# Current Task Packet

## 状态概览（2026-07-10）

| 项目 | 状态 |
|------|------|
| P7-PRODUCT-OVERVIEW | **BLOCKED_BY_DOMESTIC_INVENTORY** — P7-PLAN DONE，P7-MVP 不接通国内库存前不启动 |
| P8-DOMESTIC-INVENTORY | 暂不启动 — 国内库存接入方案待用户确认后启动 |
| P6-OVERSEAS-INVENTORY-UX-V2 | **FINAL CLOSED**（2026-07-09） |
| 全量测试 | **3460/3460**（0 failures）— QUALITY-GATE-FIX-P6-ASSERTIONS 已恢复 |
| 团队账号 | **侧边栏入口已开放**（TEAM-ACCOUNTS-SIDEBAR） |
| Select controlled warning | **已修复**（TEAM-ACCOUNTS-SELECT-CONTROLLED） |

## 最近已完成（2026-07-10）

### QUALITY-GATE-FIX-P6-ASSERTIONS

全量测试从 3454/3460 恢复至 3460/3460。6 个旧断言全部为 P6-UX-IN-TRANSIT-OPTIMIZATION 后 UI 结构调整导致测试过时（span className 匹配 + unmatched 分支布局 + badge shrink-0 上下文窗口）。不改业务逻辑/Repository/Server Action/Migration/RPC/RLS。

### TEAM-ACCOUNTS-SELECT-CONTROLLED

修复 `/dashboard/users` 页面 `UserRoleChangeDialog` 中 Base UI Select controlled/uncontrolled console warning。根因：`useState<string | undefined>()` 初始值为 `undefined`，选择角色后变为 role id 字符串，导致 Base UI 认为 Select 从 uncontrolled 切换到 controlled。修复：`useState('')` 空字符串 sentinel 保持全生命周期 controlled，`setSelectedRoleId(undefined)` → `setSelectedRoleId('')`，`onValueChange` 不再写 `v ?? undefined`。不改业务逻辑/权限/RPC/Migration/RLS。

### TEAM-ACCOUNTS-SIDEBAR

团队账号侧边栏入口已开放。Admin 可点击进入 `/dashboard/users`，Operator 侧边栏不显示团队账号。

## 当前阻塞

- **P7-MVP** → 等待国内库存真实接入方案确认（P8-DOMESTIC-INVENTORY-PLAN）。不接通国内库存前不做 P7。
- **P3-S1B**（百世 API 恢复）→ BLOCKED_EXTERNAL，百世 partnerId API 权限未开通。

## 质量门（全阶段通用）

```bash
npm run test          # 3460/3460（0 failures）
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
