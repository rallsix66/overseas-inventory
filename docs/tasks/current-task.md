# Current Task Packet

## Task ID

`PERF-D-OVERVIEW` — 同步页仓库概览改为服务端全量聚合

## 状态

**DONE**（2026-07-07）。

### 背景

`src/app/dashboard/sync/_components/sync-page-content.tsx` 原有 `warehouseOverview` useMemo，基于当前页 `rows` 做客户端聚合，只能反映当前分页数据，非全量最新状态。需要改为服务端 RPC 全量聚合。

### 实现

**Migration 00032** — `00032_sync_warehouse_overview.sql`：

- 新增 `get_sync_warehouse_overview()` RPC
- SECURITY DEFINER + `SET search_path = ''` + `auth.uid()` 身份绑定
- Admin：返回全部活跃海外仓概览
- Operator：仅返回已分配仓库（通过 `user_warehouses`）+ 失败原因截断至 100 字符
- 返回 jsonb 数组，按 country 排序
- REVOKE FROM PUBLIC, anon / GRANT TO authenticated

每仓返回字段：
```json
{
  "warehouse_id": "uuid",
  "warehouse_name": "仓库名",
  "country": "XX",
  "latest_dry_run": { "status": "completed|failed|in_progress", "run_id": "...", "time": "..." } | null,
  "latest_real_write": { "status": "...", "run_id": "...", "time": "..." } | null,
  "last_success_time": "..." | null,
  "last_failure_reason": "..." | null
}
```

**Repository 层**：
- `SyncRepository` 接口新增 `getSyncWarehouseOverview(): Promise<SyncWarehouseOverviewItem[]>`
- `MockRepository` 实现：从内存 runs 聚合全量概览，按 role 区分失败原因展示
- `SupabaseSyncRepository` 实现：调用 `get_sync_warehouse_overview` RPC，snake_case → camelCase 映射

**Server Action**：
- 新增 `getSyncWarehouseOverview()`（authenticated only，无外部输入）

**页面**：
- `page.tsx`：通过 `Promise.all` 与分页/仓库列表并行获取概览，作为 prop 传入
- `sync-page-content.tsx`：Props 新增 `warehouseOverview: SyncWarehouseOverviewItem[]`，删除 useMemo 聚合

**perf-d-overview.test.ts**：26 项测试：

| 分组 | 测试项 | 数量 |
|------|--------|------|
| Migration 00032 静态契约 | 无 DDL/RLS/POLICY/DROP；SECURITY DEFINER + search_path；auth.uid() + get_user_role()；anon 禁止/authenticated 可执行 | 6 |
| Admin/Operator 隔离 | v_role 分支；user_warehouses 过滤；auth.uid() 绑定 | 3 |
| 文件元数据 | 00032 命名、非空、.sql | 3 |
| MockRepository 行为 | Admin 全量、Operator 截断、空数据 | 3 |
| 客户端源码检查 | 无 useMemo warehouseOverview；prop 定义；无 supabase.from/createClient | 3 |
| 服务端源码检查 | 调用 getSyncWarehouseOverview；Promise.all 并行；prop 传递 | 3 |

**database.ts**：添加 `get_sync_warehouse_overview` RPC 类型声明（`Args: Record<string, never>; Returns: unknown[]`）。

### 禁止事项（已遵守）

- 不修改已执行 Migration 00001~00031
- 不改 Product/ProductVariant/Inventory 模型
- 不改同步分页 RPC
- 不改索引优化 00031
- 不改 RLS
- 不修改 `.claude/`
- 不做 UI 大改版
- 不处理 `--webpack`

### 验收

| 检查项 | 结果 |
|--------|------|
| `npm run test -- src/features/sync` | **863/863** 通过（27 文件）✅ |
| `npm run test`（全量非并发） | **2939/2939** 通过（71 文件）✅ |
| `npm run build` | ✓ Compiled + TypeScript ✅ |
| `npm run lint` | 5 errors / 25 warnings（均为既有，非本轮新增）✅ |
| `git diff --check` | 通过 ✅ |

### 修改文件清单

| # | 文件 | 变更 |
|---|------|------|
| 1 | `supabase/migrations/00032_sync_warehouse_overview.sql` | 新增 RPC + 权限收口 |
| 2 | `src/features/sync/perf-d-overview.test.ts` | 新增 26 项测试 |
| 3 | `src/features/sync/types.ts` | 新增 `SyncWarehouseOverviewItem` 类型 |
| 4 | `src/features/sync/repository.ts` | 接口 + Mock 实现 |
| 5 | `src/features/sync/supabase-repository.ts` | Supabase 实现（含类型导入） |
| 6 | `src/features/sync/server-actions.ts` | 新增 Server Action（含类型导入） |
| 7 | `src/app/dashboard/sync/page.tsx` | 服务端并行获取概览，prop 传入 |
| 8 | `src/app/dashboard/sync/_components/sync-page-content.tsx` | Props 新增 warehouseOverview，删除 useMemo |
| 9 | `src/types/database.ts` | 添加 RPC 类型声明 |

### 生产启用

Migration 00032 已在 Supabase SQL Editor 手动执行成功（2026-07-07）。后续如重新生成 `src/types/database.ts`，可替换当前手动添加的 RPC 类型声明。

### 下一步

PERF-D-OVERVIEW 完成。剩余性能计划项：warehouseOverview 独立 RPC（本次已完成）、Phase F 去 --webpack、`idx_inventory_low_stock` 删除评估。可选择推进或 P3-S1B 恢复（百世 API，BLOCKED_EXTERNAL）。
