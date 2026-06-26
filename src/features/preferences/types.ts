// 用户偏好模块类型（归档 + 关注共用 user_variant_preference 表）
//
// P5-SY12: 扩展 preference_type 支持 'favorited'（特别关注阶段 B）
// P5-SY11G: preference_type='archived' 已在阶段 A 实现

// ─── 错误类型 ──────────────────────────────────────────────────────────

export type PreferenceErrorCode =
  | 'VARIANT_NOT_FOUND'   // variantId 对应的 ProductVariant 不存在
  | 'ALREADY_FAVORITED'   // 已关注（幂等）
  | 'NOT_FAVORITED'        // 未关注（取消关注时不存在偏好记录）
  | 'RLS_REJECTED'         // RLS 拒绝写入（用户无权操作该偏好）
  | 'DB_ERROR'             // 未知数据库错误
  | 'EMPTY_RESULT';        // 已关注但 inventory 查询返回空（诊断用）

export class PreferenceError extends Error {
  constructor(
    public readonly code: PreferenceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PreferenceError';
  }
}

export type PreferenceResult<T> =
  | { success: true; data: T }
  | { success: false; error: PreferenceError };

/** 中文错误映射 */
export function preferenceErrorMessage(code: PreferenceErrorCode): string {
  switch (code) {
    case 'VARIANT_NOT_FOUND': return '该 SKU 不存在';
    case 'ALREADY_FAVORITED': return '已关注该 SKU';
    case 'NOT_FAVORITED':      return '未关注该 SKU';
    case 'RLS_REJECTED':       return '无权操作该 SKU';
    case 'DB_ERROR':           return '数据库错误，请稍后重试';
    case 'EMPTY_RESULT':       return '关注数据查询异常，请刷新重试';
  }
}

// ─── Dashboard 关注区类型 ──────────────────────────────────────────────

/**
 * Dashboard 关注产品动态行（阶段 C — 动态告警）
 *
 * 阶段 C 动态告警规则：
 *   critical: estimatedDays < leadTimeDays（可售天数低于补货周期）
 *   warning: quantity < safetyStock（低于安全线，仅已匹配 Product 判定）
 *   两者同时满足 → critical 优先
 *   unknown: 未匹配 Product 且 dailySales 或 estimatedDays 缺失
 *   其余 → normal
 *
 * P5-SY12C: 新增 dailySales / estimatedDays / leadTimeDays / alertLevel / alertReason
 */
export interface FollowedVariantBasic {
  variantId: string;
  productName: string;         // product?.name ?? variant.sku ?? '未匹配产品'
  productCode: string;         // product?.code ?? variant.sku ?? ''
  sku: string;                 // variant.sku（product 为空时用于展示 fallback）
  matchStatus: string;         // variant.match_status（前端判断未匹配状态）
  isUnmatched: boolean;        // product 为空 = variant 未匹配到 Product
  country: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
  safetyStock: number;         // product?.safety_stock ?? 0（无 product 时为 0）
  dailySales: number | null;   // BigSeller 预测日销量（inventory.daily_sales）
  estimatedDays: number | null;// BigSeller 预计可售天数（inventory.estimated_days）
  leadTimeDays: number | null; // 仓库补货周期天（warehouse.lead_time_days）
  alertLevel: 'critical' | 'warning' | 'normal' | 'unknown';
  alertReason: string | null;  // 中文告警原因，normal 时为 null
}
