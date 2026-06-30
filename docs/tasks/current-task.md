# Current Task Packet

## Task ID

`P3-S2E` — 在途入口收口 + 采购单号 + 海外库存轻量展开

## 状态

**DONE**（2026-06-30）

## 背景

P3-S2B（在途维护收口）、P3-S2C（库存视图接入在途）和 P3-S2D（在途聚合精确到仓库）已完成。P3-S2E 进行三项收口：

1. 在途管理新增采购单号字段，与 shipment_no 互补
2. 海外库存页 SKU+仓库行展开内部在途明细（不接 Best）
3. 入口收口：移除侧边栏重复"在途库存"入口，重定向到 /dashboard/shipments

写权限收紧为 Admin-only（Server Action + RPC 双层）。

## 依赖

- P3-S2B DONE（shipment/shipment_item/tracking_event 表 + RPC）
- P3-S2C DONE（getInTransitByVariant 聚合）
- P3-S2D DONE（getInTransitByVariantAndWarehouse 仓库维度聚合）
- P3-S3 DONE（手动创建/补录）
- `warehouseAccessRepository`（仓库隔离）
- `getUserRole()`（权限判断）

## 范围

1. **采购单号** — Migration 00020：`shipment.purchase_order_no` nullable text + `create_shipment_transactional` 11 参数（`RETURNING id INTO v_shipment_id`，Admin-only）。database.ts → types → Zod → Repository → Actions → 创建/编辑表单 + 列表副行 + 详情页。
2. **海外库存行展开** — `InTransitDetailRow` 客户端组件按 (variantId, warehouseId) 精准查询在途明细（单号/采购单号/在途数量/预计到货/详情链接），不串仓，不展示状态/船名/航次/轨迹。
3. **入口收口** — 侧边栏移除"在途库存"入口，`/dashboard/inventory/in-transit` → redirect('/dashboard/shipments')。Operator 隐藏"新建在途"/"编辑"/"状态变更"按钮。
4. **权限收紧** — Migration 00021：`change_shipment_status_transactional` 覆盖为 Admin-only。Server Action 层拒绝 Operator 写操作（中文错误）。
5. **测试** — `getInTransitDetailsByVariantAndWarehouse` 17 项 Repository 行为测试 + 27 项 action/Zod/源码/Migration 检查（44 项 P3-S2E 合计）。

## 禁止

- 不接 Best/shipment_external_ref 外部表
- 不做入库联动
- 页面/组件不直接调用 `supabase.from()`
- 不修改已执行 Migration（00019 用新 Migration 00021 覆盖）
- 展开明细不展示详细物流字段（状态/船名/航次/轨迹）

## 停止条件（全部满足）

1. Migration 00020：`purchase_order_no` 字段 + RPC `RETURNING id INTO v_shipment_id` + Admin-only ✓
2. Migration 00021：`change_shipment_status_transactional` Admin-only 覆盖 ✓
3. 采购单号全链路（创建/编辑/列表/详情）✓
4. 海外库存行展开不串仓，字段仅含单号/采购单号/数量/预计到货/详情链接 ✓
5. 侧边栏无重复"在途库存"入口，/dashboard/inventory/in-transit 重定向 ✓
6. Operator 调用 create/update/changeStatus 被 Server Action 拒绝 ✓
7. Admin/Operator 仓库隔离有效 ✓
8. `npm run test` 1603/1604（49 文件，concurrency/best live 预存失败），`npm run lint` 0 errors / 26 warnings（all pre-existing），`npm run build` 通过，`git diff --check` 通过 ✓

## 下一步

- P3-S4（状态推进与轨迹映射）依赖 P3-S2 + P3-S3 — 就绪
- P3-S5（入仓联动）依赖 P3-S4 — **BLOCKED**
- P3-S6（权限与验收）依赖 P3-S5 — **BLOCKED**
