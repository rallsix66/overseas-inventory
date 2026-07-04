// 物流模块数据访问层 — 封装 shipment / shipment_item / tracking_event 查询
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { unwrapJoin } from '@/lib/supabase/helpers';
import { warehouseAccessRepository } from '@/features/warehouse-access/repository';
import { variantRepository } from '@/features/variants/repository';
import { isValidStatusTransition } from './schema';
import type {
  ShipmentListItem,
  ShipmentDetail,
  ShipmentFilters,
  CreateShipmentData,
  UpdateShipmentData,
  VariantSelectorItem,
  WarehouseSelectorItem,
  InTransitDetailItem,
  TrackingEventDetail,
  PartialWarehouseItem,
  PartialWarehouseResult,
  EligibleShipmentFilters,
  EligibleShipmentItem,
  ConfirmedWarehousedAggregation,
} from './types';
import type { PaginatedResult } from '@/types/common';

const PAGE_SIZE = 20;

export class ShipmentError extends Error {
  constructor(
    message: string,
    public code: 'VALIDATION' | 'NOT_FOUND' | 'DB_ERROR' | 'FORBIDDEN',
  ) {
    super(message);
    this.name = 'ShipmentError';
  }
}

const getUserRole = cache(
  async (userId: string): Promise<'admin' | 'operator' | 'unknown'> => {
    const supabase = await createClient();
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('role:role_id(name)')
      .eq('id', userId)
      .single();

    if (error) {
      // PGRST116 = row not found — profile genuinely doesn't exist
      if (error.code === 'PGRST116') return 'unknown';
      // Real DB/RLS error — must not silently degrade to 'unknown' and widen permissions
      throw new ShipmentError('查询用户角色失败', 'DB_ERROR');
    }

    const roleName = (profile as unknown as { role: { name: string } } | null)?.role?.name;
    if (roleName === 'admin') return 'admin';
    if (roleName === 'operator') return 'operator';
    return 'unknown';
  },
);

