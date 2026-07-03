# DIS 性能优化计划

> 状态：**规划阶段**（2026-07-03）
> 目标：解决海外库存页面缓慢问题，分阶段执行，第一阶段聚焦 SQL 下推消除 JS 全量过滤分页。

---

## 一、问题诊断

以下诊断基于 2026-07-03 真实代码审计。

### 1.1 海外库存全量读取后 JS 过滤分页（最大瓶颈）

**`inventoryRepository.getOverseasList()`** (`src/features/inventory/repository.ts:129-238`)：

```text
① supabase.from('inventory').select(...).eq('warehouse.type', 'overseas')  ← 无 LIMIT/OFFSET
② .order('quantity', { ascending: true })  ← 全量排序
③ → 全部海外 inventory 行返回服务器 JS 层
④ getUserArchivedVariantIds / getUserFavoritedVariantIds  ← 额外 2 次 DB 查询（归档/关注偏好）
⑤ JS 过滤: activeData.filter(archived)  → 归档过滤
⑥ JS 过滤: items.filter(country)         → 国家筛选
⑦ warehouseAccessRepository.getAccessibleWarehouseIds ← 额外 1 次 DB 查询（仓库访问权限）
⑧ JS 过滤: items.filter(accessibleWhIds) → 仓库隔离
⑨ JS 过滤: items.filter(search)          → SKU/品名搜索（toLowerCase 逐行）
⑩ JS 过滤: items.filter(stockStatus)     → 库存状态（零库存/低库存/正常）
⑪ JS 排序: sort(isFavorited desc, quantity asc)
⑫ JS 分页: total = items.length; items.slice(from, to)
```

**问题**：即使只需要 20 条，也先拉取全部海外库存行（当前规模尚可，但随增长指数级恶化）。每次路由导航/筛选切换都全量拉取。

### 1.2 统计查询同样全量读取

**`inventoryRepository.getOverseasStats()`** (`src/features/inventory/repository.ts:362-448`)：

```text
① supabase.from('inventory').select(...).eq('warehouse.type', 'overseas')  ← 无 SQL 聚合
② → 全部海外 inventory 行返回 JS 层
③ for (const row of data) JS 循环计数: totalQuantity/SKU Set/低库存 Set/lastSyncAt
④ warehouseAccessRepository.getAccessibleWarehouseIds ← 额外 DB 查询
⑤ JS 层仓库隔离过滤
```

**问题**：统计（SKU 数、库存总量、低库存数、最后同步时间）完全可以用 SQL `COUNT`/`SUM`/`MAX` 在 DB 层完成，目前却在 JS 层循环全量行。

### 1.3 低库存查询全量拉取

**`inventoryRepository.getLowStock()`** (`src/features/inventory/repository.ts:241-298`)：

```text
① supabase.from('inventory').select(...)  ← 无 .eq('warehouse.type', 'overseas')，拉全部仓库
② → 全量 inventory 行返回 JS 层
③ JS 过滤: 排除已归档 Variant
④ JS 过滤: quantity <= safetyStock
⑤ warehouseAccessRepository.getAccessibleWarehouseIds  ← 又一次查询
⑥ JS 层仓库隔离过滤
```

### 1.4 confirmedMap 按仓库循环查询（N+1 模式）

**`getOverseasInventory()`** (`src/features/inventory/actions.ts:65-86`)：

```text
① getInTransitByVariantAndWarehouse(userId)     ← shipment 全量 → shipment_item 全量 → JS 聚合
② getOverseasStats + getOverseasWarehouses + getOverseasList  ← 并行
③ uniqueWarehouseIds = [...new Set(result.data.map(whId))]
④ Promise.all(uniqueWarehouseIds.map(whId =>
     getConfirmedWarehousedByWarehouse(whId)     ← 每仓 2 次 DB（shipment + shipment_item）
   ))
```

**问题**：有 N 个仓库就产生 2N 次额外 DB 查询。`getConfirmedWarehousedByWarehouse` 内部先查 shipment（按 warehouse_id + .or()），再查 shipment_item（按 shipment_id IN），每条链路都是串行两步。

