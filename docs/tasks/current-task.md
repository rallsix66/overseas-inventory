# Current Task Packet

## Task ID

`P5-SY11-REWORK`（P5-SY11G）— 语义返工：用户级 Variant 归档偏好

## 状态

`P5-SY11-REWORK DONE` — P5-SY11G A~F 全部完成。P5-SY11G 返工（2026-06-25）修复 4 项阻塞问题。P5-SY11G-RUNTIME（2026-06-25）修复 2 项运行时问题 + 人工验收通过。

### P5-SY11G 返工修复（4 项）

1. **inventory repo 归档过滤 Bug**：`getOverseasList`/`getLowStock` 的 variant join select 不含 `id`，但过滤逻辑使用 `v.id` → 所有海外库存行被过滤为空。修复：改用 `row.variant_id` 判断 `archivedVariantIds.has(row.variant_id)`。
2. **variants list() 分页后过滤**：DB range 分页 → JS filter 归档 → total 错误、archived tab 空页。修复：`notIn('id',archivedArray)`/`.in('id',archivedArray)` 下推到 DB，分页前过滤。
3. **archive/restore 返回假数量**：archive 返回总数非新增、restore 返回请求数。修复：先查询已有偏好，仅操作实际需要变更的记录，返回真实数量。
4. **list() active tab 使用 .not('id','in',[...]) 生成错误 PostgREST 语法**：`.not()` 期望 `'(id1,id2)'` 括号格式，JS 数组直接字符串化为 `uuid1,uuid2` 无括号 → PostgREST 拒绝。修复：改用 postgrest-js 内置 `.notIn('id',archivedArray)`，生成正确的 `not.in.(uuid1,uuid2)` 语法。

### P5-SY11G-RUNTIME 运行时修复（2 项 + 人工验收）

1. **Migration 00012 手动执行**：`public.user_variant_preference` 表在 Supabase 生产数据库中不存在（Migration 00012 从未被执行）。自动连接不可用（Pooler 不识别 tenant `hzlhqyditalumhnxbaim`，DNS 不解析 `db.*.supabase.co`）。由用户在 Supabase Dashboard SQL Editor 手动执行 `supabase/migrations/00012_user_variant_preference.sql`。执行后通过 `NOTIFY pgrst, 'reload schema'` 刷新 PostgREST schema cache。验证：`to_regclass('public.user_variant_preference')` 返回表名，4 条 RLS 策略存在。

2. **getSyncRuns limit 契约修正**：Zod `getSyncRunsSchema.limit` 从 `max(500).default(200)` 改为 `max(100).default(100)`，`server-actions.ts` `getOverseasWarehouseSyncStatus()` 中 `repository.getSyncRuns({ limit: 500 })` 改为 `limit: 100`。DB RPC `get_sync_runs` 本身强制 `p_limit > 100` 抛异常，之前 Zod max(500) 与 DB 不一致（传 200 会被 DB 拒绝）。全局搜索 sync 模块无残余 `limit: 200` / `limit: 500` 引用。

### 人工验收结果（2026-06-25）

- `/dashboard/inventory/overseas` 正常加载（不再报 `Could not find the table 'public.user_variant_preference' in the schema cache`）
- `/dashboard/sync` 正常加载
- `/dashboard/variants` 归档/恢复正常
- 在 /dashboard/variants 归档 SKU 后，/dashboard/inventory/overseas 不再显示该 SKU
- 在已归档中恢复后，/dashboard/inventory/overseas 重新显示该 SKU
- 归档是当前账号个人偏好（A 归档不影响 B 的视图），非全局归档

### 关键设计确认

- `product_variant.is_archived` 是**遗留列**，所有业务代码已停止读写。归档通过 `user_variant_preference` 表（`user_id + variant_id + preference_type='archived'`）完成。
- `user_variant_preference` 是**个人偏好表**，通过 RLS `auth.uid() = user_id` 强制隔离。后续"特别关注"功能可新增 `preference_type='favorited'` 复用本表，但本次不实现。
- 不删除 ProductVariant，不改变 Product → ProductVariant → Inventory 模型。

