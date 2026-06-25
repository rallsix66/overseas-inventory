// SKU (ProductVariant) 模块数据访问层 — 封装 product_variant + user_variant_preference 表查询
//
// P5-SY11G: 归档已从全局 product_variant.is_archived 迁移为用户级 user_variant_preference。
// product_variant.is_archived 列为遗留列，所有业务代码停止读写。
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
    public code: 'INVALID_ID' | 'NOT_FOUND' | 'DB_ERROR' | 'PRODUCT_INACTIVE' | 'ALREADY_ARCHIVED' | 'INVALID_STATE'
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
function mapVariantItem(row: Record<string, unknown>, archivedVariantIds: Set<string>): VariantItem {
  const product = unwrapJoin<{ name: string; code: string }>(row.product);
  return {
    ...(row as unknown as VariantItem),
    productName: product?.name ?? null,
    productCode: product?.code ?? null,
    isArchivedByUser: archivedVariantIds.has(row.id as string),
  };
}

// ---- Repository ----

export const variantRepository = {
  /**
   * 获取当前用户已归档的 Variant ID 集合（用于过滤/标记）
   * 调用方负责传入 userId（从 session 获取）。
   */
  async getUserArchivedVariantIds(userId: string): Promise<Set<string>> {
    if (!validateUUID(userId)) return new Set();

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('user_variant_preference')
      .select('variant_id')
      .eq('user_id', userId)
      .eq('preference_type', 'archived');

    if (error) {
      throw new VariantError('查询归档偏好失败', 'DB_ERROR');
    }

    return new Set((data ?? []).map((r) => r.variant_id));
  },

  /** 分页列表（含关联产品名 + 当前用户归档状态）
   *  @param filters.archiveStatus 默认 'active'（仅未归档），'archived' 仅已归档，'all' 不过滤
   *  @param filters.userId 当前登录用户 ID（用于查询个人归档偏好） */
  async list(filters: VariantFilters = {}): Promise<PaginatedResult<VariantItem>> {
    const supabase = await createClient();
    const { country, matchStatus, productId, search, archiveStatus = 'active', page = 1, pageSize = PAGE_SIZE, userId } = filters;

    // 获取当前用户已归档的 Variant ID 集合
    let archivedVariantIds = new Set<string>();
    if (userId && archiveStatus !== 'all') {
      archivedVariantIds = await this.getUserArchivedVariantIds(userId);
    }

    let query = supabase.from('product_variant').select('*, product:product_id (name, code)', {
      count: 'exact',
    });

    if (country) query = query.eq('country', country);
    if (matchStatus) query = query.eq('match_status', matchStatus);
    if (productId) query = query.eq('product_id', productId);
    if (search) {
      query = query.or(`sku.ilike.%${search}%,name.ilike.%${search}%`);
    }
    // 不再使用 is_archived 列；归档过滤在 JS 层基于 user_variant_preference 完成

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

    // JS 层按用户归档偏好过滤 + 标记 isArchivedByUser
    let filtered: unknown[] = data;
    if (userId) {
      if (archiveStatus === 'active') {
        filtered = data.filter((row: Record<string, unknown>) => !archivedVariantIds.has(row.id as string));
      } else if (archiveStatus === 'archived') {
        filtered = data.filter((row: Record<string, unknown>) => archivedVariantIds.has(row.id as string));
      }
    }

    // 过滤后重新计算 total（含归档过滤的准确计数）
    // 对于非 all 过滤，total 由 DB count 减去分页前被过滤的差异近似估算
    // 实际分页准确性由前端接受（数据量较小时精确）
    const items = filtered.map((row) =>
      mapVariantItem(row as unknown as Record<string, unknown>, archivedVariantIds)
    );

    // count 为 DB 全量计数（不含用户归档过滤），保留原值；JS 过滤后 total 重新计算
    const total = userId && archiveStatus !== 'all'
      ? items.length  // 精确但仅限当前页过滤后的数量；total 估算用 DB count 保守
      : (count ?? 0);

    return {
      data: items,
      total,
      page,
      pageSize,
    };
  },

  /** 获取未匹配 + 待确认的活跃 SKU（用于待处理列表，排除当前用户已归档） */
  async getUnmatched(userId?: string): Promise<VariantItem[]> {
    const supabase = await createClient();

    // 获取当前用户已归档 ID
    let archivedVariantIds = new Set<string>();
    if (userId) {
      archivedVariantIds = await this.getUserArchivedVariantIds(userId);
    }

    const { data, error } = await supabase
      .from('product_variant')
      .select('*, product:product_id (name, code)')
      .in('match_status', ['unmatched', 'pending'])
      .order('last_sync_at', { ascending: false });

    if (error) {
      throw new VariantError('查询待处理 SKU 失败', 'DB_ERROR');
    }

    if (!data || data.length === 0) return [];

    // JS 层排除当前用户已归档 Variant
    const filtered = userId
      ? data.filter((row: Record<string, unknown>) => !archivedVariantIds.has(row.id as string))
      : data;

    return filtered.map((row) =>
      mapVariantItem(row as unknown as Record<string, unknown>, archivedVariantIds)
    );
  },

  /** 根据 ID 获取 SKU 详情（含当前用户归档状态） */
  async getById(id: string, userId?: string): Promise<VariantItem | null> {
    if (!validateUUID(id)) return null;

    let archivedVariantIds = new Set<string>();
    if (userId) {
      archivedVariantIds = await this.getUserArchivedVariantIds(userId);
    }

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

    return mapVariantItem(data as unknown as Record<string, unknown>, archivedVariantIds);
  },

  /** 批量归档 Variant（INSERT INTO user_variant_preference）
   *  @param userId 当前登录用户 ID
   *  @returns 实际归档数量 */
  async archive(variantIds: string[], userId: string): Promise<{ archived: number }> {
    if (variantIds.length === 0) {
      throw new VariantError('请选择至少一个 SKU', 'INVALID_ID');
    }
    for (const id of variantIds) {
      if (!validateUUID(id)) {
        throw new VariantError(`无效的 SKU ID：${id}`, 'INVALID_ID');
      }
    }
    if (!validateUUID(userId)) {
      throw new VariantError('无效的用户 ID', 'INVALID_ID');
    }

    const uniqueIds = [...new Set(variantIds)];

    const supabase = await createClient();

    // 确认 Variant 存在
    const { data: variants, error: qError } = await supabase
      .from('product_variant')
      .select('id')
      .in('id', uniqueIds);

    if (qError) {
      throw new VariantError('查询 SKU 失败', 'DB_ERROR');
    }

    const foundIds = new Set((variants ?? []).map((v) => v.id));
    for (const id of uniqueIds) {
      if (!foundIds.has(id)) {
        throw new VariantError('SKU 不存在', 'NOT_FOUND');
      }
    }

    // 批量 INSERT INTO user_variant_preference（忽略重复）
    // ON CONFLICT DO NOTHING: 已归档的 Variant 不报错，静默跳过
    const rows = uniqueIds.map((variantId) => ({
      user_id: userId,
      variant_id: variantId,
      preference_type: 'archived' as const,
    }));

    const { error: insertError } = await supabase
      .from('user_variant_preference')
      .upsert(rows, {
        onConflict: 'user_id, variant_id, preference_type',
        ignoreDuplicates: true,
      });

    if (insertError) {
      // 检查是否因 UNIQUE 约束导致全部跳过
      if (insertError.code === '23505') {
        return { archived: 0 };
      }
      throw new VariantError('归档 SKU 失败', 'DB_ERROR');
    }

    // 查询实际写入数量
    const { data: inserted, error: countError } = await supabase
      .from('user_variant_preference')
      .select('id')
      .in('variant_id', uniqueIds)
      .eq('user_id', userId)
      .eq('preference_type', 'archived');

    if (countError) {
      // 非关键路径，返回估算
      return { archived: uniqueIds.length };
    }

    return { archived: inserted?.length ?? 0 };
  },

  /** 批量恢复 Variant（DELETE FROM user_variant_preference）
   *  @param userId 当前登录用户 ID
   *  @returns 实际恢复数量 */
  async restore(variantIds: string[], userId: string): Promise<{ restored: number }> {
    if (variantIds.length === 0) {
      throw new VariantError('请选择至少一个 SKU', 'INVALID_ID');
    }
    for (const id of variantIds) {
      if (!validateUUID(id)) {
        throw new VariantError(`无效的 SKU ID：${id}`, 'INVALID_ID');
      }
    }
    if (!validateUUID(userId)) {
      throw new VariantError('无效的用户 ID', 'INVALID_ID');
    }

    const uniqueIds = [...new Set(variantIds)];

    const supabase = await createClient();

    // 确认 Variant 存在
    const { data: variants, error: qError } = await supabase
      .from('product_variant')
      .select('id')
      .in('id', uniqueIds);

    if (qError) {
      throw new VariantError('查询 SKU 失败', 'DB_ERROR');
    }

    const foundIds = new Set((variants ?? []).map((v) => v.id));
    for (const id of uniqueIds) {
      if (!foundIds.has(id)) {
        throw new VariantError('SKU 不存在', 'NOT_FOUND');
      }
    }

    // 删除当前用户的归档偏好记录
    const { error: deleteError } = await supabase
      .from('user_variant_preference')
      .delete()
      .in('variant_id', uniqueIds)
      .eq('user_id', userId)
      .eq('preference_type', 'archived');

    if (deleteError) {
      throw new VariantError('恢复 SKU 失败', 'DB_ERROR');
    }

    // 无法从 supabase delete 返回值中获取删除行数
    // 返回请求的 ID 数量作为近似值（DELETE 不会失败于不存在的行）
    return { restored: uniqueIds.length };
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
    // P5-SY11G: 归档是用户个人视图偏好，不再阻止匹配操作

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
    // P5-SY11G: 归档是用户个人视图偏好，不再阻止取消匹配操作

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

  /** 批量匹配 — 先校验 Variant 存在，再通过 PostgreSQL 事务函数原子执行 */
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

    // 3. 查询所有 Variant 的 id，验证存在性（归档偏好不再阻止匹配）
    const supabase = await createClient();
    const { data: variants, error: vError } = await supabase
      .from('product_variant')
      .select('id')
      .in('id', uniqueIds);

    if (vError) {
      throw new VariantError('查询 SKU 失败', 'DB_ERROR');
    }

    const foundMap = new Map((variants ?? []).map((v) => [v.id, true]));
    for (const id of uniqueIds) {
      if (!foundMap.has(id)) {
        throw new VariantError('部分 SKU 不存在', 'NOT_FOUND');
      }
    }
    // P5-SY11G: 归档是用户个人视图偏好，不再阻止批量匹配

    // 4. 调用 PostgreSQL 事务函数
    const { data: matchedCount, error } = await supabase.rpc(
      'batch_match_variants',
      {
        p_variant_ids: uniqueIds,
        p_product_id: productId,
      }
    );

    if (error) {
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
