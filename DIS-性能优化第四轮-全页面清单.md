# DIS 性能优化 — 全页面问题清单（第四轮全盘扫描）

> 诊断时间：2026-07-04
> 范围：**全部 17 个页面路由** + 8 个 repository + 全局 auth/client 层 + 数据库索引
> 方法：不再"用户指哪打哪"，一次性扫完所有 page.tsx / repository.ts / actions.ts
> 结论：**问题分三层 —— ①数据库索引缺失（所有页面共担）②全局 auth/role/warehouse 查询无 cache（所有页面共担）③各页面独立的查询编排问题。前两层是地基，修一次所有页面都受益。**

---

## 一、全局问题（影响所有页面）

这 5 个问题是"系统性"的，不是某个页面的问题，而是**每个页面都在重复踩的坑**。修一次，全站受益。

| # | 问题 | 影响范围 | 严重度 |
|---|------|----------|--------|
| G1 | **`getCurrentUser` / `getCurrentActiveUser` 无 `cache()`** | 所有需认证的页面（17 个里 15 个） | 🔴 |
| G2 | **`createClient` 无 `cache()`，每次新建实例** | 所有查数据库的页面 | 🟠 |
| G3 | **`getUserRole`（shipments）无 `cache()`，9 处重复查** | shipments 全模块 + 在途管理页 | 🟠 |
| G4 | **`getAccessibleWarehouseIds` 无 `cache()`，8 处重复查** | shipments 6处 + preferences 1处 + sync 1处 | 🟠 |
| G5 | **`getUserArchivedVariantIds` 无 `cache()`，4 处重复查** | variants 3处 + shipments 1处 | 🟡 |
| G6 | **数据库索引缺失**（inventory.variant_id 等） | 所有列表页 | 🔴 |
| G7 | **dev/build 强制 `--webpack`** | 开发体验 | 🟡 |
| G8 | **`next.config` 空，未开 `optimizePackageImports`** | 编译速度 | 🟡 |

### G1 详解：认证无 cache（最严重）

`lib/auth.ts` 的 `getCurrentUser` 和 `getCurrentActiveUser` 都是普通 async 函数。每次调用 = 2 个串行往返（`auth.getUser()` + `profiles` 查询）。

一次页面渲染的调用链（以海外库存页为例）：
```
layout.tsx → auth.getUser() + profiles          ← 往返 1、2
overseas/page.tsx → getOverseasInventory → requireAuth() → getCurrentUser()  ← 往返 3、4
            → getOverseasWarehouseSyncStatus → requireActiveAuth() → getCurrentActiveUser()  ← 往返 5、6
```
光认证就 **6 个串行往返**。

**修复**：用 React `cache()` 包装，同一渲染 pass 内只查一次：
```ts
import { cache } from 'react';
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => { /* 原实现 */ });
export const getCurrentActiveUser = cache(async (): Promise<CurrentActiveUser | null> => { /* 原实现 */ });
```

### G3/G4/G5 详解：role / warehouse / archived 重复查

| 函数 | 调用处 | 一次渲染重复次数 |
|------|--------|------------------|
| `getUserRole`（shipments/repository.ts L37） | list / getInTransitByVariant / getInTransitByVariantAndWarehouse / getInTransitDetailsByVariantAndWarehouse / getById / listEligibleForBatchWarehousing 等 | 在途管理页一次渲染 2-3 次 |
| `getAccessibleWarehouseIds`（warehouse-access/repository.ts L22） | shipments 6处 + preferences 1处 + sync 1处 | 同一请求内 3-4 次，且内部又查一次 role |
| `getUserArchivedVariantIds`（variants/repository.ts L55） | variants list / getUnmatched / getById + shipments 1处 | variants 页 1-2 次 |

**修复**：全部用 `cache()` 包装。注意 `getAccessibleWarehouseIds` 内部也查 role，cache 后 role 查询自动合并。

### G6 详解：索引缺失（已在第三轮详述，此处汇总）