## 背景

P5-SY11A~F 按**全局 ProductVariant 状态**实现了软归档：在 `product_variant` 表新增 `is_archived` 列（Migration 00011），Operator RLS 全局过滤 `is_archived = false`，仅 Admin 可执行归档/恢复。

用户已确认以下业务语义，与当前实现**严重冲突**：

| # | 用户确认语义 | 当前实现 | 冲突 |
|---|------------|---------|------|
| 1 | 归档是每个用户自己的个人偏好 | `product_variant.is_archived` 是全局列，A 归档后 B 也看不到 | **严重** |
| 2 | 每个账号都需要归档权限，不限 Admin | `archiveVariants`/`restoreVariants` 仅限 Admin | **严重** |
| 3 | A 归档的产品只影响 A；B 看不到 A 的归档状态 | Operator RLS `AND is_archived = false` 对所有用户统一隐藏 | **严重** |
| 4 | A 下次登录仍保留自己的归档列表 | 全局列持久化可保留，但不区分用户 | 需迁移 |
| 5 | 后续"特别关注"功能应共享偏好表设计 | 单列 `is_archived` 无法扩展到多种偏好类型 | 需重新设计 |

**结论**：P5-SY11A~F 技术实现（Migration / 类型 / Repository / Server Action / UI / 测试）代码质量合格，但业务语义需从全局归档迁移为**用户级个人偏好**。

## 任务目标

1. **新建 `user_variant_preference` 表**（Migration 00012）：`user_id` + `variant_id` + `preference_type`，支持 `'archived'` 类型，预留后续 `'favorited'` 等扩展。
2. **废弃 `product_variant.is_archived` 全局列**：不删除已执行 Migration 00011（约束：不修改已执行 Migration），但所有业务代码停止读写 `is_archived`，改用 `user_variant_preference` 表。
3. **每个登录用户均可归档/恢复自己的 Variant**：Admin 和 Operator 权限相同，`requireActiveAuth()` 替代 `requireActiveAdmin()`。
4. **A 的归档不影响 B**：每个用户的归档偏好完全独立，通过 `WHERE user_id = auth.uid()` RLS 隔离。
5. **Inventory 视图按当前用户归档偏好过滤**：海外库存列表、低库存统计、库存统计卡片排除当前用户已归档的 Variant。
6. **产品详情页（`getByProductId`）不过滤归档**：与 P5-SY11D 设计一致。
7. **预留"特别关注"扩展**：`preference_type` 使用 CHECK 约束枚举，当前仅 `'archived'`，后续可新增 `'favorited'` 等类型，表结构不变。本次不实现关注功能。
8. **同步写入链路完全不受影响**：归档偏好是用户级元数据，不影响 `sync_warehouse_inventory` RPC 和 inventory 写入。

## 强制架构边界

- 数据库结构变更必须通过**新 Migration 00012**，不修改已执行 Migration 00001~00011。
- `product_variant.is_archived` 列保留在 DB 中（Migration 00011 不修改），但所有业务代码不再读写该列。
- 保持 Repository Pattern、Server Actions、Zod 校验、Supabase RLS 完整链路。
- 用户偏好隔离在 **RLS 层**强制执行：`user_variant_preference` 的 SELECT/INSERT/DELETE 策略限制 `user_id = auth.uid()`。
- 所有 Inventory 视图过滤优先在 Repository/Supabase 查询层完成，避免仅依赖前端隐藏。
- 归档/恢复对所有登录用户开放（`requireActiveAuth`），不限制角色。
- 不删除 ProductVariant 双层模型。
- 不启动 P5-SY10 Phase B 自动 Real Write。
- `WEBSYNC_REAL_WRITE_ENABLED` 继续保持 disabled。
- `service_role` 不得进入前端或 client bundle。
- 不实现"特别关注"功能（仅预留表结构扩展空间）。

## 当前代码现状

### P5-SY11A~F 已完成设施（可复用）

