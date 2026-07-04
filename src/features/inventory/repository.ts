// 库存模块数据访问层 — 封装 inventory 表查询
// 库存查询关联 product_variant、product、warehouse 三表
//
// P5-SY11G: 归档过滤已从全局 product_variant.is_archived 迁移为用户级 user_variant_preference。
// 海外库存列表/低库存/统计按当前用户归档偏好过滤；产品详情页不过滤。
// P5-SY13A: operator 海外库存/低库存/统计按已分配仓库过滤。
// PERF-S1B: 海外库存列表/统计/在途+已确认聚合已接入 Migration 00027 的 RPC（get_overseas_inventory /
//           get_overseas_stats / get_in_transit_confirmed_aggregate），移除 JS 全量过滤分页和 N+1 查询。
import { createClient } from '@/lib/supabase/server';
import { unwrapJoin } from '@/lib/supabase/helpers';
import type { InventoryItem, InventoryFilters, OverseasStats, WarehouseOption } from './types';
import type { PaginatedResult } from '@/types/common';

const PAGE_SIZE = 20;

// ---- 类型 ----

/** get_overseas_inventory RPC 返回的原始行（snake_case） */
interface RawOverseasInventoryRow {
  id: string;
  variant_id: string;
  warehouse_id: string;
  quantity: number;
  last_sync_at: string | null;
  sku: string;
  country: string;
  match_status: string;
  product_name: string | null;
  product_code: string | null;
  safety_stock: number;
  warehouse_name: string;
  warehouse_type: string;
  is_favorited: boolean;
}

/** get_in_transit_confirmed_aggregate RPC 返回的原始行（snake_case） */
interface RawAggregateRow {
  warehouse_id: string;
  variant_id: string;
  in_transit_quantity: number;
  confirmed_quantity: number;
}

// ---- 工具 ----

/** snake_case → camelCase 映射一条 RPC 返回行 */
function mapOverseasRow(row: RawOverseasInventoryRow): InventoryItem {
  return {
    id: row.id,
    variantId: row.variant_id,
    warehouseId: row.warehouse_id,
    quantity: row.quantity,
    lastSyncAt: row.last_sync_at,
    productName: row.product_name ?? null,
    productCode: row.product_code ?? null,
    sku: row.sku ?? '',
    country: row.country ?? '',
    warehouseName: row.warehouse_name ?? '',
    warehouseType: row.warehouse_type ?? '',
    safetyStock: row.safety_stock ?? 0,
    matchStatus: row.match_status ?? 'unmatched',
    isFavorited: row.is_favorited ?? false,
    inTransitQuantity: 0,
  };
}