### 1.5 关键按钮成功后的不必要 router.refresh()

| 位置 | 触发场景 | 刷新代价 |
|---|---|---|
| `overseas-page-content.tsx:136` | 关注/取消关注成功后 | 整页 Server Component 重查（stats + list + confirmedMap + inTransit） |
| `partial-warehouse-dialog.tsx:197` | 部分确认入仓成功后 | 详情页整页重查（含 getShipmentDetail 子查询） |
| `bigseller-absorption-button.tsx:47` | BigSeller 吸收确认成功后 | 详情页整页重查 |

每个 `router.refresh()` 触发整个路由段 Server Component 重新渲染，连带所有嵌套的 Server Actions 重新执行。

### 1.6 Auth/Profile 重复查询（次要）

- 每个 Server Action 通过 `requireActiveAuth()` / `requireAuth()` → `getCurrentActiveUser()` / `getCurrentUser()` 独立查询 `auth.getUser()` + `profiles`
- layout.tsx 调用 `getCurrentActiveUser()` + 每个子页面可能再调用一次 + 页面内 Actions 又各自调用
- 同一 HTTP 请求生命周期内 profile 几乎不变，可 per-request 缓存

### 1.7 库存同步链路（不在第一阶段）

- Python/Playwright/BigSeller 抓取是长任务，当前通过 Web Server Action 同步等待完整流程
- 应在第二阶段独立后台化，不混入第一阶段

---

## 二、阶段拆分

### 第一阶段：海外库存页核心优化（PERF-S1）

**目标**：SQL 下推消除全量 JS 过滤分页，合并多轮 DB 查询。

**具体措施**：

1. **海外库存列表 RPC 化**：新建 Migration 创建 `get_overseas_inventory` RPC（或少数几个 RPC），SQL 层完成：
   - `warehouse.type = 'overseas'` 过滤
   - country 筛选（`variant.country`）
   - warehouseId 筛选
   - SKU/品名搜索（SQL `ILIKE`）
   - 库存状态筛选（quantity = 0 / 0 < quantity ≤ safety_stock / quantity > safety_stock）
   - 用户归档偏好过滤（`user_variant_preference` JOIN 排除已归档）
   - 用户关注标记（`user_variant_preference` JOIN 获取关注状态）
   - 仓库访问权限隔离（`get_assigned_warehouse_ids()`）
   - 排序（关注置顶 → quantity ASC）
   - 分页（`LIMIT` / `OFFSET`），`total` 为过滤后真实总数
   - 返回 JSONB 含分页行 + total

2. **海外库存统计 RPC 化**：同一或另一 Migration 创建 `get_overseas_stats` RPC，SQL 层完成：
   - `COUNT(DISTINCT variant_id)` → SKU 数
   - `SUM(quantity)` → 总库存
   - `COUNT(DISTINCT CASE WHEN quantity > 0 AND quantity <= safety_stock THEN variant_id END)` → 低库存 SKU 数
   - `MAX(last_sync_at)` → 最后同步时间
   - 归档/仓库隔离过滤与列表 RPC 一致

3. **低库存查询 RPC 化**：低库存属于海外库存子集，可由列表 RPC 通过参数覆盖，或单独 RPC。

4. **合并在途 + 已确认到仓聚合**：
   - 在途数量：将 `getInTransitByVariantAndWarehouse` 的 JS 聚合逻辑移入 RPC（shipment + shipment_item 两步查询合成单次 SQL）
   - 已确认到仓：不再按仓库循环 `getConfirmedWarehousedByWarehouse`，改为 RPC 一次返回 `(warehouse_id, variant_id, confirmed_quantity)` 三元组
   - 两个聚合可与列表 RPC 合并在同一个 RPC 调用中返回，或至少并行化到一次 DB round-trip

5. **关键按钮局部更新**：
   - 关注/取消关注：乐观更新已实现（setOptimisticFavorited），去掉 `router.refresh()`，因为关注状态不改变库存数量/统计
   - 部分确认入仓/批量入仓：返回更新后的 shipment 数据，客户端 `setState` 替代 `router.refresh()`
   - BigSeller 吸收确认：返回更新后的 shipment，客户端局部更新