- `src/features/variants/` 完整模块：types / repository / actions / schema / columns / components
- `src/features/inventory/repository.ts`：`getOverseasList()` / `getLowStock()` / `getOverseasStats()` / `getByProductId()`
- `src/app/dashboard/variants/` 完整页面：列表 / 未匹配 / loading / error
- `src/features/variants/components/archive-controls.tsx`：归档/恢复操作组件
- 914 项 TypeScript 测试 + 271 项 Python 测试
- Migration 00011（`is_archived` 列 + RLS）已执行

### 需要替换的部分

| 现有设施 | 问题 | 替换方案 |
|---------|------|---------|
| `product_variant.is_archived` 列 | 全局状态，A 影响 B | 停止读写；改用 `user_variant_preference` |
| `product_variant.archived_at` / `archived_by` | Admin 审计字段，语义错误 | 停止读写；`user_variant_preference.created_at` 替代时间追踪 |
| Operator RLS `AND is_archived = false` | 对所有用户统一过滤 | 新 RLS 在 `user_variant_preference` 按 `auth.uid()` 隔离 |
| `variantRepository.archive()` / `restore()` | 写全局 `is_archived`、接受 `archivedBy` | 重写为 INSERT/DELETE `user_variant_preference`、接受 `userId` |
| `variantRepository.list()` 的 `archiveStatus` 过滤 | WHERE `is_archived = true/false` | LEFT JOIN `user_variant_preference` ON current user |
| `variantRepository.match()` / `unmatch()` / `batchMatch()` 归档阻止 | 读取 `is_archived` 全局列 | 改为检查当前用户是否已归档（但匹配操作应独立于个人偏好，本次需重新评估是否保留阻止逻辑） |
| `archiveVariants` / `restoreVariants` Server Actions | `requireActiveAdmin()` | 改为 `requireActiveAuth()` |
| `archive-controls.tsx` | Admin 专属 | 所有已登录用户可见 |
| Variant 页面权限 | Operator 只读、无操作按钮 | Admin 和 Operator 均可归档/恢复 |

### 需要保留不变的部分

- `src/features/inventory/repository.ts` 的过滤策略（过滤已归档 Variant），但过滤条件从全局 `is_archived` 改为当前用户的 `user_variant_preference`
- `getByProductId()` 不过滤归档
- 同步 RPC `sync_warehouse_inventory` 完全不涉及归档
- Variant 页面整体 UI 布局（筛选标签 / 表格 / 搜索 / 分页）
- 非回归测试的核心断言逻辑（同步不受影响、恢复后可见）

## 子任务拆分

| Sub-Task ID | 任务 | 目标 | 依赖 | 状态 |
|---|---|---|---|---|
| **P5-SY11G-A** | Migration 00012：`user_variant_preference` 表 + RLS | 新建 migration 文件，含 DDL（`user_variant_preference` 表含 `user_id`/`variant_id`/`preference_type`/`created_at`）+ UNIQUE 约束 + 索引 + RLS（用户仅能操作自己的偏好）+ 静态契约测试 | — | **DONE** |
| **P5-SY11G-B** | 类型同步 + Variant Repository 重写 | 更新 `database.ts` 类型；`variantRepository` 新增 `archive()`/`restore()`/`getUserArchivedVariantIds()` 方法（基于 `user_variant_preference`）；`list()`/`getUnmatched()` 改为 LEFT JOIN `user_variant_preference` 按当前用户过滤；评估并调整 `match()`/`unmatch()`/`batchMatch()` 归档阻止逻辑 | P5-SY11G-A | **DONE** |
| **P5-SY11G-C** | Server Actions：重写 `archiveVariants` / `restoreVariants` | `requireActiveAuth()` 替代 `requireActiveAdmin()`；从 session 获取 `userId`；调用重写后的 repository 方法；Zod 校验 + revalidatePath | P5-SY11G-B | **DONE** |
| **P5-SY11G-D** | Inventory 层过滤：按当前用户归档偏好过滤 | `getOverseasList()`/`getLowStock()`/`getOverseasStats()` 改为基于 `user_variant_preference` 过滤（排除当前用户已归档的 Variant）；`getByProductId()` 不过滤；实现策略优先 DB 层（LEFT JOIN + IS NULL 排除），JS 兜底 | P5-SY11G-A | **DONE** |
| **P5-SY11G-E** | Variant 页面 UI：所有用户均可归档/恢复 | `archive-controls.tsx` 对所有已登录用户可见；页面权限标签不再区分 Admin/Operator（均可归档/恢复）；搜索/筛选/分页复用现有实现 | P5-SY11G-C, P5-SY11G-D | **DONE** |
| **P5-SY11G-F** | 质量门 + 非回归验证 + 文档收口 | 全量测试 + lint + build + Python；验证全局 is_archived 代码路径已全部替换；验证 A 归档不影响 B；验证恢复后库存正确；文档同步 | P5-SY11G-E | **DONE** |

