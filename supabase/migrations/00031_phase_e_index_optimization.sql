-- ============================================
-- Migration 00031: Phase E — 索引优化（返工修正）
-- ============================================
-- 目的：为高频查询路径补建索引，减少 seq scan、sort、bitmap merge 开销。
--
-- 返工修正（2026-07-07）：
--   - 删除 idx_inventory_variant_id：00001 已有
--     inventory_variant_warehouse_unique UNIQUE (variant_id, warehouse_id)，
--     自动生成的唯一索引 variant_id 前导列已覆盖单列 variant_id 查询。
--   - 删除 idx_sync_run_warehouse_status：00007 已有
--     idx_sync_run_one_in_progress ON sync_run(warehouse_id)
--     WHERE status='in_progress'，精确覆盖 claim_sync_run 的
--     warehouse_id + status='in_progress' 查询。
--   - idx_shipment_status_created → idx_shipment_active_created：
--     改为部分索引 WHERE status <> 'warehoused'，
--     更精确覆盖 shipmentRepository.list() 的
--     .neq('status','warehoused').order('created_at',{ascending:false})。
--
-- 原则：
--   - 仅新增索引，不修改已执行 Migration 00001~00030
--   - 不修改表结构、CHECK 约束、RLS、RPC、权限
--   - 不修改 Product → ProductVariant → Inventory 模型
--   - 每个索引标注对应的查询路径与预期收益
--   - 使用 IF NOT EXISTS 保证幂等
--
-- 设计依据：
--   基于 2026-07-07 真实查询路径审查：
--     - sync_run:       get_sync_runs_paginated / get_sync_runs /
--                       cleanup_expired_sync_runs / getWarehouseHistory
--     - shipment:       list / listEligibleForBatchWarehousing /
--                       getInTransitByVariantAndWarehouse /
--                       getInTransitDetailsByVariantAndWarehouse /
--                       getConfirmedWarehousedQuantity / confirmBigsellerAbsorption
--     - shipment_item:  在途聚合 / 已确认到仓聚合 / 在途明细 join
--     - tracking_event: 详情页轨迹时间线
--     - user_variant_preference: get_overseas_inventory / get_low_stock
--                       LEFT JOIN 反连接（排除已归档）
-- ============================================

-- ============================================
-- 1. sync_run(warehouse_id, started_at DESC)
-- ============================================
-- 查询路径：
--   - get_sync_runs_paginated  RPC（00029/00030）：
--     COUNT(*): WHERE warehouse_id = p_warehouse_id
--     rows CTE: WHERE warehouse_id = p_warehouse_id ORDER BY started_at DESC
--   - get_sync_runs            RPC（00007）：
--     WHERE warehouse_id = p_warehouse_id ORDER BY started_at DESC
--   - SupabaseSyncRepository.getWarehouseHistory()：
--     WHERE warehouse_id = $1 ORDER BY started_at DESC LIMIT 20
--   - getOverseasWarehouseSyncStatus() 通过 getSyncRuns({limit: 100}) 间接使用
--
-- 预期收益：
--   - 消除 COUNT(*) + warehouse 过滤后的排序步骤
--   - 使 warehouse-scoped 查询成为 index-only scan（含 started_at）
--   - sync 页面为最高频管理页之一，收益直接可感知
-- ============================================
CREATE INDEX IF NOT EXISTS idx_sync_run_warehouse_started
  ON public.sync_run(warehouse_id, started_at DESC);

-- ============================================
-- 2. sync_run(status, lease_expires_at)
-- ============================================
-- 查询路径：
--   - cleanup_expired_sync_runs RPC（00007）：
--     SELECT DISTINCT sr.warehouse_id
--     FROM sync_run sr
--     WHERE sr.status = 'in_progress'
--       AND sr.lease_expires_at IS NOT NULL
--       AND sr.lease_expires_at < now()
--   - lease_expires_at 目前无任何索引
--
-- 注：claim_sync_run 的 warehouse_id + status='in_progress' 查询
--     已由 00007 的 idx_sync_run_one_in_progress（部分唯一索引
--     ON sync_run(warehouse_id) WHERE status='in_progress'）覆盖，
--     无需额外复合索引。
--
-- 预期收益：
--   - status = 'in_progress' 行数极少（最多 5 行，每仓一个），
--     但 lease_expires_at 无索引意味着每次 cleanup 扫描
--     均需对 in_progress 行逐行比较时间戳
--   - 复合索引使 cleanup 成为纯索引扫描，无需回表
-- ============================================
CREATE INDEX IF NOT EXISTS idx_sync_run_status_lease
  ON public.sync_run(status, lease_expires_at);

