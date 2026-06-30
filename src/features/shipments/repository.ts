// 物流模块数据访问层 — 封装 shipment / shipment_item / tracking_event 查询
import { createClient } from '@/lib/supabase/server';
import { unwrapJoin } from '@/lib/supabase/helpers';
import { warehouseAccessRepository } from '@/features/warehouse-access/repository';
import { variantRepository } from '@/features/variants/repository';
import type {
  ShipmentListItem,
  ShipmentDetail,
  ShipmentFilters,
  CreateShipmentData,
  UpdateShipmentData,
  VariantSelectorItem,
  WarehouseSelectorItem,
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

async function getUserRole(userId: string): Promise<'admin' | 'operator' | 'unknown'> {
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
}

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
        `id, shipment_no, vessel_name, voyage_number, country, warehouse_id, status,
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
      supabase
        .from('tracking_event')
        .select('*')
        .eq('shipment_id', id)
        .order('occurred_at', { ascending: false }),
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
      events: eventsRes.data ?? [],
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

  /** P3-S2B: 手动变更物流状态（不触发库存联动，禁用 warehoused）
   *  使用 change_shipment_status_transactional RPC（Migration 00019）
   *  同一事务内完成 shipment.status 更新 + tracking_event 插入
   *  RLS 保障仓库隔离；RPC 内 GET DIAGNOSTICS 确认命中目标行 */
  async changeStatus(
    shipmentId: string,
    status: string,
    _userId: string,
    description?: string,
  ): Promise<boolean> {
    const supabase = await createClient();

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

  /** 推进物流状态（旧版—P3-S4 使用，保留完整性） */
  async advanceStatus(
    shipmentId: string,
    nextStatus: string,
    userId: string,
    description?: string,
  ): Promise<boolean> {
    const supabase = await createClient();

    const { error } = await supabase
      .from('shipment')
      .update({ status: nextStatus })
      .eq('id', shipmentId);

    if (error) return false;

    if (nextStatus === 'warehoused') {
      const { data: items } = await supabase
        .from('shipment_item')
        .select('id, quantity')
        .eq('shipment_id', shipmentId);

      if (items) {
        for (const item of items) {
          await supabase
            .from('shipment_item')
            .update({ warehoused_quantity: item.quantity })
            .eq('id', item.id);
        }
      }
    }

    const statusLabel: Record<string, string> = {
      loading: '装柜',
      departed: '离港',
      arrived: '到港',
      customs: '清关',
      warehoused: '入仓',
    };

    await supabase.from('tracking_event').insert({
      shipment_id: shipmentId,
      status: nextStatus,
      description: description ?? statusLabel[nextStatus] ?? nextStatus,
      occurred_at: new Date().toISOString(),
      created_by: userId,
    });

    return true;
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
};
