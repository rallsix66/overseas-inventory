# Current Task Packet

## 状态概览（2026-07-16）

| 项目 | 状态 |
|------|------|
| Stage 0 治理 | **Stage 0A 审计完成** — 五份定稿方案（P0/P1/P7/首页/总顺序）已通过 Codex 架构终审 |
| Stage 1 P0 喜运达物流轨迹 API 接入 | **DONE + 绑定闭环 CODE DONE** — 既有生产 API/Cron 冒烟已完成；本分支新增未绑定记录、同仓同国 Shipment 候选与不可逆绑定 UI |
| Stage 2 P1 预测式补货引擎 | **DB DEPLOYED + READ SMOKE PASS** — 00041–00044 已应用；Admin/Operator 补货与在途 RPC 通过；待 Preview 与 Admin 写入验收 |
| Stage 3 P7 全球库存作战室 | **DB DEPLOYED + READ SMOKE PASS** — 00045–00046 已应用；列表、详情与 Operator 仓库隔离通过；待 Preview 页面验收 |
| Stage 4 首页决策看板 | **DB DEPLOYED + READ SMOKE PASS** — 00047 已应用；Admin/Operator 仓库健康 RPC 通过；待 Preview 页面验收 |
| DIS Staging | **READY + FULL MIGRATION REPLAY PASS** — 新项目 `hyarhvsjhkjpallbyifn` 已从空库严格执行 00001–00047；18/18 public 表启用 RLS，关键 RPC 权限通过；待 Vercel Preview 接线 |
| P8-DOMESTIC-INVENTORY | 暂不启动 — 国内库存接入方案待用户确认后启动 |
| P6-OVERSEAS-INVENTORY-UX-V2 | **FINAL CLOSED**（2026-07-09） |
| 全量测试 | **3879/3879**（87 files, 0 failures）；lint 0 errors / 31 warnings；build pass |

## 本次已完成（2026-07-15）

### SEQUENTIAL-ROADMAP-IMPLEMENTATION

- 独立 worktree：`.vercel/worktrees/codex-sequential`；独立分支：`codex/sequential-roadmap`。
- P0：补齐未绑定喜运达记录列表、同仓同国候选查询、Server Action 绑定和绑定后列表刷新。
- P1：新增 00041–00044、共享断货预测函数、补货建议页、仓库补货参数、计划发货与软取消。
- P7：新增 00045–00046、全球库存 JSONB 列表/详情 RPC、权限内聚合、决策队列、详情弹窗和仓库级行动。
- 首页：新增 00047，改为库存健康、有效计划及在途、未来 7 日到港、低库存、关注与同步异常的单屏决策看板。
- 本地验收：两轮全量测试最终均为 3879/3879；lint 0 errors；build/TypeScript 通过；登录页及三条受保护路由浏览器冒烟通过，最终控制台 0 error/warn。
- 数据库部署：00041–00047 已于 2026-07-16 严格按序应用到目标 Supabase `DIS Project`。远端记录 7 条 migration；4 个新列、2 个约束、2 个索引、1 个触发器和 6 个 RPC 均核对通过。
- 数据库只读验收：Admin/Operator 的补货、在途、P7 列表/详情和首页健康度 RPC 均返回正确契约；Operator 仅可见 1 个已分配仓库，补货/P7/首页/详情的仓库隔离断言全部为 true（无泄露）。迁移后安全与性能顾问未发现本批新增对象相关项。
- Staging：Supabase `DIS Staging`（project ref `hyarhvsjhkjpallbyifn`，Singapore）已创建；00001–00047 共 47 条 migration 从空库重放成功，migration 历史连续无缺口。18 个 public 基础表全部启用 RLS；新增六个 P1/P7/首页 RPC 均为 `SECURITY INVOKER`、空 `search_path`、anon 无执行权、authenticated 有执行权。安全/性能顾问均为 0 error，保留的是既有策略/索引类 warning。
- 数据库漂移：Staging 按仓库 migration 链生成，较 Production 多出 `product_variant.is_archived/archived_at/archived_by`、对应索引/外键，以及 `claim_sync_run_system(...)`。这些对象来自 00010/00011，说明 Production 早期 SQL Editor 执行结果与当前 migration 链存在历史漂移；本任务不直接改 Production，后续须单独做生产基线与补齐评审。
- 剩余：Vercel Preview 尚未切换到 Staging；Production 环境变量保持不变。仍需在 Preview 页面完成 Admin/Operator 身份、真实页面、仓库参数、计划发货与取消写入验收。

## 最近已完成（2026-07-10）

### QUALITY-GATE-FIX-P6-ASSERTIONS

全量测试从 3454/3460 恢复至 3460/3460。6 个旧断言全部为 P6-UX-IN-TRANSIT-OPTIMIZATION 后 UI 结构调整导致测试过时（span className 匹配 + unmatched 分支布局 + badge shrink-0 上下文窗口）。不改业务逻辑/Repository/Server Action/Migration/RPC/RLS。

