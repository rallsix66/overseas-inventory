# Current Task Packet

## Task ID

`P3-S4A` — 内部手动在途状态轨迹收口

## 状态

**DONE**（2026-06-30）+ **返工完成**（2026-06-30，advanceStatus 收口到 RPC）

## 背景

P3-S2B（在途维护收口）提供了 `change_shipment_status_transactional` RPC（Migration 00019/00021）支持状态变更，但缺少状态流转规则校验（防倒退、防跳步）。轨迹时间线按创建时间降序排列，缺少创建人信息。

P3-S4A 进行三项收口：

1. 状态流转规则收口（booking → loading → departed → arrived → customs，三层一致校验）
2. 轨迹展示优化（升序时间线 + 创建人 + 首个节点高亮）
3. 旧版 advanceStatus 权限收口（Admin-only + 禁用 warehoused + 流转校验）

## 依赖

- P3-S2B DONE（`change_shipment_status_transactional` RPC）
- P3-S2E DONE（Admin-only 权限覆盖 Migration 00021）
- P3-S3 DONE（手动创建/补录）

## 范围

1. **状态流规则收口** — 仅允许 booking→loading→departed→arrived→customs 顺序推进。禁止倒退、禁止跳步、禁止手动推进到 warehoused。`SHIPMENT_STATUS_FLOW` 常量 + `isValidStatusTransition()` 纯函数 + Repository 预读当前状态校验 + RPC 层（Migration 00022）SELECT 当前状态校验 + Zod schema 排除 warehoused。

2. **轨迹展示优化** — `/dashboard/shipments/[id]` 详情页轨迹时间线按 `occurred_at` 升序排列。tracking_event 查询 join profiles 获取 `display_name`。显示字段：状态中文名、描述、发生时间、创建人。首个节点蓝色高亮。空轨迹"暂无物流轨迹"。

3. **权限保持** — Admin 可变更状态（Server Action + RPC 双层），Operator 只读。`advanceShipmentStatus` 旧版路径同步收紧为 Admin-only。

4. **数据一致性** — `change_shipment_status_transactional` 继续同事务 UPDATE shipment.status + INSERT tracking_event。如果状态更新成功但轨迹插入失败，整体失败回滚。不写 inventory，不改 shipment_item.warehoused_quantity。

5. **UI 收口** — `ShipmentStatusChange` 组件移除下拉选择，仅展示下一合法状态（如 booking → 「推进至「装柜」」）。已到 customs 显示"已是最终状态"。移除 Select 组件导入。

6. **测试** — 79 项 P3-S4A 源码检查（18 纯函数 + 13 Zod schema + 11 Migration 00022 + 22 详情页/组件/actions/repository）+ 7 项行为测试（p3-s2a-behavior.test.ts：2 倒退/跳步拒绝 + 5 advanceStatus RPC 收口）。

7. **返工（2026-06-30）** — `advanceStatus()` 改为直接委托 `this.changeStatus()` → RPC，删除旧版两步分离 `from('shipment').update` + `from('tracking_event').insert`。Actions `advanceShipmentStatus()` 使用 `parsed.data.shipmentId` / `parsed.data.nextStatus` / `parsed.data.description` 而非原始参数。新增 5 项 advanceStatus 行为测试（成功路径调用 RPC / RPC 错误中文失败 / warehoused 拒绝 / 倒退拒绝 / 跳步拒绝）+ 5 项源码断言（方法体不含 `.from('shipment').update` / 不含 `.from('tracking_event').insert` / 含 `this.changeStatus` / 整文件不含 `.from('tracking_event').insert` / 含 warehoused 显式守卫）。

## 禁止

- 不接 Best/shipment_external_ref 外部表
- 不做入仓联动（warehoused 禁止手动推进）
- 页面/组件不直接调用 `supabase.from()`
- 不修改已执行 Migration（00021 用新 Migration 00022 覆盖）
- 不新增数据库表或字段

## 停止条件（全部满足）

1. Migration 00022：`change_shipment_status_transactional` 新增状态流转规则（SELECT 当前状态 → 校验流转 → UPDATE + INSERT）✓
2. `SHIPMENT_STATUS_FLOW` 常量 + `isValidStatusTransition()` 纯函数 + `getNextValidStatus()` ✓
3. Repository `changeStatus()` 预读当前状态校验流转规则 ✓
4. Repository `advanceStatus()` 委托 `changeStatus()` → RPC（不再直接 update/insert）✓
5. Repository `getById()` tracking_event join profiles + 升序排列 + 返回 `TrackingEventDetail` ✓
6. Actions `advanceShipmentStatus()` Admin-only + 中文错误传播 ✓
7. `ShipmentStatusChange` 组件仅展示下一合法状态，无可推进时显示"已是最终状态" ✓
8. 详情页轨迹显示创建人、升序时间线、首个节点蓝色高亮 ✓
9. `npm run test` 1688/1688（50 文件，concurrency/best live 预存失败），`npm run lint` 0 errors / 25 warnings（all pre-existing），`npm run build` 通过，`git diff --check` 通过 ✓

## 下一步

- Migration 00022 待用户在 Supabase SQL Editor 手动执行
- P3-S5（入仓联动）依赖 P3-S4 — 就绪
- P3-S6（权限与验收）依赖 P3-S5 — **BLOCKED**
