// SKU (ProductVariant) 模块数据访问层 — 封装 product_variant 表查询
//
// 错误传播约定：
// - 数据库查询/写入失败 → 抛出 VariantError，由 actions 层捕获并返回中文错误
// - 目标不存在 → 返回 null
// - 列表无数据 → 返回空数组
// - 关联查询失败 → 抛出 VariantError(DB_ERROR)，不返回不完整数据
import { createClient } from '@/lib/supabase/server';
import { unwrapJoin } from '@/lib/supabase/helpers';
import type { VariantItem, VariantFilters } from './types';
import type { PaginatedResult } from '@/types/common';

const PAGE_SIZE = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- 自定义错误 ----

export class VariantError extends Error {
  constructor(
    message: string,
    public code: 'INVALID_ID' | 'NOT_FOUND' | 'DB_ERROR' | 'PRODUCT_INACTIVE'
  ) {
    super(message);
    this.name = 'VariantError';
  }
}

// ---- 工具函数 ----

function validateUUID(id: string): boolean {
  return UUID_RE.test(id);
}

/** 将 Supabase join 结果映射为 VariantItem */
function mapVariantItem(row: Record<string, unknown>): VariantItem {
  const product = unwrapJoin<{ name: string; code: string }>(row.product);
  return {
    ...(row as unknown as VariantItem),
    productName: product?.name ?? null,
    productCode: product?.code ?? null,
  };
}

// ---- Repository ----

