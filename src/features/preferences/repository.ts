// 用户偏好模块数据访问层 — 封装 user_variant_preference 表查询（关注部分）
//
// P5-SY12: 特别关注阶段 B — 关注/取消关注/查询关注状态/Dashboard 关注视图
// P5-SY11G: 归档部分由 variants/repository.ts 管理（preference_type='archived'）
//
// 数据模型：复用 user_variant_preference 表，通过 preference_type 区分：
//   - 'archived' → 归档（variants/repository.ts）
//   - 'favorited' → 关注（本文件）
//
// 关注不影响同步、不影响库存写入、不影响他人视图。
// 同一用户同一 variant 可同时 archived + favorited（preference_type 不同）。
//
// 错误传播约定：
// - 数据库查询/写入失败 → 抛出 PreferenceError，由 actions 层捕获并返回中文错误
// - variant 不存在 → 返回 PreferenceResult error
// - 用户无关注 → 返回空数组
import { createClient } from '@/lib/supabase/server';
import { unwrapJoin } from '@/lib/supabase/helpers';
import { PreferenceError, type PreferenceResult, type FollowedVariantBasic } from './types';
import type { Database } from '@/types/database';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUUID(id: string): boolean {
  return UUID_RE.test(id);
}

/** Supabase join 展开后的 inventory 行（阶段 B 字段子集） */
type InventoryJoinRow = {
  quantity: number;
  last_sync_at: string | null;
  warehouse: {
    id: string; name: string; country: string; type: string;
  } | null;
};

