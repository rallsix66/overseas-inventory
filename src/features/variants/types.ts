// SKU (ProductVariant) 模块类型
import type { Database } from '@/types/database';
import type { PaginationParams } from '@/types/common';

export type VariantRow = Database['public']['Tables']['product_variant']['Row'];
export type VariantInsert = Database['public']['Tables']['product_variant']['Insert'];
export type VariantUpdate = Database['public']['Tables']['product_variant']['Update'];

/** 用户 Variant 偏好记录 */
export type UserVariantPreference = Database['public']['Tables']['user_variant_preference']['Row'];

/** SKU 列表项（含关联的标准产品名 + 当前用户归档状态） */
export interface VariantItem extends VariantRow {
  /** 关联的标准产品名称（通过 product_id join） */
  productName: string | null;
  /** 关联的标准产品编码 */
  productCode: string | null;
  /** 当前用户是否已归档此 Variant（基于 user_variant_preference） */
  isArchivedByUser: boolean;
}

/** 归档筛选状态 */
export type VariantArchiveStatus = 'active' | 'archived' | 'all';

/** SKU 筛选条件 */
export interface VariantFilters extends PaginationParams {
  country?: string;
  matchStatus?: string;
  productId?: string;
  search?: string;
  /** 归档筛选：active（默认，仅未归档）| archived（仅已归档）| all（全部） */
  archiveStatus?: VariantArchiveStatus;
  /** 当前登录用户 ID（用于查询个人归档偏好） */
  userId?: string;
}

/** SKU 匹配表单 */
export interface VariantMatchData {
  variantId: string;
  productId: string;
}
