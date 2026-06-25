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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUUID(id: string): boolean {
  return UUID_RE.test(id);
}

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

    // 步骤 1：读取当前用户 favorited variant_id 集合
    const favoritedVariantIds = await this.getFavoritedVariantIds(userId);
    if (favoritedVariantIds.size === 0) return [];

    // 步骤 2：从 inventory 正向查询这些 variant 的库存行（join variant/product/warehouse）
    // 使用与 getOverseasList 一致的查询模式：mutable chain + eq + order
    // 关注区显示所有 favorited variant（不排除同时 archived 的）
    // warehouse.type = 'overseas' 过滤与 getOverseasList 保持一致
    const query = supabase
      .from('inventory')
      .select(
        `id, variant_id, warehouse_id, quantity, last_sync_at,
         variant:variant_id!inner (id, sku, match_status, country, product:product_id (id, name, code, safety_stock)),
         warehouse:warehouse_id!inner (id, name, country, type)`
      )
      .in('variant_id', [...favoritedVariantIds])
      .eq('warehouse.type', 'overseas')
      .order('quantity', { ascending: true });

    const { data, error } = await query;

    if (error) {
      throw new PreferenceError('DB_ERROR', `查询关注列表失败: ${error.message}`);
    }

    // 用户有 favorited 但 inventory 查询返回空 → 诊断错误（不静默伪装成"暂无关注产品"）
    if (!data || data.length === 0) {
      throw new PreferenceError(
        'EMPTY_RESULT',
        `已关注 ${favoritedVariantIds.size} 个 SKU 但未找到对应库存记录，请确认对应 variant 在 inventory 表中存在且 warehouse.type = 'overseas'`
      );
    }

    const results: FollowedVariantBasic[] = [];
    for (const row of data as unknown[]) {
      const r = row as Record<string, unknown>;
      const variant = unwrapJoin<{ id: string; sku: string; match_status: string; country: string; product: unknown }>(r.variant);
      if (!variant) continue;
      const product = unwrapJoin<{ id: string; name: string; code: string; safety_stock: number } | null>(variant.product);
      const wh = unwrapJoin<{ id: string; name: string; country: string; type: string }>(r.warehouse);

      // product 为空时使用 variant.sku fallback，不丢弃关注项
      const productName = product?.name ?? variant.sku ?? '未匹配产品';
      const productCode = product?.code ?? variant.sku ?? '';
      const safetyStock = product?.safety_stock ?? 0;
      const qty = (r.quantity as number) ?? 0;
      // 仅 product 存在时才按阶段 B 规则判断低库存；未匹配 SKU 不误判为低库存
      const isLow = product ? qty < safetyStock : false;

      results.push({
        variantId: variant.id,
        productName,
        productCode,
        sku: variant.sku,
        matchStatus: variant.match_status,
        isUnmatched: !product,
        country: variant.country,
        warehouseId: wh?.id ?? (r.warehouse_id as string),
        warehouseName: wh?.name ?? '未知仓库',
        quantity: qty,
        safetyStock,
        isLowStock: isLow,
        alertReason: isLow ? `低于安全线 ${safetyStock}` : null,
      });
    }

    // 防御：inventory 返回了行但全部被跳过（理论上不应发生，但保留诊断）
    if (results.length === 0) {
      throw new PreferenceError(
        'EMPTY_RESULT',
        `已关注 ${favoritedVariantIds.size} 个 SKU 但处理后无有效结果，请确认 variant 数据完整性`
      );
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
