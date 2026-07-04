# Phase 2 — 库存与 Dashboard

目标：优先交付每天可查看的真实库存看板。

| Task ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| P2-I1 | 海外库存查询与分页正确性 | P1-P2 | DONE |
| P2-I2 | 海外库存页面交互与响应式验收 | P2-I1 | DONE |
| P2-I3 | 海外库存真实数据走查与使用验收 | P2-I2 | DONE |
| P2-D1 | Dashboard 海外库存摘要与入口 | P1-P2 | DONE |
| P2-D2 | Dashboard 低库存与缺货摘要 | P2-I3 | **DONE (2026-07-04)** — Dashboard 首页新增 LowStockSummarySection 组件（按仓库分组、缺口头大优先、SKU 跳转海外库存、空/错误状态）。复用 inventoryRepository.getLowStock()，全局低库存（不依赖关注）。43 项 P2-D2 测试。全量 2703/2703（64 文件），build pass，lint 仅既有 5e/25w。不新增 Migration/RLS/权限变更。 |
| P2-I4 | 国内库存查询与页面 | P2-I3 | BACKLOG |
| P2-I5 | 在途库存只读汇总页 | P3-S2 | BLOCKED |
| P2-I6 | 库存模块完整权限与回归验收 | P2-I4、P2-I5 | BLOCKED |

拆分规则：

- 查询正确性、页面交互和真实数据验收必须分开。
- 统计卡片不得与库存页面查询重构放在同一任务。
- 自动同步属于 Phase 5，不在库存页面任务中顺带实现。
