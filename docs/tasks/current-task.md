# Current Task Packet

## Task ID

`P6-CSV-EXPORT` — 海外库存 CSV 导出

## 状态

**DONE**（2026-07-07）。

## 功能概述

海外库存页面新增"导出 CSV"按钮，复用当前筛选条件（国家/仓库/库存状态/搜索），通过分页循环拉取全量数据生成 UTF-8 BOM CSV 文件。

## 核心设计

### Server Action

`exportOverseasInventoryCsv(filters)` — `src/features/inventory/actions.ts`

1. `requireAuth()` → `exportCsvSchema.safeParse(filters)` 校验
2. `inventoryRepository.getInTransitConfirmedAggregate(user.id)` 获取在途聚合
3. 构建 `whInTransitMap`（variantId → Map<warehouseId, inTransitQty>），复用 `getOverseasInventory` 的维度映射逻辑
4. `while(true)` 分页循环调用 `inventoryRepository.getOverseasList({pageSize: CSV_EXPORT_PAGE_SIZE=100})`
5. 每页 rows 回填 `item.inTransitQuantity = whInTransitMap.get(item.variantId)?.get(item.warehouseId) ?? 0`
6. 累计到 `allRows`，超 `CSV_EXPORT_MAX_ROWS=10000` → 返回中文错误
7. 空数据 → 返回中文错误
8. `toCsv(allRows, exportColumns)` 生成 CSV 字符串

### CSV 工具

`toCsv(rows, columns)` — `src/lib/csv.ts`（纯函数，浏览器/服务端通用）

- UTF-8 BOM（`﻿`）Excel 兼容中文
- 逗号分隔，RFC 4180 双引号转义
- null/undefined → 空字符串

### 页面按钮

`src/app/dashboard/inventory/overseas/_components/overseas-page-content.tsx`

- `handleExportCsv()` 传递当前 `filters`（country/warehouse/stockStatus/search）
- `exporting` state → disabled + "导出中..." 文案
- `total === 0` → disabled
- 成功：`new Blob([csv], {type: 'text/csv;charset=utf-8;'})` → `URL.createObjectURL` → `<a download>` → click → revoke
- 失败：`toast.error`
- 文件名：`overseas-inventory-YYYYMMDD.csv`

### Schema

`exportCsvSchema` — `src/features/inventory/schema.ts`

- 不含 `page` / `pageSize`（分页由 action 内部控制）
- `country` 仅海外五国（TH/ID/MY/PH/VN，不含 CN）

### CSV 列（10 列）

| 列头 | accessor |
|------|----------|
| 国家 | `r.country` |
| 仓库 | `r.warehouseName` |
| SKU | `r.sku` |
| 产品名称 | `r.productName ?? '未匹配'` |
| 当前库存 | `r.quantity` |
| 在途 | `r.inTransitQuantity \|\| 0` — 由 `getInTransitConfirmedAggregate` 按 (variantId, warehouseId) 回填 |
| 库存+在途 | `r.quantity + (r.inTransitQuantity \|\| 0)` — 非仅 quantity |
| 安全库存 | matched → `r.safetyStock`，unmatched → `'—'` |
| 库存状态 | `stockStatusLabel(r)` |
| 最后同步时间 | `r.lastSyncAt ?? ''` |

## 返修记录

### 返修 1（2026-07-07）：在途数据回填

**问题**：初版 `exportOverseasInventoryCsv` 仅调用 `getOverseasList()`，返回行的 `inTransitQuantity` 默认为 0，导致 CSV 在途列数据不正确。

**修复**：
- 在分页循环前调用 `inventoryRepository.getInTransitConfirmedAggregate(user.id)`
- 构建 `whInTransitMap`（variantId → Map<warehouseId, inTransitQty>），复用 `getOverseasInventory` 的聚合逻辑
- 每页 rows 回填 `item.inTransitQuantity` 后再 push 到 `allRows`
- 新增 3 项测试：`getInTransitConfirmedAggregate` 调用断言 / whInTransitMap 回填逻辑 / "库存+在途"非仅 quantity
- 修复 p3-s5b4-batch-warehouse.test.ts 预存测试：`warehouses 和 list 不使用 seal 以外的独立的 await` 检查范围收窄为仅 `getOverseasInventory` 函数体（不影响 `exportOverseasInventoryCsv` 的 while 循环 await）

## 限制

- ✅ 不新增 Migration（migrations/ 下无 00034）
- ✅ 不新增 RPC / RLS
- ✅ 不修改 `inventoryRepository` 签名（复用 `getOverseasList` + `getInTransitConfirmedAggregate`）
- ✅ pageSize 固定 100，max 10000 行
- ✅ 不依赖百世 API / 国内库存数据源

## 测试

`src/features/inventory/p6-csv-export.test.ts` — 36 项测试

| # | 类别 | 测试数 |
|---|------|--------|
| 1 | CSV 纯函数（toCsv） | 8 |
| 2 | Server Action 源码检查 | 14（含 3 在途回填） |
| 3 | 页面组件源码检查 | 10 |
| 4 | 架构边界 | 2 |
| 5 | 修复 p3-s5b4-batch-warehouse 预存测试 | 1 |
| **Total** | | **36** |

## 验收

| 检查项 | 结果 |
|--------|------|
| `npm run test -- p6-csv-export.test.ts` | 36/36 ✅ |
| `npm run test`（全量非并发） | 2998/2998（74 文件）✅ |
| `npm run build` | Turbopack ✓ 通过 ✅ |
| `npm run lint` | **0 errors** / 25 warnings（均为既有）✅ |
| `git diff --check` | 通过（仅 LF/CRLF warning）✅ |

## 修改文件清单

| # | 文件 | 变更 |
|---|------|------|
| 1 | `src/lib/csv.ts` | 新增：`toCsv()` 纯函数 |
| 2 | `src/features/inventory/actions.ts` | 新增 `exportOverseasInventoryCsv` + 10 列定义 + 在途 aggregate 回填 |
| 3 | `src/features/inventory/schema.ts` | 新增 `exportCsvSchema` |
| 4 | `src/app/dashboard/inventory/overseas/_components/overseas-page-content.tsx` | 导出按钮 + `handleExportCsv` |
| 5 | `src/features/inventory/p6-csv-export.test.ts` | 新增：36 项测试 |
| 6 | `src/features/shipments/p3-s5b4-batch-warehouse.test.ts` | 修复：`warehouses 和 list 不使用 seal 以外的独立的 await` 检查范围收窄为 `getOverseasInventory` 函数体 |
| 7 | `docs/current-state.md` | 更新 Phase / Task / Recent Changes / Last Updated |
| 8 | `docs/tasks/current-task.md` | 本文件（P6-CSV-EXPORT 任务包） |

### 未修改

- 不提交 `.claude/context-status.json`
- 不新增 Migration / RPC / RLS
- 不修改 `inventoryRepository` 签名

## CSV 在途列确认

- ✅ 在途数据已按 `get_in_transit_confirmed_aggregate` RPC 聚合后回填
- ✅ `inTransitQuantity` 按 (variantId, warehouseId) 维度精确取值（不串仓）
- ✅ `库存+在途` = `quantity + inTransitQuantity`（非仅 quantity）
- ✅ 当前筛选条件仍复用
- ✅ pageSize 仍固定 100，最大 10000 行
- ✅ UTF-8 BOM 前缀
- ✅ docs 已同步

## 下一步

可选择推进新 Phase 或 P3-S1B 恢复（百世 API，仍在 BLOCKED_EXTERNAL 状态）。
