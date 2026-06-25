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
 * Dashboard 关注产品动态行（阶段 B）
 *
 * 阶段 B 临时告警：quantity < product.safety_stock（非动态告警）。
 * 阶段 C 升级为动态告警（est_days < lead_time_days）。
 * 阶段 B 不新增 daily_sales / est_days / lead_time_days 字段。
 */
export interface FollowedVariantBasic {
  variantId: string;
  productName: string;
  productCode: string;
  country: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
  safetyStock: number;         // product.safety_stock（阶段 B 唯一告警依据）
  isLowStock: boolean;         // 临时规则：quantity < safetyStock（非动态告警，不是 bug）
  alertReason: string | null;  // "低于安全线 X"（阶段 C 升级为 "可售X天 补货需Y天"）
}
