# Current Task Packet

## Task ID

`P5-SY11` — ProductVariant 软归档与库存视图降噪

## 状态

`IN_PROGRESS` — P5-SY11A~F 子任务已拆分，等待 Codex 独立设计审查后启动实现。P5-SY9 全部子任务（A~K）DONE。P5-SY10 全部子任务（A~F）DONE。

## 背景

P5-SY9 已完成全部 5 海外仓的生产化批量同步，数据库中已有数百个 ProductVariant 记录。随着同步持续运行，会出现以下运营噪音：

- 停产物料、供应商切换等导致部分 SKU 不再活跃
- 但这些 Variant **不能删除**：同步会通过 `ON CONFLICT DO NOTHING` 重新创建，且 `shipment_item` 等历史记录通过 FK 引用它们
- 库存列表、低库存统计中仍会显示已废弃 SKU，干扰运营判断

P5-SY11 引入**软归档**机制：保留 Variant 数据和同步链路完整性，但从默认视图中隐藏已归档条目，降低运营噪音。

## 任务目标

1. **新增 `product_variant.is_archived` 软归档字段**：通过 Migration 00011 增加列、可选审计字段、索引和 RLS 调整。
2. **默认库存列表、低库存统计、常规 Variant 列表隐藏已归档 Variant**：Repository 层默认过滤 `is_archived = true`，数据库层 (RLS) Operator SELECT 策略增加 `AND is_archived = false`。
3. **同步写入链路不受影响**：已归档 Variant 的 `inventory` 仍被同步更新，确保恢复后数据是最新值。
4. **Admin 可手动归档/恢复**：新增 Server Actions，仅 Admin 可执行；归档时记录 `archived_at` 和 `archived_by`。
5. **Operator 只读**：数据库 RLS 层面拒绝 Operator 查看已归档 Variant；页面不展示归档/恢复操作入口。
6. **不删除 ProductVariant、不改变 Product → ProductVariant → Inventory 模型**。

## 强制架构边界

- 数据库结构变更必须通过**新 Migration 00011**，不修改已执行 Migration 00001~00010。
- 保持 Repository Pattern、Server Actions、Zod 校验、Supabase RLS 完整链路。
- 所有视图过滤优先在 Repository/Supabase 查询层完成，避免仅依赖前端隐藏。
- Operator 对已归档 Variant 的不可见性在 **RLS 层**强制执行，不依赖应用代码。
- 同步 RPC（`sync_warehouse_inventory`）不修改，`INSERT ON CONFLICT DO NOTHING` 不涉及 `is_archived`。
- 归档/恢复仅 Admin 可操作（Server Action + RLS 双重校验）。
- 不删除 ProductVariant 双层模型。
- 不启动 P5-SY10 Phase B 自动 Real Write。
- `WEBSYNC_REAL_WRITE_ENABLED` 继续保持 disabled。
- `service_role` 不得进入前端或 client bundle。

## 当前代码现状

### product_variant 表（Migration 00001）

```sql
CREATE TABLE product_variant (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   uuid        REFERENCES product(id) ON DELETE SET NULL,
  sku          text        NOT NULL,
  country      text        NOT NULL CHECK (country IN ('TH','ID','MY','PH','VN','CN')),
  name         text        NOT NULL,
  match_status text        NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('matched','unmatched','pending')),
  last_sync_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT variant_sku_country_unique UNIQUE (sku, country)
);
```

**`is_archived` 不存在**。Migration 00003~00010 均未修改 product_variant 列。

### 当前 RLS（Migration 00001 + 00003）

- `admin_all_variant`：Admin 全权限（ALL）
- `operator_select_variant`：Operator 只读（SELECT），**无 `is_archived` 过滤**

### 当前 Variant 页面

`src/app/dashboard/variants/page.tsx` 和 `unmatched/page.tsx` 为 Phase 1 占位符，仅返回静态占位文本，未连接数据。

### 当前 Inventory 查询

`src/features/inventory/repository.ts` 的 `getOverseasList()`、`getLowStock()`、`getOverseasStats()` 通过 `variant:variant_id (...)` 关联查询，**未过滤 `is_archived`**（该列不存在）。

### 同步 RPC

Migration 00009 的 `sync_warehouse_inventory` 使用 `INSERT INTO product_variant (...) VALUES (...) ON CONFLICT (sku, country) DO NOTHING`，仅创建新 Variant，不更新已有行。新增 `is_archived` 列后新 Variant 默认 `false`，已有归档 Variant 不受影响。

