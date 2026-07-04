# DIS 性能优化计划（分阶段 + 风险分级）

> 修订：2026-07-04
> 性质：**优化计划**，不是确定性结论。每项标注「已确认 / 待验证 / 不建议直接做」。
> 前几轮报告的问题：把需要验证的项写成了确定结论，可能导致按错方向实施。本版修正。

---

## 风险分级说明

| 标记 | 含义 | 行动 |
|------|------|------|
| ✅ 已确认 | 代码层面可确认的问题，方向明确，可直接做 | 按计划实施 |
| 🔬 待验证 | 疑似问题但需 EXPLAIN / 实测确认，不能凭猜测动手 | 先测再做 |
| ⚠️ 不建议直接做 | 前几轮提过但经复核不成立或收益小、风险大 | 从计划移除或降级 |

---

## 第一类：✅ 已确认应优先做

### B1. 认证与权限读取的 request-scope cache

**问题（已确认）**：`getCurrentUser` / `getCurrentActiveUser` 是普通 async 函数，同一请求内被多次调用（layout + page + requireAuth + requireActiveAuth），每次 2 个串行往返（`auth.getUser` + `profiles` 查询）。

**范围（已确认）**：
- `lib/auth.ts` 的 `getCurrentUser` / `getCurrentActiveUser`
- `features/shipments/repository.ts` 的 `getUserRole`（9 处调用）
- `features/warehouse-access/repository.ts` 的 `getAccessibleWarehouseIds`（8 处调用，内部又查 role）
- `features/variants/repository.ts` 的 `getUserArchivedVariantIds`（4 处调用）

**修复**：用 React `cache()` 包装上述函数。`cache()` 作用域是单次请求的渲染 pass，不会跨请求泄漏。

**必须配套（layout 接入）**：
- ⚠️ `app/dashboard/layout.tsx` 当前**没有复用** `getCurrentUser` / `getCurrentActiveUser`，而是直接 `createClient().auth.getUser()` + 查 `profiles`（layout.tsx L15-29）。如果只给 helper 加 cache 但 layout 不接入，cache 命中率会打折——layout 查的那次和 page 查的那次仍是两次独立查询。
- Phase B 必须包含：**layout 改为复用 `getCurrentActiveUser()`**（或 `getCurrentUser()`），这样 layout + page + requireAuth 共用同一次 cache 命中。

**实施注意（可变对象防污染）**：
- `getAccessibleWarehouseIds()` 和 `getUserArchivedVariantIds()` 返回 `Set`。如果直接 `cache()` 一个返回 Set 的函数，同请求内多个调用方拿到**同一个可变对象**，一旦某处 `.add()` / `.delete()` / `.clear()` 会污染所有调用方。
- 正确写法：cache 缓存**内部 array**，repository 方法每次返回 `new Set(cachedArray)`：
  ```ts
  const _getAccessibleWhIdsRaw = cache(async (userId: string): Promise<string[]> => {
    // ...原查询逻辑，返回 array
  });
  async getAccessibleWarehouseIds(userId: string): Promise<Set<string>> {
    return new Set(await _getAccessibleWhIdsRaw(userId));
  }
  ```
- `getUserArchivedVariantIds` 同理。

**不做的事**：
- ❌ **不缓存 `createClient()`**。Supabase 客户端实例化开销小，且 cookie 读取在 Next 15+ 是 async，缓存语义复杂。收益不确定，风险（cookie 刷新时机）存在。如果将来实测发现实例化确实是瓶颈再加。

**风险**：低。`cache()` 是 React 官方原语，语义明确。唯一注意点是 Server Action（非渲染 pass）里的调用不会被缓存——但这符合预期，Action 本就是独立请求。

---

### B2. 首页串行查询重排

**问题（已确认）**：`app/dashboard/page.tsx` 在 `getCurrentUser()` 之后，4 个查询串行：`getOverseasStats` → `getInTransitByVariant` → `getFollowedVariantsBasic` → `getLowStock`。

**修复方向（已确认）**：
- 认证完成后，4 个区块查询可重排并行。
- **保持每个区块独立 catch**，一个失败不拖垮首页（现有 try/catch 语义保留）。
- 在途查询：评估复用 `get_in_transit_confirmed_aggregate` RPC 替代旧 `getInTransitByVariant`，但需确认两者口径一致后再换。

**待验证点**：
- 🔬 `getFollowedVariantsBasic` 内部会注入 `inTransitMap`（page.tsx L60-64）。如果改成并行，注入逻辑要后移到查询返回后。需确认这个后移不破坏告警计算顺序。
- 🔬 在途旧法 vs 新聚合 RPC 的口径是否完全一致（旧法按 variant 聚合，新 RPC 按 variant+warehouse 聚合）。换之前要对数。

