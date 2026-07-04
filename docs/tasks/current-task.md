# Current Task Packet

## Task ID

`UNMATCHED-PAGINATION` — 待处理 SKU 页面分页补齐 + Pending Modules 文档修正

## 状态

**DONE**（2026-07-04）。待处理 SKU 页面 `/dashboard/variants/unmatched` 已从全量加载改为 DB 层分页查询，`docs/current-state.md` Pending Modules 表格的过期状态已修正。

### 背景

`variantRepository.getUnmatched()` 原为全量查询（无 `.range()`、无 `count: 'exact'`），归档排除在 JS 层完成。所有 unmatched/pending SKU 一次性加载到内存再过滤分页。当前数据量小（< 10 条），但随同步持续增长存在性能退化风险。本任务补齐 DB 层分页，同时顺手修正 `docs/current-state.md` 中 Pending Modules 表格的 3 条过期状态。

### 实现（DONE）

**repository.ts 修改：**
- `getUnmatched()` 签名改为 `getUnmatched(params: { userId?: string; page?: number; pageSize?: number }): Promise<PaginatedResult<VariantItem>>`
- 查询使用 `{ count: 'exact' }` + `.range(from, from + pageSize - 1)`
- 归档排除从 JS 层 `data.filter()` 迁移到 DB 层 `query.notIn('id', archivedArray)`（在 `.range()` 之前执行，确保 total 准确）
- 排序保持 `last_sync_at desc`
- 返回 `{ data, total, page, pageSize }`

**unmatched/page.tsx 修改：**
- 新增 `searchParams: Promise<{ page?: string }>` prop（Next.js 16）
- `await searchParams` → `parseInt(page, 10)` → 默认 1
- 调用 `getUnmatched({ userId: user.id, page, pageSize: 20 })`
- 新增分页导航：上一页/下一页 Link + "第 N 页，共 M 条"
- 空数据状态保持不变

**测试（`src/features/variants/p5-sy11g-e-ui.test.ts`）：**
- 更新 `unmatched/page.tsx` 组：3 项新断言（searchParams + 分页导航 + PAGE_SIZE）+ 更新旧签名断言为新对象参数
- 新增 `UNMATCHED-PAGINATION — variantRepository.getUnmatched 分页` 组：7 项断言（PaginatedResult 返回类型 / count exact / range / notIn 在 range 前 / last_sync_at 排序 / 返回字段）

**文档：**
- `docs/current-state.md`：Current Task / Pending Modules（3 条修正）/ Technical Debt（getUnmatched 分页已补齐）/ Next Step / Last Updated
- `docs/tasks/current-task.md`：本文件

### 验收

| 检查项 | 结果 |
|--------|------|
| 全量测试 | **2717/2717**（65 文件，concurrency + best live 预存失败）✅ |
| build | Compiled + TypeScript ✅ |
| lint | 5 errors / 25 warnings（仅 `smoke-test-00025.ts` 既有）✅ |
| git diff --check | 通过 ✅ |
| getUnmatched 使用 count exact + range | ✅ |
| notIn 归档过滤在 range 之前 | ✅ |
| unmatched/page.tsx searchParams + 分页导航 | ✅ |
| Pending Modules 表 3 条过期已修正 | ✅ |
| Technical Debt getUnmatched 分页已标记补齐 | ✅ |
| getLowStock 技术债仍保留 | ✅ |

### 禁止事项（已遵守）

- 不修改 getLowStock() ✅
- 不新增 Migration / RPC ✅
- 不修改 RLS / 权限模型 / Server Actions ✅
- 不修改 ProductVariant 匹配业务逻辑 ✅
- 不清理 smoke-test-00025.ts lint ✅
- 不修改 .claude/context-status.json ✅
- 不进入 P3-S1B/P3-S1C/P3-S1D/P3-S2/P3-S4 阻塞路径 ✅

## 下一步

UNMATCHED-PAGINATION 完成。PERF-S1 全系列、P4-UX、P2-D2、SIDEBAR-ENABLE、UNMATCHED-PAGINATION 均已完成。P3-S1B 仍 BLOCKED_EXTERNAL（百世 API 授权未恢复）。可推进其他未阻塞任务（getLowStock 分页补齐 或 P2-I4 Domestic Inventory）。