## 子任务详细规格

### P5-SY11G-A — Migration 00012

**新文件**：
- `supabase/migrations/00012_user_variant_preference.sql`
- `supabase/migrations/00012_user_variant_preference.test.ts`（静态契约测试）

**DDL 内容**：

```sql
-- 1. 新建用户 Variant 偏好表
CREATE TABLE IF NOT EXISTS user_variant_preference (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  variant_id      uuid        NOT NULL REFERENCES product_variant(id) ON DELETE CASCADE,
  preference_type text        NOT NULL CHECK (preference_type IN ('archived')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, variant_id, preference_type)
);

-- 2. 索引：按用户查询偏好
CREATE INDEX IF NOT EXISTS idx_uvp_user_type
  ON user_variant_preference (user_id, preference_type);

-- 3. 索引：按 Variant 查询（用于检查特定 Variant 的被归档情况）
CREATE INDEX IF NOT EXISTS idx_uvp_variant
  ON user_variant_preference (variant_id, preference_type);

-- 4. RLS：启用
ALTER TABLE user_variant_preference ENABLE ROW LEVEL SECURITY;

-- 5. RLS：用户可以查看自己的偏好
CREATE POLICY "user_select_own_preferences" ON user_variant_preference
  FOR SELECT
  USING (auth.uid() = user_id);

-- 6. RLS：用户可以插入自己的偏好
CREATE POLICY "user_insert_own_preferences" ON user_variant_preference
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 7. RLS：用户可以删除自己的偏好
CREATE POLICY "user_delete_own_preferences" ON user_variant_preference
  FOR DELETE
  USING (auth.uid() = user_id);

-- 8. Admin 全权限（可查看所有用户的偏好，用于支持和审计）
CREATE POLICY "admin_all_preferences" ON user_variant_preference
  FOR ALL
  USING (get_user_role() = 'admin');
```

**设计说明**：
- `preference_type` 使用 CHECK 约束枚举，当前仅 `'archived'`。后续"特别关注"功能只需 `ALTER TABLE ... DROP CONSTRAINT ... ADD CHECK (preference_type IN ('archived', 'favorited'))`，表结构不变。
- `UNIQUE (user_id, variant_id, preference_type)` 防止同一用户对同一 Variant 重复归档。
- `ON DELETE CASCADE`：用户或 Variant 被删除时自动清理偏好记录。
- Admin 保留全权限策略，用于技术支持场景（不暴露在普通 UI）。

**验收标准**：
- DDL 语法正确，可重复执行（`IF NOT EXISTS`）
- `preference_type` CHECK 约束仅允许 `'archived'`
- UNIQUE 约束防止重复归档
- FK 约束指向 `profiles(id)` 和 `product_variant(id)`
- RLS：用户仅能 SELECT/INSERT/DELETE 自己的行
- Admin RLS 可查看全部
- 不修改已执行 Migration 00001~00011
- `product_variant.is_archived` 列保留不动（不 DROP）
- 静态测试 ≥10 项（表存在、列存在/类型、UNIQUE、FK、索引、RLS 策略数量与内容、CHECK 约束）

