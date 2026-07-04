// 产品模块数据访问层 — 封装所有 product 表 Supabase 查询
// 页面和组件不直接调用 supabase.from('product')，统一走 repository
//
// 错误传播约定：
// - 数据库查询/写入失败 → 抛出 ProductError，由 actions 层捕获并返回中文错误
// - 目标不存在 → 返回 null
// - 列表无数据 → 返回空数组
// - 关联查询失败 → 抛出 ProductError(DB_ERROR)，不返回不完整数据
import { createClient } from '@/lib/supabase/server';
import { unwrapJoin } from '@/lib/supabase/helpers';
import type {
  ProductItem,
  ProductDetail,
  ProductFilters,
  ProductInsert,
  ProductUpdate,
  ProductRow,
  InventoryBrief,
} from './types';
import type { PaginatedResult } from '@/types/common';

const PAGE_SIZE = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- 自定义错误 ----

export class ProductError extends Error {
  constructor(
    message: string,
    public code: 'DUPLICATE_CODE' | 'NOT_FOUND' | 'DB_ERROR' | 'INVALID_ID'
  ) {
    super(message);
    this.name = 'ProductError';
  }
}

// ---- 工具函数 ----

/** 校验外部传入 ID 是否为合法 UUID */
function validateUUID(id: string): boolean {
  return UUID_RE.test(id);
}

/** 从 inventory 关联查询结果中安全提取 InventoryBrief */
function extractInventoryRows(rows: unknown[] | null): InventoryBrief[] {
  if (!rows || rows.length === 0) return [];

  return rows
    .map((row) => {
      const r = row as Record<string, unknown>;
      const variant = unwrapJoin<{ sku: string; country: string }>(r.variant);
      const warehouse = unwrapJoin<{ name: string }>(r.warehouse);
      if (!variant || !warehouse) return null;

      return {
        id: r.id as string,
        sku: variant.sku,
        country: variant.country,
        warehouseName: warehouse.name,
        quantity: (r.quantity as number) ?? 0,
        safetyStock: 0, // 由调用方根据 product.safety_stock 填充
        lastSyncAt: r.last_sync_at as string | null,
      };
    })
    .filter((item): item is InventoryBrief => item !== null);
}

// ---- Repository ----

