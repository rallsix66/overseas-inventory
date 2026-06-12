// 产品模块类型
import type { Database } from '@/types/database';
import type { PaginationParams } from '@/types/common';

// --- 从 Database 类型提取 ---
export type ProductRow = Database['public']['Tables']['product']['Row'];
export type ProductInsert = Database['public']['Tables']['product']['Insert'];
export type ProductUpdate = Database['public']['Tables']['product']['Update'];

// --- 业务类型 ---

/** 产品列表项（含关联 SKU 数） */
export interface ProductItem extends ProductRow {
  /** 关联的 SKU 数量 */
  skuCount: number;
}

/** 库存简要信息（用于产品详情页，避免耦合 inventory 模块类型） */
export interface InventoryBrief {
  id: string;
  sku: string;
  country: string;
  warehouseName: string;
  quantity: number;
  safetyStock: number;
  lastSyncAt: string | null;
}

/** 产品详情（含各仓 SKU 列表与各仓库存） */
export interface ProductDetail extends ProductRow {
  variants: VariantBrief[];
  inventory: InventoryBrief[];
}

/** SKU 简要信息（用于产品详情页） */
export interface VariantBrief {
  id: string;
  sku: string;
  country: string;
  name: string;
  matchStatus: string;
  lastSyncAt: string | null;
}

/** 产品筛选条件 */
export interface ProductFilters extends PaginationParams {
  search?: string;
  isActive?: boolean;
}

/** 产品表单数据 */
export interface ProductFormData {
  code: string;
  name: string;
  safetyStock: number;
  category?: string;
  unit: string;
}