-- ============================================
-- 3. shipment(warehouse_id, status)
-- ============================================
-- 查询路径：
--   - shipmentRepository.getInTransitDetailsByVariantAndWarehouse()：
--     .eq('warehouse_id', warehouseId) + .neq('status', 'warehoused')
--   - shipmentRepository.getInTransitByVariantAndWarehouse()：
--     .neq('status', 'warehoused') + .in('warehouse_id', [...])
--   - get_in_transit_confirmed_aggregate RPC（00027）：
--     eligible_shipment CTE:
--       WHERE warehouse_id IS NOT NULL
--         AND warehouse_id IN (assigned) / = ANY(p_warehouse_ids)
--   - 在途明细展开（海外库存页每行可展开）高频触发
--
-- 预期收益：
--   - 合并 warehouse_id + status 双列过滤为单次索引扫描
--   - 避免 idx_shipment_warehouse_id 与 idx_shipment_status
--     的 bitmap scan 合并开销
-- ============================================
CREATE INDEX IF NOT EXISTS idx_shipment_warehouse_status
  ON public.shipment(warehouse_id, status);

-- ============================================
-- 4. shipment(created_at DESC) WHERE status <> 'warehoused'
-- ============================================
-- 查询路径：
--   - shipmentRepository.list()（在途列表主查询）：
--     .neq('status', 'warehoused')
--     .order('created_at', { ascending: false })
--   - shipmentRepository.listEligibleForBatchWarehousing()：
--     .eq('status', 'customs')
--     .order('created_at', { ascending: false })
--   - created_at 目前无任何索引
--
-- 注：原 idx_shipment_status_created(status, created_at DESC) 对
--     status='customs' 等值查询有效，但无法完整覆盖
--     status <> 'warehoused'（不等值）的全局排序。
--     改为部分索引 WHERE status <> 'warehoused' 精确匹配
--     list() 的核心过滤条件，同时 customs 子集也可复用。
--
-- 预期收益：
--   - 在途列表主查询（最高频 Shipment 读路径）直接命中部分索引
--   - 消除全量 created_at 排序，索引顺序直接提供 ORDER BY
--   - customs 子集（批量入仓列表）自动复用同一索引
-- ============================================
CREATE INDEX IF NOT EXISTS idx_shipment_active_created
  ON public.shipment(created_at DESC)
  WHERE status <> 'warehoused';

-- ============================================
-- 5. shipment_item(shipment_id, variant_id)
-- ============================================
-- 查询路径：
--   - shipmentRepository.getInTransitDetailsByVariantAndWarehouse()：
--     .in('shipment_id', shipmentIds) + .eq('variant_id', variantId)
--   - get_in_transit_confirmed_aggregate RPC（00027）：
--     in_transit_agg:
--       JOIN shipment_item si ON si.shipment_id = es.id
--       GROUP BY es.warehouse_id, si.variant_id
--     confirmed_agg: 同上
--
-- 预期收益：
--   - shipment_id IN (...) + variant_id 等值双列过滤 →
--     单次索引扫描取代 bitmap AND（idx_shipment_item_shipment_id
--     + idx_shipment_item_variant_id）
--   - 在途聚合 GROUP BY (warehouse_id, variant_id) 可利用索引顺序
-- ============================================
CREATE INDEX IF NOT EXISTS idx_shipment_item_shipment_variant
  ON public.shipment_item(shipment_id, variant_id);

-- ============================================
-- 6. user_variant_preference(variant_id, user_id, preference_type)
-- ============================================
-- 查询路径：
--   - get_overseas_inventory RPC（00027）：每行 inventory 的 LEFT JOIN 反连接
--       LEFT JOIN user_variant_preference uvp_arch
--         ON uvp_arch.variant_id = i.variant_id
--        AND uvp_arch.user_id = p_user_id
--        AND uvp_arch.preference_type = 'archived'
--       WHERE uvp_arch.variant_id IS NULL
--   - get_low_stock RPC（00028）：同上反连接
--   - get_overseas_stats RPC（00027）：同上反连接
--   - 现有唯一索引 (user_id, variant_id, preference_type) 列顺序为
--     user_id 在前，无法高效服务以 variant_id 为前导列的反连接
--
-- 预期收益：
--   - 海外库存查询（最高频数据页）每行均触发此反连接
--   - variant_id 前导列匹配 JOIN 条件的第一列
--   - 变体数 × 用户数增长时收益递增
-- ============================================
CREATE INDEX IF NOT EXISTS idx_uvp_variant_user_type
  ON public.user_variant_preference(variant_id, user_id, preference_type);

-- ============================================
-- 7. tracking_event(shipment_id, occurred_at)
-- ============================================
-- 查询路径：
--   - shipmentRepository.getById() → tracking_event 查询：
--     .eq('shipment_id', id) + .order('occurred_at', { ascending: true })
--   - 在途详情页轨迹时间线（从早到晚显示）依赖此排序
--
-- 预期收益：
--   - 消除每笔详情页查询的 occurred_at 排序
--   - 复合索引覆盖 shipment_id 等值 + occurred_at 排序
--   - tracking_event 行数较小，几乎零成本
-- ============================================
CREATE INDEX IF NOT EXISTS idx_tracking_event_shipment_occurred
  ON public.tracking_event(shipment_id, occurred_at);
