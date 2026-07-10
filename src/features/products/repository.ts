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
  ProductSkuBindingSummary,
  ProductVariantBindingBrief,
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

// ---- 搜索工具 ----

/** P6-UX-V2-D: 输入规范化 + 分词 */
const TOKEN_SPLIT_RE = /[\s\-_/()（）,，]+/;

/** 需要过滤的噪声 token（仅含标点或太短） */
function isNoiseToken(t: string): boolean {
  return t.length === 0 || /^[\s\-_/()（）,，.]+$/.test(t);
}

/** 转义 PostgreSQL LIKE 特殊字符和 Supabase .or() 分隔符 */
function escapeLike(s: string): string {
  return s.replace(/%/g, '\\%').replace(/_/g, '\\_').replace(/,/g, '\\,');
}

/** 将搜索字符串拆为去重 token 列表 */
function tokenize(input: string): string[] {
  const trimmed = input.trim().replace(/\s+/g, ' ');
  const raw = trimmed.split(TOKEN_SPLIT_RE).filter((t) => !isNoiseToken(t));
  return [...new Set(raw)];
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

    // 批量获取当前页所有产品的 SKU 绑定明细（含 SKU、国家、仓库产品名、匹配状态、最后同步时间）
    const productIds = products.map((p) => p.id);
    const { data: variants, error: vcError } = await supabase
      .from('product_variant')
      .select('id, sku, country, name, match_status, last_sync_at, product_id')
      .in('product_id', productIds)
      .order('country');

    if (vcError) {
      throw new ProductError('查询产品 SKU 绑定失败', 'DB_ERROR');
    }

    // 构建 skuCount + bindings 映射
    const countMap = new Map<string, number>();
    const bindingsMap = new Map<string, ProductSkuBindingSummary>();
    for (const pid of productIds) {
      countMap.set(pid, 0);
      bindingsMap.set(pid, { domestic: [], overseas: {} });
    }

    for (const v of variants ?? []) {
      const pid = v.product_id;
      if (!pid) continue;

      countMap.set(pid, (countMap.get(pid) ?? 0) + 1);

      const brief: ProductVariantBindingBrief = {
        id: v.id,
        sku: v.sku,
        country: v.country,
        name: v.name,
        matchStatus: v.match_status,
        lastSyncAt: v.last_sync_at,
      };

      const binding = bindingsMap.get(pid);
      if (!binding) continue;

      if (v.country === 'CN') {
        binding.domestic.push(brief);
      } else {
        const groups = binding.overseas;
        if (!groups[v.country]) {
          groups[v.country] = [];
        }
        groups[v.country].push(brief);
      }
    }

    return {
      data: products.map((p) => ({
        ...p,
        skuCount: countMap.get(p.id) ?? 0,
        bindings: bindingsMap.get(p.id),
      })),
      total: count ?? 0,
      page,
      pageSize,
    };
  },

  /**
   * P6-UX-V2-D: 模糊/分词搜索产品（供绑定 Dialog 使用）
   *
   * 将输入分词后按 code/name 做多 token ILIKE 搜索，
   * 同时通过 product_variant.sku 反向查找关联产品。
   * 仅返回启用产品（is_active=true）。
   *
   * 搜索逻辑说明：
   * 1. 输入 normalize：trim + 合并空白
   * 2. 按空格、连字符、下划线、斜杠、括号等分词
   * 3. 去重 + 过滤噪声 token
   * 4. 每个 token 对 code/name 做 ILIKE 匹配
   * 5. 同时在 product_variant.sku 中搜索匹配 token，收集关联 product_id
   * 6. 合并两个结果集（OR 语义）
   * 7. Special chars 已 escape，防止破坏 .or() 语法
   */
  async search(query: string, pageSize: number = 20): Promise<ProductItem[]> {
    if (!query || !query.trim()) {
      return [];
    }

    const tokens = tokenize(query);
    if (tokens.length === 0) {
      return [];
    }

    const supabase = await createClient();

    // 收集 SKU 搜索匹配的 product_id
    const skuMatchedProductIds: string[] = [];
    for (const token of tokens) {
      const escaped = escapeLike(token);
      const { data: skuVariants, error: skuError } = await supabase
        .from('product_variant')
        .select('product_id')
        .ilike('sku', `%${escaped}%`)
        .not('product_id', 'is', null)
        .limit(50);

      if (!skuError && skuVariants) {
        for (const v of skuVariants) {
          if (v.product_id && !skuMatchedProductIds.includes(v.product_id)) {
            skuMatchedProductIds.push(v.product_id);
          }
        }
      }
    }

    // 构建 .or() 条件：每个 token 匹配 code OR name
    const orParts: string[] = [];
    for (const token of tokens) {
      const escaped = escapeLike(token);
      orParts.push(`code.ilike.%${escaped}%,name.ilike.%${escaped}%`);
    }

    let query_builder = supabase.from('product').select('*', { count: 'exact' });

    // 构建复合条件
    if (orParts.length > 0 && skuMatchedProductIds.length > 0) {
      // 同时有 token 匹配和 SKU 匹配 → OR 组合
      const orFilters = orParts.join(',');
      query_builder = query_builder.or(`${orFilters},id.in.(${skuMatchedProductIds.join(',')})`);
    } else if (orParts.length > 0) {
      query_builder = query_builder.or(orParts.join(','));
    } else if (skuMatchedProductIds.length > 0) {
      query_builder = query_builder.in('id', skuMatchedProductIds);
    }

    // 仅启用产品
    query_builder = query_builder.eq('is_active', true);

    const { data: products, error } = await query_builder
      .order('created_at', { ascending: false })
      .limit(pageSize);

    if (error) {
      throw new ProductError('搜索产品失败', 'DB_ERROR');
    }

    if (!products || products.length === 0) {
      return [];
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

    return products.map((p) => ({ ...p, skuCount: countMap.get(p.id) ?? 0 }));
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

  /** 更新产品（含产品编码，创建后仍可修改） */
  async update(id: string, data: ProductUpdate): Promise<ProductItem | null> {
    if (!validateUUID(id)) {
      throw new ProductError('无效的产品 ID', 'INVALID_ID');
    }

    const supabase = await createClient();

    // 如果修改 code，先校验是否与其他产品重复
    if (data.code) {
      const { data: existing, error: dupError } = await supabase
        .from('product')
        .select('id')
        .eq('code', data.code)
        .neq('id', id)
        .maybeSingle();

      if (dupError) {
        throw new ProductError('查询产品编码失败', 'DB_ERROR');
      }
      if (existing) {
        throw new ProductError('产品编码已存在', 'DUPLICATE_CODE');
      }
    }

    const { data: product, error } = await supabase
      .from('product')
      .update(data)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) {
      // PostgreSQL 唯一约束违反（兜底保护）
      if (error.code === '23505') {
        throw new ProductError('产品编码已存在', 'DUPLICATE_CODE');
      }
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
