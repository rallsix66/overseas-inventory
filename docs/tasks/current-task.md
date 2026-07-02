# Current Task Packet

## Task ID

`P3-S5B3` — 详情页双模式按钮 + PartialWarehouseDialog + BigsellerAbsorptionButton

## 状态

**DONE**（2026-07-02，P3-S5B0/B1/B2/B3 全部完成。2026-07-02 收口返修完成）

## 依赖

- P3-S5B0 DONE（旧版 00023 入仓入口已封存）
- P3-S5B1 DONE（Migration 00026 + types/schema + 93 项静态测试。Migration 00026 已执行并验证）
- P3-S5B2 DONE（Repository 5 方法 + Actions 3 函数 + 87 项测试。全量 2367/2367。2026-07-02 返修：聚合口径过滤已修复 — 仅纳入 customs 或 warehoused + bigseller_absorbed_at IS NULL）

## 范围（待实现）

### 1. 详情页双模式按钮

在 `src/app/dashboard/shipments/[id]/page.tsx` 修改入仓按钮：
- `status='customs'` → 显示"确认到仓"按钮 → 打开 `PartialWarehouseDialog`
- `status='warehoused'` 且 `bigseller_absorbed_at IS NULL` → 显示"确认 BigSeller 吸收"按钮 → 打开确认 Dialog
- 其他状态不显示入仓相关按钮

### 2. PartialWarehouseDialog

新建 `src/features/shipments/components/partial-warehouse-dialog.tsx`：
- shadcn/ui Dialog + 产品明细表格（variant/sku/品名/在途数量/本次入仓数量输入）
- Zod 前端校验 + 调 `partialWarehouseShipment` action
- 提交中 loading + 失败中文错误 + 成功关闭 + router.refresh

### 3. BigsellerAbsorptionButton

新建 `src/features/shipments/components/bigseller-absorption-button.tsx`：
- 确认 Dialog（"确认 BigSeller 已吸收该在途记录的全部货物？"）
- 调 `confirmBigsellerAbsorption` action
- 成功关闭 + router.refresh

### 4. 不实现

- 不实现批量 UI / 海外库存列（P3-S5B4）
- 不实现应用行为测试（P3-S5B5）
- 不修改 Migration

## 下一步

P3-S5B4 — 批量入仓 UI + 海外库存列（依赖 P3-S5B3 ✅）

## 质量门

P3-S5B3 收口返修通过：
- shipments 819/819（13 files）
- 全量 2381/2381（60 files）
- build pass
- lint 5 errors / 26 warnings（all pre-existing, smoke-test-00025.ts）
- git diff --check pass

## 当前业务口径

inventory.quantity 唯一事实来源是 BigSeller。DIS 确认到仓仅更新 shipment_item.warehoused_quantity + shipment.status + tracking_event。`bigseller_absorbed_at` 由 Admin 手动确认（NULL = 未确认吸收）。