**不改变**：
- `inventory.quantity` 仍只来自 BigSeller 同步
- DIS 入仓只读/写 shipment_item.warehoused_quantity / shipment.status / tracking_event / bigseller_absorbed_at
- Product → ProductVariant → Inventory 模型不变
- Repository / Server Action / Zod / RLS 链路不变（Repository 内部调用 RPC 替代 Supabase `.from()` 查询，契约不变）

### 第二阶段：库存同步后台化（PERF-S2）

- job/runId 状态模型
- 前端按钮立即返回 pending/running/done/failed
- Python/Playwright 不再由前端 Server Action 同步等待完整流程
- 可轮询或后续实时推送
- **不在第一阶段实现**

### 第三阶段：轻量优化（PERF-S3）

- request-scope auth/profile cache（同一 HTTP 请求内复用 getCurrentActiveUser 结果）
- 首页 Promise.all 并发查询整理（确保无串行依赖的查询真正并发）
- dev 环境尝试 turbopack
- **这些不是第一优先级**

---

## 三、禁止事项

1. 不要把库存同步后台化混进第一阶段
2. 不要引入 `revalidateTag`，除非先完成缓存边界设计；Supabase client 查询不是普通 Next fetch tag 缓存
3. 不要用全局缓存缓存用户角色或启停状态
4. 不要改变 Product → ProductVariant → Inventory 模型
5. 不要让 `inventory.quantity` 被 DIS 入仓流程写入
6. 不要修改已经执行过的 Migration
7. 不要绕过 Repository / Server Action / Zod / RLS
8. RPC 必须 SECURITY INVOKER，沿用现有 auth.uid() 身份绑定模式

---

## 四、建议任务拆分

### PERF-S1A：海外库存 RPC 设计 + Migration 静态契约测试

- 设计 `get_overseas_inventory` RPC：
  - 参数：p_country / p_warehouse_id / p_search / p_stock_status / p_is_favorited_filter / p_user_id / p_page / p_page_size
  - 返回：JSONB `{ data: [...], total: number }`
  - 含归档过滤、关注标记、仓库隔离、排序、分页
- 设计 `get_overseas_stats` RPC（或合并进列表 RPC）
- 设计 `get_in_transit_confirmed_aggregate` RPC：一次返回在途数量 + 已确认到仓数量
- Migration SQL 文件 + 静态契约测试（正则预检输入加固、权限、JSONB 返回结构）
- **不修改 Repository/Server Action/UI**

### PERF-S1B：Repository / Server Action 接入 RPC

- `inventoryRepository.getOverseasList()` 改为调用 RPC，移除 JS 过滤/排序/分页
- `inventoryRepository.getOverseasStats()` 改为调用 RPC
- `inventoryRepository.getLowStock()` 改为调用 RPC（或复用列表 RPC 参数）
- `getOverseasInventory` action 整合新 RPC 调用
- Repository 内部契约不变（仍返回 `PaginatedResult<InventoryItem>` / `OverseasStats`）
- **不修改 UI 组件**

### PERF-S1C：合并在途 + 已确认到仓聚合（已并入 PERF-S1B）

- `getInTransitByVariantAndWarehouse` 逻辑移入 RPC ✅（PERF-S1B 已完成）
- `getConfirmedWarehousedByWarehouse` 循环查询改为单次 RPC 返回全仓聚合 ✅（PERF-S1B 已完成）
- `getOverseasInventory` 去除 `uniqueWarehouseIds.map(whId => ...)` 循环 ✅（PERF-S1B 已完成）
- 口径不变：仅 customs 或 warehoused + bigseller_absorbed_at IS NULL ✅
- **已确认在途/已确认数与原 JS 聚合完全一致** ✅
- **状态**：已并入 PERF-S1B，不再独立执行。

### PERF-S1D：关键按钮局部更新，减少 router.refresh()

- 关注/取消关注：去 `router.refresh()`，仅乐观更新（关注不影响库存数）
- 部分确认入仓：Dialog 关闭后返回新数据，列表/详情局部更新
- BigSeller 吸收确认：Button 关闭后局部更新 shipment 状态
- 批量入仓页：提交后仅刷新当前页数据，不触发整页重渲染
- **不改权限校验和 Repository 契约**
- **不引入 `revalidateTag`**，除非先完成缓存边界设计；Supabase client 查询不是普通 Next fetch tag 缓存

