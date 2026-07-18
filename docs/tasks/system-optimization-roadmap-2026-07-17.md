# DIS 系统优化路线图（2026-07-17）

## 文档定位

本路线图把 `DIS-项目代码总结.md`（2026-07-13，42 个 Migration / 3524 个测试）中仍然有效的建议，按 2026-07-17 的真实代码、Migration、测试和线上 Supabase 状态重新校准。

事实来源优先级：

1. 当前真实代码与 Git 历史
2. `supabase/migrations/`
3. `docs/current-state.md`
4. 本路线图
5. `DIS-项目代码总结.md`（仅作为 2026-07-13 的历史审计快照）

## 当前事实基线

| 项目 | 2026-07-17 事实 |
|---|---|
| 主线 | `master` 已合并 `codex/sequential-roadmap`，HEAD 包含 P0–P7、首页及 Preview 验收归档 |
| Migration | 仓库包含 00001–00047，共 47 个 SQL Migration |
| 默认测试 | 88 个文件、3883 个测试，0 failure |
| 全部测试文件 | 92 个：88 个默认测试、1 个并发测试、1 个 live provider 测试、2 个当前未被 Vitest 扫描的 migration 测试 |
| Lint | 0 error / 31 warning，均为未使用变量 |
| 构建 | Next.js build / TypeScript 通过 |
| Staging | 从空库连续重放 00001–00047，真实脱敏快照与 Admin/Operator RLS 验收通过 |
| Production | 业务 Schema 已包含大量早期对象，但 Migration 历史只登记 00041–00047；与 Staging 存在已确认 Schema 漂移 |
| 自动化 | OPT-1 已新增 `.github/workflows/ci.yml`；本地质量门通过，PostgreSQL 并发 job 等待独立分支/PR首次远程验证 |

## 对旧总结的校准

### 已完成，不再作为优化缺口

- P0–P7 与首页实现。
- Vercel Preview、独立 Supabase Staging 和真实脱敏数据验收。
- Production 的 00041–00047 部署与只读 RPC/RLS 冒烟。
- ProductVariant、海外库存、在途、团队账号和同步链路的既定 MVP 范围。

### 仍然成立

- 缺少持续集成和自动质量门。
- 测试中过度依赖源码文本契约，真实 PostgreSQL/RLS/RPC 行为覆盖不足。
- Production 的迁移历史尚未基线化，不能安全启用 `supabase db push`。
- 国内库存、动态运输周期、库存历史快照、自动匹配、逐 SKU 同步审计仍属于产品路线技术债务。

### 本次审计新增或提高优先级

- 两个 `supabase/migrations/*.test.ts` 不在 `vitest.config.mts` 的 `src/**/*.test.ts` 扫描范围内，默认质量门实际漏跑。
- Production/Staging 数据库顾问均无 ERROR，但存在需人工分级的既有 WARNING：
  - 5 个函数未固定 `search_path`；
  - `get_user_role()`、`handle_new_user()` 继承了 `PUBLIC/anon EXECUTE`；
  - 多个 `SECURITY DEFINER` RPC 可由 `authenticated` 执行，必须逐个核对调用者身份绑定和业务授权，不能批量改成 `SECURITY INVOKER`；
  - 6 个 RLS policy 存在 auth init-plan 优化项；
  - 115 个 multiple permissive policy 告警，需要按表核对语义后逐步合并，禁止为消警告改变 Admin/Operator 可见范围。
- 当前状态文档中“等待 Preview 确认后合并”的旧描述已在 OPT-1 文档同步中改为历史验收结果。

## 总体实施顺序

```text
OPT-1 CI 基线
  ↓
OPT-2 测试覆盖加固
  ↓
OPT-3 Production Migration 基线审计（只读）
  ↓ 用户确认基线报告与备份
OPT-4 Migration 历史修复 + Schema 前向补齐
  ↓
OPT-5 数据库最小权限收口
  ↓
OPT-6 Lint / 文档 / 性能告警渐进治理
```