### 现有 Variant Feature Module

`src/features/variants/` 已有完整基础设施：
- `types.ts`：`VariantRow`（继承 Database 类型）、`VariantItem`、`VariantFilters`（country/matchStatus/productId/search）
- `repository.ts`：`list()`、`getUnmatched()`、`getById()`、`match()`、`unmatch()`、`batchMatch()`，均通过 `createClient()` 走 RLS
- `actions.ts`：`matchVariant()`、`unmatchVariant()`、`batchMatchVariants()`，均 `requireAdmin()`
- `schema.ts`：`variantMatchSchema`、`variantSearchSchema`
- `columns.tsx`：6 列定义（sku/name/country/match_status/productName/last_sync_at）

## 子任务拆分

| Sub-Task ID | 任务 | 目标 | 依赖 | 状态 |
|---|---|---|---|---|
| **P5-SY11A** | Migration 00011：`is_archived` 列 + 审计字段 + 索引 + RLS | 新增 migration 文件，含 DDL（`is_archived` + `archived_at` + `archived_by`）、部分索引、RLS 调整（Operator SELECT 过滤 `is_archived=false`）、静态契约测试 | — | PENDING |
| **P5-SY11B** | 类型同步 + Repository：archive/restore/filter | 更新 `database.ts` 类型；`variantRepository` 新增 `archive()`/`restore()` 方法；`list()`/`getUnmatched()` 增加 `archiveStatus` 过滤；`match()`/`unmatch()`/`batchMatch()` 阻止已归档 Variant 操作；Mock 实现 + 测试 | P5-SY11A | PENDING |
| **P5-SY11C** | Server Actions：`archiveVariants` / `restoreVariants` | Admin 专用 Server Action，Zod 校验 + revalidatePath；Admin/Operator 权限测试 | P5-SY11B | PENDING |
| **P5-SY11D** | Inventory 层过滤：默认视图隐藏已归档 Variant | `getOverseasList()`/`getLowStock()`/`getOverseasStats()` 过滤已归档 Variant；`getByProductId()` 不过滤；测试覆盖 | P5-SY11A | PENDING |
| **P5-SY11E** | Variant 列表页面 + 归档/恢复 UI | 实现 `variants/page.tsx`（Server + Client Component）：数据表格、归档筛选标签（活跃/已归档/全部）、Admin 批量归档/恢复按钮；`unmatched/page.tsx` 仅显示活跃未匹配；Operator 只读 | P5-SY11C, P5-SY11D | PENDING |
| **P5-SY11F** | 同步非回归验证 + 质量门 + 文档收口 | 验证同步 RPC 不受影响、恢复后库存正确出现；全量测试 + lint/build + Python；文档同步 | P5-SY11E | PENDING |

## 子任务详细规格

### P5-SY11A — Migration 00011

**新文件**：
- `supabase/migrations/00011_add_variant_soft_archive.sql`
- `supabase/migrations/00011_add_variant_soft_archive.test.ts`（静态契约测试）

**DDL 内容**：

```sql
-- 1. 新增 is_archived 列
ALTER TABLE product_variant
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;

-- 2. 新增审计列（可选）
ALTER TABLE product_variant
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE product_variant
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES profiles(id);

-- 3. 部分索引（仅已归档行，体积小）
CREATE INDEX IF NOT EXISTS idx_variant_is_archived
  ON product_variant (is_archived)
  WHERE is_archived = true;

-- 4. RLS：收紧 Operator SELECT
DROP POLICY IF EXISTS "operator_select_variant" ON product_variant;

CREATE POLICY "operator_select_variant" ON product_variant
  FOR SELECT
  USING (get_user_role() = 'operator' AND is_archived = false);

-- admin_all_variant 保持不变（Admin 可查看全部）
```

**验收标准**：
- DDL 语法正确，可重复执行（`IF NOT EXISTS` / `DROP IF EXISTS`）
- `is_archived` 默认 `false`，新 Variant 不受影响
- `archived_by` 有 FK 约束指向 `profiles(id)`
- 部分索引仅覆盖 `is_archived = true` 行
- Operator SELECT 策略包含 `AND is_archived = false`
- Admin 策略不变（全权限）
- 不修改已执行 Migration
- 静态测试 ≥8 项（列存在、默认值、索引、FK、RLS 策略数量与内容）

### P5-SY11B — 类型同步 + Repository