### PERF-S1E：质量门、文档同步、性能验收

- 全量测试通过（inventory + shipments + 全量）
- build / lint / git diff --check 通过
- 手动验收：海外库存页筛选/翻页/搜索响应时间明显缩短
- 归档/关注/仓库隔离/在途/已确认到仓口径不变
- 更新 `docs/current-state.md` 和 `docs/tasks/current-task.md`

---

## 五、验收标准

- 海外库存列表不再全量拉取后 JS 分页（由 RPC SQL `LIMIT`/`OFFSET` 完成）
- 搜索/国家/仓库/库存状态/分页 total 均由 SQL/RPC 保证
- Operator 仓库隔离仍有效（`get_assigned_warehouse_ids()` 在 RPC 内调用）
- 归档、关注状态仍正确（`user_variant_preference` JOIN 在 RPC 内完成）
- 在途数量、已确认到仓数量口径不变
- `inventory.quantity` 事实来源不变（只来自 BigSeller 同步）
- 关键按钮成功后不触发整页重查，除非有明确必要
- 质量门全部通过：

```bash
npm run test -- src/features/inventory/
npm run test -- src/features/shipments/
npm run test
npm run build
npm run lint
git diff --check
```

---

## 六、当前决策记录

- **2026-07-03**：计划创建。所有优化仅限于第一阶段（PERF-S1），第二阶段（PERF-S2）和第三阶段（PERF-S3）仅记录不实现。
- **2026-07-03**：PERF-S1A 完成（两次返修）。Migration 00027 创建了三个 RPC（`get_overseas_inventory` / `get_overseas_stats` / `get_in_transit_confirmed_aggregate`）+ 79 项静态契约测试通过。已于 2026-07-03 执行并通过数据库侧 smoke 验证（三个 RPC 存在、SECURITY INVOKER、anon 拒绝、auth.uid() 绑定正确）。存储于 `supabase/migrations/00027_overseas_inventory_performance_rpc.sql`。测试文件 `src/features/inventory/perf-s1a-migration.test.ts`。全量 2640/2640（63 文件），build pass，lint 5/26。
- **2026-07-03**：PERF-S1B 完成。Repository（`getOverseasList` / `getOverseasStats` / `getInTransitConfirmedAggregate`）+ Actions（`getOverseasInventory`）已接入 00027 三个 RPC。`getOverseasList` 从 ~110 行 JS 全量过滤分页简化为 ~30 行 RPC 调用 + snake_case→camelCase 映射。`getOverseasStats` 从 JS 循环聚合改为 RPC 调用。`getOverseasInventory` 消除 `uniqueWarehouseIds.map(whId => getConfirmedWarehousedByWarehouse(whId))` N+1 循环，改为单次 `get_in_transit_confirmed_aggregate` RPC。`database.ts` 新增三个 RPC 函数签名。Migration 00027 已于 2026-07-03 执行并通过数据库侧 smoke 验证。全量 2639/2639（63 文件），build pass，lint 5/26。
- **2026-07-03**：PERF-S1B 收口返修。PERF-S1C 的聚合内容（合并在途 + 已确认到仓聚合、消除 N+1 按仓循环查询）已确认并入 PERF-S1B 完成。`get_in_transit_confirmed_aggregate` RPC 已覆盖原 PERF-S1C 范围：单次 RPC 返回所有仓库的 (warehouse_id, variant_id, in_transit_quantity, confirmed_quantity) 四元组，替代了 `getInTransitByVariantAndWarehouse`（全量 shipment → JS 聚合）+ `getConfirmedWarehousedByWarehouse`（N+1 按仓循环）。下一步聚焦 PERF-S1D（关键按钮局部更新）或 PERF-S1E（质量门/文档收口）。
- **第一阶段推荐从 PERF-S1A 开始**：先设计 RPC 并编写静态契约测试，确认 SQL 层正确后再接入 Repository。
