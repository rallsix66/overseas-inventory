# Current Task Packet

## 状态概览（2026-07-15）

| 项目 | 状态 |
|------|------|
| Stage 0 治理 | **Stage 0A 审计完成** — 五份定稿方案（P0/P1/P7/首页/总顺序）已通过 Codex 架构终审 |
| Stage 1 P0 喜运达物流轨迹 API 接入 | **DONE + 绑定闭环 CODE DONE** — 既有生产 API/Cron 冒烟已完成；本分支新增未绑定记录、同仓同国 Shipment 候选与不可逆绑定 UI |
| Stage 2 P1 预测式补货引擎 | **CODE DONE** — Migration 00041–00044、补货建议、仓库参数、ETA 明细、Admin 计划发货与取消均已落盘；待数据库运行时验收 |
| Stage 3 P7 全球库存作战室 | **CODE DONE** — Migration 00045–00046、唯一列表/详情 RPC、决策队列、分国推演与仓库级行动均已落盘；待数据库运行时验收 |
| Stage 4 首页决策看板 | **CODE DONE** — Migration 00047、库存健康、有效在途、未来 7 日到港、异常与快捷入口均已落盘；待数据库运行时验收 |
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
- 未执行：00041–00047 尚未应用到目标 Supabase；因此 Admin/Operator 的真实数据与 RLS 运行时验收、Vercel Preview/Production 部署仍待后续执行。

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

- **数据库运行时与部署验收待执行**：本地环境没有 Supabase CLI / psql / Docker，且本次未获授权直接修改生产数据库。必须先在目标 Supabase 按 00041→00047 顺序执行新 Migration，再部署 Preview；随后以 Admin/Operator 验证 RPC、RLS、计划发货写入、取消与页面真实数据。通过前不得宣称生产完成。
- **P3-S1B**（百世 API 恢复）→ BLOCKED_EXTERNAL，百世 partnerId API 权限未开通。与 P0 喜运达物流轨迹 API 接入无关，不阻塞 Stage 1。
- **Migration 顺序不可变**：P7 的 00045（E）依赖 P1 的 00043（C），00046（F）依赖 P1 的 00043（C）与 00044（D）；执行必须为 00041→00042→00043→00044→00045→00046→00047。

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