---

### B3. 同步页假分页 + 全量聚合

**问题（已确认）**：
- `getSyncRuns({ limit: 100 })` 拉全量 100 条 sync_run，前端 `filteredRows.slice(...)` 是假分页。
- `warehouseOverview` 遍历全量 100 条做 JS 聚合。
- 切仓库筛选时重新 slice，但底层数据不变。

**修复方向（已确认）**：
- 改服务端分页：warehouse filter + page 放 URL searchParams，后端按需查 20 条。
- `warehouseOverview` 改独立 RPC（每仓每种 mode 最新一条，SQL `ROW_NUMBER() OVER(PARTITION BY ...)`）。

**附带修复（已确认）**：
- ⚠️ `features/sync/server-actions.ts` L141 的 `_overseasWhCache` 是模块级 `let`，注释写"同一请求内复用"但实际是**进程级缓存**。仓库增减后不更新，会 stale。应改为 request-scope（`cache()`）或加 TTL，或直接每次查（仓库表很小）。

**风险**：中。改服务端分页涉及 `get_sync_runs` RPC 加分页参数 + 前端分页组件改造。建议单独一个 Phase 做。

---

### B4. 产品详情 / 产品列表查询优化

**问题（已确认）**：
- `features/products/repository.ts` 的 `getById` 内部 3 步串行：product → variants → inventory。
- `list` 是**两次往返 + JS 计数**（先 product 分页，再用 productIds 批量查 variant 计数，再 JS 算 countMap）。**不是 N+1**——是两次批量查询，但仍是两次串行往返。

**修复方向**：
- 产品详情：优先把后两步（variants、inventory）并行，它们都只依赖 product.id。
- 产品列表：优先评估 **RPC / grouped count** 方向（SQL 层 `SELECT product_id, count(*) GROUP BY` 按需取分页内的计数），最稳。
- 嵌套查询 `select('*, variants:product_variant(id)')` 作为备选，但需注意：当每产品 variant 数多时，会传输大量 variant id（20 产品 × 每产品 N 个 variant），不一定比两次往返更优。**仅在数据量可控时用嵌套查询**，否则走 RPC。

**风险**：低-中。RPC 或嵌套查询都需验证返回结构和 unwrapJoin 兼容性。

---

## 第二类：🔬 待验证（先测再做，不凭猜测动手）

### C1. 数据库索引

**前几轮的错误结论**：
- ❌ "inventory(variant_id) 完全没有索引"——**这是错的**。`00001_initial_schema.sql` L124 有 `UNIQUE (variant_id, warehouse_id)` 约束，PostgreSQL 自动建复合索引，覆盖 `variant_id` 前缀查询。前几轮把这条当 P0 元凶是误判。

**正确的做法**：
- 🔬 **先用真实慢 SQL 做 `EXPLAIN ANALYZE`**，确认哪些查询真的走了 Seq Scan，再决定建什么索引。
- 不要按猜测建索引，尤其不要建与现有约束索引重复的。

**待验证的候选索引**（需 EXPLAIN 确认是否被需要 + 是否已命中现有索引）：
| 候选 | 理由 | 验证方法 |
|------|------|----------|
| `shipment(warehouse_id, status)` | 在途聚合过滤 `warehouse_id=X AND status<>'warehoused'` | EXPLAIN 看是否用了 `idx_shipment_warehouse_id` + filter，还是 Seq Scan |
| `sync_run(warehouse_id, finished_at DESC)` | 每仓取最新一条的排序 | EXPLAIN 看取最新 run 是否 filesort |
| `user_variant_preference` 反查索引 | 归档排除 `NOT IN (...)` 场景 | 看 `idx_uvp_user_type` 是否足够，还是需要 `(variant_id, user_id)` |

**确认要清理的**：
- ✅ `idx_inventory_low_stock WHERE quantity <= 500` 是硬编码废索引（低库存用 `safety_stock`，命中不了）。但删除前也建议确认没有其他查询依赖它。

---

### C2. 海外库存 actions.ts 查询编排

**前几轮的不严谨结论**：
- ❌ "4 个查询全并行"——`getOverseasStats(userId, variantTotalMap)` 依赖 aggregate 产出的 `variantTotalMap`，不能简单全并行。

**正确的分析**：
- `aggregate` 必须先取（或重构 stats 让它独立计算 in-transit 统计）。
- `warehouses` 和 `list` 不依赖 aggregate，可以和 aggregate 并行。
- `stats` 依赖 `variantTotalMap`（来自 aggregate），要么保持串行，要么重构 `getOverseasStats` 让它自己算在途统计（不传 inTransitMap）。