export const variantRepository = {
  /** 分页列表（含关联产品名） */
  async list(filters: VariantFilters = {}): Promise<PaginatedResult<VariantItem>> {
    const supabase = await createClient();
    const { country, matchStatus, productId, search, page = 1, pageSize = PAGE_SIZE } = filters;

    let query = supabase.from('product_variant').select('*, product:product_id (name, code)', {
      count: 'exact',
    });

    if (country) query = query.eq('country', country);
    if (matchStatus) query = query.eq('match_status', matchStatus);
    if (productId) query = query.eq('product_id', productId);
    if (search) {
      query = query.or(`sku.ilike.%${search}%,name.ilike.%${search}%`);
    }

    const from = (page - 1) * pageSize;
    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new VariantError('查询 SKU 列表失败', 'DB_ERROR');
    }

    if (!data || data.length === 0) {
      return { data: [], total: 0, page, pageSize };
    }

    return {
      data: data.map((row) => mapVariantItem(row as unknown as Record<string, unknown>)),
      total: count ?? 0,
      page,
      pageSize,
    };
  },

  /** 获取未匹配 + 待确认的 SKU（用于待处理列表） */
  async getUnmatched(): Promise<VariantItem[]> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('product_variant')
      .select('*, product:product_id (name, code)')
      .in('match_status', ['unmatched', 'pending'])
      .order('last_sync_at', { ascending: false });

    if (error) {
      throw new VariantError('查询待处理 SKU 失败', 'DB_ERROR');
    }

    if (!data || data.length === 0) return [];

    return data.map((row) => mapVariantItem(row as unknown as Record<string, unknown>));
  },

  /** 根据 ID 获取 SKU 详情 */
  async getById(id: string): Promise<VariantItem | null> {
    if (!validateUUID(id)) return null;

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('product_variant')
      .select('*, product:product_id (name, code)')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new VariantError('查询 SKU 详情失败', 'DB_ERROR');
    }
    if (!data) return null;

    return mapVariantItem(data as unknown as Record<string, unknown>);
  },

  /** 匹配 SKU 到标准产品 */
  async match(variantId: string, productId: string): Promise<void> {
    if (!validateUUID(variantId)) {
      throw new VariantError('无效的 SKU ID', 'INVALID_ID');
    }
    if (!validateUUID(productId)) {
      throw new VariantError('无效的产品 ID', 'INVALID_ID');
    }

    const supabase = await createClient();

    // 确认 Variant 存在
    const { data: variant, error: vError } = await supabase
      .from('product_variant')
      .select('id')
      .eq('id', variantId)
      .maybeSingle();

    if (vError) {
      throw new VariantError('查询 SKU 失败', 'DB_ERROR');
    }
    if (!variant) {
      throw new VariantError('SKU 不存在', 'NOT_FOUND');
    }

    // 确认 Product 存在且处于启用状态
    const { data: product, error: pError } = await supabase
      .from('product')
      .select('id, is_active')
      .eq('id', productId)
      .maybeSingle();

    if (pError) {
      throw new VariantError('查询产品失败', 'DB_ERROR');
    }
    if (!product) {
      throw new VariantError('产品不存在', 'NOT_FOUND');
    }
    if (!product.is_active) {
      throw new VariantError('产品已停用，无法匹配', 'PRODUCT_INACTIVE');
    }

    // 执行匹配
    const { data: updated, error: uError } = await supabase
      .from('product_variant')
      .update({ product_id: productId, match_status: 'matched' })
      .eq('id', variantId)
      .select('id')
      .maybeSingle();

    if (uError) {
      throw new VariantError('匹配 SKU 失败', 'DB_ERROR');
    }
    if (!updated) {
      throw new VariantError('SKU 不存在', 'NOT_FOUND');
    }
  },

  /** 取消匹配（设为 unmatched，清除 product_id） */
  async unmatch(variantId: string): Promise<void> {
    if (!validateUUID(variantId)) {
      throw new VariantError('无效的 SKU ID', 'INVALID_ID');
    }

    const supabase = await createClient();

    // 确认 Variant 存在
    const { data: variant, error: vError } = await supabase
      .from('product_variant')
      .select('id')
      .eq('id', variantId)
      .maybeSingle();

    if (vError) {
      throw new VariantError('查询 SKU 失败', 'DB_ERROR');
    }
    if (!variant) {
      throw new VariantError('SKU 不存在', 'NOT_FOUND');
    }

    // 执行取消匹配
    const { data: updated, error: uError } = await supabase
      .from('product_variant')
      .update({ product_id: null, match_status: 'unmatched' })
      .eq('id', variantId)
      .select('id')
      .maybeSingle();

    if (uError) {
      throw new VariantError('取消匹配失败', 'DB_ERROR');
    }
    if (!updated) {
      throw new VariantError('SKU 不存在', 'NOT_FOUND');
    }
  },

  /** 批量匹配 — 通过 PostgreSQL 事务函数原子执行全部校验与写入 */
  async batchMatch(variantIds: string[], productId: string): Promise<{ matched: number }> {
    // 1. 应用层 UUID 校验 — 非法 ID 立即整体拒绝，不传入数据库
    if (!validateUUID(productId)) {
      throw new VariantError('无效的产品 ID', 'INVALID_ID');
    }

    if (variantIds.length === 0) {
      throw new VariantError('请选择至少一个 SKU', 'INVALID_ID');
    }
    for (const id of variantIds) {
      if (!validateUUID(id)) {
        throw new VariantError(`无效的 SKU ID：${id}`, 'INVALID_ID');
      }
    }

    // 2. 去重，避免重复 ID 导致更新数量与请求数量误判
    const uniqueIds = [...new Set(variantIds)];

    // 3. 调用 PostgreSQL 事务函数 — Product 存在/启用、Variant 存在、批量 UPDATE 在同一事务内原子执行
    const supabase = await createClient();
    const { data: matchedCount, error } = await supabase.rpc(
      'batch_match_variants',
      {
        p_variant_ids: uniqueIds,
        p_product_id: productId,
      }
    );

    if (error) {
      // PostgreSQL RAISE EXCEPTION 消息通过 error.message 返回
      if (error.message.includes('产品已停用')) {
        throw new VariantError('产品已停用，无法匹配', 'PRODUCT_INACTIVE');
      }
      if (error.message.includes('产品不存在')) {
        throw new VariantError('产品不存在', 'NOT_FOUND');
      }
      if (error.message.includes('SKU 不存在')) {
        throw new VariantError('部分 SKU 不存在', 'NOT_FOUND');
      }
      throw new VariantError('批量匹配失败', 'DB_ERROR');
    }

    return { matched: matchedCount ?? 0 };
  },
};
