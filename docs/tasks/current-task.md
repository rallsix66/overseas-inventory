# Current Task Packet

## Task ID

**OPT-1-CI-BASELINE — CODE COMPLETE / REMOTE VERIFY PENDING**

路线图：[system-optimization-roadmap-2026-07-17.md](system-optimization-roadmap-2026-07-17.md)

上一阶段归档：[2026-07-17 sequential roadmap and Staging smoke](../reports/2026-07-17-sequential-roadmap-and-staging-smoke.md)

## 目标

为 GitHub Pull Request 和 `master` push 建立不接触云数据库的自动质量门，覆盖当前 3883 个默认测试、lint、Next.js build、diff check，以及在隔离 PostgreSQL service 中运行的 44 个并发测试。

## 开始前事实

- `master` 已包含 PR #2 的顺序路线实现与文档归档。
- 仓库共有 47 个 SQL Migration（00001–00047）。
- `npm run test`：88 files / 3883 tests / 0 failure。
- `npm run lint`：0 error / 31 warning。
- `npm run build`：通过。
- `.github/workflows/` 尚不存在。
- `npm run test:concurrency` 需要 PostgreSQL 连接参数，当前不属于默认测试。
- 两个 `supabase/migrations/*.test.ts` 不在默认 Vitest include 中；它们属于下一任务 OPT-2，本任务不顺带移动。

## 依赖

- 确认 GitHub 仓库 Actions 可用。
- 从 Vercel/项目配置核对生产兼容的 Node 主版本；不得凭本机版本猜测。
- 使用现有 `package-lock.json`，不升级依赖。

## 允许修改范围

- `.github/workflows/ci.yml`
- `package.json`（仅在需要增加无副作用的 CI script 或 Node 版本约束时）
- `.nvmrc`（仅在确认 Node 主版本后）
- 与 CI 配置直接相关的最小文档和测试辅助配置
- `docs/current-state.md`
- `docs/tasks/current-task.md`
- `docs/tasks/system-optimization-roadmap-2026-07-17.md`

## 实施要求

### Quality Job

触发条件：

- Pull Request
- push 到 `master`
- `workflow_dispatch`

步骤：

1. checkout
2. setup-node，启用 npm cache
3. `npm ci`
4. `npm run test`
5. lint，初始 warning budget 固定为 31，任何新增 warning 使 CI 失败
6. `npm run build`
7. `git diff --check`

### PostgreSQL Concurrency Job

- 使用 GitHub Actions PostgreSQL service，不连接 Production/Staging。
- 创建专用测试数据库和最低必要连接变量。
- 等待健康检查通过后执行 `npm ci` 与 `npm run test:concurrency`。
- 不使用 Supabase URL、anon key、service role key 或 Production secrets。

### Live Provider Test

- `npm run test:best-live` 不进入普通 PR/push workflow。
- 若后续需要自动运行，必须另建手动/计划任务并使用受保护 secrets；不属于当前 Task。

## 非目标

- 不修改业务源码、页面、Repository、Server Action 或同步脚本。
- 不移动两个漏跑的 migration 测试；留给 OPT-2。
- 不新增或修改 Migration、RPC、RLS、函数权限或 Supabase 设置。
- 不执行 `supabase migration repair` / `supabase db push`。
- 不连接或写入 Production/Staging。
- 不部署 Vercel。
- 不清理 31 个 lint warning，只建立不允许增长的预算。
- 不提交 `.claude/context-status.json`、`.env.local`、运行产物或用户现有未提交修改。

## 验收标准

- workflow YAML 可被 GitHub Actions 解析。
- 本地 `npm run test` 仍为 3883/3883。
- lint 为 0 error，warning 不超过 31。
- build / TypeScript 通过。
- PostgreSQL 并发测试使用隔离数据库并通过 44/44。
- workflow 中不存在 Production/Staging Supabase 项目标识和密钥引用。
- `git diff --check` 通过。
- 变更集只包含本 Task 允许文件，不混入用户现有同步脚本修改。

## 实施结果（2026-07-17）

- 新增 `.nvmrc`，Node 主版本固定为 24；已通过 Vercel 项目只读配置确认 Production 使用 `24.x`。
- 新增 `.github/workflows/ci.yml`：Quality Job + PostgreSQL 17 Concurrency Job。
- workflow 不包含 Supabase/Vercel 项目标识或真实密钥，不执行 Vercel deploy。
- YAML 结构解析通过。
- `npm run test`：88 files / 3883 tests / 0 failure。
- `npm run lint -- --max-warnings 31`：0 error / 31 warning。
- 使用 CI 占位 Supabase 环境变量执行 `npm run build`：通过；保留 1 条既有 Turbopack NFT trace warning，已记入 OPT-6。
- `git diff --check`：通过。
- 本机未安装 Docker/PostgreSQL，因此 44 个并发测试未在本地重跑；等待该 workflow 在 GitHub PostgreSQL 17 service 中首次验证。此项通过前不把 OPT-1 标记为 DONE。

## 验证命令

```bash
npm run test
npm run lint -- --max-warnings 31
npm run build
npm run test:concurrency
git diff --check
git status --short
```

并发测试必须指向本地或临时 PostgreSQL；缺少隔离数据库时不得改为连接 Supabase Production/Staging。

## 停止条件

CI 文件已完成并通过本地质量门。下一步只允许发布本 Task 的独立分支/PR并观察两个 GitHub Actions job；两个 job 均通过后把 OPT-1 标记为 DONE。不得自动进入 OPT-2 或数据库任务。