**可选方案**：
- 方案 A（小改）：`aggregate` + `warehouses` + `list` 三并行 → 然后用 aggregate 结果算 stats。省一个串行环节。
- 方案 B（中改）：重构 `getOverseasStats` 去掉 `inTransitMap` 参数，在 RPC 内部算在途统计，4 查询全独立并行。

**建议**：先做方案 A，收益已够。方案 B 等 Phase C 评估。

---

### C3. 去 `--webpack`

**方向（基本对）**：Next 16 默认 Turbopack，`--webpack` 强制走旧编译器。

**但应作为独立小任务**：
1. 先只改 `dev`，本地启动 + 访问各页面验证。
2. 确认无回归后，再评估 `build` 是否去掉。
3. **不要和数据库/认证优化混在一批**。

**风险**：Turbopack 对某些 webpack 专项配置兼容性需验证。当前 `next.config.ts` 是空的，理论上零风险，但仍建议独立验证。

---

### C4. optimizePackageImports

**降级为低优先级**。

- `lucide-react` 在 Next 文档里已默认优化，显式声明的收益可能没前几轮写的那么大。
- 除非确认 `@base-ui/react` 或其他包确实拖慢编译（用 build 日志确认），否则不列为核心性能项。
- 如果要做，先实测编译时间，做完再实测对比。

---

## 第三类：⚠️ 不建议直接做 / 从计划移除

### D1. 新建在途 / 批量确认到仓的 Promise.all 建议

**前几轮的建议（不成立）**：
- "新建在途页 `getCurrentActiveUser` 与 `getWarehousesForSelector` 并行"——**错**。`getWarehousesForSelector(user.id)` 依赖 user，且页面有 Admin 守卫（`user.roleName !== 'admin'` 要先判），不能并行。
- "批量确认到仓 `getCurrentActiveUser` 与 `listEligibleForBatchWarehousing` 并行"——同样错，依赖 user.id 且有 Admin 守卫。

**处理**：从 P1 清单移除。这些页面查询少（1-2 个），收益极小，不值得为假并行引入守卫逻辑混乱。

---

### D2. 在途详情 warehouses 并入 Promise.all

**前几轮的建议（不准确）**：
- "把 `getWarehousesForSelector` 加入第一个 `Promise.all`"——**错**。仓库列表依赖 user（`user.id`），只能等 user 出来后再取，最多做 promise chaining，收益很小。

**处理**：从清单移除。

---

### D3. "所有列表页 SQL 全表扫描"表述

**前几轮的表述（过重）**：
- ❌ "所有 join inventory 的查询全表扫描"——这基于"inventory 无 variant_id 约束"的错误前提。实际上有 UNIQUE 约束索引。

**修正**：改为"部分查询可能未命中最佳复合索引，需 EXPLAIN 验证"。不按猜测建索引。

---

### D4. React.memo 表格行

**降级到第三批（锦上添花）**。

- 先解决服务端查询和 SQL 问题，前端 memo 不该排在前面。
- 海外库存页 20 行 × 13 列的重渲染开销，在服务端耗时没降下来之前，不是主要矛盾。

---

## 实施顺序（修订版）

### Phase A1：轻量测量与基线（不阻塞 Phase B）
- 记录首页、海外库存、产品列表、产品详情、同步页的**服务端耗时**和**主要查询次数**。
- 目的：建立基线，供后续各 Phase 对比。
- **不阻塞 Phase B**——request-scope cache 不需要等测量结果。

### Phase A2：索引 EXPLAIN 验证（可与 B 并行，在 E 之前完成）
- 在 Supabase Dashboard 对疑似慢查询跑 `EXPLAIN ANALYZE`，记录实际执行计划。
- **这一步的产出决定 Phase E 哪些索引真的需要建**。
- 可以和 Phase B 并行进行，只要在 Phase E（建索引）之前完成即可。

### Phase B：request-scope cache（B1）— 可与 A2 并行
- 范围：`getCurrentUser` / `getCurrentActiveUser` / `getUserRole` / `getAccessibleWarehouseIds` / `getUserArchivedVariantIds`。
- **必须配套：layout.tsx 改为复用统一认证 helper**（见 B1）。
- 不动 `createClient`。
- 注意 Set 可变对象防污染（见 B1）。
- 收益稳定，风险低，全站受益。