**修改文件**：
- `src/types/database.ts` — `product_variant` 的 Row/Insert/Update 增加 `is_archived`、`archived_at`、`archived_by`
- `src/features/variants/types.ts` — `VariantFilters` 增加 `archiveStatus?: 'active' | 'archived' | 'all'`
- `src/features/variants/schema.ts` — 新增 `archiveVariantsSchema` / `restoreVariantsSchema` / 更新 `variantSearchSchema` 增加 `archiveStatus`
- `src/features/variants/repository.ts` — 新增方法 + 修改现有方法

**Repository 新增方法**：

```typescript
// 批量归档
archive(variantIds: string[], archivedBy: string): Promise<{ archived: number }>

// 批量恢复
restore(variantIds: string[]): Promise<{ restored: number }>
```

**Repository 修改**：

| 方法 | 修改 |
|---|---|
| `list(filters)` | `filters.archiveStatus` 默认 `'active'` 时过滤 `is_archived = false`；`'archived'` 时过滤 `is_archived = true`；`'all'` 时不过滤（显式传入，仅 Admin 使用） |
| `getUnmatched()` | 增加 `.eq('is_archived', false)` — 仅返回活跃的未匹配 Variant |
| `match()` | 归档检查：如 Variant 已归档，抛出 `VariantError('ARCHIVED')` |
| `unmatch()` | 同上 |
| `batchMatch()` | 同上（在应用层逐 ID 检查或 RPC 层校验） |

**验收标准**：
- `database.ts` 类型与 Migration 00011 一致
- `list()` / `list({})` 默认仅返回活跃 Variant（`archiveStatus` 默认 `'active'`）
- `list({ archiveStatus: 'archived' })` 仅返回已归档 Variant
- `list({ archiveStatus: 'all' })` 返回全部（仅 Admin 显式传入）
- `archive()` 正确设置 `is_archived=true`、`archived_at=now()`、`archived_by`
- `restore()` 正确设置 `is_archived=false`、清空审计字段
- `match()`/`unmatch()`/`batchMatch()` 对已归档 Variant 抛出 `ARCHIVED` 错误
- Repository 测试 ≥20 项

### P5-SY11C — Server Actions

**修改文件**：
- `src/features/variants/actions.ts` — 新增 `archiveVariants()` / `restoreVariants()`

**Server Action 签名**：

```typescript
// Admin 批量归档
export async function archiveVariants(variantIds: string[]): Promise<ActionResult<{ archived: number }>>

// Admin 批量恢复
export async function restoreVariants(variantIds: string[]): Promise<ActionResult<{ restored: number }>>
```

**实现要点**：
- `requireActiveAdmin()` 校验（拒绝非活跃 Admin、Operator、未认证用户）
- Zod 校验：`variantIds` 为非空 UUID 数组，去重
- 调用 `variantRepository.archive()` / `variantRepository.restore()`
- `revalidatePath('/dashboard/variants')` 和 `/dashboard/variants/unmatched`
- 错误处理：`VariantError` → 中文错误；未知错误 → 通用提示

**验收标准**：
- 活跃 Admin 可成功归档/恢复
- 非活跃 Admin 调用返回权限错误（`requireActiveAdmin` 拒绝）
- Operator 调用返回权限错误
- 未认证用户调用返回权限错误
- 空数组返回参数校验错误
- 非法 UUID 返回校验错误
- 不存在的 Variant ID 返回明确中文错误
- 操作后页面路径已 revalidate
- Server Action 测试 ≥15 项（活跃 Admin 成功/非活跃 Admin 拒绝/Operator 拒绝/未认证拒绝/空数组/非法 ID/不存在 ID/已归档重复归档等）

### P5-SY11D — Inventory 层过滤

**修改文件**：
- `src/features/inventory/repository.ts`
- `src/features/inventory/types.ts`（如需）

**修改内容**：

| 方法 | 修改 |
|---|---|
| `getOverseasList()` | 使用 inner join 或 DB/RPC 层可靠过滤已归档 Variant；JS 兜底必须排除 `variant == null` 和 `is_archived === true` |
| `getLowStock()` | 同上 |
| `getOverseasStats()` | 同上（统计前排除已归档 Variant 的 inventory 记录） |
| `getByProductId()` | **不过滤** — 产品详情页应显示全部 Variant（含已归档） |

