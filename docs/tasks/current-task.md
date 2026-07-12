# Current Task Packet

## 状态概览（2026-07-10）

| 项目 | 状态 |
|------|------|
| P7-PRODUCT-OVERVIEW | **可实施** — P7-PLAN DONE（Codex 复验通过）；v4 合并整合（2026-07-12）解除 `BLOCKED_BY_DOMESTIC_INVENTORY`：P7-A 海外基础总览 + 国内占位可开工，P7-B 增强层待 P1 落盘后叠加，国内真实接入划归 P8（P7-C 启用国内补给判断） |
| P8-DOMESTIC-INVENTORY | 暂不启动 — 国内库存接入方案待用户确认后启动 |
| P6-OVERSEAS-INVENTORY-UX-V2 | **FINAL CLOSED**（2026-07-09） |
| 全量测试 | **3524/3524**（0 failures）— P6-OVERSEAS-PRODUCT-NAME-SIMPLIFY 收口完成 |
| 团队账号 | **侧边栏入口已开放**（TEAM-ACCOUNTS-SIDEBAR） |
| Select controlled warning | **已修复**（TEAM-ACCOUNTS-SELECT-CONTROLLED） |
| SKU 管理 — 待处理合并 | **DONE**（SKU-MANAGEMENT-UNMATCHED-MERGE） |
| 海外库存产品名称简化 | **DONE**（P6-OVERSEAS-PRODUCT-NAME-SIMPLIFY） |

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

- **P7-MVP（已解除 BLOCKED_BY_DOMESTIC_INVENTORY，2026-07-12 v4 合并整合）**：P7-A 海外基础总览 + 国内占位可开工；P7-B 作战室增强层待 P1 补货引擎落盘（提供共享 `forecast_stockout(...)`）后叠加；国内真实库存接入为独立后续 **P8**（不阻塞 P7-A/P7-B）。
- **P3-S1B**（百世 API 恢复）→ BLOCKED_EXTERNAL，百世 partnerId API 权限未开通。

## 质量门（全阶段通用）

```bash
npm run test          # 3524/3524（0 failures）
npm run build         # Turbopack 构建成功
npm run lint          # 0 errors / 25 warnings（all pre-existing）
git diff --check      # 无 trailing whitespace / 冲突标记
```

## 禁止事项（全阶段）

- 不新增 Migration / RPC / RLS（除非新 Task 明确需要）
- 不修改 Product → ProductVariant → Inventory 核心模型
- 不绕过 Repository Pattern / Server Actions / RLS
- 不提交 `.claude/context-status.json`
- 不提交 `.env.local`
- 不使用 `any`
- 不使用 `service_role` 在客户端或业务页面
