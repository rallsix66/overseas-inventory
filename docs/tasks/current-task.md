# Current Task Packet

## Task ID

`P6-OVERSEAS-PRODUCT-NAME-VISIBILITY` — 海外库存产品名称显示修正

## 状态

**DONE**（2026-07-08）。

## 功能概述

修正 `/dashboard/inventory/overseas` 表格中产品名称列的显示：
1. 将"产品名称"列移到 SKU 前面作为主识别列
2. productName 为空时显示"未匹配产品"文字 + 黄色 Badge"未匹配"
3. 产品名称列保持 truncate 防止撑破表格
4. Repository `mapOverseasRow` 确认 product_name → productName 映射正确

## 核心设计

### 列顺序

调整前：国家 / 仓库 / SKU / 产品名称 / 当前库存 / 在途 / 已确认到仓 / 库存+在途 / 安全库存 / 库存状态 / 同步状态

调整后：国家 / 仓库 / **产品名称** / SKU / 当前库存 / 在途 / 已确认到仓 / 库存+在途 / 安全库存 / 库存状态 / 同步状态

### 产品名称显示策略

- `item.productName` 有值 → 直接渲染文本
- `item.productName` 为空 → `<span>未匹配产品</span>` + 黄色 Badge `<span>未匹配</span>`
- 列宽 `max-w-[180px] truncate` 防止长文本撑破表格

### Repository 映射

`src/features/inventory/repository.ts` 中 `mapOverseasRow()` 正确映射 `row.product_name → productName`（`?? null`），无需修改。

### 搜索

搜索 placeholder 已支持"搜索 SKU 或产品名称..."，无需修改。

## 修改文件清单

| # | 文件 | 变更 |
|---|------|------|
| 1 | `src/app/dashboard/inventory/overseas/_components/overseas-page-content.tsx` | 表头列顺序调整 + 表体 productName/SKU 列交换 + 空 productName Badge |
| 2 | `src/features/inventory/p6-product-name-visibility.test.ts` | 新增：34 项测试 |
| 3 | `docs/current-state.md` | 更新 Phase / Task / Completed Tasks |
| 4 | `docs/tasks/current-task.md` | 本文件 |

## 未修改

- Repository（`mapOverseasRow` 已正确映射）
- Migration / RPC / RLS
- 搜索 placeholder
- 国内库存页面
- 同步真实写入逻辑

## 测试

`src/features/inventory/p6-product-name-visibility.test.ts` — 34 项测试

| # | 类别 | 测试数 |
|---|------|--------|
| 1 | 表头列顺序 | 4 |
| 2 | productName 显示逻辑 | 6 |
| 3 | Repository product_name → productName 映射 | 5 |
| 4 | 搜索 placeholder | 2 |
| 5 | 架构合规 | 5 |
| 6 | 回归检查（其他列/按钮/colSpan 未丢失） | 12 |
| **Total** | | **34** |

## 验收

| 检查项 | 结果 |
|--------|------|
| `npm run test -- p6-product-name-visibility` | 34/34 ✅ |
| `npm run test`（全量非并发） | 3052/3053 ✅（1 预存失败：WEBSYNC_REAL_WRITE_ENABLED=true） |
| `npm run build` | Turbopack ✓ 通过 ✅ |
| `npm run lint` | **0 errors** / 25 warnings（均为既有）✅ |
| `git diff --check` | 通过（仅 LF/CRLF warning）✅ |

## 下一步

可选择推进新 Phase 或 P3-S1B 恢复（百世 API，仍在 BLOCKED_EXTERNAL 状态）。