### TEAM-ACCOUNTS-SELECT-CONTROLLED

修复 `/dashboard/users` 页面 `UserRoleChangeDialog` 中 Base UI Select controlled/uncontrolled console warning。根因：`useState<string | undefined>()` 初始值为 `undefined`，选择角色后变为 role id 字符串，导致 Base UI 认为 Select 从 uncontrolled 切换到 controlled。修复：`useState('')` 空字符串 sentinel 保持全生命周期 controlled，`setSelectedRoleId(undefined)` → `setSelectedRoleId('')`，`onValueChange` 不再写 `v ?? undefined`。不改业务逻辑/权限/RPC/Migration/RLS。

### TEAM-ACCOUNTS-SIDEBAR

团队账号侧边栏入口已开放。Admin 可点击进入 `/dashboard/users`，Operator 侧边栏不显示团队账号。

### SKU-MANAGEMENT-UNMATCHED-MERGE

将「待处理 SKU」并入「SKU 管理」作为页内子视图。侧边栏产品管理组仅保留一个「SKU 管理」入口；进入后通过标签切换「全部 SKU」和「待处理 SKU」。这是导航与信息架构收口，不涉及数据库和业务逻辑变更。

- 侧边栏：移除独立「待处理 SKU」入口 + `AlertTriangle` import
- 新增 `variants/layout.tsx`：统一标题 + 两个视图标签
- 两个页面移除独立 `<h1>` 和 `px-6` 外层包装
- 不改 ProductVariant 数据模型/查询口径/权限规则/匹配业务逻辑
- 新增 27 项测试

### P6-OVERSEAS-PRODUCT-NAME-SIMPLIFY

海外库存表格产品名称列展示简化：移除 matched 分支中标准产品辅助信息（"标准品：xxx"/"已匹配标准品缺失"），已匹配行直接显示单个 BigSeller 原始品名 span。标准产品字段、绑定关系、Repository 映射及权限均保持不变。

## 当前阻塞

- **Vercel Preview 接线与页面/写入验收待执行**：Staging 数据库和全量 migration 重放已完成；仍须将 Vercel Preview 的 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY` 指向 `DIS Staging`，Production target 不得修改。随后用 Staging Admin/Operator 验证真实页面，并由 Admin 验证仓库参数、计划发货与取消写入。通过前不得宣称生产完成。
- **P3-S1B**（百世 API 恢复）→ BLOCKED_EXTERNAL，百世 partnerId API 权限未开通。与 P0 喜运达物流轨迹 API 接入无关，不阻塞 Stage 1。
- **Production Migration 历史与 Schema 需基线化后再采用 CLI push**：Production 的 00001–00040 早期通过 SQL Editor 执行且未登记在远端 migration 历史；远端历史仅登记 00041–00047。Staging 已证明仓库 00001–00047 可从空库连续重放，并暴露 Production 缺失的 00010/00011 对象。未来启用 `supabase db push` 或补齐 Production 前必须先做 history baseline/repair 与对象级影响评审，禁止直接重跑旧 migration。

## 质量门（全阶段通用）

```bash
npm run test          # 3879/3879（87 files, 0 failures）
npm run build         # Turbopack 构建成功
npm run lint          # 0 errors / 31 warnings（无本批次新增 error）
git diff --check      # 无 trailing whitespace / 冲突标记
```

## 实施顺序与 Migration 依赖（定稿）

固定串行顺序：**Stage 1 P0 → Stage 2 P1 → Stage 3 P7 → Stage 4 首页**

| Stage | 方案 | Migration | 依赖 |
|-------|------|-----------|------|
| 1 | P0 喜运达物流轨迹 API 接入 | 00038 A / 00039 B / 00040 C | 无（仅依赖现有 00037） |
| 2 | P1 预测式补货引擎 | 00041 A / 00042 B / 00043 C / 00044 D | P0 完成 |
| 3 | P7 全球库存作战室 | 00045 E / 00046 F | P1 C/00043 + P1 D/00044 |
| 4 | 首页决策看板 | 00047 | P1 + P7 完成 |

关键规则：
- P7 的 00045/00046 必须作为新 Migration 创建，不能修改已执行的 00001–00037
- P7 不能先于 P1 开工（P7 E 依赖 P1 C 的共用预测函数，P7 F 依赖 P1 C+D 的 `get_replenishment_suggestions`）
- P0 优先实施仅为降低后续并行变更冲突，不是 P1/P7 的计算依赖
- 首页必须在 P1 与 P7 完成后实施，首页不是并行快赢

## 禁止事项（全阶段）

- 不新增 Migration / RPC / RLS（除非当前 Stage 明确需要）
- 不修改 Product → ProductVariant → Inventory 核心模型
- 不绕过 Repository Pattern / Server Actions / RLS
- 不提交 `.claude/context-status.json`
- 不提交 `.env.local`
- 不使用 `any`
- 不使用 `service_role` 在客户端或业务页面
