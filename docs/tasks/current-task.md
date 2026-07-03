# Current Task Packet

## Task ID

`P3-S5B5` — 应用行为测试 + 文档同步 + 质量门

## 状态

**DONE**（2026-07-03，P3-S5B0~B5 全部完成）

## 依赖

- P3-S5B0 DONE（旧版 00023 入仓入口已封存）
- P3-S5B1 DONE（Migration 00026 + types/schema + 93 项静态测试。Migration 00026 已执行并验证）
- P3-S5B2 DONE（Repository 5 方法 + Actions 3 函数 + 87 项测试。聚合口径已修复 — 仅纳入 customs 或 warehoused + bigseller_absorbed_at IS NULL）
- P3-S5B3 DONE（详情页双模式按钮 + PartialWarehouseDialog + BigsellerAbsorptionButton + 收口返修）
- P3-S5B4 DONE（批量入仓 UI + 海外库存"已确认到仓"列 + 返修完成）
- P3-S5B5 DONE（2026-07-03，应用行为测试 + 文档同步 + 质量门）

## 范围（已完成）

### 1. 批量确认到仓 UI

新建 `/dashboard/shipments/batch` 路由：
- **Server Component** (`page.tsx`): `getCurrentActiveUser` → Admin 校验 → 非 Admin 重定向 `/dashboard/shipments` → `listEligibleForBatchWarehousing` 首屏数据
- **Client Component** (`BatchWarehousePage`): 合格 shipment 列表（customs + 已分配仓库）
  - 原生 checkbox 选择/全选
  - 行展开 → `getShipmentDetail` 按需加载产品明细（itemsCache 缓存）
  - 展开后显示产品明细表格（SKU/品名/总数/已入仓/在途余量/本次入仓）
  - 数量输入 `Record<string, string>` 原始字符串存储 + `validateEntry` 前端校验（小数/负数/零/超量中文错误）+ `fieldErrors` 字段级错误
  - "全额确认"按钮一键填入所有在途余量（`String(remaining)`）
  - "批量提交入仓" → 逐条收集配置好的 items → `batchWarehouseShipments` action
  - 提交结果汇总（每笔成功/失败状态）+ 已成功自动从选中移除 + 列表刷新
  - 分页 20 条/页，加载/空数据/错误/提交中状态全覆盖
- 复用 P3-S5B2: `listEligibleForBatchWarehousing` / `batchWarehouseShipments`
- 新增 `listEligibleForBatchWarehousingAction` Server Action（Admin-only + Zod (`eligibleShipmentFiltersSchema`) + 仓库隔离 + ShipmentError 中文传播）
- **返修 (2026-07-02)**: Action 新增 `safeParse(filters)`，校验失败返回中文错误不进入 repository

### 2. 海外库存"已确认到仓"列

- `getOverseasInventory` action 新增每仓并行查询 `getConfirmedWarehousedByWarehouse`
  - 单仓失败 catch → 空聚合，不阻塞页面
  - 返回 `confirmedMap: Record<string, Record<string, number>>`（warehouseId → variantId → confirmedQuantity）
- `OverseasPageContent` 新增"已确认到仓"列（在途与库存+在途之间）
  - 从 `confirmedMap[item.warehouseId]?.[item.variantId]` 取值
  - 0 显示 `—`，>0 显示数字
  - colSpan 13（表头 13 列：展开/关注/国家/仓库/SKU/产品名称/当前库存/在途/已确认到仓/库存+在途/安全库存/库存状态/同步状态）
- 口径：仅纳入 customs 或 warehoused + bigseller_absorbed_at IS NULL 的 shipment
- 不写 inventory.quantity，不读 BigSeller 同步数据

### 3. 侧边栏

- 物流组下新增"批量入仓"链接（`/dashboard/shipments/batch`）
- `PackageCheck` 图标，Admin-only（`isAdmin` 条件渲染）

### 4. 不实现

- 不写 inventory.quantity
- 不调旧 00023 RPC
- 不新增 Migration
- 不把 BigSeller 同步库存和 DIS 到仓进度混成同一事实来源

## 下一步

P3-S5B 全部完成。下一模块待用户确认。

## 质量门

P3-S5B5 通过（2026-07-03）：
- 新增 `p3-s5b5-behavior.test.ts`（108 项应用行为测试：详情页双模式 23 + batchWarehousingAction mock 9 + validateEntry 9 + confirmedMap 12 + 安全边界 30 + 边界状态 12 + Zod schema 10 + 列数一致性 3 + 权限审计 6）
- shipments 999/999（15 文件）
- 全量 2561/2561（62 文件）
- build pass
- lint 5 errors / 26 warnings（all pre-existing）
- git diff --check pass

## 当前业务口径

inventory.quantity 唯一事实来源是 BigSeller。DIS 确认到仓仅更新 shipment_item.warehoused_quantity + shipment.status + tracking_event。`bigseller_absorbed_at` 由 Admin 手动确认（NULL = 未确认吸收）。BigSeller 同步库存 ≠ DIS 到仓进度，两个事实来源独立展示。