数据库任务必须串行。OPT-3 完成前，不得对 Production 执行 `db push`、旧 Migration 重放或新的 Production Schema 变更。

## OPT-1：CI 基线（CODE COMPLETE / REMOTE VERIFY PENDING）

**目标**：让每次 PR 和 `master` push 自动验证当前稳定基线。

**范围**：

- 新增 GitHub Actions workflow。
- Quality Job：`npm ci` → 默认测试 → lint → build → `git diff --check`。
- PostgreSQL Job：启动隔离的 PostgreSQL service，执行 `npm run test:concurrency`。
- 初期以 `--max-warnings 31` 固定 warning 上限，禁止新增 warning；后续逐步归零。
- 确认并固定与 Vercel 兼容的 Node 主版本，写入 workflow 和项目版本约束。

**非目标**：

- PR CI 不连接 Production/Staging。
- `test:best-live` 不进入普通 PR；仅允许手动或计划任务并使用受保护 secrets。
- 本任务不部署 Vercel、不修改数据库。

**验收**：PR 与主线质量任务通过；故意破坏测试时 workflow 明确失败；并发测试在隔离 PostgreSQL 中稳定执行。

**2026-07-17 本地结果**：已新增 `.nvmrc`（与 Vercel Project Settings 的 Node `24.x` 对齐）和 `.github/workflows/ci.yml`。YAML 结构解析通过；默认测试 3883/3883、lint 0 error / 31 warning budget、占位 Supabase 环境 build 均通过。本机无 Docker/PostgreSQL，44 个并发测试等待 workflow 在 GitHub PostgreSQL 17 service 中首次验证。

## OPT-2：测试覆盖加固

**目标**：保留有效架构护栏，同时把关键结论从“源码包含某段文本”升级为“数据库实际行为成立”。

**范围**：

1. 将以下漏跑测试移入 `src/` 对应 feature，或显式纳入默认 Vitest：
   - `supabase/migrations/00013_extend_user_variant_preference_favorited.test.ts`
   - `supabase/migrations/00014_dynamic_alert_fields.test.ts`
2. 为 00041–00047 增加隔离数据库 replay / RPC contract 测试。
3. 补 Admin、Operator、disabled user、anon、跨仓访问的 RLS 行为测试。
4. 补 P1、P7、首页聚合 RPC 的边界数据与权限测试。
5. 保留以下负向架构护栏：页面不直连 Supabase、客户端无 `service_role`、Repository/Server Action 边界、已执行 Migration 不被修改。

**验收**：所有测试进入可见的 CI job；权限测试验证返回行集，而不是只匹配 SQL/TS 源码文本。

## OPT-3：Production Migration 基线审计

**目标**：在不写 Production 的前提下，生成可复核的 00001–00040 历史与对象级差异报告。

**步骤**：

1. 记录 Production 备份/恢复点和当前 Migration 历史。
2. 从 00001 到 00040 逐条提取预期 Schema effect。
3. 对 Production 与 Staging 做只读对象比对：表、列、类型、默认值、约束、索引、触发器、函数签名/定义/owner/ACL、RLS 和 policy。
4. 每条 Migration 分类：
   - `EXACT_PRESENT`：效果完整且一致，可候选只修历史；
   - `PRESENT_DIVERGENT`：对象存在但定义不同，必须影响评审；
   - `MISSING_REQUIRED`：缺失且当前仍需要，使用 00048+ 前向 Migration 补齐；
   - `OBSOLETE_SUPERSEDED`：已被后续 Migration 完整替代，记录证据，不重放旧 SQL。
5. 输出 SQL、对象证据、风险、回滚和建议动作，等待用户确认。

**硬性边界**：

- `supabase migration repair` 只允许在确认实际 Schema effect 已存在时使用；它只修历史，不执行 SQL。
- 禁止把 00001–00040 直接重放到 Production。
- 禁止为了让 CLI 显示一致而伪造对象状态。
- 审计阶段只读，不修改 Migration、Production Schema 或历史表。

## OPT-4：历史修复与 Schema 前向补齐

**前置条件**：OPT-3 报告通过人工确认，Production 有可用备份/恢复点。