export const preferencesRepository = {
  // ─── 关注状态查询 ──────────────────────────────────────────────────

  /** 获取当前用户已关注的 variant_id 集合（用于前端标记星标状态） */
  async getFavoritedVariantIds(userId: string): Promise<Set<string>> {
    if (!validateUUID(userId)) return new Set();

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('user_variant_preference')
      .select('variant_id')
      .eq('user_id', userId)
      .eq('preference_type', 'favorited');

    if (error) {
      throw new PreferenceError('DB_ERROR', `查询关注列表失败: ${error.message}`);
    }

    return new Set((data ?? []).map((r) => r.variant_id));
  },

  /** 是否已关注 */
  async isFavorited(userId: string, variantId: string): Promise<boolean> {
    if (!validateUUID(userId) || !validateUUID(variantId)) return false;

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('user_variant_preference')
      .select('id')
      .eq('user_id', userId)
      .eq('variant_id', variantId)
      .eq('preference_type', 'favorited')
      .maybeSingle();

    if (error) {
      throw new PreferenceError('DB_ERROR', `查询关注状态失败: ${error.message}`);
    }
    return !!data;
  },

  // ─── 关注操作 ──────────────────────────────────────────────────────

  /** 关注 variant */
  async favorite(userId: string, variantId: string): Promise<PreferenceResult<{ favorited: true }>> {
    if (!validateUUID(userId)) {
      return { success: false, error: new PreferenceError('RLS_REJECTED', '无权操作该 SKU') };
    }
    if (!validateUUID(variantId)) {
      return { success: false, error: new PreferenceError('VARIANT_NOT_FOUND', '该 SKU 不存在') };
    }

    // 1. 验证 Variant 存在
    const variantExists = await this._variantExists(variantId);
    if (!variantExists) {
      return { success: false, error: new PreferenceError('VARIANT_NOT_FOUND', '该 SKU 不存在') };
    }

    // 2. 幂等检查
    const already = await this.isFavorited(userId, variantId);
    if (already) {
      return { success: false, error: new PreferenceError('ALREADY_FAVORITED', '已关注该 SKU') };
    }

    // 3. INSERT
    const supabase = await createClient();
    const { error } = await supabase
      .from('user_variant_preference')
      .insert({ user_id: userId, variant_id: variantId, preference_type: 'favorited' });

    if (error) {
      // 23505 = unique_violation（已被并发插入）
      if (error.code === '23505') {
        return { success: false, error: new PreferenceError('ALREADY_FAVORITED', '已关注该 SKU') };
      }
      // 42501 = insufficient_privilege（RLS 拒绝）
      if (error.code === '42501') {
        return { success: false, error: new PreferenceError('RLS_REJECTED', '无权操作该 SKU') };
      }
      return { success: false, error: new PreferenceError('DB_ERROR', `数据库错误: ${error.message}`) };
    }

    return { success: true, data: { favorited: true } };
  },

  /** 取消关注 */
  async unfavorite(userId: string, variantId: string): Promise<PreferenceResult<{ favorited: false }>> {
    if (!validateUUID(userId)) {
      return { success: false, error: new PreferenceError('RLS_REJECTED', '无权操作该 SKU') };
    }
    if (!validateUUID(variantId)) {
      return { success: false, error: new PreferenceError('VARIANT_NOT_FOUND', '该 SKU 不存在') };
    }

    // 幂等检查
    const already = await this.isFavorited(userId, variantId);
    if (!already) {
      return { success: false, error: new PreferenceError('NOT_FAVORITED', '未关注该 SKU') };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from('user_variant_preference')
      .delete()
      .eq('user_id', userId)
      .eq('variant_id', variantId)
      .eq('preference_type', 'favorited');

    if (error) {
      if (error.code === '42501') {
        return { success: false, error: new PreferenceError('RLS_REJECTED', '无权操作该 SKU') };
      }
      return { success: false, error: new PreferenceError('DB_ERROR', `数据库错误: ${error.message}`) };
    }

    return { success: true, data: { favorited: false } };
  },

  /** 切换关注状态 */
  async toggleFavorite(userId: string, variantId: string): Promise<PreferenceResult<{ favorited: boolean }>> {
    if (!validateUUID(userId)) {
      return { success: false, error: new PreferenceError('RLS_REJECTED', '无权操作该 SKU') };
    }
    if (!validateUUID(variantId)) {
      return { success: false, error: new PreferenceError('VARIANT_NOT_FOUND', '该 SKU 不存在') };
    }

    // 1. 验证 Variant 存在
    const variantExists = await this._variantExists(variantId);
    if (!variantExists) {
      return { success: false, error: new PreferenceError('VARIANT_NOT_FOUND', '该 SKU 不存在') };
    }

    // 2. 查询当前状态
    const isFav = await this.isFavorited(userId, variantId);

    // 3. 执行操作
    if (isFav) {
      const result = await this.unfavorite(userId, variantId);
      if (!result.success) return result;
      return { success: true, data: { favorited: false } };
    }
    const result = await this.favorite(userId, variantId);
    if (!result.success) return result;
    return { success: true, data: { favorited: true } };
  },

  // ─── Dashboard 查询 ─────────────────────────────────────────────────

  /**
   * 获取当前用户关注 Variant 的基础库存视图（阶段 B）。
   *
   * 阶段 B 临时告警：quantity < product.safety_stock（非动态告警）。
   * 阶段 C 升级为动态告警（est_days < lead_time_days）。
   *
   * 查询失败时抛出 PreferenceError（不静默返回 []）。
   * 仅当用户确实没有关注任何 Variant 时才返回 []。
   *
   * 注意：关注区显示所有 favorited 的 variant（不排除同时 archived 的），
   * 因为关注是用户主动选择的高亮视图，归档只是列表视图偏好。
   */
  async getFollowedVariantsBasic(userId: string): Promise<FollowedVariantBasic[]> {
    if (!validateUUID(userId)) return [];

    const supabase = await createClient();
    type UvpRow = Database['public']['Tables']['user_variant_preference']['Row'];

    const { data, error } = await supabase
      .from('user_variant_preference')
      .select(`
        variant:variant_id (
          id, country,
          product:product_id (id, name, code, safety_stock),
          inventory:inventory (
            quantity, last_sync_at,
            warehouse:warehouse_id (id, name, country, type)
          )
        )
      `)
      .eq('user_id', userId)
      .eq('preference_type', 'favorited');

    // 查询失败 → 抛出错误，由调用方处理
    if (error) {
      throw new PreferenceError('DB_ERROR', `查询关注列表失败: ${error.message}`);
    }

    // null/undefined data 视为空列表（用户无关注）
    if (!data || data.length === 0) return [];

    const results: FollowedVariantBasic[] = [];
    for (const f of data) {
      const variant = unwrapJoin<{ id: string; country: string; product: unknown; inventory: unknown }>(f.variant);
      if (!variant) continue;
      const product = unwrapJoin<{ id: string; name: string; code: string; safety_stock: number }>(variant.product);
      if (!product) continue;
      const inventoryRows = (variant.inventory ?? []) as unknown as InventoryJoinRow[];

      for (const inv of inventoryRows) {
        const wh = unwrapJoin<{ id: string; name: string; country: string; type: string }>(inv.warehouse);
        if (!wh) continue;

        const safetyStock = product.safety_stock ?? 0;
        const isLow = inv.quantity < safetyStock;  // 阶段 B 临时规则

        results.push({
          variantId: variant.id,
          productName: product.name,
          productCode: product.code,
          country: variant.country,
          warehouseId: wh.id,
          warehouseName: wh.name,
          quantity: inv.quantity,
          safetyStock,
          isLowStock: isLow,
          alertReason: isLow ? `低于安全线 ${safetyStock}` : null,
        });
      }
    }

    // 低库存行置顶
    results.sort((a, b) => Number(b.isLowStock) - Number(a.isLowStock));
    return results;
  },

  // ─── 内部工具 ──────────────────────────────────────────────────────

  /** 校验 variantId 是否对应真实 ProductVariant */
  async _variantExists(variantId: string): Promise<boolean> {
    if (!validateUUID(variantId)) return false;

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('product_variant')
      .select('id')
      .eq('id', variantId)
      .maybeSingle();
    if (error) throw new PreferenceError('DB_ERROR', `校验 SKU 失败: ${error.message}`);
    return !!data;
  },
};
