// SKU (ProductVariant) 模块类型
import type { Database } from '@/types/database';
import type { PaginationParams } from '@/types/common';

export type VariantRow = Database['public']['Tables']['product_variant']['Row'];
export type VariantInsert = Database['public']['Tables']['product_variant']['Insert'];
export type VariantUpdate = Database['public']['Tables']['product_variant']['Update'];

/** SKU 列表项（含关联的标准产品名） */
export interface VariantItem extends VariantRow {
  /** 关联的标准产品名称（通过 product_id join） */
  productName: string | null;
  /** 关联的标准产品编码 */
  productCode: string | null;
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
}

/** SKU 匹配表单 */
export interface VariantMatchData {
  variantId: string;
  productId: string;
}
