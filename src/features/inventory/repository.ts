// 库存模块数据访问层 — 封装 inventory 表查询
// 库存查询关联 product_variant、product、warehouse 三表
//
// P5-SY11G: 归档过滤已从全局 product_variant.is_archived 迁移为用户级 user_variant_preference。
// 海外库存列表/低库存/统计按当前用户归档偏好过滤；产品详情页不过滤。
import { createClient } from '@/lib/supabase/server';
import { unwrapJoin } from '@/lib/supabase/helpers';
import type { InventoryItem, InventoryFilters, OverseasStats, WarehouseOption } from './types';
import type { PaginatedResult } from '@/types/common';

const PAGE_SIZE = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- 工具 ----

/** 获取当前用户已归档的 Variant ID 集合 */
async function getUserArchivedVariantIds(userId: string | undefined): Promise<Set<string>> {
  if (!userId) return new Set();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('user_variant_preference')
    .select('variant_id')
    .eq('user_id', userId)
    .eq('preference_type', 'archived');

  if (error) {
    throw new Error(`查询归档偏好失败: ${error.message}`);
  }

  return new Set((data ?? []).map((r) => r.variant_id));
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
      };
    });

    return { data: items, total: count ?? 0, page, pageSize };
  },

  /**
   * 海外库存分页列表 — MVP 临时实现
   *
   * 当前数据规模较小，先获取全部海外库存基础数据，
   * 在服务器 JS 层统一执行搜索、库存状态筛选和用户归档过滤，筛选完成后再分页。
   * 数据量增大后改为数据库 RPC 函数。
   */
  async getOverseasList(filters: InventoryFilters = {}): Promise<PaginatedResult<InventoryItem>> {
    const supabase = await createClient();
    const { country, stockStatus, search, page = 1, pageSize = PAGE_SIZE, warehouseId, userId } = filters;

    // 获取当前用户已归档 Variant ID 集合
    const archivedVariantIds = await getUserArchivedVariantIds(userId);

    // 加载全部海外库存数据（仅 warehouse.type = 'overseas'）
    // 不再使用 variant.is_archived 过滤；归档过滤在 JS 层基于 user_variant_preference 完成
    let query = supabase.from('inventory').select(
      `id, variant_id, warehouse_id, quantity, last_sync_at,
       variant:variant_id!inner (sku, country, match_status, product:product_id (name, code, safety_stock)),
       warehouse:warehouse_id!inner (name, type)`
    ).eq('warehouse.type', 'overseas');

    // 简单 eq 筛选下推到 Supabase（减少数据传输量）
    if (warehouseId) {
      query = query.eq('warehouse_id', warehouseId);
    }

    const { data, error } = await query.order('quantity', { ascending: true });

    if (error) {
      throw new Error(`海外库存查询失败: ${error.message}`);
    }

    if (!data || data.length === 0) {
      return { data: [], total: 0, page, pageSize };
    }

    // JS 兜底：排除 variant 为 null 或当前用户已归档的 inventory 行
    // 使用 row.variant_id（inventory 自带），variant join 的 select 不含 id
    const activeData = data.filter((row) => {
      const v = unwrapJoin<{ sku?: string }>(row.variant);
      if (!v) return false;
      return !archivedVariantIds.has(row.variant_id);
    });

    // 解包关联数据为扁平结构
    let items: InventoryItem[] = activeData.map((row) => {
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
      };
    });

    // JS 层国家筛选
    if (country) {
      items = items.filter((item) => item.country === country);
    }

    // JS 层搜索筛选
    if (search) {
      const s = search.toLowerCase();
      items = items.filter(
        (item) =>
          item.sku.toLowerCase().includes(s) ||
          (item.productName?.toLowerCase().includes(s) ?? false)
      );
    }

    // JS 层库存状态筛选
    if (stockStatus) {
      items = items.filter((item) => {
        if (stockStatus === 'out_of_stock') return item.quantity === 0;
        if (stockStatus === 'low') {
          return item.matchStatus === 'matched' && item.quantity > 0 && item.quantity <= item.safetyStock;
        }
        if (stockStatus === 'normal') {
          return item.matchStatus === 'matched' && item.quantity > item.safetyStock;
        }
        return true;
      });
    }

    const total = items.length;
    const pagedFrom = (page - 1) * pageSize;
    const paged = items.slice(pagedFrom, pagedFrom + pageSize);

    return { data: paged, total, page, pageSize };
  },

  /** 获取低库存列表（用于 Dashboard 缺货清单，排除当前用户已归档 Variant） */
  async getLowStock(userId?: string): Promise<InventoryItem[]> {
    const supabase = await createClient();
    const archivedVariantIds = await getUserArchivedVariantIds(userId);

    const { data, error } = await supabase.from('inventory').select(
      `id, variant_id, warehouse_id, quantity, last_sync_at,
       variant:variant_id!inner (sku, country, match_status, product_id, product:product_id (name, code, safety_stock)),
       warehouse:warehouse_id (name, type)`
    );

    if (error) {
      throw new Error(`低库存查询失败: ${error.message}`);
    }

    if (!data) return [];

    // JS 兜底：排除 variant 为 null 或当前用户已归档的 inventory 行
    // 使用 row.variant_id（inventory 自带），variant join 的 select 不含 id
    const activeData = data.filter((row) => {
      const v = unwrapJoin<{ sku?: string }>(row.variant);
      if (!v) return false;
      return !archivedVariantIds.has(row.variant_id);
    });

    return activeData
      .map((row) => {
        const variant = unwrapJoin<{ sku: string; country: string; match_status: string; product_id: string; product: unknown }>(row.variant);
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
        };
      })
      .filter((item) => item.quantity <= item.safetyStock);
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
   * 海外库存统计 — MVP 临时实现
   *
   * 低库存按唯一 SKU 计数，仅统计已匹配且 quantity > 0 且 <= safety_stock 的 SKU。
   * 未匹配 Product 的 SKU 不参与低库存统计。
   * 排除当前用户已归档 Variant。
   * 数据量增大后改为数据库 RPC 函数。
   */
  async getOverseasStats(userId?: string): Promise<OverseasStats> {
    const supabase = await createClient();
    const archivedVariantIds = await getUserArchivedVariantIds(userId);

    const { data, error } = await supabase.from('inventory').select(
      `id, quantity, last_sync_at, variant_id,
       variant:variant_id!inner (product_id, product:product_id (safety_stock)),
       warehouse:warehouse_id!inner (type)`
    ).eq('warehouse.type', 'overseas');

    if (error) {
      throw new Error(`海外库存统计查询失败: ${error.message}`);
    }

    if (!data || data.length === 0) {
      return { totalQuantity: 0, skuCount: 0, lowStockCount: 0, lastSyncAt: null };
    }

    let totalQuantity = 0;
    const skuSet = new Set<string>();
    const lowStockSkus = new Set<string>();
    let lastSyncAt: string | null = null;

    for (const row of data) {
      // JS 兜底：排除 variant 为 null 或当前用户已归档的 inventory 行
      const variantRaw = unwrapJoin<{ product: unknown }>(row.variant);
      if (!variantRaw) continue;

      // 排除当前用户已归档的 Variant
      if (row.variant_id && archivedVariantIds.has(row.variant_id)) continue;

      totalQuantity += (row.quantity as number) ?? 0;
      if (row.variant_id) skuSet.add(row.variant_id);

      const product = unwrapJoin<{ safety_stock: number }>(variantRaw?.product);
      if (product && (row.quantity as number) > 0 && (row.quantity as number) <= product.safety_stock) {
        lowStockSkus.add(row.variant_id);
      }

      if (row.last_sync_at) {
        if (!lastSyncAt || row.last_sync_at > lastSyncAt) {
          lastSyncAt = row.last_sync_at;
        }
      }
    }

    return {
      totalQuantity,
      skuCount: skuSet.size,
      lowStockCount: lowStockSkus.size,
      lastSyncAt,
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
};
