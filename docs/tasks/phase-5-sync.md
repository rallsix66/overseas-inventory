# Phase 5 — 海外库存同步

目标：稳定获取海外仓真实库存，并保留失败记录和上次成功数据。

| Task ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| P5-SY1 | 明确首个海外仓数据来源与字段映射 | P2-I3 | DONE |
| P5-SY2 | 单仓抓取与解析器 | P5-SY1 | DONE |
| P5-SY3A | Inventory 写入映射与只读 Dry Run | P5-SY2、P1-V1 | DONE |
| P5-SY3B | Inventory 实际写入与新 SKU 创建 | P5-SY3A | DONE |
| P5-SY4A | SyncLog 与失败保留机制设计及任务拆分 | P5-SY3B | DONE |
| P5-SY4B | Migration 00006：事务型海外库存同步 RPC | P5-SY4A | DONE |
| P5-SY4C | Executor 适配 RPC 与 SyncLog 写入 | P5-SY4B | DONE |
| P5-SY4D | 同步失败模式测试覆盖 | P5-SY4C | DONE (独立验收通过) |
| P5-SY4E | CLI 集成与 Dry Run 验证 | P5-SY4D | DONE (独立验收通过) |
| P5-SY5 | 手动同步入口（含子任务） | P5-SY4E | IN_PROGRESS（P5-SY5A DONE，P5-SY5B DONE，P5-SY5C DONE，P5-SY5C2 待开始） |
| P5-SY6 | 定时任务与运行环境评估 | P5-SY5 | BLOCKED |
| P5-SY7 | 单仓端到端验收 | P5-SY6 | BLOCKED |
| P5-SY8 | 逐仓扩展 | P5-SY7 | BLOCKED |

同步必须先完成一个仓库的端到端闭环，再逐仓扩展。禁止一次实现五个国家抓取。

## P5-SY5 子任务拆分（V5.4 修订）

| Sub-Task ID | 任务 | 依赖 | 类型 |
|---|---|---|---|
| **P5-SY5A** | Migration 00007（第五次聚焦返工完成，59/59 静态契约测试，独立静态验收通过）| P5-SY5 | DONE |
| **P5-SY5B** | 认证链修复：`getCurrentActiveUser()` / `requireActiveAuth()` / `requireActiveAdmin()` | P5-SY5A | DONE（独立验收通过，25/25） |
| **P5-SY5C** | Sync Feature Module 骨架（含 ArtifactProvider 接口：`prepare()` 先 validateJsonValue 后 stringify，返回 `{ bytes, hash, normalizedContent }` + `store(PreparedArtifact)` + `listCandidates()` + `deleteMany()`；validateJsonValue 运行时验证器递归拒绝 undefined/function/Symbol/BigInt/NaN/Infinity/toJSON/自定义原型 + V5.4.2 增强：WeakSet 循环引用检测、Reflect.ownKeys 拒绝 Symbol 键、拒绝稀疏数组/数组额外属性/accessor-getter、禁止 any + V5.4.3 增强：仅接受规范数组索引（String(index)===key, index<length）拒绝伪数字 "01"/"4294967295"、拒绝 Array 子类（prototype !== Array.prototype）、拒绝数组 toJSON、拒绝不可枚举属性（enumerable===false）、使用 descriptor.value 读取值、WeakSet try/finally 删除（祖先链—共享引用通过/真循环拒绝）；GC orchestrator 直接 cutoff `now - 7 days` + 恢复 getRecentlyCompletedRunIds(now-60min) 双层保护；更新后的 SyncRunner 接口（inputArtifact/boundPlanArtifact 类型 JsonValue）+ 预生成 runId + 先 claim 后 store 生命周期） | P5-SY5A, P5-SY5B | DONE（独立验收通过，129/129） |
| **P5-SY5C2** | 类型补全 + Schema + Repository + SyncService + 依赖工厂 + Server Actions + Mock Provider/Runner | P5-SY5C | 后端模块（任务包第三次修订完成，待独立复审） |
| **P5-SY5D** | Sync 页面与客户端组件 | P5-SY5C2 | 前端页面 |
| **P5-SY5E** | 侧边栏集成 | P5-SY5C2 | 前端导航 |
| **P5-SY5F** | MockSyncRunner + MockArtifactProvider + 端到端流程验证（含 validateJsonValue ~24 场景：V5.4.1 基础 ~12 场景 NaN/Infinity/嵌套 undefined/toJSON/自定义原型/函数/Symbol/BigInt/正常值 round-trip + V5.4.2 新增 ~4 场景 Symbol 键/循环引用/稀疏数组/getter 属性 + V5.4.3 新增 ~8 场景 非规范索引"01"/"4294967295"/不可枚举属性/Array 子类/数组自身 toJSON/数组继承 toJSON/共享对象引用通过/真正循环祖先链拒绝；prepare() normalizedContent round-trip + store hash 一致性 + 非确定性序列化安全 + claim 失败无 artifact + store 失败 release failed + GC orchestrator 双层保护（7 天 cutoff + getRecentlyCompletedRunIds 60 分钟保护）+ 防误删 in_progress/被引用 artifact + GC 防误删"artifact 超 7 天但 Dry Run 刚完成"边界测试 + 终态 exit_code 约束 + Runner JsonValue 类型验证，共 ~46 场景） | P5-SY5D | 集成测试 |
| **P5-SY5G** | 并发锁原子 claim 测试（必须真实 PostgreSQL 双事务并发，含 claim dry_run_run_id 验证执行顺序测试（验证在锁后执行）+ claim-vs-release deadlock 验证 + claim-vs-cleanup deadlock 验证 + Real Write claim 原子 dry_run_run_id 验证 + TOCTOU 边界 + 时钟边界 59:59 vs 60:00 + GC vs claim 并发安全 + GC 防误删边界（artifact 超 7 天但 Dry Run 刚完成 + artifact.createdAt 与 finished_at 独立验证）+ lease_duration 边界测试 + **V5.5: heartbeat 与新 claim 并发时，成功续租的运行不得被回收（FOR UPDATE 行锁阻止并发 UPDATE，验证 claim 在锁后读到的 lease_expires_at 为最新值）** + **V5.5: 仓库停用与 claim 并发 — 锁等待期间仓库被停用（warehouse.is_active=false）后，不得创建新 sync_run**，Mock 不算通过） | P5-SY5A, P5-SY5F | 安全测试 |
