# Current Task Packet

## Task ID

`PERF-C2A` — 海外库存 getOverseasInventory 查询编排优化

## 状态

**DONE**（2026-07-04）。

### 背景

PERF-C1（Dashboard 首页并行重排）已完成。Phase C 第二轮只优化 `src/features/inventory/actions.ts#getOverseasInventory` 的查询编排，不处理产品页。当前实现中 `getInTransitConfirmedAggregate` 先串行完成，然后才并行 `getOverseasStats` / `getOverseasWarehouses` / `getOverseasList`。优化目标：`getOverseasWarehouses` 和 `getOverseasList` 不依赖 aggregate 结果，应与 aggregate 提前并行启动。

### 实现

**src/features/inventory/actions.ts：**

- 新增 `seal<T>(p)` helper：为提前启动的 Promise 附加 noop `.catch()`，防止 `await aggregatePromise` 抛错时其余 promise 产生 unhandledRejection
- 重构 `getOverseasInventory(filters)` 查询编排：
  1. `requireAuth()` / `inventorySearchSchema.safeParse()` 仍保持前置
  2. `userId` 确定后，三个互不依赖的查询立即启动：
     - `aggregatePromise = getInTransitConfirmedAggregate(userId)`
     - `warehousesPromise = seal(getOverseasWarehouses())`
     - `listPromise = seal(getOverseasList({ ...parsed.data, userId }))`
  3. `await aggregatePromise` → 构建 `whInTransitMap` / `variantTotalMap` / `confirmedMap`（逻辑不变）
  4. `statsPromise = getOverseasStats(userId, variantTotalMap)` — 等待 variantTotalMap 就绪后才启动
  5. `await Promise.all([statsPromise, warehousesPromise, listPromise])` — stats / warehouses / list 并行 await
  6. `inTransitQuantity` 注入和 `confirmedMap` 返回逻辑完全不变

**编排对比：**

```
Before (PERF-S1B):
  aggregate (串行) → [stats | warehouses | list] (并行)
  串行阶段: 1 个查询
  并行阶段: 3 个查询

After (PERF-C2A):
  [aggregate | warehouses | list] (并行启动)
  → aggregate 完成 → stats 启动
  → [stats | warehouses | list] (并行 await)
  首轮并行: 3 个查询（warehouses/list 不再等待 aggregate）
  次轮并行: 3 个查询
```

**错误隔离保证：**
- 任一 repository 查询失败仍抛出错误，由海外库存页 `error.tsx` 边界处理
- 不静默吞掉 `getOverseasInventory` 内部错误
- `seal()` 仅防止 unhandledRejection 警告，不影响错误传播

**src/features/shipments/p3-s5b4-batch-warehouse.test.ts：**
- 新增 `PERF-C2A — getOverseasInventory 查询编排`describe 块，10 项测试：
  - `seal` helper 存在
  - aggregate / warehouses / list 三个 promise 提前并行启动
  - aggregate 先 await，构建 variantTotalMap 后再启动 stats
  - `variantTotalMap` 仍从 aggregateRows 构建
  - `confirmedMap` 仍从 aggregateRows 构建
  - stats / warehouses / list 在第二轮 `Promise.all` 中并行 await
  - `inTransitQuantity` 注入仍在 result 返回后执行
  - warehouses 和 list 不使用 seal 以外的独立 await（不串行等待）
  - 不新增 per-warehouse N+1 查询模式
  - `getOverseasStats` 仍使用 `variantTotalMap` 参数

### 禁止事项（已遵守）

- 不改 Repository SQL / RPC / Migration / RLS
- 不改 `get_overseas_inventory` / `get_overseas_stats` / `get_in_transit_confirmed_aggregate`
- 不改海外库存 UI 表格列、筛选、分页、syncStatus
- 不改产品页、产品 repository、产品详情页
- 不改 Dashboard 首页
- 不改 `.claude/`
- 不改 package.json
- 不做无关重构
- 不使用 `any`

### 验收

| 检查项 | 结果 |
|--------|------|
| 指定 4 个测试文件 | **261/261** 通过 ✅ |
| `npm run build` | ✓ Compiled + TypeScript (23/23) ✅ |
| `npm run lint` | 5 errors / 25 warnings（仅 `smoke-test-00025.ts` 既有），未发现本轮新增 ✅ |
| `git diff --check` | 通过 ✅ |
| 不新增 Migration | ✅ |
| 不改产品/海外库存/同步页/权限 | ✅ |

### 修改文件清单

| # | 文件 | 变更 |
|---|------|------|
| 1 | `src/features/inventory/actions.ts` | 重构 getOverseasInventory 查询编排：aggregate/warehouses/list 提前并行启动，stats 等 variantTotalMap 后再加入第二轮 Promise.all |
| 2 | `src/features/shipments/p3-s5b4-batch-warehouse.test.ts` | 新增 PERF-C2A 查询编排 10 项测试 |

### 范围说明

本轮只做海外库存 actions 查询编排优化。Phase C 其余内容：
- 产品页 actions 并行（`PERF-C2B`）— 未开始
- 同步页分页（Phase D）— 未开始
- 索引优化（Phase E）— 未开始

### 残余风险

- `seal()` 的 noop `.catch()` 吞掉了 rejection reason；如果调用方因 bug 忘记 await sealed promise，错误会被静默丢失。当前代码保证所有 sealed promise 都在 `Promise.all` 中 await，风险可控
- `aggregatePromise` 抛错时 `warehousesPromise` / `listPromise` 可能仍在飞行中；seal 防止了 unhandledRejection，但这两个查询的数据库资源不会被取消（JS 无原生 Promise cancellation）

### 下一步

PERF-C2A 完成。可推进 PERF-C2B（产品页 actions 并行重排）或其他未阻塞任务。P3-S1B 仍 BLOCKED_EXTERNAL。
