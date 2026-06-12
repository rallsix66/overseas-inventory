# Phase 1 — 产品与 SKU 映射

目标：维护标准产品，并将各国家 SKU 映射到 Product。

| Task ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| P1-P1 | Product 数据层与权限 | P0-F5 | DONE |
| P1-P2 | Product 列表、表单和详情页 | P1-P1 | DONE |
| P1-P3 | Product CRUD 独立验收 | P1-P2 | DONE |
| P1-V1 | Variant 数据层与批量匹配 RPC | P0-F5 | DONE |
| P1-V2 | SKU 管理列表页 | P1-V1 | DEFERRED |
| P1-V3 | 单个匹配、重新匹配与取消匹配组件 | P1-V2 | DEFERRED |
| P1-V4 | 待处理 SKU 页面与批量匹配 | P1-V3 | DEFERRED |
| P1-V5 | Admin/Operator 权限与流程验收 | P1-V4 | DEFERRED |

执行边界：

- 每个页面和复杂交互独立成 Task Packet。
- 不允许把 `P1-V2` 到 `P1-V5` 合并为一次会话。
- 当前优先交付库存看板，Variant 页面任务保持延期。