### Phase C：主页面查询编排（B2 + B4 + C2）
- 首页 4 查询并行重排（B2）。
- 产品详情后两步并行或 RPC/嵌套重写（B4）。
- 产品列表两次往返优化（B4）——优先 RPC/grouped count，嵌套查询仅数据量可控时用。
- 海外库存 actions.ts 用方案 A（aggregate + warehouses + list 三并行，stats 后算）（C2）。

### Phase D：同步页服务端分页（B3）— 单独做，碰 RPC + 权限
- 单独做，不和 cache 混。
- `get_sync_runs` RPC 加分页参数。
- `warehouseOverview` 独立 RPC。
- 修 `_overseasWhCache` 进程级缓存问题。
- **权限验收标准（必须满足）**：
  - Admin / Operator 返回字段不能混淆（Operator 脱敏 error_message / failure_summary 等管理字段，沿用现有 `SyncRunAdminRow` / `SyncRunOperatorRow` 区分）。
  - Operator 不能看到无权限仓库的 sync_run。
  - Operator 不能看到 admin-only 错误详情。
  - 新 RPC 必须有 `auth.uid()` 绑定 + `get_user_role()` 仓库隔离，与现有 `get_sync_runs` 权限链一致。
  - 改完跑 `p3-s6-permission-audit.test.ts` 等权限相关测试回归。

### Phase E：索引优化（C1）
- **基于 Phase A 的 EXPLAIN 结果**，不按猜测建。
- 确认真要建的索引，写 migration。
- 确认 `idx_inventory_low_stock` 可删则删。

### Phase F：构建体验（C3 + C4）
- 去 `--webpack`（先 dev 后 build，独立验证）。
- `optimizePackageImports` 仅在实测确认有收益时做。

---

## 前几轮报告的错误修正对照

| 前几轮结论 | 修正 |
|-----------|------|
| "inventory(variant_id) 完全没有索引，是 SKU 越多越慢的底层元凶" | ❌ 错。UNIQUE(variant_id, warehouse_id) 约束已自动建索引。删除此结论。 |
| "海外库存 4 查询可全并行" | ⚠️ 不严谨。stats 依赖 aggregate 产出的 variantTotalMap。改为三并行 + stats 后算。 |
| "新建在途/批量确认到仓可 Promise.all" | ❌ 错。后续查询依赖 user.id 和 Admin 守卫，不能并行。移除。 |
| "在途详情 warehouses 并入 Promise.all" | ❌ 错。仓库列表依赖 user。移除。 |
| "所有列表页 SQL 全表扫描" | ⚠️ 过重。改为"可能未命中最佳复合索引，需 EXPLAIN 验证"。 |
| "createClient 无 cache 是 P2 问题" | ⚠️ 降级。不缓存 createClient，实例化开销小，cookie 语义复杂。 |
| "optimizePackageImports 是核心性能项" | ⚠️ 降级。lucide-react 已默认优化，除非实测有收益否则不做。 |
| "_overseasWhCache 是同请求缓存" | ❌ 错（注释也写错了）。实际是进程级缓存，会 stale。加入修复清单。 |

---

## 给 Claude 的第一轮实施范围（低风险切片）

为避免一次性改动过大，第一轮**只做以下范围**：

### ✅ 第一轮做
1. **统一认证 helper + layout 接入**
   - `getCurrentUser` / `getCurrentActiveUser` 用 `cache()` 包装。
   - `app/dashboard/layout.tsx` 改为复用 `getCurrentActiveUser()`（替代直接 `createClient().auth.getUser()` + 查 profiles）。
2. **request-scope cache**
   - `shipments/repository.ts` 的 `getUserRole` 用 `cache()` 包装。
   - `warehouse-access/repository.ts` 的 `getAccessibleWarehouseIds` 用 `cache()` 包装（注意 Set 防污染：缓存 array，返回 `new Set()`）。
   - `variants/repository.ts` 的 `getUserArchivedVariantIds` 同理。
3. **验收**
   - `npm run test` 全绿。
   - `npm run lint` 无新增错误。
   - `npm run build` 成功。
   - 手动验证：首页、海外库存、在途管理、产品列表、同步页可正常访问，登录/登出正常。

### ❌ 第一轮不做
- 不动 `createClient()`。
- 不动 migration / 索引。
- 不动同步页分页 / RPC。
- 不动首页查询编排（Phase C）。
- 不动 `--webpack`。

**理由**：同步页分页和索引优化会碰 RPC、类型、RLS / 权限验收，风险面大，应单独开任务。第一轮只做 request-scope cache + layout 接入，范围清楚、可独立验收、回归面小。

---

*本文件为优化计划，非确定性结论。每个 Phase 完成后重新测量，根据实际结果调整后续计划。*
