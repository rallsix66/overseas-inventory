# Current Task Packet

## Task ID

`P2-D2` — Dashboard 低库存汇总看板

## 状态

**DONE**（2026-07-04）。P2-D2 完成：Dashboard 首页新增低库存汇总区块，不依赖用户关注。

### 背景

Phase 2 任务表中 P2-D2 原本标记为 BLOCKED（依赖 P2-I3）。P2-I3（海外库存真实数据走查）已于早期完成，P2-D2 实际已解除阻塞。P2-D2 面向运营人员快速发现全局低库存风险，与 P5-SY12C/D 关注产品动态互补：关注是用户策展的（手动星标），低库存汇总是系统全量的。

### P2-D2 实现（DONE）

**LowStockSummarySection（`src/app/dashboard/_components/low-stock-summary-section.tsx`）：**
- Client Component，导出 `LowStockSummaryItem` 类型 + `LowStockSummarySection` 组件
- Props: `items: LowStockSummaryItem[]`, `error?: string | null`
- 空状态：绿色边框 "库存正常 — 当前所有海外仓库存均高于安全库存线"
- 错误状态：红色边框 "低库存数据加载失败：{error}"
- 正常状态：按仓库分组表格（SKU/产品/库存/安全库存/缺口），缺口列红色
- `groupByWarehouse()` 按 warehouseId 分组，各组按缺口总和降序
- MAX_DISPLAY=15 控制首页展示数量，超出显示 "还有 N 项 — 查看全部低库存"
- SKU 链接 → `/dashboard/inventory/overseas?search=<sku>`
- "查看全部" → `/dashboard/inventory/overseas?stockStatus=low`
- 不导入 supabase / Repository / Server Actions / preferences

**DashboardPage（`src/app/dashboard/page.tsx`）：**
- 新增 `inventoryRepository.getLowStock(user.id)` 调用（独立 try/catch）
- gap = `Math.max(safetyStock - quantity, 0)`，非负
- 排序：缺口降序 → 库存升序
- 失败不崩溃 Dashboard（catch 赋值 lowStockError）
- 未登录（无 user.id）时不调用 getLowStock
- 低库存与关注产品各自独立 try/catch，互不影响

**测试（`src/features/inventory/p2-d2-low-stock-summary.test.ts`）：**
- 43 项测试，8 个 describe 分组：
  - Dashboard 数据获取链路（9 项）
  - LowStockSummarySection 组件结构（11 项）
  - 空状态与错误状态（4 项）
  - 仓库分组（4 项）
  - SKU 跳转链接（4 项）
  - 关注与低库存隔离（5 项）
  - 架构合规（5 项）
  - P5-SY12D 回归（5 项）

### 验收

| 检查项 | 结果 |
|--------|------|
| 全量测试 | **2703/2703**（64 文件）✅ |
| build | Compiled + TypeScript ✅ |
| lint | 5 errors / 25 warnings（仅 `smoke-test-00025.ts` 既有）✅ |
| git diff --check | 通过 ✅ |
| Dashboard 存在低库存汇总区块 | ✅ |
| 使用 inventoryRepository.getLowStock(user?.id) | ✅ |
| 关注产品动态保持原行为 | ✅ |
| Admin/Operator 按现有仓库权限隔离 | ✅ |
| 空状态/错误状态中文文案 | ✅ |
| 不修改 Migration/RLS/权限模型/Server Actions | ✅ |
| 页面/组件不直接调用 supabase | ✅ |

### 禁止事项（已遵守）

- 不修改 Migration ✅
- 不修改 RLS ✅
- 不修改权限模型 ✅
- 不修改 Server Actions 签名 ✅
- 不修改 inventoryRepository.getLowStock() 接口 ✅
- 不把关注产品逻辑和低库存汇总逻辑混在一起 ✅
- 不让页面或客户端组件直接调用 supabase ✅
- 不处理 getLowStock/getUnmatched 分页技术债务 ✅
- 不清理 smoke-test-00025.ts lint ✅

## 下一步

P2-D2 完成。PERF-S1 全系列、P4-UX、P2-D2 均已完成。P3-S1B 仍 BLOCKED_EXTERNAL（百世 API 授权未恢复）。可推进其他未阻塞任务。
