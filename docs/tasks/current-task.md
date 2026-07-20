# Current Task Packet

## Task ID

**OPT-5-CLOSEOUT / OPT-6-HANDOFF — OPT-5 FINAL PASS / PR #8 MERGE PENDING**

## 当前事实

- OPT-5 指定独立审查已给出 `FINAL PASS`，允许主会话记录 PASS 并进入 OPT-6。
- 通过绑定：head `9d52ad5fa976b7005a5c985a3616ec48b6b1b9aa`、GitHub Actions `29718642505`、Vercel `dpl_EhLhGoqpysRmRj49BNgDASrnWsGJ`。
- PR #8 仍为 Draft/Open/MERGEABLE/CLEAN；合并/部署由主会话处理。
- Production 与 Staging 均为精确 `00001–00049`，OPT-5 不再需要任何数据库写入。
- 完整证据：[OPT-5 主报告](../reports/2026-07-20-opt5-database-least-privilege.md)；[Staging postcheck](../reports/evidence/2026-07-20-opt5-staging-postcheck.md)；[Production postcheck](../reports/evidence/2026-07-20-opt5-production-postcheck.md)。

## 当前允许范围

1. 把 OPT-5 FINAL PASS 与远程绑定写入项目树并完成链接/secret/diff 检查。
2. 推送状态提交，等待新 exact-head CI/Vercel 全绿，将 PR #8 标为 Ready 并合并到 master。
3. 从已合并的最新 master 建立独立 OPT-6 分支与任务包。

## 当前禁止范围

- 禁止在 PR #8/OPT-5 分支混入 OPT-6 代码、Policy Migration、依赖或 lint 清理。
- 禁止再次写 Staging/Production、修改 00049、修旧 history 或重放旧 Migration。
- 禁止在 PR #8 合并前把 OPT-6 标为实施中。
- 用户对既定 OPT-6 路线的持续授权不覆盖意外数据删除、直接回滚、绕过 RLS、密钥暴露或 materially different 的架构变更。

## OPT-6 交接范围

合并后应先重算真实基线，再实施 [系统优化路线图](system-optimization-roadmap-2026-07-17.md#opt-6渐进式质量治理) 的既定项目：

- 清理 31 个 lint warning，并把 CI warning budget 分批降至 0；
- 对 6 个 auth init-plan policy 做等价优化并验证完整身份矩阵；
- 对 115 个 multiple permissive policy 只按可证明 OR 语义等价的小批次治理；
- 不因单次 Advisor 删除 unused index；调查 Turbopack NFT trace warning；
- 评估 leaked-password protection、2 个无可用修复的 moderate PostCSS advisory 与依赖治理边界；
- 每批保存本地/CI/远端 postcheck 与文档索引，最终再次移交指定会话；明确 `OPT-6 FINAL PASS` 前不宣称全部优化完成。