**实现策略**：
- **第一优先级**：DB 层过滤。Supabase 查询使用 `variant:variant_id!inner (id, is_archived)` + `.eq('variant.is_archived', false)` 过滤已归档 Variant。若 Supabase 关联 `.eq()` 不能可靠过滤 inventory 主表，则改用 RPC 或 SQL `INNER JOIN product_variant ON inventory.variant_id = product_variant.id AND product_variant.is_archived = false`。
- **JS 兜底**：查询选择 `variant:variant_id (id, is_archived)` 时解包，显式排除两条：`variant == null`（防止 null variant 泄漏）和 `variant.is_archived === true`。兜底层不得跳过 null 检查。
- **Operator RLS 配合**：Operator 的 `operator_select_variant` 策略已包含 `AND is_archived = false`，Operator 无法看见已归档 Variant 数据。但当 `inventory.variant_id` 对应一个 Operator 不可见的 Variant 时，Supabase 关联展开的 `variant` 字段可能为 `null`——JS 兜底的 `variant == null` 排除必须覆盖此场景，确保 Operator 视角下不泄漏已归档库存。

**验收标准**：
- 海外库存列表不显示已归档 Variant 的库存
- 低库存统计不包含已归档 Variant
- 海外库存统计卡片不计数已归档 Variant
- 产品详情页（`getByProductId`）仍显示已归档 Variant 的库存
- 恢复后 Variant 重新出现在默认视图
- **Operator RLS + null variant 不泄漏 inventory**：当 inventory 关联到一个 Operator 不可见（已归档）的 Variant 时，展开结果为 `null`，JS 兜底正确排除，不显示该行
- 测试 ≥12 项（含 null variant 排除 / RLS 泄漏测试 / DB 层过滤验证）

### P5-SY11E — Variant 列表页面 + 归档/恢复 UI

**新文件**：
- `src/features/variants/components/variant-table.tsx` — 客户端数据表格组件
- `src/features/variants/components/archive-controls.tsx` — 归档/恢复操作组件

**修改文件**：
- `src/app/dashboard/variants/page.tsx` — 替换占位符
- `src/app/dashboard/variants/unmatched/page.tsx` — 替换占位符（仅活跃未匹配）
- `src/features/variants/columns.tsx` — 增加 `is_archived` 状态列

**页面设计**：

```
┌─────────────────────────────────────────────────┐
│  SKU 管理                                       │
│                                                 │
│  [活跃] [已归档] [全部]    🔍 搜索 SKU/名称     │
│                                                 │
│  ┌─ 批量操作 ─────────────────────────────────┐ │
│  │ ☐ 全选  已选 3 项  [归档选中] [恢复选中]   │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  ┌─────────────────────────────────────────────┐│
│  │ ☐│SKU        │名称    │国家│匹配│产品│归档 ││
│  │──│───────────│────────│────│────│────│─────││
│  │☐│SKU-001    │产品A   │PH  │已匹│产品A│     ││
│  │☐│SKU-002    │旧产品  │PH  │未匹│—   │📦已归档││
│  │  │...        │        │    │    │    │     ││
│  └─────────────────────────────────────────────┘│
│                        第 1 页，共 N 页          │
└─────────────────────────────────────────────────┘
```

**组件结构**：
- Server Component（`page.tsx`）：`requireActiveAuth()` 获取当前用户角色，传递 `isAdmin` 和初始数据
- Client Component（`variant-table.tsx`）：
  - 归档筛选标签（活跃/已归档/全部）→ URL search params
  - 数据表格（复用 `columns.tsx` + 新增 `is_archived` 列）
  - 复选框批量选择（仅 Admin 可见）
  - 归档/恢复按钮（仅 Admin 可见，仅选中行操作）
  - 分页（客户端或服务端分页，数据量 <500 行时客户端分页即可）
- `unmatched/page.tsx`：仅活跃未匹配 Variant 列表，无归档筛选，无归档按钮

**权限**：
- Admin：可查看全部标签页（活跃/已归档/全部），可归档/恢复
- Operator：仅显示活跃标签页，无复选框和操作按钮，RLS 层已过滤已归档 Variant

**验收标准**：
- Variant 列表正确加载，显示 SKU/名称/国家/匹配状态/产品/归档状态
- 归档筛选标签切换正确（活跃/已归档/全部）
- Admin 可见复选框和批量归档/恢复按钮
- 选择已归档 Variant 时显示「恢复选中」按钮
- 选择活跃 Variant 时显示「归档选中」按钮
- 混合选择时两个按钮均显示（或禁用并提示）
- Operator 仅见活跃标签，无操作按钮
- 搜索功能正常
- 空数据、加载、错误状态已处理
- 页面不直接访问 Supabase（走 Repository → Server Action 链）
- 未匹配页面仅显示活跃未匹配 Variant
- 测试 ≥15 项（含组件渲染/权限/筛选/操作/边界）

