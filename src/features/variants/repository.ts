// SKU (ProductVariant) 模块数据访问层 — 封装 product_variant + user_variant_preference 表查询
//
// P5-SY11G: 归档已从全局 product_variant.is_archived 迁移为用户级 user_variant_preference。
// Migration 00011 保持不可变；00048 已清理旧全局归档列，业务只使用用户级偏好。
//
// 错误传播约定：
// - 数据库查询/写入失败 → 抛出 VariantError，由 actions 层捕获并返回中文错误
// - 目标不存在 → 返回 null
// - 列表无数据 → 返回空数组
// - 关联查询失败 → 抛出 VariantError(DB_ERROR)，不返回不完整数据
import { cache } from 'react';
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

// ─── Request-scope cached helpers ────────────────────────────────────
// 内部函数返回 string[]（不可变），避免缓存可变 Set。

const cachedGetUserArchivedVariantIds = cache(
  async (userId: string): Promise<string[]> => {
    if (!validateUUID(userId)) return [];

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('user_variant_preference')
      .select('variant_id')
      .eq('user_id', userId)
      .eq('preference_type', 'archived');

    if (error) {
      throw new VariantError('查询归档偏好失败', 'DB_ERROR');
    }

    return (data ?? []).map((r) => r.variant_id);
  },
);

// ---- Repository ----

