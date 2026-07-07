# Current Task Packet

## Task ID

`PERF-D-CACHE` — 移除同步模块海外仓进程级缓存

## 状态

**DONE**（2026-07-07）。

### 背景

`src/features/sync/server-actions.ts` 原有模块级缓存：

```ts
let _overseasWhCache: Awaited<ReturnType<typeof getOverseasWarehouses>> | null = null;
async function getCachedOverseasWarehouses() {
  if (!_overseasWhCache) {
    _overseasWhCache = await getOverseasWarehouses();
  }
  return _overseasWhCache;
}
```

这是进程级缓存，只在首次调用时查询一次 `warehouse` 表，之后整个进程生命周期内不再刷新。问题：

- 仓库增删改名后缓存 stale，导致仓库列表不准确
- 与 Phase B（PERF-B1）已建立的 request-scope cache 模式不一致
- 7 个 Server Action 调用点全部受影响

### 实现

**修复**（最小风险方案 — 直接删除缓存）：

1. 删除 `_overseasWhCache` 变量声明（module-level `let`）
2. 删除 `getCachedOverseasWarehouses()` 缓存包装函数
3. 所有 7 处 `getCachedOverseasWarehouses()` → `await getOverseasWarehouses()`
4. `p5-sy9f-batch-dry-run.test.ts` 注释引用同步更新

`getOverseasWarehouses()` 每次查询 `warehouse` 表（`type='overseas' AND is_active=true`），当前数据量 ~5 行，查询开销可忽略。

**perf-d-cache.test.ts**：8 项静态源码测试：

| 分组 | 测试项 |
|------|--------|
| 缓存变量与函数已删除 | 不存在 `_overseasWhCache` / `getCachedOverseasWarehouses` / 任何 `let ... Cache` 声明 |
| 正确函数未受影响 | `getOverseasWarehouses` 存在 / `getOverseasWarehouseOptions` 导出 / 内部直接调用不经缓存 |
| 文件元数据 | 文件存在且非空 / 仍为 `.ts` |

### 禁止事项（已遵守）

- 不改 Migration
- 不改 RLS/RPC
- 不改同步分页、不改索引
- 不修改 `.claude/`
- 不处理 `--webpack`

### 验收

| 检查项 | 结果 |
|--------|------|
| `npm run test -- src/features/sync` | **837/837** 通过（26 文件）✅ |
| `npm run test`（全量非并发） | **2913/2913** 通过（70 文件）✅ |
| `npm run build` | ✓ Compiled + TypeScript ✅ |
| `npm run lint` | 5 errors / 25 warnings（均为既有，非本轮新增）✅ |
| `git diff --check` | 通过 ✅ |

### 修改文件清单

| # | 文件 | 变更 |
|---|------|------|
| 1 | `src/features/sync/server-actions.ts` | 删除 `_overseasWhCache` + `getCachedOverseasWarehouses()`，7 处调用点改为 `getOverseasWarehouses()` |
| 2 | `src/features/sync/perf-d-cache.test.ts` | 新增 8 项静态源码测试 |
| 3 | `src/features/sync/p5-sy9f-batch-dry-run.test.ts` | 注释引用修正 |
| 4 | `docs/current-state.md` | PERF-D-CACHE 状态同步 |
| 5 | `docs/tasks/current-task.md` | PERF-D-CACHE Task 记录（本文件） |

### 剩余性能计划未完成项

按 `DIS-性能优化计划-修订版.md` 清单：

| # | 任务 | 状态 | 说明 |
|---|------|------|------|
| 1 | warehouseOverview 独立 RPC | 未启动 | 当前基于同步页当前页 rows 做客户端 useMemo 聚合，非全量最新状态；如需全量准确概览，后续可评估独立 RPC |
| 2 | Phase F 去 --webpack / optimizePackageImports | 未启动 | Next.js 构建优化，需评估 Turbopack 兼容性 |
| 3 | `idx_inventory_low_stock` 删除评估 | 未启动 | 00001 低库存部分索引使用率需另开任务评估 |

### 下一步

PERF-D-CACHE 完成。可选择推进新 Phase、剩余性能计划项或 P3-S1B 恢复（百世 API 权限，仍 BLOCKED_EXTERNAL）。