| 缺失索引 | 影响查询 | 严重度 |
|----------|----------|--------|
| `inventory(variant_id)` | 所有 join inventory 的查询（海外库存/产品详情/在途聚合） | 🔴 最严重 |
| `inventory(warehouse_id, variant_id)` | 在途聚合 group by | 🟠 |
| `shipment(warehouse_id, status)` | 在途聚合过滤 | 🟠 |
| `sync_run(warehouse_id, finished_at DESC)` | 同步页取每仓最新 | 🟡 |
| `user_variant_preference(variant_id, user_id, preference_type)` | 归档排除反查 | 🟡 |
| 删除 `idx_inventory_low_stock WHERE quantity<=500`（废索引） | 低库存 RPC 用 safety_stock 命中不了 | 🟡 清理 |

---

## 二、逐页面问题清单

### 页面 1：首页 `/dashboard`

**文件**：`app/dashboard/page.tsx`

| # | 问题 | 严重度 |
|---|------|--------|
| H1 | 5 个查询完全串行（getCurrentUser → getOverseasStats → getInTransitByVariant → getFollowedVariantsBasic → getLowStock），~10 个串行往返 | 🔴 |
| H2 | 在途用旧方法 `getInTransitByVariant`（2 步串行），没用新聚合 RPC `getInTransitConfirmedAggregate` | 🟠 |
| H3 | `getFollowedVariantsBasic` 内部又调 `getAccessibleWarehouseIds`（无 cache → 重复查 role） | 🟠 |

**修复**：5 查询改 `Promise.all`（各 catch 独立）+ 在途改用聚合 RPC + G1/G4 cache 落地后认证和 role 自动合并。

---

### 页面 2：海外库存 `/dashboard/inventory/overseas`

**文件**：`app/dashboard/inventory/overseas/page.tsx` + `features/inventory/actions.ts`

| # | 问题 | 严重度 |
|---|------|--------|
| O1 | `actions.ts` 4 查询分两批串行（先 aggregate，再 [stats, warehouses, list]），本可 4 全并行 | 🔴 |
| O2 | 列表行无 `React.memo`，20 行 × 13 列每次父组件 render 全量重渲染 | 🟡 |
| O3 | `getOverseasWarehouseSyncStatus` 拉 100 条 + JS 过滤（第二轮已提，未落地） | 🟠 |

**修复**：4 查询改 `Promise.all`（注入和统计在查询返回后 JS 层做）+ 行抽 `memo` 组件 + sync status 改 RPC。

---

### 页面 3：产品列表 `/dashboard/products`

**文件**：`app/dashboard/products/page.tsx` + `features/products/repository.ts`

| # | 问题 | 严重度 |
|---|------|--------|
| P1 | `getCurrentUser` 与 `productRepository.list` 串行（应并行） | 🟠 |
| P2 | `list` 是 2 步串行 N+1：先查 product 分页，拿到 id 后再 `in` 查 variant 计数 | 🔴 |
| P3 | `idx_variant_product_id` 索引存在但 `in` 查询仍是一次额外往返 | 🟡 |

**修复**：改 PostgREST 嵌套查询 `select('*, variants:product_variant(id)')` 一次拿 + getCurrentUser 并行。

---

### 页面 4：产品详情 `/dashboard/products/[id]`

**文件**：`app/dashboard/products/[id]/page.tsx` + `features/products/repository.ts`

| # | 问题 | 严重度 |
|---|------|--------|
| PD1 | `getCurrentUser` 与 `productRepository.getById` 串行（应并行） | 🟠 |
| PD2 | `getById` 内部 3 步串行：先查 product → 再查 variants → 再查 inventory（3 个往返） | 🔴 |
| PD3 | inventory 查询 `.eq('variant.product_id', id)` 走 variant 表 join，inventory(variant_id) 无索引 → 全表扫描 | 🔴 |

**修复**：`getById` 改单次嵌套查询或并行 3 查询 + getCurrentUser 并行 + 补索引。

---