export const variantRepository = {
  /**
   * 获取当前用户已归档的 Variant ID 集合（用于过滤/标记）
   * 调用方负责传入 userId（从 session 获取）。
   * 每次调用返回新的 Set（基于同一请求内缓存的 string[]），避免调用方修改共享状态。
   */
  async getUserArchivedVariantIds(userId: string): Promise<Set<string>> {
    return new Set(await cachedGetUserArchivedVariantIds(userId));
  },

  /** 分页列表（含关联产品名 + 当前用户归档状态）
   *  @param filters.archiveStatus 默认 'active'（仅未归档），'archived' 仅已归档，'all' 不过滤
   *  @param filters.userId 当前登录用户 ID（用于查询个人归档偏好）
   *
   *  归档过滤在 DB 层完成（分页前），确保 total 和每页条数准确。
   *  'all' 时也加载 archivedVariantIds 用于 isArchivedByUser 标记。 */
  async list(filters: VariantFilters = {}): Promise<PaginatedResult<VariantItem>> {
    const supabase = await createClient();
    const { country, matchStatus, productId, search, archiveStatus = 'active', page = 1, pageSize = PAGE_SIZE, userId } = filters;

    // 始终加载当前用户已归档 ID（all 也需要，用于 isArchivedByUser 标记）
    let archivedVariantIds = new Set<string>();
    if (userId) {
      archivedVariantIds = await this.getUserArchivedVariantIds(userId);
    }

    // archived tab + 无已归档记录 → 直接返回空
    if (archiveStatus === 'archived' && archivedVariantIds.size === 0) {
      return { data: [], total: 0, page, pageSize };
    }

    // 不再使用 is_archived 列；归档过滤基于 user_variant_preference 在 DB 层完成
    let query = supabase.from('product_variant').select('*, product:product_id (name, code)', {
      count: 'exact',
    });

    if (country) query = query.eq('country', country);
    if (matchStatus) query = query.eq('match_status', matchStatus);
    if (productId) query = query.eq('product_id', productId);
    if (search) {
      query = query.or(`sku.ilike.%${search}%,name.ilike.%${search}%`);
    }

    // DB 层归档过滤（分页前完成，确保 total 准确、分页不丢行）
    if (userId) {
      const archivedArray = [...archivedVariantIds];
      if (archiveStatus === 'active' && archivedArray.length > 0) {
        query = query.notIn('id', archivedArray);
      } else if (archiveStatus === 'archived') {
        query = query.in('id', archivedArray);
      }
      // archiveStatus === 'all': 不过滤
      // archiveStatus === 'active' && archivedArray.length === 0: 无需过滤
    }

    const from = (page - 1) * pageSize;
    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new VariantError('查询 SKU 列表失败', 'DB_ERROR');
    }

    if (!data || data.length === 0) {
      return { data: [], total: count ?? 0, page, pageSize };
    }

    const items = data.map((row) =>
      mapVariantItem(row as unknown as Record<string, unknown>, archivedVariantIds)
    );

    return {
      data: items,
      total: count ?? 0,
      page,
      pageSize,
    };
  },

  /** 获取未匹配 + 待确认的活跃 SKU（用于待处理列表，排除当前用户已归档）
   *  归档过滤在 DB 层完成（分页前），确保 total 和每页条数准确。 */
  async getUnmatched(
    params: { userId?: string; page?: number; pageSize?: number } = {}
  ): Promise<PaginatedResult<VariantItem>> {
    const { userId, page = 1, pageSize = PAGE_SIZE } = params;
    const supabase = await createClient();

    // 获取当前用户已归档 ID
    let archivedVariantIds = new Set<string>();
    if (userId) {
      archivedVariantIds = await this.getUserArchivedVariantIds(userId);
    }

    let query = supabase
      .from('product_variant')
      .select('*, product:product_id (name, code)', { count: 'exact' })
      .in('match_status', ['unmatched', 'pending']);

    // DB 层归档过滤（分页前完成，确保 total 准确、分页不丢行）
    if (userId) {
      const archivedArray = [...archivedVariantIds];
      if (archivedArray.length > 0) {
        query = query.notIn('id', archivedArray);
      }
    }

    const from = (page - 1) * pageSize;
    const { data, error, count } = await query
      .order('last_sync_at', { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new VariantError('查询待处理 SKU 失败', 'DB_ERROR');
    }

    if (!data || data.length === 0) {
      return { data: [], total: count ?? 0, page, pageSize };
    }

    const items = data.map((row) =>
      mapVariantItem(row as unknown as Record<string, unknown>, archivedVariantIds)
    );

    return { data: items, total: count ?? 0, page, pageSize };
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
   *  @returns 本次实际新增的归档数量（已归档的不会重复计入） */
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

    // 查询当前用户已归档的 Variant（避免重复插入）
    const { data: existing, error: existingError } = await supabase
      .from('user_variant_preference')
      .select('variant_id')
      .in('variant_id', uniqueIds)
      .eq('user_id', userId)
      .eq('preference_type', 'archived');

    if (existingError) {
      throw new VariantError('查询归档状态失败', 'DB_ERROR');
    }

    const alreadyArchived = new Set((existing ?? []).map((r) => r.variant_id));
    const toArchive = uniqueIds.filter((id) => !alreadyArchived.has(id));

    if (toArchive.length === 0) {
      return { archived: 0 };
    }

    // 仅插入尚未归档的记录
    const rows = toArchive.map((variantId) => ({
      user_id: userId,
      variant_id: variantId,
      preference_type: 'archived' as const,
    }));

    const { error: insertError } = await supabase
      .from('user_variant_preference')
      .insert(rows);

    if (insertError) {
      throw new VariantError('归档 SKU 失败', 'DB_ERROR');
    }

    return { archived: toArchive.length };
  },

  /** 批量恢复 Variant（DELETE FROM user_variant_preference）
   *  @param userId 当前登录用户 ID
   *  @returns 本次实际恢复的数量（仅统计实际被删除的偏好记录） */
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

    // 查询当前用户实际已归档的 Variant（仅删除实际存在的偏好记录）
    const { data: existing, error: existingError } = await supabase
      .from('user_variant_preference')
      .select('variant_id')
      .in('variant_id', uniqueIds)
      .eq('user_id', userId)
      .eq('preference_type', 'archived');

    if (existingError) {
      throw new VariantError('查询归档状态失败', 'DB_ERROR');
    }

    const actuallyArchived = (existing ?? []).map((r) => r.variant_id);

    if (actuallyArchived.length === 0) {
      return { restored: 0 };
    }

    // 仅删除实际存在的偏好记录
    const { error: deleteError } = await supabase
      .from('user_variant_preference')
      .delete()
      .in('variant_id', actuallyArchived)
      .eq('user_id', userId)
      .eq('preference_type', 'archived');

    if (deleteError) {
      throw new VariantError('恢复 SKU 失败', 'DB_ERROR');
    }

    return { restored: actuallyArchived.length };
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