**范围**：

- 对 `EXACT_PRESENT` 执行受控 migration history repair。
- 对缺失或分歧对象创建新的 00048+ 前向 Migration；不修改 00001–00047。
- 先在全新本地/临时数据库重放 00001–最新，再部署 Staging。
- Staging 完成 Admin/Operator/RLS/关键页面和回滚演练后，才安排 Production 维护窗口。
- Production 执行后重新核对 Schema、Migration 历史和数据库顾问结果。

## OPT-5：数据库最小权限收口

**目标**：解决高信号安全告警，同时保持现有权限语义和 RLS 行为。

**已确认事实**：

- `get_user_role()` 为 `SECURITY DEFINER`，已 `SET search_path = ''`，查询绑定 `auth.uid()` 和 `profiles.is_active`；anon 调用通常返回空，但无需保留 anon 执行权。
- `handle_new_user()` 为 Auth 用户创建触发器函数，已固定空 `search_path`；应撤销不必要的直接执行权，并保证 Auth trigger 所需 owner 权限不受影响。
- `check_operator_profile_update()`、`update_updated_at_column()`、`update_shipment_external_updated_at()`、`toggle_user_active_protected()`、`update_user_role_protected()` 未固定 `search_path`；其中后两个已有 `auth.uid()`、活跃 Admin 和操作者参数绑定。

**实施原则**：

1. 逐函数记录 owner、SECURITY 模式、调用角色、内部鉴权、RLS 依赖和现有调用点。
2. 优先撤销不需要的 `PUBLIC` / `anon EXECUTE`，只向实际调用角色显式授权。
3. 所有保留函数固定安全 `search_path` 并显式限定对象 schema。
4. `SECURITY DEFINER` 只有确需越过 RLS 的内部读取/原子操作才保留；不得为了消除告警批量切换模式。
5. 检查 `provider_token_cache` 的 Data API grant。若仅 service role/服务器使用，保持无 anon/authenticated policy 可能是正确设计；先验证 grant，再决定是否新增 policy。
6. Supabase Auth 的 leaked-password protection 属于平台设置，单独评估启用后的登录影响并做回归。
7. 通过新的前向 Migration 实施，先 Staging，后 Production。

**验收身份矩阵**：anon、未登录、活跃 Admin、活跃 Operator、disabled user、跨仓 Operator、service role/系统同步调用。

## OPT-6：渐进式质量治理

- 清理 31 个 unused-vars warning；CI warning budget 从 31 逐步降至 0。
- 对 6 个 auth init-plan policy 使用 `(select auth.uid())` 等等价形式优化，并验证权限矩阵不变。
- 115 个 multiple permissive policy 按热点表和可读性分批治理；每批必须先证明 OR 语义等价。
- 未使用索引只在取得足够生产统计窗口后处理，不能根据单次 advisor 输出批量删除。
- 调查 Next.js build 的既有 Turbopack NFT 全项目 trace warning；重点审查 `next.config.ts → sync/server-actions.ts → api/cron/dry-run` 的动态文件系统路径，修复前不得改变同步产物路径或 Vercel 运行行为。
- 持续校验 `current-state.md` 的 Preview/合并/部署描述，防止完成态再次回退为历史停止条件。

## 产品路线：不混入本轮工程治理

以下项目保留在产品 Backlog，需要单独确认业务规则、数据源和验收口径：

- P8 国内库存接入；
- 仓库/线路级动态运输周期；
- 库存历史快照；
- ProductVariant 自动/半自动匹配；
- 逐 SKU 同步变更审计；
- 百世 API 权限恢复。

## 全局停止条件

- 任一任务发现现有行为与文档不一致，先记录事实并停止扩大范围。
- 任一数据库任务无法证明 Admin/Operator/RLS 语义等价，不进入 Production。
- 任一 Migration 无法在空库连续重放，不部署 Staging/Production。
- 遇到 Production 写操作、migration history repair、权限撤销或 Vercel Production 部署，必须在对应任务验收完成后单独取得用户确认。