### 页面 5：在途管理 `/dashboard/shipments`

**文件**：`app/dashboard/shipments/page.tsx` + `features/shipments/repository.ts`

| # | 问题 | 严重度 |
|---|------|--------|
| S1 | `listShipments` → `list` 内部先 `getUserRole`（1往返）→ operator 时再 `getAccessibleWarehouseIds`（1往返，内部又查 role）→ 再查 shipment | 🟠 |
| S2 | `list` 查询嵌套 `shipment_item` + `variant` + `product`，一页 20 条 shipment 各含 N 个 item，传输量大 | 🟡 |
| S3 | 无 cache 时，role 被查 2 次（一次 list 一次 role 守卫） | 🟠（G3 覆盖） |

**修复**：G3/G4 cache 落地后 role/warehouse 自动合并 + list 查询考虑只取聚合数量不取全部 item 明细。

---

### 页面 6：在途详情 `/dashboard/shipments/[id]`

**文件**：`app/dashboard/shipments/[id]/page.tsx`

| # | 问题 | 严重度 |
|---|------|--------|
| SD1 | `Promise.all([getShipmentDetail, getCurrentActiveUser])` 后，第 63 行又**串行** `getWarehousesForSelector(user.id)` | 🟠 |
| SD2 | `getShipmentDetail` → `getById` 内部多步串行（查 shipment → items → events） | 🟠 |

**修复**：把 `getWarehousesForSelector` 加入第一个 `Promise.all`。

---

### 页面 7：新建在途 `/dashboard/shipments/new`

**文件**：`app/dashboard/shipments/new/page.tsx`

| # | 问题 | 严重度 |
|---|------|--------|
| SN1 | `getCurrentActiveUser` 与 `getWarehousesForSelector` 串行（应并行） | 🟡 |

**修复**：改 `Promise.all`。这是小页面，但既然扫到了就一并修。

---

### 页面 8：批量确认到仓 `/dashboard/shipments/batch`

**文件**：`app/dashboard/shipments/batch/page.tsx`

| # | 问题 | 严重度 |
|---|------|--------|
| SB1 | `getCurrentActiveUser` 与 `listEligibleForBatchWarehousing` 串行（应并行） | 🟡 |
| SB2 | `listEligibleForBatchWarehousing` 内部又查 role + warehouse ids（G3/G4 覆盖） | 🟠 |

**修复**：改 `Promise.all` + G3/G4 cache。

---

### 页面 9：数据同步 `/dashboard/sync`

**文件**：`app/dashboard/sync/page.tsx` + `features/sync/server-actions.ts`

| # | 问题 | 严重度 |
|---|------|--------|
| SY1 | 拉全量 100 条 sync_run + 客户端 JS 分页/过滤/聚合（`slice` 假分页） | 🔴 |
| SY2 | `getCurrentActiveUser` 串行在 `Promise.all` 外（L14 先 await，L15 才并行） | 🟠 |
| SY3 | `warehouseOverview` 遍历全量 100 条 JS 聚合，应独立 RPC | 🟠 |
| SY4 | `getOverseasWarehouseOptions` 内部又查仓库（与 warehouseOverview 数据重叠） | 🟡 |

**修复**：服务端分页（URL searchParams）+ warehouseOverview 独立 RPC + getCurrentActiveUser 并行。

---

### 页面 10：用户管理 `/dashboard/users`

**文件**：`app/dashboard/users/page.tsx`

| # | 问题 | 严重度 |
|---|------|--------|
| U1 | 3 步串行：`getCurrentActiveUser` → `listRoles` → `listUsers` | 🟠 |
| U2 | `listRoles` 和 `listUsers` 彼此独立，可并行（都不依赖对方结果） | 🟠 |

**修复**：`getCurrentActiveUser` 先查（需要 role 守卫），然后 `Promise.all([listRoles, listUsers])`。

---

### 页面 11：仓库分配 `/dashboard/users/warehouses`

**文件**：`app/dashboard/users/warehouses/page.tsx`

