# Phase 5 — 海外库存同步

目标：稳定获取海外仓真实库存，并保留失败记录和上次成功数据。

| Task ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| P5-SY1 | 明确首个海外仓数据来源与字段映射 | P2-I3 | DONE |
| P5-SY2 | 单仓抓取与解析器 | P5-SY1 | DONE |
| P5-SY3A | Inventory 写入映射与只读 Dry Run | P5-SY2、P1-V1 | DONE |
| P5-SY3B | Inventory 实际写入与新 SKU 创建 | P5-SY3A | DONE |
| P5-SY4A | SyncLog 与失败保留机制设计及任务拆分 | P5-SY3B | DONE |
| P5-SY4B | Migration 00006：事务型海外库存同步 RPC | P5-SY4A | ACTIVE |
| P5-SY4C | Executor 适配 RPC 与 SyncLog 写入 | P5-SY4B | BLOCKED |
| P5-SY4D | 同步失败模式测试覆盖 | P5-SY4C | BLOCKED |
| P5-SY4E | CLI 集成与 Dry Run 验证 | P5-SY4D | BLOCKED |
| P5-SY5 | 手动同步入口 | P5-SY4E | BLOCKED |
| P5-SY6 | 定时任务与运行环境评估 | P5-SY5 | BLOCKED |
| P5-SY7 | 单仓端到端验收 | P5-SY6 | BLOCKED |
| P5-SY8 | 逐仓扩展 | P5-SY7 | BLOCKED |

同步必须先完成一个仓库的端到端闭环，再逐仓扩展。禁止一次实现五个国家抓取。