### P5-SY11G-B — 类型同步 + Variant Repository 重写

**修改文件**：
- `src/types/database.ts` — 新增 `user_variant_preference` 表的 Row/Insert/Update 类型
- `src/features/variants/types.ts` — `VariantFilters` 的 `archiveStatus` 语义调整；新增 `UserVariantPreference` 类型
- `src/features/variants/schema.ts` — 更新 `archiveVariantsSchema` / `restoreVariantsSchema`（移除 `archivedBy` 相关，改为从 session 获取 userId）
- `src/features/variants/repository.ts` — 重写归档相关方法

**Repository 重写方法**：

```typescript
// 获取当前用户已归档的 Variant ID 集合（用于过滤）
getUserArchivedVariantIds(userId: string): Promise<Set<string>>

// 批量归档（INSERT INTO user_variant_preference）
archive(variantIds: string[], userId: string): Promise<{ archived: number }>

// 批量恢复（DELETE FROM user_variant_preference）
restore(variantIds: string[], userId: string): Promise<{ restored: number }>
```

**Repository 修改**：

| 方法 | 修改 |
|---|---|
| `list(filters, userId)` | `filters.archiveStatus` 默认 `'active'` 时 LEFT JOIN `user_variant_preference` ON `variant.id = uvp.variant_id AND uvp.user_id = <userId> AND uvp.preference_type = 'archived'`，过滤 `WHERE uvp.id IS NULL`（未归档）；`'archived'` 时过滤 `WHERE uvp.id IS NOT NULL`；`'all'` 时不过滤 |
| `getUnmatched(userId)` | LEFT JOIN + IS NULL 排除当前用户已归档 Variant |
| `match()` / `unmatch()` / `batchMatch()` | **评估**：当前阻止已归档 Variant 的匹配操作是基于全局 `is_archived`。在用户级偏好模型下，归档是个人视图偏好，不应阻止其他用户的业务操作。建议：**移除归档阻止逻辑**，匹配/取消匹配操作独立于任何用户的归档偏好。若用户希望看到已归档 Variant，可通过 `archiveStatus='all'` 查看。 |
| `getById()` | 新增可选参数 `userId`，返回 Variant 详情 + 当前用户是否已归档 |

**移除/废弃**：
- 不再读写 `product_variant.is_archived`、`archived_at`、`archived_by` 列
- `database.ts` 中 `product_variant` Row 的 `is_archived`/`archived_at`/`archived_by` 字段保留类型定义但标注 `@deprecated`

**验收标准**：
- `database.ts` 新增 `user_variant_preference` 类型，与 Migration 00012 一致
- `list()` / `list({})` 默认仅返回当前用户未归档的 Variant
- `list({ archiveStatus: 'archived' })` 仅返回当前用户已归档 Variant
- `list({ archiveStatus: 'all' })` 返回全部（含归档状态标记）
- `archive()` 正确 INSERT INTO `user_variant_preference`（`user_id` + `variant_id` + `preference_type='archived'`）
- `restore()` 正确 DELETE FROM `user_variant_preference` WHERE `user_id` + `variant_id`
- 重复归档同一 Variant 返回明确中文错误
- `getUnmatched()` 排除当前用户已归档 Variant
- 匹配操作不再因归档状态阻止（或保留阻止但基于当前用户偏好）
- Repository 测试 ≥25 项

### P5-SY11G-C — Server Actions

**修改文件**：
- `src/features/variants/actions.ts` — 重写 `archiveVariants()` / `restoreVariants()`

**Server Action 签名**：

```typescript
// 任何已登录用户批量归档自己的 Variant
export async function archiveVariants(variantIds: string[]): Promise<ActionResult<{ archived: number }>>

// 任何已登录用户批量恢复自己的 Variant
export async function restoreVariants(variantIds: string[]): Promise<ActionResult<{ restored: number }>>
```

