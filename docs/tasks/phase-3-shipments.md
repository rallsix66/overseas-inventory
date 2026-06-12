# Phase 3 — 在途与物流

目标：录入在途记录、推进物流状态，并在入仓时正确更新库存。

| Task ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| P3-S1 | Shipment 数据层与错误传播收口 | P1-V1 | BACKLOG |
| P3-S2 | 在途列表与详情只读页面 | P3-S1 | BLOCKED |
| P3-S3 | 新建在途记录表单 | P3-S1 | BLOCKED |
| P3-S4 | 状态推进与 TrackingEvent 时间线 | P3-S2、P3-S3 | BLOCKED |
| P3-S5 | 入仓事务与库存联动 | P3-S4 | BLOCKED |
| P3-S6 | 在途模块权限与流程验收 | P3-S5 | BLOCKED |

禁止将新建、状态推进、入仓联动和页面开发合并为一个任务包。

