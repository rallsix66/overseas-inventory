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
import { warehouseAccessRepository } from '@/features/warehouse-access/repository';
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
   * 获取当前用户关注 Variant 的库存视图（阶段 C — 动态告警）。
   *
   * 阶段 C 动态告警规则：
   *   critical: estimatedDays != null && leadTimeDays != null && estimatedDays < leadTimeDays
   *   warning:  isUnmatched === false && quantity < safetyStock
   *   两者同时满足 → critical 优先
   *   unknown:  isUnmatched && (dailySales == null || estimatedDays == null)
   *   其余 → normal
   *
   * 排序：critical → warning → normal/unknown，同级内 estimatedDays asc（null 最后），quantity asc
   *
   * 查询失败时抛出 PreferenceError（不静默返回 []）。
   * 仅当用户确实没有关注任何 Variant 时才返回 []。
   */
  async getFollowedVariantsBasic(userId: string): Promise<FollowedVariantBasic[]> {
    if (!validateUUID(userId)) return [];

    const supabase = await createClient();

    // 步骤 1：读取当前用户 favorited variant_id 集合
    const favoritedVariantIds = await this.getFavoritedVariantIds(userId);
    if (favoritedVariantIds.size === 0) return [];

    // 步骤 2：从 inventory 正向查询这些 variant 的库存行（join variant/product/warehouse）
    // P5-SY12C: 新增 daily_sales, estimated_days, lead_time_days
    const query = supabase
      .from('inventory')
      .select(
        `id, variant_id, warehouse_id, quantity, daily_sales, estimated_days, last_sync_at,
         variant:variant_id!inner (id, sku, match_status, country, product:product_id (id, name, code, safety_stock)),
         warehouse:warehouse_id!inner (id, name, country, type, lead_time_days)`
      )
      .in('variant_id', [...favoritedVariantIds])
      .eq('warehouse.type', 'overseas')
      .order('quantity', { ascending: true });

    const { data, error } = await query;

    if (error) {
      throw new PreferenceError('DB_ERROR', `查询关注列表失败: ${error.message}`);
    }

    // 用户有 favorited 但 inventory 查询返回空 → 诊断错误
    if (!data || data.length === 0) {
      throw new PreferenceError(
        'EMPTY_RESULT',
        `已关注 ${favoritedVariantIds.size} 个 SKU 但未找到对应库存记录，请确认对应 variant 在 inventory 表中存在且 warehouse.type = 'overseas'`
      );
    }

    // P5-SY13A: 获取已分配仓库 ID 集合
    const accessibleWhIds = await warehouseAccessRepository.getAccessibleWarehouseIds(userId);

    const ALERT_ORDER: Record<string, number> = {
      critical: 0,
      warning: 1,
      unknown: 2,
      normal: 2,
    };

    const results: FollowedVariantBasic[] = [];
    for (const row of data as unknown[]) {
      const r = row as Record<string, unknown>;
      const variant = unwrapJoin<{ id: string; sku: string; match_status: string; country: string; product: unknown }>(r.variant);
      if (!variant) continue;
      const product = unwrapJoin<{ id: string; name: string; code: string; safety_stock: number } | null>(variant.product);
      const wh = unwrapJoin<{ id: string; name: string; country: string; type: string; lead_time_days: number | null }>(r.warehouse);

      // P5-SY13A: 仅返回当前用户可访问仓库的关注项（空分配→无结果）
      const whId = wh?.id ?? (r.warehouse_id as string | undefined);
      if (whId && !accessibleWhIds.has(whId)) continue;

      const productName = product?.name ?? variant.sku ?? '未匹配产品';
      const productCode = product?.code ?? variant.sku ?? '';
      const safetyStock = product?.safety_stock ?? 0;
      const qty = (r.quantity as number) ?? 0;
      const dailySales = (r.daily_sales as number | null) ?? null;
      const estimatedDays = (r.estimated_days as number | null) ?? null;
      const leadTimeDays = wh?.lead_time_days ?? null;

      // ─── 阶段 C 动态告警计算 ──────────────────────────────────────
      let alertLevel: FollowedVariantBasic['alertLevel'] = 'normal';
      let alertReason: string | null = null;

      const isCritical =
        estimatedDays != null &&
        leadTimeDays != null &&
        estimatedDays < leadTimeDays;
      const isLowStock = product ? qty < safetyStock : false;
      const isDataInsufficient =
        !product &&
        (dailySales == null || estimatedDays == null);

      if (isCritical) {
        alertLevel = 'critical';
        alertReason = `可售天数(${estimatedDays})低于补货周期(${leadTimeDays}天)`;
      } else if (isLowStock) {
        alertLevel = 'warning';
        alertReason = `低于安全线 ${safetyStock}`;
      } else if (isDataInsufficient) {
        alertLevel = 'unknown';
        alertReason = '数据不足';
      } else {
        alertLevel = 'normal';
        alertReason = null;
      }

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
        dailySales,
        estimatedDays,
        leadTimeDays,
        alertLevel,
        alertReason,
        inTransitQuantity: 0,
      });
    }

    // 防御：inventory 返回了行但全部被跳过
    if (results.length === 0) {
      throw new PreferenceError(
        'EMPTY_RESULT',
        `已关注 ${favoritedVariantIds.size} 个 SKU 但处理后无有效结果，请确认 variant 数据完整性`
      );
    }

    // 排序：critical → warning → normal/unknown，同级 estimatedDays asc（null 最后），quantity asc
    results.sort((a, b) => {
      const orderA = ALERT_ORDER[a.alertLevel];
      const orderB = ALERT_ORDER[b.alertLevel];
      if (orderA !== orderB) return orderA - orderB;

      // 同级内 estimatedDays 升序，null 排最后
      const edA = a.estimatedDays;
      const edB = b.estimatedDays;
      if (edA == null && edB == null) return a.quantity - b.quantity;
      if (edA == null) return 1;
      if (edB == null) return -1;
      if (edA !== edB) return edA - edB;

      return a.quantity - b.quantity;
    });
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
