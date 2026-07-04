# Current Task Packet

## Task ID

`PERF-C1` — Dashboard 首页查询并行重排

## 状态

**DONE**（2026-07-04）。

### 背景

PERF-B1（request-scope cache）已完成。Phase C 第一轮只优化 `/dashboard` 首页的服务端查询编排，将 `getCurrentUser()` 之后彼此独立的四个数据加载从串行改为并行执行，减少 waterfall。

### 实现

**src/app/dashboard/page.tsx：**
- `getCurrentUser()` 保持第一步
- 当 `user?.id` 存在时，使用 `Promise.all` 并行执行四个查询：
  - `getOverseasStats(user.id).catch(() => undefined)` — 静默失败
  - `getInTransitByVariant(user.id).catch(() => new Map())` — 静默失败，返回空 Map
  - `getFollowedVariantsBasic(user.id).then(data => ({ data, error: null })).catch(e => ({ data: [], error: ... }))` — 返回 `{ data, error }` 结构化结果，Promise.all 之后赋值 `followedVariants = fvResult.data`、`followedError = fvResult.error`
  - `getLowStock({ userId: user.id }).then(data => ({ data, error: null })).catch(e => ({ data: [], error: ... }))` — 返回 `{ data, error }` 结构化结果，Promise.all 之后赋值 `lowStockError = lsResult.error`
- 并行块之后：计算 `inTransitSkuCount`/`inTransitTotalQuantity`、注入 `inTransitQuantity` 到关注产品、map + sort 低库存列表
- 未登录时仅调用 `getOverseasStats(user?.id)`（原有行为，静默失败）

**错误隔离保证：**
- overseas stats 失败 → 不显示 stats，不影响其他区块
- in-transit 失败 → 返回空 Map（在途卡片显示 0），不影响其他区块
- followed variants 失败 → `followedError` 设置，`FollowedProductsSection` 显示错误状态
- low stock 失败 → `lowStockError` 设置，`LowStockSummarySection` 显示错误状态

**src/features/inventory/p2-d2-low-stock-summary.test.ts：**
- 更新"隔离测试"：从检查 try/catch 改为检查 `.catch()` 独立错误处理
- 新增 10 项 PERF-C1 并行编排测试：
  - `Promise.all` 存在
  - 四个查询均在 `Promise.all` 内，各有独立 `.catch()`
  - `followedError` / `lowStockError` 在 Promise.all 之后从结构化结果赋值
  - `inTransitQuantity` 注入在 `Promise.all` 之后
  - `lowStockItems` map/sort 在 `Promise.all` 之后
  - 未登录时不调用三个 `user.id` 依赖查询
  - `if (user?.id)` 内无串行 await（无独立 `await xxxRepository.xxx()`）

### 禁止事项（已遵守）

- 不改 `createClient()` / `createServiceClient()`
- 不新增 Migration / RPC / 索引
- 不改同步页分页
- 不改产品列表或产品详情页
- 不替换 `getInTransitByVariant` 为其他 RPC
- 不改权限模型、RLS、Repository 边界
- 不改 `.claude/` 下任何文件

### 验收

| 检查项 | 结果 |
|--------|------|
| 指定 3 个测试文件 | **145/145** 通过 ✅ |
| `npm run build` | ✓ Compiled + TypeScript ✅ |
| `git diff --check` | 通过 ✅ |
| 不新增 Migration | ✅ |
| 不改产品/海外库存/同步页/权限 | ✅ |

### 修改文件清单

| # | 文件 | 变更 |
|---|------|------|
| 1 | `src/app/dashboard/page.tsx` | 重构为 `Promise.all` 并行执行 4 个独立查询 |
| 2 | `src/features/inventory/p2-d2-low-stock-summary.test.ts` | 更新隔离测试 + 新增 10 项 PERF-C1 并行编排测试 |

### 范围说明

本轮只做 Dashboard 首页查询并行重排。Phase C 其余内容未开始：
- 产品页 actions 并行（`/dashboard/products`）
- 海外库存页 actions 并行（`/dashboard/inventory/overseas`）
- 同步页分页（Phase D）
- 索引优化（Phase E）

### 残余风险

- `Promise.all` 中任一查询抛未捕获异常会导致整个并行块失败；已通过 `.catch()` 全覆盖避免
- 已移除 `.catch()` 内直接修改外层变量的副作用模式；当前使用 `.then()+.catch()` 返回 `{ data, error }` 结构化结果，Promise.all 之后再统一赋值
- 无 `Promise.allSettled` — 不需要，`.catch()` 已确保所有 promise 都 resolved

### 下一步

PERF-C1 完成。可推进 PERF-C2（产品页/海外库存页 actions 并行）或其他未阻塞任务。P3-S1B 仍 BLOCKED_EXTERNAL。