export const productRepository = {
  /** 分页列表（含关联 SKU 计数） */
  async list(filters: ProductFilters = {}): Promise<PaginatedResult<ProductItem>> {
    const supabase = await createClient();
    const { search, isActive, page = 1, pageSize = PAGE_SIZE } = filters;

    let query = supabase.from('product').select('*', { count: 'exact' });

    if (search) {
      query = query.or(`code.ilike.%${search}%,name.ilike.%${search}%`);
    }
    if (isActive !== undefined) {
      query = query.eq('is_active', isActive);
    }

    const from = (page - 1) * pageSize;
    const { data: products, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new ProductError('查询产品列表失败', 'DB_ERROR');
    }

    // 空列表直接返回，跳过关联查询
    if (!products || products.length === 0) {
      return { data: [], total: 0, page, pageSize };
    }

    // 批量获取 SKU 计数
    const productIds = products.map((p) => p.id);
    const { data: variantCounts, error: vcError } = await supabase
      .from('product_variant')
      .select('product_id')
      .in('product_id', productIds)
      .not('product_id', 'is', null);

    if (vcError) {
      throw new ProductError('查询产品 SKU 计数失败', 'DB_ERROR');
    }

    const countMap = new Map<string, number>();
    productIds.forEach((id) => countMap.set(id, 0));
    variantCounts?.forEach((v) => {
      countMap.set(v.product_id, (countMap.get(v.product_id) ?? 0) + 1);
    });

    return {
      data: products.map((p) => ({ ...p, skuCount: countMap.get(p.id) ?? 0 })),
      total: count ?? 0,
      page,
      pageSize,
    };
  },

  /** 根据 code 查询产品 */
  async getByCode(code: string): Promise<ProductRow | null> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('product')
      .select('*')
      .eq('code', code)
      .maybeSingle();

    if (error) {
      throw new ProductError('查询产品编码失败', 'DB_ERROR');
    }
    return data;
  },

  /** 根据 ID 获取产品详情（含 SKU 列表 + 各仓库存） */
  async getById(id: string): Promise<ProductDetail | null> {
    if (!validateUUID(id)) return null;

    const supabase = await createClient();

    const { data: product, error } = await supabase
      .from('product')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new ProductError('查询产品详情失败', 'DB_ERROR');
    }
    if (!product) return null;

    // PERF-C2B: variants 和 inventory 只依赖 product id，并行查询
    const [variantsResult, inventoryResult] = await Promise.all([
      supabase
        .from('product_variant')
        .select('id, sku, country, name, match_status, last_sync_at')
        .eq('product_id', id)
        .order('country'),
      supabase
        .from('inventory')
        .select(
          `id, quantity, last_sync_at,
           variant:variant_id!inner (sku, country),
           warehouse:warehouse_id (name)`
        )
        .eq('variant.product_id', id),
    ]);

    const { data: variants, error: vError } = variantsResult;
    if (vError) {
      throw new ProductError('查询产品关联 SKU 失败', 'DB_ERROR');
    }

    const { data: inventoryRows, error: iError } = inventoryResult;
    if (iError) {
      throw new ProductError('查询产品库存失败', 'DB_ERROR');
    }

    const inventoryItems = extractInventoryRows(inventoryRows).map((item) => ({
      ...item,
      safetyStock: product.safety_stock,
    }));

    return {
      ...product,
      variants: (variants ?? []).map((v) => ({
        id: v.id,
        sku: v.sku,
        country: v.country,
        name: v.name,
        matchStatus: v.match_status,
        lastSyncAt: v.last_sync_at,
      })),
      inventory: inventoryItems,
    };
  },

  /** 创建产品 */
  async create(data: ProductInsert): Promise<ProductItem> {
    const supabase = await createClient();
    const { data: product, error } = await supabase
      .from('product')
      .insert(data)
      .select('*')
      .single();

    if (error) {
      // PostgreSQL 唯一约束违反
      if (error.code === '23505') {
        throw new ProductError('产品编码已存在', 'DUPLICATE_CODE');
      }
      throw new ProductError('创建产品失败', 'DB_ERROR');
    }
    if (!product) {
      throw new ProductError('创建产品失败', 'DB_ERROR');
    }
    return { ...product, skuCount: 0 };
  },

  /** 更新产品（不更新 code — code 创建后不可修改） */
  async update(id: string, data: ProductUpdate): Promise<ProductItem | null> {
    if (!validateUUID(id)) {
      throw new ProductError('无效的产品 ID', 'INVALID_ID');
    }

    const supabase = await createClient();
    const { data: product, error } = await supabase
      .from('product')
      .update(data)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) {
      throw new ProductError('更新产品失败', 'DB_ERROR');
    }
    if (!product) return null;

    // 获取 SKU 计数
    const { count, error: cError } = await supabase
      .from('product_variant')
      .select('*', { count: 'exact', head: true })
      .eq('product_id', id);

    if (cError) {
      throw new ProductError('查询产品 SKU 计数失败', 'DB_ERROR');
    }

    return { ...product, skuCount: count ?? 0 };
  },

  /** 切换启用/停用 — 返回是否实际更新了行 */
  async toggleActive(id: string, isActive: boolean): Promise<boolean> {
    if (!validateUUID(id)) {
      throw new ProductError('无效的产品 ID', 'INVALID_ID');
    }

    const supabase = await createClient();
    const { data: updated, error } = await supabase
      .from('product')
      .update({ is_active: isActive })
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (error) {
      throw new ProductError('切换产品状态失败', 'DB_ERROR');
    }
    return updated !== null;
  },
};
