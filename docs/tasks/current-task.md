# Current Task Packet

## Task ID

`SIDEBAR-ENABLE` — 侧边栏 SKU 管理/待处理 SKU 入口启用

## 状态

**DONE**（2026-07-04）。侧边栏产品管理分组下 SKU 管理和待处理 SKU 入口已启用。

### 背景

侧边栏 `sidebar-nav.tsx` 中 `/dashboard/variants`（SKU 管理）和 `/dashboard/variants/unmatched`（待处理 SKU）的 `phase` 字段原为 `'1'`，导致这两个入口灰显不可点击。实际页面和功能已由 P5-SY11E（Variant 页面开发）和 P5-SY11G（用户级归档偏好）完整实现并测试通过。本任务仅将 phase 改为 `'0'` 启用入口，并同步修改 `docs/current-state.md` 中过期的 Current Implementation Limits（删除"SKU 管理与待处理 SKU 仍灰显"、修正 Users/Dashboard/海外库存 RPC 等过期描述）。

### 实现（DONE）

**sidebar-nav.tsx 修改：**
- `/dashboard/variants` phase: `'1'` → `'0'`
- `/dashboard/variants/unmatched` phase: `'1'` → `'0'`
- 不修改 `/dashboard/inventory/domestic`（保持 phase `'2'`）
- 不修改 `isAvailable` 规则（`phase === '0'`）

**测试（`src/features/variants/p5-sy11g-e-ui.test.ts`）：**
- 新增 4 项 sidebar-nav 断言：variants phase 0 / unmatched phase 0 / 产品管理组无 phase 1 / domestic 保持 phase 2

**文档：**
- `docs/current-state.md` Current Task / Next Step / Last Updated / Current Implementation Limits 全部同步
- `docs/tasks/current-task.md` 本文件

### 验收

| 检查项 | 结果 |
|--------|------|
| 全量测试 | **2707/2707**（64 文件）✅ |
| build | Compiled + TypeScript ✅ |
| lint | 5 errors / 25 warnings（仅 `smoke-test-00025.ts` 既有）✅ |
| git diff --check | 通过 ✅ |
| `/dashboard/variants` phase 为 `'0'` | ✅ |
| `/dashboard/variants/unmatched` phase 为 `'0'` | ✅ |
| 产品管理组无 phase `'1'` | ✅ |
| Domestic Inventory 保持 phase `'2'` | ✅ |

### 禁止事项（已遵守）

- 不修改 Migration / RLS / 权限模型 / Server Actions / Repository ✅
- 不修改 variants 页面业务逻辑 ✅
- 不处理 getLowStock/getUnmatched 分页技术债务 ✅
- 不清理 smoke-test-00025.ts lint ✅

## 下一步

SIDEBAR-ENABLE 完成。PERF-S1 全系列、P4-UX、P2-D2、SIDEBAR-ENABLE 均已完成。P3-S1B 仍 BLOCKED_EXTERNAL（百世 API 授权未恢复）。可推进其他未阻塞任务。