| # | 问题 | 严重度 |
|---|------|--------|
| UW1 | `getCurrentActiveUser` 串行在 `Promise.all` 外（L16 先 await，L17 才并行） | 🟡 |

**修复**：把 `getCurrentActiveUser` 加入 `Promise.all`。这个页面本身做得不错（已经用了 Promise.all），只是 user 查询没并进去。

---

### 页面 12：SKU 管理 `/dashboard/variants`

**文件**：`app/dashboard/variants/page.tsx` + `features/variants/repository.ts`

| # | 问题 | 严重度 |
|---|------|--------|
| V1 | `requireActiveAuth` 与 `variantRepository.list` 串行（list 依赖 user.id，无法并行） | 🟡 不可避免 |
| V2 | `list` 内部先 `getUserArchivedVariantIds`（1 往返）→ 再查 product_variant 分页（1 往返），2 步串行 | 🟠 |
| V3 | `notIn('id', archivedArray)` 当归档数量多时，PostgREST 生成的 `NOT IN (...)` 列表长，SQL 解析慢 | 🟡 |

**修复**：G5 cache 落地后 archived ids 同请求只查一次。V3 若归档量大可改 RPC 用 `NOT EXISTS` 子查询。

---

### 页面 13：待处理 SKU `/dashboard/variants/unmatched`

**文件**：`app/dashboard/variants/unmatched/page.tsx`

| # | 问题 | 严重度 |
|---|------|--------|
| VU1 | 同 V2：`getUnmatched` 内部先 `getUserArchivedVariantIds` → 再查分页，2 步串行 | 🟠 |
| VU2 | `requireActiveAuth` 与查询串行（依赖 user.id，不可避免） | 🟡 |

**修复**：G5 cache 覆盖。

---

### 页面 14/15：登录页 / 首页重定向 / 国内库存

| 页面 | 状态 |
|------|------|
| `/auth/login` | 客户端表单，无性能问题 |
| `/`（根） | 5 行重定向，无问题 |
| `/dashboard/inventory/domestic` | 4 行占位页，无问题 |
| `/dashboard/inventory/in-transit` | 7 行，无问题 |

---

## 三、问题汇总统计

| 类别 | 数量 | 修复方式 |
|------|------|----------|
| 🔴 P0（严重，体感影响大） | 8 | 必须修 |
| 🟠 P1（明显，应尽快修） | 15 | 尽快修 |
| 🟡 P2（轻微，顺手修） | 10 | 顺手修 |

### 🔴 P0 清单（8 项）
1. **G1** getCurrentUser/getCurrentActiveUser 无 cache（全局）
2. **G6** inventory(variant_id) 等索引缺失（全局）
3. **H1** 首页 5 查询串行
4. **O1** 海外库存 4 查询两批串行
5. **P2** 产品列表 2 步串行 N+1
6. **PD2** 产品详情 3 步串行
7. **PD3** 产品详情 inventory 全表扫描（索引）
8. **SY1** 同步页拉全量 100 条 + 假分页

### 🟠 P1 清单（15 项，节选）
- G2/G3/G4/G5 四个 cache 缺失（全局）
- H2 首页在途用旧方法
- S1 shipments list 串行查 role+warehouse
- SD1 详情页 warehouses 串行
- U1 用户管理 3 步串行
- SY2/SY3 同步页 user 串行 + overview 全量聚合
- V2/VU1 variants 2 步串行查 archived
- 等等

---

## 四、修复优先级与执行顺序

### 第一批（地基，修完全站受益）— 工作量小，收益最大

