# Current Task Packet

## Task ID

`PERF-F-TURBOPACK` — 移除 --webpack flag，切换 Next.js 16 默认 Turbopack

## 状态

**DONE**（2026-07-07）。

### 背景

`package.json` 原有 `next dev --webpack` / `next build --webpack`，显式降级到 webpack。Next.js 16 默认使用 Turbopack（Rust 增量打包器），无需额外 flag。需要移除 `--webpack` 并验证 Turbopack 构建通过。

### 实现

**移除 --webpack**：
- `package.json` dev 脚本：`next dev --webpack` → `next dev`
- `package.json` build 脚本：`next build --webpack` → `next build`

**不添加 `optimizePackageImports`**：
- `lucide-react` 是项目唯一使用的重型多导出库，已在 Next.js 默认自动优化列表中
- 无 `date-fns`、`lodash-es`、`recharts`、`react-use` 等其他默认列表中的库
- 无自定义 icon/library 需要手动配置

**Turbopack 构建发现的 Bug 修复**：
- `src/features/warehouse-access/actions.ts`：移除 `export type { OperatorWithAssignments, AssignableWarehouse }` type-only re-export
- Turbopack 正确拒绝 `'use server'` 模块中的 type-only re-export（不产生运行时值），webpack 静默容忍
- 无人从 `actions.ts` 导入这两个类型，全部直接从 `./types.ts` 导入，移除安全

**perf-f-turbopack.test.ts**：9 项静态测试：

| 分组 | 测试项 | 数量 |
|------|--------|------|
| package.json | dev/build 不含 --webpack、直接调用 next dev/build、start 不变 | 5 |
| package.json | 有效 JSON、name 正确 | 1 |
| next.config.ts | 文件存在 | 1 |
| 源码检查 | package.json 全文不含 --webpack 及大小写变体 | 2 |

**p5-sy13b.test.ts**：1 项适配（re-export 断言改为 import + 不 re-export 断言）。

### 禁止事项（已遵守）

- 不修改 `supabase/migrations/*`
- 不改页面业务逻辑
- 不改 Repository / Server Actions（仅修复 type-only re-export Bug）
- 不升级 Next.js 或依赖版本
- 不处理 `idx_inventory_low_stock`
- 不修改 `.claude/context-status.json`
- 不添加 `optimizePackageImports`（无需求）

### 验收

| 检查项 | 结果 |
|--------|------|
| `npm run test`（全量非并发） | **2948/2948** 通过（72 文件）✅ |
| `npm run build`（Turbopack） | ✓ Compiled（3.9s）+ TypeScript（6.2s）+ 静态页 23/23 ✅ |
| `npm run lint` | 5 errors / 25 warnings（均为既有，非本轮新增）✅ |
| `git diff --check` | 通过（仅 LF/CRLF warnings）✅ |
| 构建器确认 | `▲ Next.js 16.2.9 (Turbopack)` ✅ |

### 修改文件清单

| # | 文件 | 变更 |
|---|------|------|
| 1 | `package.json` | 移除 dev/build 脚本中的 `--webpack` |
| 2 | `src/features/sync/perf-f-turbopack.test.ts` | 新增 9 项测试 |
| 3 | `src/features/warehouse-access/actions.ts` | 移除 type-only re-export（Turbopack 拒绝）|
| 4 | `src/features/warehouse-access/p5-sy13b.test.ts` | 适配 re-export → import 断言 |
| 5 | `docs/current-state.md` | PERF-F 记录 + 摘要 |
| 6 | `docs/tasks/current-task.md` | 本文件 |

### 生产启用

无需 Migration 或数据库变更。`npm run build` 已在 Turbopack 下验证通过。

### 下一步

PERF-F-TURBOPACK 完成。剩余性能计划项：`idx_inventory_low_stock` 删除评估。可选择推进新 Phase 或 P3-S1B 恢复（百世 API，BLOCKED_EXTERNAL）。
