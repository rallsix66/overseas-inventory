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

export const shipmentRepository = {
  /** 在途列表（不含 warehoused） */
  async list(filters: ShipmentFilters = {}): Promise<PaginatedResult<ShipmentListItem>> {
    const supabase = await createClient();
    const { country, status, page = 1, pageSize = PAGE_SIZE } = filters;

    let query = supabase
      .from('shipment')
      .select(
        `id, vessel_name, voyage_number, country, status, estimated_arrival, created_by, created_at,
         items:shipment_item (quantity, warehoused_quantity)`,
        { count: 'exact' },
      )
      .neq('status', 'warehoused');

    if (country) query = query.eq('country', country);
    if (status) query = query.eq('status', status);

    const from = (page - 1) * pageSize;
    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);

    if (error || !data) {
      return { data: [], total: 0, page, pageSize };
    }

    return {
      data: data.map((row) => {
        const items =
          (row.items as unknown as { quantity: number; warehoused_quantity: number }[]) ?? [];
        return {
          id: row.id,
          vesselName: row.vessel_name,
          voyageNumber: row.voyage_number,
          country: row.country,
          status: row.status,
          estimatedArrival: row.estimated_arrival,
          productCount: items.length,
          totalQuantity: items.reduce((sum, i) => sum + i.quantity, 0),
          inTransitQuantity: items.reduce((sum, i) => sum + (i.quantity - i.warehoused_quantity), 0),
          createdBy: row.created_by,
          createdAt: row.created_at,
        };
      }),
      total: count ?? 0,
      page,
      pageSize,
    };
  },

  /** 物流单详情 */
  async getById(id: string): Promise<ShipmentDetail | null> {
    const supabase = await createClient();

    const { data: shipment, error } = await supabase
      .from('shipment')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !shipment) return null;

    const { data: items } = await supabase
      .from('shipment_item')
      .select(
        `id, quantity, warehoused_quantity, variant_id,
         variant:variant_id (sku, product:product_id (name))`,
      )
      .eq('shipment_id', id);

    const { data: events } = await supabase
      .from('tracking_event')
      .select('*')
      .eq('shipment_id', id)
      .order('occurred_at', { ascending: false });

    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', shipment.created_by)
      .single();

    return {
      ...shipment,
      items: (items ?? []).map((item) => {
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
      events: events ?? [],
      creatorName: profile?.display_name ?? null,
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

  /** 推进物流状态 */
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