export const shipmentRepository = {
  /** P3-S2A/P3-S2B: 在途列表（不含 warehoused），含仓库隔离 */
  async list(
    filters: ShipmentFilters = {},
    userId?: string,
  ): Promise<PaginatedResult<ShipmentListItem>> {
    const supabase = await createClient();
    const { country, status, page = 1, pageSize = PAGE_SIZE } = filters;

    let query = supabase
      .from('shipment')
      .select(
        `id, shipment_no, purchase_order_no, vessel_name, voyage_number, country, warehouse_id, status,
         estimated_arrival, created_by, created_at,
         warehouse:warehouse_id(name),
         items:shipment_item (
           quantity, warehoused_quantity,
           variant:variant_id (product:product_id (name))
         )`,
        { count: 'exact' },
      )
      .neq('status', 'warehoused');

    // Warehouse isolation for operator
    if (userId) {
      const role = await getUserRole(userId);
      if (role === 'operator') {
        const accessibleIds = await warehouseAccessRepository.getAccessibleWarehouseIds(userId);
        if (accessibleIds.size === 0) {
          return { data: [], total: 0, page, pageSize };
        }
        query = query.in('warehouse_id', [...accessibleIds]);
      }
      // Admin: no warehouse filter (RLS allows all, including NULL warehouse_id)
    }

    if (country) query = query.eq('country', country);
    if (status) query = query.eq('status', status);

    const from = (page - 1) * pageSize;
    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new ShipmentError('查询在途列表失败', 'DB_ERROR');
    }
    if (!data) {
      return { data: [], total: 0, page, pageSize };
    }

    const rows = data as unknown as Array<{
      id: string;
      shipment_no: string;
      purchase_order_no: string | null;
      vessel_name: string | null;
      voyage_number: string | null;
      country: string;
      warehouse_id: string | null;
      status: string;
      estimated_arrival: string | null;
      created_by: string;
      created_at: string;
      warehouse: { name: string } | null;
      items: Array<{
        quantity: number;
        warehoused_quantity: number;
        variant: { product: { name: string } | null } | null;
      }>;
    }>;

    return {
      data: rows.map((row) => {
        const items = row.items ?? [];
        const wh = row.warehouse;

        // P3-S2B: 聚合品名（最多 3 个，逗号分隔）
        const productNames: string[] = [];
        for (const item of items) {
          const name = item.variant?.product?.name;
          if (name && !productNames.includes(name)) {
            productNames.push(name);
            if (productNames.length >= 3) break;
          }
        }

        return {
          id: row.id,
          shipmentNo: row.shipment_no,
          purchaseOrderNo: row.purchase_order_no,
          vesselName: row.vessel_name,
          voyageNumber: row.voyage_number,
          country: row.country,
          warehouseName: wh?.name ?? null,
          status: row.status,
          estimatedArrival: row.estimated_arrival,
          productCount: items.length,
          totalQuantity: items.reduce((sum, i) => sum + i.quantity, 0),
          inTransitQuantity: items.reduce((sum, i) => sum + (i.quantity - i.warehoused_quantity), 0),
          productNames: productNames.length > 0 ? productNames.join('、') : null,
          createdBy: row.created_by,
          createdAt: row.created_at,
        };
      }),
      total: count ?? 0,
      page,
      pageSize,
    };
  },

  /** P3-S2C: 按 variant_id 聚合在途数量（只读，不写 inventory）
   *  在途 = shipment_item.quantity - shipment_item.warehoused_quantity
   *  排除 shipment.status = 'warehoused'
   *  Operator 仅统计已分配仓库；Admin 统计全部 */
  async getInTransitByVariant(userId?: string): Promise<Map<string, number>> {
    const supabase = await createClient();

    // Determine warehouse filter before building query (role check consumes a DB call)
    let accessibleWhIds: Set<string> | null = null;
    if (userId) {
      const role = await getUserRole(userId);
      if (role === 'operator') {
        const ids = await warehouseAccessRepository.getAccessibleWarehouseIds(userId);
        if (ids.size === 0) return new Map();
        accessibleWhIds = ids;
      }
      // Admin: no warehouse filter (RLS allows all)
    }

    let query = supabase
      .from('shipment')
      .select('id')
      .neq('status', 'warehoused');

    if (accessibleWhIds) {
      query = query.in('warehouse_id', [...accessibleWhIds]);
    }

    const { data: shipments, error } = await query;

    if (error) {
      throw new ShipmentError('查询在途数据失败', 'DB_ERROR');
    }
    if (!shipments || shipments.length === 0) return new Map();

    const shipmentIds = shipments.map((s) => s.id);

    const { data: items, error: itemsErr } = await supabase
      .from('shipment_item')
      .select('variant_id, quantity, warehoused_quantity')
      .in('shipment_id', shipmentIds);

    if (itemsErr) {
      throw new ShipmentError('查询在途数据失败', 'DB_ERROR');
    }

    const map = new Map<string, number>();
    for (const item of items ?? []) {
      const inTransit = item.quantity - item.warehoused_quantity;
      map.set(item.variant_id, (map.get(item.variant_id) ?? 0) + inTransit);
    }
    return map;
  },

  /** P3-S2D: 按 (variant_id, warehouse_id) 聚合在途数量（只读，不写 inventory）
   *  在途 = shipment_item.quantity - shipment_item.warehoused_quantity
   *  排除 shipment.status = 'warehoused'
   *  Operator 仅统计已分配仓库；Admin 统计全部
   *  返回 Map<variantId, Map<warehouseId, inTransitQty>> */
  async getInTransitByVariantAndWarehouse(
    userId?: string,
  ): Promise<Map<string, Map<string, number>>> {
    const supabase = await createClient();

    // Determine warehouse filter before building query (role check consumes a DB call)
    let accessibleWhIds: Set<string> | null = null;
    if (userId) {
      const role = await getUserRole(userId);
      if (role === 'operator') {
        const ids = await warehouseAccessRepository.getAccessibleWarehouseIds(userId);
        if (ids.size === 0) return new Map();
        accessibleWhIds = ids;
      }
      // Admin: no warehouse filter (RLS allows all)
    }

    let query = supabase
      .from('shipment')
      .select('id, warehouse_id')
      .neq('status', 'warehoused');

    if (accessibleWhIds) {
      query = query.in('warehouse_id', [...accessibleWhIds]);
    }

    const { data: shipments, error } = await query;

    if (error) {
      throw new ShipmentError('查询在途数据失败', 'DB_ERROR');
    }
    if (!shipments || shipments.length === 0) return new Map();

    // Build shipment_id → warehouse_id lookup (skip null warehouse_id — items
    // in shipments without a warehouse are excluded from in-transit aggregation)
    const shipmentWarehouseMap = new Map<string, string>();
    for (const s of shipments) {
      if (s.warehouse_id) {
        shipmentWarehouseMap.set(s.id, s.warehouse_id);
      }
    }

    const shipmentIds = shipments.map((s) => s.id);

    const { data: items, error: itemsErr } = await supabase
      .from('shipment_item')
      .select('variant_id, quantity, warehoused_quantity, shipment_id')
      .in('shipment_id', shipmentIds);

    if (itemsErr) {
      throw new ShipmentError('查询在途数据失败', 'DB_ERROR');
    }

    const map = new Map<string, Map<string, number>>();
    for (const item of items ?? []) {
      const whId = shipmentWarehouseMap.get(item.shipment_id);
      if (!whId) continue; // skip items whose shipment has no warehouse (shouldn't happen)

      const inTransit = item.quantity - item.warehoused_quantity;

      let innerMap = map.get(item.variant_id);
      if (!innerMap) {
        innerMap = new Map();
        map.set(item.variant_id, innerMap);
      }
      innerMap.set(whId, (innerMap.get(whId) ?? 0) + inTransit);
    }
    return map;
  },

  /** P3-S2E: 按 (variant_id, warehouse_id) 查询内部在途明细（只读，不写 inventory）
   *  返回指定 variant + warehouse 的每条在途明细：
   *    - shipment_no / purchase_order_no
   *    - 数量（quantity - warehoused_quantity）
   *    - 预计到货时间 estimated_arrival
   *    - shipment_id 供跳转详情
   *  排除 shipment.status = 'warehoused'
   *  Operator 仅查看已分配仓库；Admin 全部可见
   *  不读 external 三表，不接 Best，不做入库联动 */
  async getInTransitDetailsByVariantAndWarehouse(
    variantId: string,
    warehouseId: string,
    userId?: string,
  ): Promise<InTransitDetailItem[]> {
    const supabase = await createClient();

    // Warehouse isolation for operator
    if (userId) {
      const role = await getUserRole(userId);
      if (role === 'operator') {
        const ids = await warehouseAccessRepository.getAccessibleWarehouseIds(userId);
        if (!ids.has(warehouseId)) return [];
      }
      // Admin: no warehouse filter (RLS allows all)
    }

    // Step 1: Get non-warehoused shipments for this warehouse
    const { data: shipments, error: shipErr } = await supabase
      .from('shipment')
      .select('id, shipment_no, purchase_order_no, estimated_arrival')
      .eq('warehouse_id', warehouseId)
      .neq('status', 'warehoused');

    if (shipErr) {
      throw new ShipmentError('查询在途明细失败', 'DB_ERROR');
    }
    if (!shipments || shipments.length === 0) return [];

    const shipmentIds = shipments.map((s) => s.id);

    // Step 2: Get shipment_items for this variant
    const { data: items, error: itemsErr } = await supabase
      .from('shipment_item')
      .select('shipment_id, quantity, warehoused_quantity')
      .in('shipment_id', shipmentIds)
      .eq('variant_id', variantId);

    if (itemsErr) {
      throw new ShipmentError('查询在途明细失败', 'DB_ERROR');
    }
    if (!items || items.length === 0) return [];

    // Build shipment lookup map
    const shipMap = new Map<string, (typeof shipments)[number]>();
    for (const s of shipments) {
      shipMap.set(s.id, s);
    }

    const results: InTransitDetailItem[] = [];
    for (const item of items) {
      const ship = shipMap.get(item.shipment_id);
      if (!ship) continue;
      const inTransit = item.quantity - item.warehoused_quantity;
      if (inTransit <= 0) continue;

      results.push({
        shipmentId: ship.id,
        shipmentNo: ship.shipment_no,
        purchaseOrderNo: ship.purchase_order_no,
        quantity: inTransit,
        estimatedArrival: ship.estimated_arrival,
      });
    }

    // Sort by estimated_arrival (nulls last), then by shipment_no
    results.sort((a, b) => {
      if (!a.estimatedArrival && !b.estimatedArrival) return a.shipmentNo.localeCompare(b.shipmentNo);
      if (!a.estimatedArrival) return 1;
      if (!b.estimatedArrival) return -1;
      const cmp = a.estimatedArrival.localeCompare(b.estimatedArrival);
      return cmp !== 0 ? cmp : a.shipmentNo.localeCompare(b.shipmentNo);
    });

    return results;
  },

  /** P3-S2A: 物流单详情，含仓库隔离 */
  async getById(id: string, userId?: string): Promise<ShipmentDetail | null> {
    const supabase = await createClient();

    const { data: shipment, error } = await supabase
      .from('shipment')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      // PGRST116 = row not found (PostgREST code for .single() with 0 results)
      if (error.code === 'PGRST116') return null;
      throw new ShipmentError('查询在途详情失败', 'DB_ERROR');
    }
    if (!shipment) return null;

    // Warehouse isolation for operator
    if (userId) {
      const role = await getUserRole(userId);
      if (role === 'operator') {
        if (!shipment.warehouse_id) return null;
        const canAccess = await warehouseAccessRepository.canAccessWarehouse(
          userId,
          shipment.warehouse_id,
        );
        if (!canAccess) return null;
      }
    }

    const [itemsRes, eventsRes, profileRes] = await Promise.all([
      supabase
        .from('shipment_item')
        .select(
          `id, quantity, warehoused_quantity, variant_id,
           variant:variant_id (sku, product:product_id (name))`,
        )
        .eq('shipment_id', id),
      // P3-S4A: 轨迹按 occurred_at 升序（时间线从上到下为最早→最新），join profiles 获取创建人姓名
      supabase
        .from('tracking_event')
        .select(
          `id, shipment_id, status, description, occurred_at, created_by, created_at,
           profile:created_by (display_name)`,
        )
        .eq('shipment_id', id)
        .order('occurred_at', { ascending: true }),
      supabase
        .from('profiles')
        .select('display_name')
        .eq('id', shipment.created_by)
        .single(),
    ]);

    // Check all sub-query errors — DB/RLS errors must propagate
    if (itemsRes.error) {
      throw new ShipmentError('查询在途详情失败', 'DB_ERROR');
    }
    if (eventsRes.error) {
      throw new ShipmentError('查询在途详情失败', 'DB_ERROR');
    }
    // profileRes.error is acceptable — creator may have been deleted (returns null)

    // Resolve warehouse name
    let warehouseName: string | null = null;
    if (shipment.warehouse_id) {
      const { data: wh, error: whErr } = await supabase
        .from('warehouse')
        .select('name')
        .eq('id', shipment.warehouse_id)
        .single();
      if (whErr) {
        throw new ShipmentError('查询在途详情失败', 'DB_ERROR');
      }
      warehouseName = wh?.name ?? null;
    }

    return {
      ...shipment,
      items: (itemsRes.data ?? []).map((item) => {
        const variant = unwrapJoin<{ sku: string; product: unknown }>(item.variant);
        const product = unwrapJoin<{ name: string }>(variant?.product);
        return {
          id: item.id,
          quantity: item.quantity,
          warehousedQuantity: item.warehoused_quantity,
          productName: product?.name ?? null,
          sku: variant?.sku ?? '',
          variantId: item.variant_id,
        };
      }),
      events: (eventsRes.data ?? []).map((event) => {
        const profile = event.profile as unknown as { display_name: string | null } | null;
        return {
          id: event.id,
          shipmentId: event.shipment_id,
          status: event.status,
          description: event.description,
          occurredAt: event.occurred_at,
          createdBy: event.created_by,
          createdAt: event.created_at,
          creatorName: profile?.display_name ?? null,
        } satisfies TrackingEventDetail;
      }),
      creatorName: profileRes.data?.display_name ?? null,
      warehouseName,
    };
  },

  /** 创建在途记录（数据库事务，三步原子写入，created_by 由 auth.uid() 确定） */
  async create(data: CreateShipmentData): Promise<string> {
    const supabase = await createClient();

    const itemsJson = data.items.map((item) => ({
      variant_id: item.variantId,
      quantity: item.quantity,
    }));

    const { data: shipmentId, error } = await supabase.rpc('create_shipment_transactional', {
      p_shipment_no: data.shipmentNo,
      p_vessel_name: data.vesselName ?? null,
      p_voyage_number: data.voyageNumber ?? null,
      p_origin_port: data.originPort ?? null,
      p_destination_port: data.destinationPort ?? null,
      p_country: data.country,
      p_warehouse_id: data.warehouseId ?? null,
      p_estimated_arrival: data.estimatedArrival ?? null,
      p_note: data.note ?? null,
      p_purchase_order_no: data.purchaseOrderNo ?? null,
      p_items: itemsJson,
    });

    if (error) {
      throw new ShipmentError('创建在途记录失败，请稍后重试', 'DB_ERROR');
    }
    if (!shipmentId) {
      throw new ShipmentError('创建在途记录失败，请稍后重试', 'DB_ERROR');
    }
    return shipmentId;
  },

  /** P3-S2B: 编辑在途基本信息 */
  async update(data: UpdateShipmentData, userId?: string): Promise<boolean> {
    const supabase = await createClient();

    // Operator: verify warehouse access
    if (userId) {
      const role = await getUserRole(userId);
      if (role === 'operator') {
        // Fetch current record to check warehouse ownership
        const { data: existing, error: fetchErr } = await supabase
          .from('shipment')
          .select('warehouse_id')
          .eq('id', data.id)
          .single();

        if (fetchErr || !existing) {
          throw new ShipmentError('在途记录不存在或无权访问', 'NOT_FOUND');
        }
        if (!existing.warehouse_id) {
          throw new ShipmentError('您没有该记录的操作权限', 'FORBIDDEN');
        }
        const canAccess = await warehouseAccessRepository.canAccessWarehouse(
          userId,
          existing.warehouse_id,
        );
        if (!canAccess) {
          throw new ShipmentError('您没有该记录的操作权限', 'FORBIDDEN');
        }
      }
    }

    const { data: updated, error } = await supabase
      .from('shipment')
      .update({
        shipment_no: data.shipmentNo,
        purchase_order_no: data.purchaseOrderNo?.trim() || null,
        vessel_name: data.vesselName ?? null,
        voyage_number: data.voyageNumber ?? null,
        origin_port: data.originPort ?? null,
        destination_port: data.destinationPort ?? null,
        country: data.country,
        warehouse_id: data.warehouseId ?? null,
        estimated_arrival: data.estimatedArrival ?? null,
        note: data.note ?? null,
      })
      .eq('id', data.id)
      .select('id')
      .single();

    if (error) {
      // PGRST116 = 0 rows matched → not found (RLS rejected or genuinely missing)
      if (error.code === 'PGRST116') {
        throw new ShipmentError('在途记录不存在或无权访问', 'NOT_FOUND');
      }
      throw new ShipmentError('更新在途记录失败', 'DB_ERROR');
    }
    if (!updated) {
      throw new ShipmentError('在途记录不存在或无权访问', 'NOT_FOUND');
    }
    return true;
  },

  /** P3-S2B/P3-S4A: 手动变更物流状态（不触发库存联动，禁用 warehoused）
   *  使用 change_shipment_status_transactional RPC（Migration 00022）
   *  P3-S4A: 应用层预校验当前状态 → 流转规则 → 再调用 RPC
   *  同一事务内完成 shipment.status 更新 + tracking_event 插入
   *  RLS 保障仓库隔离；RPC 内 GET DIAGNOSTICS 确认命中目标行 */
  async changeStatus(
    shipmentId: string,
    status: string,
    _userId: string,
    description?: string,
  ): Promise<boolean> {
    const supabase = await createClient();

    // P3-S4A: 读取当前状态，预校验流转规则（应用层校验，RPC 层也校验兜底）
    const { data: current, error: fetchErr } = await supabase
      .from('shipment')
      .select('status')
      .eq('id', shipmentId)
      .single();

    if (fetchErr) {
      if (fetchErr.code === 'PGRST116') {
        throw new ShipmentError('在途记录不存在或无权访问', 'NOT_FOUND');
      }
      throw new ShipmentError('查询在途记录失败', 'DB_ERROR');
    }

    if (!current) {
      throw new ShipmentError('在途记录不存在或无权访问', 'NOT_FOUND');
    }

    // P3-S4A: 状态流转规则校验 — 仅允许按顺序推进，禁止倒退和跳步
    if (!isValidStatusTransition(current.status, status)) {
      throw new ShipmentError(
        `状态不可从「${current.status}」变更为「${status}」：仅允许按顺序推进`,
        'VALIDATION',
      );
    }

    const statusLabel: Record<string, string> = {
      booking: '订舱',
      loading: '装柜',
      departed: '离港',
      arrived: '到港',
      customs: '清关',
    };

    const { error } = await supabase.rpc('change_shipment_status_transactional', {
      p_shipment_id: shipmentId,
      p_status: status,
      p_description: description ?? statusLabel[status] ?? status,
    });

    if (error) {
      throw new ShipmentError(
        error.message || '状态变更失败',
        'DB_ERROR',
      );
    }
    return true;
  },

  /** 推进物流状态（旧版兼容路径—P3-S4A 返工：统一委托 changeStatus → RPC）
   *  禁止直接 update shipment + insert tracking_event；
   *  所有手动状态推进入口必须通过 change_shipment_status_transactional RPC 完成。 */
  async advanceStatus(
    shipmentId: string,
    nextStatus: string,
    userId: string,
    description?: string,
  ): Promise<boolean> {
    // P3-S4A: 禁用 warehoused（显式守卫，给出明确错误消息）
    if (nextStatus === 'warehoused') {
      throw new ShipmentError('当前不支持手动推进到入仓状态', 'VALIDATION');
    }

    // P3-S4A REWORK: 统一委托 changeStatus → RPC，不在本方法内直接写表
    return this.changeStatus(shipmentId, nextStatus, userId, description);
  },

  // ─── P3-S3: 表单选择器数据 ──────────────────────────────────────────

  /** 服务端搜索 Variant（按 country + 关键词，供 shipment 表单选择器调用）
   *  不读取 product_variant.is_archived；改用 user_variant_preference 按当前用户过滤 */
  async searchVariants(
    country: string,
    search?: string,
    userId?: string,
  ): Promise<VariantSelectorItem[]> {
    const supabase = await createClient();

    const archivedIds = userId
      ? await variantRepository.getUserArchivedVariantIds(userId)
      : new Set<string>();

    const SELECT = 'id, sku, name, country, product:product_id (name)';
    const LIMIT = 100;

    const mapRow = (row: Record<string, unknown>): VariantSelectorItem => {
      const product = unwrapJoin<{ name: string }>(row.product);
      return {
        id: row.id as string,
        sku: row.sku as string,
        name: row.name as string,
        productName: product?.name ?? null,
        country: row.country as string,
      };
    };

    if (!search) {
      let q = supabase
        .from('product_variant')
        .select(SELECT)
        .eq('country', country)
        .order('sku', { ascending: true });
      if (archivedIds.size > 0) q = q.notIn('id', [...archivedIds]);
      const { data, error } = await q.limit(LIMIT);

      if (error) throw new ShipmentError('查询 SKU 列表失败', 'DB_ERROR');

      return ((data ?? []) as Record<string, unknown>[]).map(mapRow);
    }

    // Escape LIKE wildcards so user input doesn't change filter semantics
    // Must escape backslash first, then % and _; order matters.
    const escaped = search.replace(/\\/g, '\\\\').replace(/[%_]/g, '\\$&');
    const pattern = `%${escaped}%`;

    // Query by SKU
    let skuQ = supabase
      .from('product_variant')
      .select(SELECT)
      .eq('country', country)
      .ilike('sku', pattern)
      .order('sku', { ascending: true });
    if (archivedIds.size > 0) skuQ = skuQ.notIn('id', [...archivedIds]);
    const { data: bySkuRaw, error: skuErr } = await skuQ.limit(LIMIT);

    if (skuErr) throw new ShipmentError('查询 SKU 列表失败', 'DB_ERROR');

    // Query by variant name
    let nameQ = supabase
      .from('product_variant')
      .select(SELECT)
      .eq('country', country)
      .ilike('name', pattern)
      .order('sku', { ascending: true });
    if (archivedIds.size > 0) nameQ = nameQ.notIn('id', [...archivedIds]);
    const { data: byNameRaw, error: nameErr } = await nameQ.limit(LIMIT);

    if (nameErr) throw new ShipmentError('查询 SKU 列表失败', 'DB_ERROR');

    // Query products by name, then find matching variants
    const { data: products, error: productErr } = await supabase
      .from('product')
      .select('id')
      .ilike('name', pattern)
      .limit(LIMIT);

    if (productErr) throw new ShipmentError('查询 SKU 列表失败', 'DB_ERROR');

    let byProductRaw: Record<string, unknown>[] = [];
    if (products && products.length > 0) {
      const productIds = products.map((p) => p.id);
      let vQ = supabase
        .from('product_variant')
        .select(SELECT)
        .eq('country', country)
        .in('product_id', productIds)
        .order('sku', { ascending: true });
      if (archivedIds.size > 0) vQ = vQ.notIn('id', [...archivedIds]);
      const { data: vData, error: vErr } = await vQ.limit(LIMIT);

      if (vErr) throw new ShipmentError('查询 SKU 列表失败', 'DB_ERROR');

      byProductRaw = (vData ?? []) as Record<string, unknown>[];
    }

    // Merge and dedup by variant id (archived filtering done at DB level via notIn)
    const seen = new Set<string>();
    const results: VariantSelectorItem[] = [];
    const allRows = [
      ...(bySkuRaw ?? []) as Record<string, unknown>[],
      ...(byNameRaw ?? []) as Record<string, unknown>[],
      ...byProductRaw,
    ];

    for (const row of allRows) {
      const id = row.id as string;
      if (seen.has(id)) continue;
      seen.add(id);
      results.push(mapRow(row));
      if (results.length >= LIMIT) break;
    }

    return results;
  },

  /** 获取仓库列表供 shipment 表单选择
   *  Admin → 所有 active overseas 仓库（可选 country 过滤）
   *  Operator → 已分配仓库中的 active overseas（可选 country 过滤） */
  async getWarehousesForSelector(
    userId: string,
    country?: string,
  ): Promise<WarehouseSelectorItem[]> {
    const accessibleIds = await warehouseAccessRepository.getAccessibleWarehouseIds(userId);
    if (accessibleIds.size === 0) return [];

    const supabase = await createClient();
    let query = supabase
      .from('warehouse')
      .select('id, name, country')
      .in('id', [...accessibleIds])
      .eq('type', 'overseas')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (country) {
      query = query.eq('country', country);
    }

    const { data, error } = await query;

    if (error) {
      throw new ShipmentError('查询仓库列表失败', 'DB_ERROR');
    }

    return (data ?? []).map((w) => ({
      id: w.id,
      name: w.name,
      country: w.country,
    }));
  },

  /** 验证仓库对 shipment 的合法性：存在、启用、海外仓、国家一致
   *  校验失败抛出 ShipmentError；成功则无返回值 */
  async validateWarehouseForShipment(warehouseId: string, country: string): Promise<void> {
    const supabase = await createClient();

    const { data: wh, error } = await supabase
      .from('warehouse')
      .select('id, name, type, is_active, country')
      .eq('id', warehouseId)
      .single();

    if (error || !wh) {
      throw new ShipmentError('仓库不存在或已停用', 'VALIDATION');
    }
    if (!wh.is_active) {
      throw new ShipmentError('仓库不存在或已停用', 'VALIDATION');
    }
    if (wh.type !== 'overseas') {
      throw new ShipmentError('只能选择海外仓库', 'VALIDATION');
    }
    if (wh.country !== country) {
      throw new ShipmentError('国家与仓库不一致', 'VALIDATION');
    }
  },

  /** P3-S5A: 确认入仓 — 事务性完成：
   *  1. shipment.status → 'warehoused'
   *  2. shipment_item.warehoused_quantity → quantity
   *  3. inventory.quantity 增加对应数量
   *  4. tracking_event 插入 warehoused 轨迹
   *  调用 warehouse_shipment_transactional RPC（Migration 00023）
   *  仅 Admin 可调用；仅 customs 状态允许入仓；禁止重复入仓；
   *  必须有 warehouse_id；并发安全（FOR UPDATE 行锁） */
  async warehouseShipment(
    shipmentId: string,
    _userId: string,
    description?: string,
  ): Promise<boolean> {
    const supabase = await createClient();

    const { error } = await supabase.rpc('warehouse_shipment_transactional', {
      p_shipment_id: shipmentId,
      p_description: description ?? null,
    });

    if (error) {
      throw new ShipmentError(
        error.message || '确认入仓失败',
        'DB_ERROR',
      );
    }
    return true;
  },

  /** 批量验证 variant 对 shipment 的合法性：存在（RLS 可见）、国家一致
   *  不读取 product_variant.is_archived；归档是用户个人偏好，不阻止创建 */
  async validateVariantsForShipment(
    variantIds: string[],
    country: string,
  ): Promise<void> {
    const supabase = await createClient();

    const { data: variants, error } = await supabase
      .from('product_variant')
      .select('id, country')
      .in('id', variantIds);

    if (error || !variants) {
      throw new ShipmentError('查询 SKU 信息失败', 'DB_ERROR');
    }

    if (variants.length !== variantIds.length) {
      const found = new Set(variants.map((v) => v.id));
      const missing = variantIds.find((id) => !found.has(id));
      throw new ShipmentError(
        missing ? `SKU 不存在：${missing}` : '部分 SKU 不存在',
        'VALIDATION',
      );
    }

    for (const v of variants) {
      if (v.country !== country) {
        throw new ShipmentError('产品国家与目的国不一致', 'VALIDATION');
      }
    }
  },

  // ─── P3-S5B2: 部分入仓 ─────────────────────────────────────────────────

  /** P3-S5B2: 部分/批量确认入仓 — 调用 partial_warehouse_shipment RPC（Migration 00026）
   *  items 映射为 [{ variant_id, quantity }] JSONB 传给 RPC
   *  RPC 返回 { success, all_warehoused, items_updated } snake_case → camelCase
   *  不写 inventory.quantity — inventory 唯一事实来源是 BigSeller */
  async partialWarehouse(
    shipmentId: string,
    items: PartialWarehouseItem[],
    description?: string,
  ): Promise<PartialWarehouseResult> {
    const supabase = await createClient();

    const rpcItems = items.map((item) => ({
      variant_id: item.variantId,
      quantity: item.quantity,
    }));

    const { data: rpcResult, error } = await supabase.rpc(
      'partial_warehouse_shipment',
      {
        p_shipment_id: shipmentId,
        p_items: rpcItems,
        p_description: description ?? null,
      },
    );

    if (error) {
      throw new ShipmentError(
        error.message || '确认入仓失败，请稍后重试',
        'DB_ERROR',
      );
    }

    const result = rpcResult as Record<string, unknown> | null;
    if (!result) {
      throw new ShipmentError('确认入仓失败，请稍后重试', 'DB_ERROR');
    }

    return {
      success: result.success === true,
      allWarehoused: result.all_warehoused === true,
      itemsUpdated: typeof result.items_updated === 'number' ? result.items_updated : 0,
    };
  },

  /** P3-S5B2: 查询可批量入仓的 shipments（status='customs' + warehouse_id IS NOT NULL）
   *  Admin 全量，Operator 按已分配仓库隔离 */
  async listEligibleForBatchWarehousing(
    filters: EligibleShipmentFilters = {},
    userId?: string,
  ): Promise<PaginatedResult<EligibleShipmentItem>> {
    const supabase = await createClient();
    const { country, warehouseId, page = 1, pageSize = PAGE_SIZE } = filters;

    let query = supabase
      .from('shipment')
      .select(
        `id, shipment_no, purchase_order_no, vessel_name, voyage_number, country, warehouse_id, status,
         estimated_arrival, created_at,
         warehouse:warehouse_id(name),
         items:shipment_item (
           quantity, warehoused_quantity,
           variant:variant_id (product:product_id (name))
         )`,
        { count: 'exact' },
      )
      .eq('status', 'customs')
      .not('warehouse_id', 'is', null);

    // Warehouse isolation for operator
    if (userId) {
      const role = await getUserRole(userId);
      if (role === 'operator') {
        const accessibleIds = await warehouseAccessRepository.getAccessibleWarehouseIds(userId);
        if (accessibleIds.size === 0) {
          return { data: [], total: 0, page, pageSize };
        }
        query = query.in('warehouse_id', [...accessibleIds]);
      }
    }

    if (country) query = query.eq('country', country);
    if (warehouseId) query = query.eq('warehouse_id', warehouseId);

    const from = (page - 1) * pageSize;
    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new ShipmentError('查询可入仓在途列表失败', 'DB_ERROR');
    }
    if (!data) {
      return { data: [], total: 0, page, pageSize };
    }

    const rows = data as unknown as Array<{
      id: string;
      shipment_no: string;
      purchase_order_no: string | null;
      vessel_name: string | null;
      voyage_number: string | null;
      country: string;
      warehouse_id: string;
      status: string;
      estimated_arrival: string | null;
      created_at: string;
      warehouse: { name: string } | null;
      items: Array<{
        quantity: number;
        warehoused_quantity: number;
        variant: { product: { name: string } | null } | null;
      }>;
    }>;

    return {
      data: rows.map((row) => {
        const items = row.items ?? [];
        const wh = row.warehouse;

        const productNames: string[] = [];
        for (const item of items) {
          const name = item.variant?.product?.name;
          if (name && !productNames.includes(name)) {
            productNames.push(name);
            if (productNames.length >= 3) break;
          }
        }

        return {
          id: row.id,
          shipmentNo: row.shipment_no,
          purchaseOrderNo: row.purchase_order_no,
          vesselName: row.vessel_name,
          voyageNumber: row.voyage_number,
          country: row.country,
          warehouseId: row.warehouse_id,
          warehouseName: wh?.name ?? null,
          status: row.status,
          estimatedArrival: row.estimated_arrival,
          itemCount: items.length,
          totalQuantity: items.reduce((sum, i) => sum + i.quantity, 0),
          remainingQuantity: items.reduce(
            (sum, i) => sum + (i.quantity - i.warehoused_quantity),
            0,
          ),
          productNames: productNames.length > 0 ? productNames.join('、') : null,
        };
      }),
      total: count ?? 0,
      page,
      pageSize,
    };
  },

  /** P3-S5B2: 查询某 variant 在某仓库的已确认入仓总量
   *  仅统计 status='customs' 或 (status='warehoused' 且 bigseller_absorbed_at IS NULL) 的 shipment
   *  排除已 warehoused 且 bigseller_absorbed_at IS NOT NULL 的 shipment
   *  聚合 shipment_item.warehoused_quantity，不读取或写入 inventory.quantity */
  async getConfirmedWarehousedQuantity(
    variantId: string,
    warehouseId: string,
  ): Promise<number> {
    const supabase = await createClient();

    // Step 1: Get shipment IDs for this warehouse
    // Only include: customs OR (warehoused + not yet absorbed by BigSeller)
    const { data: shipments, error: shipErr } = await supabase
      .from('shipment')
      .select('id')
      .eq('warehouse_id', warehouseId)
      .or(
        'status.eq.customs,and(status.eq.warehoused,bigseller_absorbed_at.is.null)',
      );

    if (shipErr) {
      throw new ShipmentError('查询已确认入仓数量失败', 'DB_ERROR');
    }
    if (!shipments || shipments.length === 0) return 0;

    const shipmentIds = shipments.map((s) => s.id);

    // Step 2: Sum warehoused_quantity for this variant across those shipments
    const { data: items, error: itemErr } = await supabase
      .from('shipment_item')
      .select('warehoused_quantity')
      .eq('variant_id', variantId)
      .in('shipment_id', shipmentIds);

    if (itemErr) {
      throw new ShipmentError('查询已确认入仓数量失败', 'DB_ERROR');
    }

    let total = 0;
    for (const row of items ?? []) {
      total += row.warehoused_quantity;
    }
    return total;
  },

  /** P3-S5B2: 按 variant 聚合某仓库的已确认入仓数量
   *  仅统计 status='customs' 或 (status='warehoused' 且 bigseller_absorbed_at IS NULL) 的 shipment
   *  排除已 warehoused 且 bigseller_absorbed_at IS NOT NULL 的 shipment
   *  不读取或写入 inventory.quantity */
  async getConfirmedWarehousedByWarehouse(
    warehouseId: string,
  ): Promise<ConfirmedWarehousedAggregation[]> {
    const supabase = await createClient();

    // Step 1: Get shipment IDs for this warehouse
    // Only include: customs OR (warehoused + not yet absorbed by BigSeller)
    const { data: shipments, error: shipErr } = await supabase
      .from('shipment')
      .select('id')
      .eq('warehouse_id', warehouseId)
      .or(
        'status.eq.customs,and(status.eq.warehoused,bigseller_absorbed_at.is.null)',
      );

    if (shipErr) {
      throw new ShipmentError('查询仓库已确认入仓聚合失败', 'DB_ERROR');
    }
    if (!shipments || shipments.length === 0) return [];

    const shipmentIds = shipments.map((s) => s.id);

    // Step 2: Aggregate warehoused_quantity by variant_id across those shipments
    const { data: items, error: itemErr } = await supabase
      .from('shipment_item')
      .select('variant_id, warehoused_quantity')
      .in('shipment_id', shipmentIds);

    if (itemErr) {
      throw new ShipmentError('查询仓库已确认入仓聚合失败', 'DB_ERROR');
    }

    const map = new Map<string, number>();
    for (const row of items ?? []) {
      map.set(
        row.variant_id,
        (map.get(row.variant_id) ?? 0) + row.warehoused_quantity,
      );
    }

    return [...map.entries()].map(([variantId, confirmedQuantity]) => ({
      variantId,
      confirmedQuantity,
    }));
  },

  /** P3-S5B2: 确认 BigSeller 已吸收在途记录
   *  UPDATE shipment SET bigseller_absorbed_at = now()
   *  仅允许 status='warehoused' 且 bigseller_absorbed_at IS NULL
   *  受 RLS + Admin-only action 双层保护 */
  async confirmBigsellerAbsorption(
    shipmentId: string,
  ): Promise<boolean> {
    const supabase = await createClient();

    // 先查询当前状态，确认满足条件
    const { data: current, error: fetchErr } = await supabase
      .from('shipment')
      .select('status, bigseller_absorbed_at')
      .eq('id', shipmentId)
      .single();

    if (fetchErr) {
      if (fetchErr.code === 'PGRST116') {
        throw new ShipmentError('在途记录不存在或无权访问', 'NOT_FOUND');
      }
      throw new ShipmentError('查询在途记录失败', 'DB_ERROR');
    }

    if (!current) {
      throw new ShipmentError('在途记录不存在或无权访问', 'NOT_FOUND');
    }

    if (current.status !== 'warehoused') {
      throw new ShipmentError('仅已入仓的在途记录可确认 BigSeller 吸收', 'VALIDATION');
    }

    if (current.bigseller_absorbed_at) {
      throw new ShipmentError('该在途记录已确认 BigSeller 吸收，不可重复操作', 'VALIDATION');
    }

    const { error: updateErr } = await supabase
      .from('shipment')
      .update({ bigseller_absorbed_at: new Date().toISOString() })
      .eq('id', shipmentId)
      .eq('status', 'warehoused')
      .is('bigseller_absorbed_at', null);

    if (updateErr) {
      throw new ShipmentError('确认 BigSeller 吸收失败，请稍后重试', 'DB_ERROR');
    }

    return true;
  },
};
