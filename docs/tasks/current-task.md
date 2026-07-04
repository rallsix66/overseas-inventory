# Current Task Packet

## Task ID

`PERF-B1` — DIS 性能优化 Phase B 第一轮：request-scope cache + dashboard layout 接入

## 状态

**DONE**（2026-07-04，收口修复完成）。

### 背景

Phase B 性能优化目标是减少同一 HTTP 请求内重复的 auth、role、warehouse、archive preference 查询。第一轮为低风险切片：仅在 5 个文件中添加 React `cache()` 实现请求级缓存，不改页面查询编排、sync pagination、索引或 Migration。

### 实现

**src/lib/auth.ts：**
- 新增 `cachedGetAuthProfile` React `cache()` 函数
- 合并 `auth.getUser()` + `profiles(display_name, is_active, role)` 为一次查询
- `getCurrentUser()` 和 `getCurrentActiveUser()` 均复用 `cachedGetAuthProfile`
- PGRST116（profile 未创建，trigger race）处理为 absent profile → `getCurrentActiveUser()` 返回 `null`
- 中文错误消息不变：`requireAuth()` → `未登录`，`requireActiveAuth()` → `未登录或账户已停用`，`requireActiveAdmin()` → `无权限：需要管理员角色`

**src/app/dashboard/layout.tsx：**
- 移除直接 `createClient().auth.getUser()` + `profiles` 查询
- 改用 `getCurrentUser()`（不校验 `is_active`，保持原行为：停用用户可进入 layout，各子页面自行校验）

**src/features/shipments/repository.ts：**
- `getUserRole` 从 `async function` 改为 `const ... = cache(async ...)`
- 语义不变：Admin → `'admin'`，Operator → `'operator'`，其他 → `'unknown'`
- PGRST116 → `'unknown'`，DB error → `ShipmentError`

**src/features/warehouse-access/repository.ts：**
- 新增 `cachedGetAccessibleWarehouseIds` React `cache()`
- 返回 `string[]`（不可变），公开方法返回 `new Set(await cachedFn(userId))`
- Admin → 所有 active overseas warehouse，Operator → 分配的 warehouse

**src/features/variants/repository.ts：**
- 新增 `cachedGetUserArchivedVariantIds` React `cache()`
- 返回 `string[]`（不可变），公开方法返回 `new Set(await cachedFn(userId))`
- 无效 UUID → 空数组，DB error → `VariantError`

**src/lib/auth.test.ts：**
- 适配 select 字段断言（新增 `is_active`）
- 新增 PGRST116 行为测试：`getCurrentActiveUser()` 在 profile 查询返回 PGRST116 时返回 `null`

### 禁止事项（已遵守）

- 不修改 `createClient()` 缓存
- 不修改 `createServiceClient()`
- 不修改 Migration
- 不修改索引
- 不修改 sync 页分页
- 不修改页面查询编排（并行化）
- 不修改 `package.json`
- 不进行无关重构

### 验收

| 检查项 | 结果 |
|--------|------|
| 全量测试 | **2754/2754**（65 文件）+ 1 项 PGRST116 新测试 ✅ |
| build | Compiled + TypeScript ✅ |
| lint | 5 errors / 25 warnings（仅 `smoke-test-00025.ts` 既有）✅ |
| `.claude/context-status.json` 不在 git status | ✅ |
| auth.test.ts PGRST116 行为测试 | ✅ |
| 测试文件 3 个指定文件通过 | 105/105（3 files）✅ |
| 不新增 Migration | ✅ |
| 不改页面查询编排 / sync pagination | ✅ |

### 修改文件清单

| # | 文件 | 变更类型 |
|---|------|---------|
| 1 | `src/lib/auth.ts` | 新增 `cachedGetAuthProfile` cache()，重构 getCurrentUser/getCurrentActiveUser |
| 2 | `src/lib/auth.test.ts` | select 断言适配 + PGRST116 行为测试 |
| 3 | `src/app/dashboard/layout.tsx` | 替换直接 Supabase 调用为 getCurrentUser() |
| 4 | `src/features/shipments/repository.ts` | getUserRole 包裹 cache() |
| 5 | `src/features/warehouse-access/repository.ts` | 新增 cachedGetAccessibleWarehouseIds |
| 6 | `src/features/variants/repository.ts` | 新增 cachedGetUserArchivedVariantIds |

### 残余风险

- React `cache()` 仅在单次 render 或单次 Server Action 内共享缓存；同一页面 render 和后续 Server Action 调用之间不共享缓存
- 如需跨 render→action 共享缓存（Phase C），需评估 `AsyncLocalStorage` 方案
- `cache()` 在 Vitest 测试环境表现为透明 pass-through（无缓存），不影响测试覆盖

### 下一步

PERF-B1 完成。Phase C（页面查询并行重排）建议优先推进——当前已有 request-scope cache 基础，并行重排可减少 dashboard pages 内部 waterfall。Phase D（同步页分页）和 Phase E（索引优化）与 PERF-B1 无冲突，可独立推进。P3-S1B 仍 BLOCKED_EXTERNAL。
