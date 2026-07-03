# Current Task Packet

## Task ID

`PERF-S1A` — 海外库存 RPC 设计 + Migration 静态契约测试

## 状态

**DONE**（2026-07-03 创建，2026-07-03 两次返修）。Migration 00027 已创建（3 个 RPC + 79 项静态契约测试），未执行生产 Migration。首次返修：stock_status 白名单 zero→out_of_stock、low/normal 追加 match_status='matched'、COALESCE NULL 防御。二次返修：修复 SQL 注释吞行（WHERE 行内 -- 注释移到独立行）+ 新增 7 项防注释吞行逐行扫描测试。下一步 PERF-S1B。

## 依赖

- PERF-PLAN DONE（性能优化计划，2026-07-03）
- P3-S5B0~B5 全部 DONE

## 范围（已完成）

### 1. Migration 00027 新增三个 RPC

| RPC | 用途 | 参数 |
|---|---|---|
| `get_overseas_inventory` | 替代 getOverseasList 的 JS 全量过滤分页。SQL 层完成：overseas 过滤、country/warehouse/search/stock_status/favorited_only 筛选、归档排除、关注标记、Admin/Operator 仓库隔离、排序（关注置顶→quantity ASC）、LIMIT/OFFSET 分页、COUNT(*) 真实 total | p_user_id, p_country, p_warehouse_id, p_search, p_stock_status, p_favorited_only, p_page, p_page_size |
| `get_overseas_stats` | 替代 getOverseasStats 的 JS 全量聚合。SQL COUNT(DISTINCT)/SUM/MAX 完成。低库存仅统计已匹配且 0<qty≤safety_stock 的 variant | p_user_id, p_country, p_warehouse_id |
| `get_in_transit_confirmed_aggregate` | 合并 getInTransitByVariantAndWarehouse + getConfirmedWarehousedByWarehouse 的 JS/N+1 查询为单次 SQL。返回 warehouse_id/variant_id/in_transit_quantity/confirmed_quantity 四元组 | p_user_id, p_warehouse_ids |

### 2. 安全合规

三个 RPC 全部：
- SECURITY INVOKER
- SET search_path = ''
- auth.uid() IS NOT NULL 检查
- p_user_id = auth.uid() 绑定
- Admin 看全部海外仓，Operator 仅已分配仓库（get_assigned_warehouse_ids）
- REVOKE EXECUTE FROM PUBLIC, anon
- GRANT EXECUTE TO authenticated
- 中文 RAISE EXCEPTION
- 参数防御（COALESCE NULL 防御（p_page/p_page_size/p_favorited_only）、page<1 归一化、page_size>100 封顶、stock_status 白名单 out_of_stock/low/normal、空搜索字符串→NULL）

### 3. 口径不变

- inventory.quantity 仍只来自 BigSeller 同步
- 在途 = 非 warehoused 的 (quantity - warehoused_quantity)
- 已确认到仓 = customs 或 (warehoused + bigseller_absorbed_at IS NULL) 的 warehoused_quantity
- 已 BigSeller 吸收的不参与 confirmed
- 不写 inventory.quantity

### 4. 静态契约测试

`src/features/inventory/perf-s1a-migration.test.ts` — 79 项测试，覆盖：
- 文件存在/编号 00027
- 三个 RPC 名称
- SECURITY INVOKER（3 项）
- SET search_path = ''（3 项）
- auth.uid() IS NOT NULL（3 项）
- p_user_id 绑定（3 项）
- REVOKE 数量（6 条 = 3 × PUBLIC + anon）
- GRANT authenticated（3 条）+ 不 GRANT PUBLIC/anon/service_role
- LIMIT/OFFSET + v_offset 计算
- COUNT(*) total
- archived/favorited 逻辑（4 项）
- warehouse.type = 'overseas'
- SQL 聚合 COUNT/SUM/MAX（3 项）+ 低库存口径（2 项）
- bigseller_absorbed_at IS NULL 口径（5 项）
- 不读/写 inventory.quantity（3 项）
- 中文 RAISE EXCEPTION + ERRCODE（2 项）
- 不修改旧 migration（2 项）
- 仓库隔离（3 项）
- 参数防御（7 项：COALESCE 3 + page<1/page_size>100/stock_status 白名单 out_of_stock+low+normal/空搜索→NULL）
- stock_status 筛选口径（4 项：不含 zero、含 out_of_stock、low/normal 均含 match_status='matched'）
- 返回结构（3 项）
- 注释声明（2 项）
- 防注释吞行逐行扫描（7 项：IF auth.uid/COALESCE p_page/REVOKE/WITH filtered/WITH base/eligible_shipment 各逐行断言不在 ^\s*-- 行 + 全量注释行扫描）

### 5. 不实现

- 不修改 Repository / Server Action / UI
- 不接入新 RPC
- 不执行生产 Supabase Migration
- 不修改已执行过的旧 Migration
- 不改变 inventory.quantity 事实来源
- 不让 DIS 入仓流程写 inventory.quantity

## 下一步

**PERF-S1B**：Repository / Server Action 接入 RPC，移除 JS 全量过滤分页。

## 质量门

PERF-S1A 通过（2026-07-03 创建 → 两次返修）：
- 新增 `00027_overseas_inventory_performance_rpc.sql`（~290 行，含两次返修）
- 新增 `perf-s1a-migration.test.ts`（79 项静态契约测试，含 7 项防注释吞行逐行扫描）
- inventory 79/79（1 文件）
- 全量 2640/2640（63 文件）
- build pass
- lint 5 errors / 26 warnings（all pre-existing）
- git diff --check pass

## 当前业务口径

inventory.quantity 唯一事实来源是 BigSeller。DIS 确认到仓仅更新 shipment_item.warehoused_quantity + shipment.status + tracking_event。`bigseller_absorbed_at` 由 Admin 手动确认（NULL = 未确认吸收）。BigSeller 同步库存 ≠ DIS 到仓进度，两个事实来源独立展示。