export const inventoryRepository = {
  /** 分页列表（关联 product_variant + product + warehouse） */
  async list(filters: InventoryFilters = {}): Promise<PaginatedResult<InventoryItem>> {
    const supabase = await createClient();
    const { country, warehouseType, search, page = 1, pageSize = PAGE_SIZE } = filters;

    let query = supabase.from('inventory').select(
      `id, variant_id, warehouse_id, quantity, last_sync_at,
       variant:variant_id (sku, country, match_status, product:product_id (name, code, safety_stock)),
       warehouse:warehouse_id (name, type)`,
      { count: 'exact' }
    );

    if (country) {
      query = query.eq('variant.country', country);
    }
    if (warehouseType) {
      query = query.eq('warehouse.type', warehouseType);
    }
    if (filters.warehouseId) {
      query = query.eq('warehouse_id', filters.warehouseId);
    }
    if (search) {
      query = query.or(
        `variant.sku.ilike.%${search}%,variant.product.name.ilike.%${search}%`
      );
    }

    const from = (page - 1) * pageSize;
    const { data, error, count } = await query
      .order('quantity', { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`库存查询失败: ${error.message}`);
    }

    if (!data) {
      return { data: [], total: 0, page, pageSize };
    }

    const items: InventoryItem[] = data.map((row) => {
      const variant = unwrapJoin<{ sku: string; country: string; match_status: string; product: unknown }>(row.variant);
      const product = unwrapJoin<{ name: string; code: string; safety_stock: number }>(variant?.product);
      const warehouse = unwrapJoin<{ name: string; type: string }>(row.warehouse);

      return {
        id: row.id,
        variantId: row.variant_id,
        warehouseId: row.warehouse_id,
        quantity: row.quantity as number,
        lastSyncAt: row.last_sync_at,
        productName: product?.name ?? null,
        productCode: product?.code ?? null,
        sku: variant?.sku ?? '',
        country: variant?.country ?? '',
        warehouseName: warehouse?.name ?? '',
        warehouseType: warehouse?.type ?? '',
        safetyStock: product?.safety_stock ?? 0,
        matchStatus: variant?.match_status ?? 'unmatched',
        isFavorited: false,
        inTransitQuantity: 0,
      };
    });

    return { data: items, total: count ?? 0, page, pageSize };
  },

  /**
   * 海外库存分页列表 — PERF-S1B: 调用 get_overseas_inventory RPC
   *
   * 将 country/warehouse/search/stock_status/favorited_only 筛选、
   * 归档排除、仓库隔离、排序、分页全部下推到 SQL 层完成。
   * 不再全量读取后在 JS 层过滤分页。
   */
  async getOverseasList(filters: InventoryFilters = {}): Promise<PaginatedResult<InventoryItem>> {
    const supabase = await createClient();
    const { country, stockStatus, search, page = 1, pageSize = PAGE_SIZE, warehouseId, userId } = filters;

    if (!userId) {
      return { data: [], total: 0, page, pageSize };
    }

    const { data: rpcResult, error } = await supabase.rpc('get_overseas_inventory', {
      p_user_id: userId,
      p_country: country ?? null,
      p_warehouse_id: warehouseId ?? null,
      p_search: search || null,
      p_stock_status: stockStatus ?? null,
      p_favorited_only: false,
      p_page: page,
      p_page_size: pageSize,
    });

    if (error) {
      throw new Error(`海外库存查询失败: ${error.message}`);
    }

    const raw = rpcResult as { data: RawOverseasInventoryRow[]; total: number } | null;
    if (!raw || !raw.data || raw.data.length === 0) {
      return { data: [], total: raw?.total ?? 0, page, pageSize };
    }

    const items: InventoryItem[] = raw.data.map(mapOverseasRow);

    return { data: items, total: raw.total, page, pageSize };
  },

  /** 获取低库存列表（用于 Dashboard 缺货清单，排除当前用户已归档 Variant）
   *  LOW-STOCK-PAGINATION: 调用 get_low_stock RPC（Migration 00028）。
   *  SQL 层完成归档排除、仓库隔离、quantity <= safety_stock 过滤、
   *  gap 计算、ORDER BY gap DESC, quantity ASC、LIMIT。
   *  确保 limit 只作用在"当前用户可见、未归档、真实低库存"的结果集之后。 */
  async getLowStock(
    params: { userId?: string; limit?: number } = {}
  ): Promise<InventoryItem[]> {
    const { userId, limit = 50 } = params;

    if (!userId) {
      return [];
    }

    const supabase = await createClient();

    const { data: rpcResult, error } = await supabase.rpc('get_low_stock', {
      p_user_id: userId,
      p_limit: limit,
    });

    if (error) {
      throw new Error(`低库存查询失败: ${error.message}`);
    }

    const raw = rpcResult as { data: RawOverseasInventoryRow[] } | null;
    if (!raw || !raw.data || raw.data.length === 0) {
      return [];
    }

    return raw.data.map(mapOverseasRow);
  },

  /** 按产品 ID 获取各仓库存（不过滤归档，产品详情保留全部 Variant） */
  async getByProductId(productId: string): Promise<InventoryItem[]> {
    const supabase = await createClient();
    const { data, error } = await supabase.from('inventory').select(
      `id, variant_id, warehouse_id, quantity, last_sync_at,
       variant:variant_id!inner (sku, country, match_status, product_id),
       warehouse:warehouse_id (name, type)`
    ).eq('variant.product_id', productId);

    if (error) {
      throw new Error(`产品库存查询失败: ${error.message}`);
    }

    if (!data) return [];

    return data.map((row) => {
      const variant = unwrapJoin<{ sku: string; country: string; match_status: string; product_id: string }>(row.variant);
      const warehouse = unwrapJoin<{ name: string; type: string }>(row.warehouse);

      return {
        id: row.id,
        variantId: row.variant_id,
        warehouseId: row.warehouse_id,
        quantity: row.quantity as number,
        lastSyncAt: row.last_sync_at,
        productName: null,
        productCode: null,
        sku: variant?.sku ?? '',
        country: variant?.country ?? '',
        warehouseName: warehouse?.name ?? '',
        warehouseType: warehouse?.type ?? '',
        safetyStock: 0,
        matchStatus: variant?.match_status ?? 'unmatched',
        isFavorited: false,
        inTransitQuantity: 0,
      };
    });
  },

  /** 更新库存数量（运营可操作） */
  async updateQuantity(inventoryId: string, quantity: number): Promise<boolean> {
    const supabase = await createClient();
    const { error } = await supabase
      .from('inventory')
      .update({ quantity })
      .eq('id', inventoryId);

    if (error) {
      throw new Error(`库存更新失败: ${error.message}`);
    }

    return true;
  },

  /**
   * 海外库存统计 — PERF-S1B: 调用 get_overseas_stats RPC
   *
   * 基础统计（SKU 数/总量/低库存数/最后同步时间）由 RPC 在 SQL 层聚合完成。
   * 在途统计由调用方通过 inTransitMap 传入后在此计算（不修改 RPC）。
   */
  async getOverseasStats(
    userId?: string,
    inTransitMap?: Map<string, number>,
  ): Promise<OverseasStats> {
    const supabase = await createClient();

    if (!userId) {
      return {
        totalQuantity: 0,
        skuCount: 0,
        lowStockCount: 0,
        lastSyncAt: null,
        inTransitSkuCount: 0,
        inTransitTotalQuantity: 0,
      };
    }

    const { data: rpcResult, error } = await supabase.rpc('get_overseas_stats', {
      p_user_id: userId,
      p_country: null,
      p_warehouse_id: null,
    });

    if (error) {
      throw new Error(`海外库存统计查询失败: ${error.message}`);
    }

    const raw = rpcResult as {
      total_skus: number;
      total_quantity: number;
      low_stock_count: number;
      last_sync_at: string | null;
    } | null;

    if (!raw) {
      return {
        totalQuantity: 0,
        skuCount: 0,
        lowStockCount: 0,
        lastSyncAt: null,
        inTransitSkuCount: 0,
        inTransitTotalQuantity: 0,
      };
    }

    // 在途统计：聚合 RPC 已做仓库隔离，inTransitMap 只含本用户可访问仓库的在途数据
    let inTransitSkuCount = 0;
    let inTransitTotalQuantity = 0;
    if (inTransitMap && inTransitMap.size > 0) {
      for (const [, qty] of inTransitMap) {
        if (qty > 0) {
          inTransitSkuCount++;
          inTransitTotalQuantity += qty;
        }
      }
    }

    return {
      totalQuantity: raw.total_quantity,
      skuCount: raw.total_skus,
      lowStockCount: raw.low_stock_count,
      lastSyncAt: raw.last_sync_at,
      inTransitSkuCount,
      inTransitTotalQuantity,
    };
  },

  /** 获取海外仓库列表（用于筛选下拉） */
  async getOverseasWarehouses(): Promise<WarehouseOption[]> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('warehouse')
      .select('id, name, country')
      .eq('type', 'overseas')
      .eq('is_active', true)
      .order('country');

    if (error) {
      throw new Error(`仓库列表查询失败: ${error.message}`);
    }

    if (!data) return [];
    return data.map((w) => ({
      id: w.id,
      name: w.name,
      country: w.country,
    }));
  },

  /**
   * PERF-S1B: 在途 + 已确认到仓聚合 — 调用 get_in_transit_confirmed_aggregate RPC
   *
   * 一次 RPC 返回所有仓库的 (warehouse_id, variant_id, in_transit_quantity, confirmed_quantity)
   * 四元组。替代原来的 getInTransitByVariantAndWarehouse（全量 shipment → JS 聚合）+
   * getConfirmedWarehousedByWarehouse（N+1 按仓库循环查询）。
   *
   * 口径：
   *   - 在途 = 非 warehoused shipment 的 SUM(quantity - warehoused_quantity)
   *   - 已确认到仓 = SUM(warehoused_quantity) WHERE
   *       status='customs' OR (status='warehoused' AND bigseller_absorbed_at IS NULL)
   *   - 不读/写 inventory.quantity
   */
  async getInTransitConfirmedAggregate(
    userId: string,
    warehouseIds?: string[],
  ): Promise<RawAggregateRow[]> {
    const supabase = await createClient();

    const { data, error } = await supabase.rpc('get_in_transit_confirmed_aggregate', {
      p_user_id: userId,
      p_warehouse_ids: warehouseIds ?? null,
    });

    if (error) {
      throw new Error(`查询在途与已确认到仓聚合失败: ${error.message}`);
    }

    const rows = data as RawAggregateRow[] | null;
    return rows ?? [];
  },
};