**实现要点**：
- `requireActiveAuth()` 校验（Admin 和 Operator 均可，无需 `requireActiveAdmin`）
- 从 `getCurrentActiveUser()` 获取 `userId`
- Zod 校验：`variantIds` 为非空 UUID 数组，去重
- 调用 `variantRepository.archive(userId, variantIds)` / `variantRepository.restore(userId, variantIds)`
- `revalidatePath('/dashboard/variants')` 和 `/dashboard/variants/unmatched`
- 错误处理：`VariantError` → 中文错误；未知错误 → 通用提示

**验收标准**：
- 活跃 Admin 可成功归档/恢复（操作的是自己的偏好）
- 活跃 Operator 可成功归档/恢复
- 非活跃用户调用返回权限错误（`requireActiveAuth` 拒绝 `is_active = false`）
- 未认证用户调用返回权限错误
- 空数组返回参数校验错误
- 非法 UUID 返回校验错误
- 不存在的 Variant ID 返回明确中文错误
- Admin A 归档 Variant X → Admin B 视图不受影响（B 仍可看到 Variant X）
- 操作后页面路径已 revalidate
- Server Action 测试 ≥18 项

### P5-SY11G-D — Inventory 层过滤

**修改文件**：
- `src/features/inventory/repository.ts`
- `src/features/inventory/types.ts`（如需）

**修改内容**：

| 方法 | 修改 |
|---|---|
| `getOverseasList(filters, userId)` | 新增 `userId` 参数；排除当前用户在 `user_variant_preference` 中 `preference_type='archived'` 的 Variant；优先 DB 层：NOT EXISTS (SELECT 1 FROM user_variant_preference WHERE variant_id = inventory.variant_id AND user_id = <userId> AND preference_type = 'archived')；JS 兜底排除 |
| `getLowStock(filters, userId)` | 同上 |
| `getOverseasStats(userId)` | 同上 |
| `getByProductId(productId)` | **不过滤**，不传 userId |

**实现策略**：
- **第一优先级**：DB 层过滤。使用 NOT EXISTS 子查询或 LEFT JOIN + IS NULL 排除当前用户已归档 Variant。
- **JS 兜底**：查询时携带 `variant_id`，批量查询 `user_variant_preference` 获取当前用户已归档集合，在 JS 层排除。确保 `variant == null` 也被排除（防御性）。
- **Admin 调用**：`userId` 从 session 获取，Admin 也只看自己的归档偏好。

**验收标准**：
- 海外库存列表不显示当前用户已归档 Variant 的库存
- 低库存统计不包含当前用户已归档 Variant
- 海外库存统计卡片不计数当前用户已归档 Variant
- 产品详情页（`getByProductId`）仍显示全部 Variant 库存
- 用户 A 归档 Variant X → 用户 B 的库存视图不受影响
- 恢复后 Variant 重新出现在当前用户的默认视图
- 测试 ≥15 项

### P5-SY11G-E — Variant 页面 UI

**修改文件**：
- `src/app/dashboard/variants/_components/variant-page-content.tsx` — 交互层
- `src/app/dashboard/variants/page.tsx` — Server Component
- `src/app/dashboard/variants/unmatched/page.tsx` — 未匹配页面
- `src/features/variants/components/archive-controls.tsx` — 操作组件

**权限变更**：

| 元素 | P5-SY11E（旧） | P5-SY11G（新） |
|------|--------------|--------------|
| 归档/恢复按钮 | 仅 Admin 可见 | 所有已登录用户可见 |
| 复选框批量选择 | 仅 Admin 可见 | 所有已登录用户可见 |
| 归档筛选标签（活跃/已归档/全部） | Admin 全部，Operator 仅活跃 | 所有用户全部标签可用 |
| 页面访问 | `requireActiveAuth()` | `requireActiveAuth()`（不变） |

**实现要点**：
- `page.tsx`：`requireActiveAuth()` 获取当前用户 `userId` 和角色，传递给 Client Component
- `variant-page-content.tsx`：移除 `isAdmin` 条件判断归档操作（复选框和按钮对所有用户可见）；每个用户看到的归档状态是自己的
- `archive-controls.tsx`：移除 Admin 角色校验文案；操作确认 Dialog 不提及"管理员"
- `unmatched/page.tsx`：使用当前用户 `userId` 过滤归档