### P5-SY11F — 同步非回归验证 + 质量门 + 文档收口

**质量门**：
- `npm run test` 全部通过（排除 `**/concurrency.test.ts`）
- `npm run lint` 0 errors
- `npm run build` 通过
- Python 测试全部通过（compileall + 所有 test_*.py）

**同步非回归验证**：
- 同步 RPC `sync_warehouse_inventory` 对已归档 Variant 的 inventory 更新正常
- 恢复已归档 Variant 后，其 inventory 数据为最新同步值
- 新发现 SKU 创建的 Variant 默认 `is_archived = false`

**文档同步**：
- `docs/current-state.md`：P5-SY11 进度
- `docs/tasks/current-task.md`：子任务状态
- `docs/tasks/phase-5-sync.md`：P5-SY11 更新
- 明确记录：不删除 ProductVariant，软归档不影响同步写入链路

## 验收标准

- `product_variant.is_archived` 列存在，默认 `false`。
- `archived_at` / `archived_by` 审计字段存在，FK 约束有效。
- Operator RLS SELECT 策略包含 `AND is_archived = false`。
- 默认库存列表、低库存统计、海外库存统计不显示已归档 Variant。
- 产品详情页 (`getByProductId`) 仍显示已归档 Variant 的库存。
- `shipment_item` 等历史记录不受归档影响。
- Admin 可批量归档/恢复 Variant。
- Operator 只读，无法查看已归档 Variant，无操作按钮。
- 已归档 Variant 的 inventory 仍可被同步链路更新。
- 恢复后的 Variant 重新出现在默认视图中，且库存为最新值。
- 新创建 Variant 默认 `is_archived = false`。
- 不删除 ProductVariant，不改变 Product → ProductVariant → Inventory 模型。
- Admin / Operator 权限在 Server Action + RLS 双重保障。
- `npm run test` 通过（排除 concurrency.test.ts）。
- `npm run lint` 0 errors。
- `npm run build` 通过。
- Python tests 全部通过。
- 不修改已执行 Migration 00001~00010。
- 不新增数据库表。
- 不重新提交 `.env.local`、`runtime/profile`、cookie。

## 测试要求

- Migration 静态契约测试：≥8 项（列存在、默认值、索引、FK、RLS 策略）
- Repository 测试：≥20 项（archive/restore/list 过滤/getUnmatched 过滤/match 阻止/unmatch 阻止）
- Server Action 测试：≥15 项（活跃 Admin 成功/非活跃 Admin 拒绝/Operator 拒绝/未认证拒绝/校验/边界）
- Inventory 过滤测试：≥12 项（海外列表/低库存/统计/产品详情不过滤/恢复后出现/null variant 排除/RLS 泄漏验证）
- UI 测试：≥15 项（组件渲染/权限/筛选标签/操作按钮/边界）
- 同步非回归测试：≥5 项（RPC 不受影响/恢复后库存正确/新 Variant 默认 false）
- 不退化现有 744 项 TS 测试 + 253 项 Python 测试

## 停止条件

- P5-SY11A~E 全部完成后停止，等待 Codex 独立验收（P5-SY11F）。
- 不删除 ProductVariant、不删除数据库行。
- 不改变 Product → ProductVariant → Inventory 模型。
- 不修改已执行 Migration 00001~00010。
- 不新增数据库表。
- 不启用 P5-SY10 Phase B 自动 Real Write。
- `WEBSYNC_REAL_WRITE_ENABLED` 保持 false。
- 不启动 P5-SY12 或其他后续任务。

## 依赖

- P5-SY9 全部子任务（A~K）DONE — 全部 5 海外仓批量真实写入完成。
- P5-SY10 全部子任务（A~F）DONE — 自动 Dry Run 预审与 Cron 调度完成。
- Migration 00001~00010（全部已执行）。
- Variant Feature Module（`src/features/variants/`）— 现有 types/repository/actions/schema/columns。
- Inventory Feature Module（`src/features/inventory/`）— 现有 repository。
- Supabase 当前生产数据库配置。

## 后置计划

- **P5-SY10 Phase B** — PASS 仓库自动 Real Write（设计预留，需运行稳定并建立每仓基线后评估）。
- 后续可考虑归档自动过期策略（如超过 N 天未同步的 Variant 自动建议归档），但不在本任务范围。