| 序号 | 动作 | 影响范围 | 工作量 |
|------|------|----------|--------|
| 1 | **migration 00029 补 6 个索引 + 删废索引**（G6） | 所有列表页 | 小 |
| 2 | **`getCurrentUser`/`getCurrentActiveUser` 加 `cache()`**（G1） | 所有页面 | 极小 |
| 3 | **`createClient` 加 `cache()`**（G2） | 所有页面 | 极小 |
| 4 | **shipments `getUserRole` 加 `cache()`**（G3） | shipments 全模块 | 极小 |
| 5 | **`getAccessibleWarehouseIds` 加 `cache()`**（G4） | shipments+preferences+sync | 极小 |
| 6 | **`getUserArchivedVariantIds` 加 `cache()`**（G5） | variants+shipments | 极小 |
| 7 | **dev/build 去掉 `--webpack`**（G7） | 开发体验 | 极小 |
| 8 | **`next.config` 开 `optimizePackageImports`**（G8） | 编译速度 | 极小 |

**这一批做完，所有页面的认证往返从 4-6 次降到 1 次，role/warehouse/archived 查询从 2-4 次降到 1 次，列表页 SQL 从全表扫描变索引扫描。** 是性价比最高的一批。

### 第二批（各页面查询编排）— 逐页改

| 序号 | 页面 | 动作 | 工作量 |
|------|------|------|--------|
| 9 | 首页 | 5 查询 Promise.all + 在途改聚合 RPC（H1/H2） | 小 |
| 10 | 海外库存 | 4 查询 Promise.all（O1） | 小 |
| 11 | 产品列表 | 嵌套查询一次拿（P2） | 小 |
| 12 | 产品详情 | getById 改并行/嵌套（PD2） | 中 |
| 13 | 在途详情 | warehouses 并入 Promise.all（SD1） | 极小 |
| 14 | 同步页 | 服务端分页 + overview 独立 RPC（SY1/SY3） | 中 |
| 15 | 用户管理 | listRoles/listUsers 并行（U1） | 极小 |
| 16 | 其余小页面 | 各自 Promise.all（SN1/SB1/UW1） | 极小 |

### 第三批（锦上添花）

| 序号 | 动作 | 工作量 |
|------|------|--------|
| 17 | 海外库存行 React.memo（O2） | 小 |
| 18 | shipments list 不取 item 明细只取聚合（S2） | 中 |
| 19 | variants notIn 改 RPC NOT EXISTS（V3） | 中 |

---

## 五、预期收益总结

### 第一批（地基）落地后
- **所有页面**认证往返：4-6 次 → 1 次
- **所有列表页**SQL：全表扫描 → 索引扫描
- **shipments/variants**模块 role/archived 重复查消除
- dev 首次编译加速 2-5 倍

### 第二批落地后
- 首页/海外库存/产品列表/产品详情/同步页 这 5 个主力页面，后端耗时各降 40-60%
- 串行往返数从 8-10 降到 2-3

### 体感预期
- **地基批**做完：所有页面"略微变快"（因为认证和索引优化是隐性的）
- **第二批**做完：主力页面"明显变快"（串行消除是显性的）
- **两批都做完**：SKU 从 100 涨到 500 时，不再有明显恶化

---

## 六、为什么前两轮没发现这些

第一轮（7/1）：聚焦首页和数据层 RPC 下推，发现并修了全表拉取+JS 过滤。
第二轮（7/4 上午）：用户说首页慢，我只看了首页，发现首页串行 + auth 无 cache。
第三轮（7/4 下午）：用户说列表页慢，我只看了列表页，发现索引缺失 + 产品 N+1 + 同步页假分页。
第四轮（本轮）：用户批评"指哪打哪"，我全盘扫了 17 个页面，发现**6 个全局问题 + 每个页面独立的串行问题**。

**教训**：前几轮是"头痛医头脚痛医脚"，没有系统性扫描。全局问题（G1-G6）藏在每个页面里，不扫完所有页面就发现不了它们的共性。比如 `getUserRole` 无 cache，单独看任何一个 shipments 方法都"看起来正常"，只有扫完全模块发现 9 处都在重复查，才意识到是系统性问题。

---

*本报告覆盖全部 17 个页面路由。落地建议：先做第一批 8 项地基（1-2 天），再做第二批 8 项页面编排（2-3 天），最后第三批锦上添花。每项改完跑 `npm test` 回归。*