**验收标准**：
- Admin 可见归档/恢复按钮，操作的是自己的偏好
- Operator 可见归档/恢复按钮，操作的是自己的偏好
- 用户 A 归档 Variant X 后，用户 A 的列表中 X 显示为已归档
- 用户 B 同时登录，列表中 X 仍显示为活跃（不受 A 影响）
- 归档筛选标签切换正确（活跃/已归档/全部—基于当前用户）
- 搜索功能正常
- 空数据、加载、错误状态已处理
- 页面不直接访问 Supabase（走 Repository → Server Action 链）
- 测试 ≥18 项

### P5-SY11G-F — 质量门 + 非回归验证 + 文档收口

**质量门**：
- `npm run test` 全部通过（排除 `**/concurrency.test.ts`）
- `npm run lint` 0 errors
- `npm run build` 通过
- Python 测试全部通过（compileall + 所有 test_*.py）

**非回归验证**：
- 同步 RPC `sync_warehouse_inventory` 对任意用户归档的 Variant 的 inventory 更新正常（归档是纯 UI 层偏好）
- 恢复后 Variant 重新出现在当前用户的默认视图，库存为最新同步值
- 新发现 SKU 创建的 Variant 对所有用户默认可见（无归档偏好记录）
- 全局 `is_archived` 代码路径已全部替换为 `user_variant_preference` 查询
- 用户 A 归档/恢复不影响用户 B 的视图（多用户隔离验证）
- P5-SY11A~E 的同功能测试不退化（调整断言后迁移到新语义）

**文档同步**：
- `docs/current-state.md`：P5-SY11-REWORK 完成状态
- `docs/tasks/current-task.md`：子任务状态
- `docs/tasks/phase-5-sync.md`：P5-SY11G 更新
- 明确记录：`product_variant.is_archived` 列为遗留列、不再被业务代码读写

## 验收标准

- `user_variant_preference` 表存在，含 `user_id`/`variant_id`/`preference_type`/`created_at` 列。
- `preference_type` CHECK 约束仅允许 `'archived'`（预留扩展）。
- UNIQUE (user_id, variant_id, preference_type) 约束有效。
- RLS：用户仅能 SELECT/INSERT/DELETE 自己的偏好行。
- 每个已登录用户（Admin + Operator）均可归档/恢复 Variant。
- 用户 A 的归档完全不影响用户 B 的视图（每人独立偏好）。
- 默认库存列表、低库存统计、海外库存统计不显示当前用户已归档 Variant。
- 产品详情页 (`getByProductId`) 仍显示全部 Variant 库存（含其他用户归档的）。
- `shipment_item` 等历史记录不受归档影响。
- 已归档 Variant 的 inventory 仍可被同步链路更新。
- 恢复后的 Variant 重新出现在当前用户的默认视图中，库存为最新值。
- 新创建 Variant 对所有用户默认可见。
- `product_variant.is_archived` 列保留在 DB 中但业务代码不再读写。
- 不删除 ProductVariant，不改变 Product → ProductVariant → Inventory 模型。
- 权限在 Server Action + RLS 双重保障（用户仅操作自己的偏好）。
- `npm run test` 通过（排除 concurrency.test.ts）。
- `npm run lint` 0 errors。
- `npm run build` 通过。
- Python tests 全部通过。
- 不修改已执行 Migration 00001~00011。
- 不新增数据库表（仅新增 `user_variant_preference` 一张表）。
- 不重新提交 `.env.local`、`runtime/profile`、cookie。

## 测试要求

- Migration 静态契约测试：≥10 项（表存在、列存在/类型、UNIQUE、FK、索引、RLS 策略、CHECK 约束）
- Repository 测试：≥25 项（archive/restore/list 过滤/getUnmatched 过滤/getUserArchivedVariantIds/重复归档/多用户隔离）
- Server Action 测试：≥18 项（活跃 Admin 成功/活跃 Operator 成功/非活跃拒绝/未认证拒绝/校验/边界/多用户隔离）
- Inventory 过滤测试：≥15 项（海外列表/低库存/统计/产品详情不过滤/NOT EXISTS 过滤/多用户隔离）
- UI 测试：≥18 项（组件渲染/权限均等/筛选标签/操作按钮/多用户隔离/边界）
- 非回归测试：≥8 项（同步不受影响/恢复后可见/is_archived 代码路径已替换/多用户隔离/新 Variant 默认可见）
- 不退化现有 914 项 TS 测试 + 271 项 Python 测试（调整断言后的子集）

## 停止条件

- P5-SY11G-A~F 全部完成。不进入 P5-SY12，不启用 P5-SY10 Phase B 自动 Real Write。
- 不删除 ProductVariant、不删除数据库行（除 `user_variant_preference` 的 DELETE 操作外）。
- 不改变 Product → ProductVariant → Inventory 模型。
- 不修改已执行 Migration 00001~00011。
- 不删除 `product_variant.is_archived` 列（仅停止使用）。
- `WEBSYNC_REAL_WRITE_ENABLED` 保持 false。
- 不实现"特别关注"功能（仅预留 `preference_type` 扩展空间）。

## 依赖

- P5-SY9 全部子任务（A~K）DONE — 全部 5 海外仓批量真实写入完成。
- P5-SY10 全部子任务（A~F）DONE — 自动 Dry Run 预审与 Cron 调度完成。
- P5-SY11A~F 全部 DONE — 全球归档技术实现完成（代码可复用，语义需迁移）。
- Migration 00001~00011（全部已执行）。
- Variant Feature Module（`src/features/variants/`）— 现有 types/repository/actions/schema/columns/components 可复用。
- Inventory Feature Module（`src/features/inventory/`）— 现有 repository 可复用。
- Supabase 当前生产数据库配置。

## 设计决策记录

### D1：为什么不直接 DROP `is_archived` 列？

约束"不修改已执行 Migration"禁止 ALTER TABLE DROP COLUMN 通过新 Migration。`is_archived` 列保留在 DB 中作为遗留列，业务代码全部停止读写。若将来确认无影响，可通过独立 Migration 清理（需用户明确确认）。

### D2：为什么匹配操作不再因归档阻止？

在全局归档模型下，归档是 Variant 级别的"冻结"状态，阻止匹配有业务意义。在用户偏好模型下，归档仅是 A 个人的视图偏好——A 不想看某个 Variant，不代表这个 Variant 不应该被 B 匹配。匹配/取消匹配是业务操作，独立于个人视图偏好。

### D3：为什么 Admin 保留 `user_variant_preference` 全权限 RLS？

Admin 可能需要在技术支持的场景下查看和清理用户的偏好记录。但日常 UI 操作（归档/恢复按钮）始终操作当前登录用户自己的偏好，不暴露"以其他用户身份操作"的 UI 入口。

### D4：预留"特别关注"扩展

`preference_type` CHECK 约束当前仅允许 `'archived'`。后续实现"特别关注"时：
1. 新 Migration `ALTER TABLE user_variant_preference DROP CONSTRAINT ... ADD CHECK (preference_type IN ('archived', 'favorited'))`
2. 新增 `favoriteVariants` / `unfavoriteVariants` Server Actions
3. Variant 列表新增 `preference_type='favorited'` 筛选标签
4. Inventory 视图可选择性按关注过滤（不同于归档的默认排除语义：归档=排除，关注=高亮/置顶）

## 后置计划

- **P5-SY12** — 下一任务（Pending，待本次返工完成后根据真实业务需求确定）。
- **"特别关注"功能** — 复用 `user_variant_preference` 表，新增 `preference_type='favorited'`。本次不实现。
- **P5-SY10 Phase B** — PASS 仓库自动 Real Write（设计预留，需运行稳定并建立每仓基线后评估）。
- **`product_variant.is_archived` 列清理** — 确认无影响后可通过独立 Migration 移除遗留列。
