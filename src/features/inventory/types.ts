// 库存模块类型
import type { Database } from '@/types/database';
import type { PaginationParams } from '@/types/common';

export type InventoryRow = Database['public']['Tables']['inventory']['Row'];
export type InventoryInsert = Database['public']['Tables']['inventory']['Insert'];
export type InventoryUpdate = Database['public']['Tables']['inventory']['Update'];

/** 库存列表项（含关联的产品、SKU、仓库信息） */
export interface InventoryItem {
  id: string;
  variantId: string;
  warehouseId: string;
  quantity: number;
  lastSyncAt: string | null;
  // 关联信息
  productName: string | null;
  productCode: string | null;
  sku: string;
  country: string;
  warehouseName: string;
  warehouseType: string;
  safetyStock: number;
  matchStatus: string;
  /** 当前用户是否已关注此 Variant（P5-SY12，基于 user_variant_preference preference_type='favorited'） */
  isFavorited: boolean;
}

/** 库存筛选条件 */
export interface InventoryFilters extends PaginationParams {
  country?: string;
  warehouseType?: 'domestic' | 'overseas';
  warehouseId?: string;
  stockStatus?: 'normal' | 'low' | 'out_of_stock';
  search?: string;
  /** 当前登录用户 ID（用于按用户归档偏好过滤） */
  userId?: string;
}

/** 库存状态 */
export type StockStatus = 'normal' | 'low' | 'out_of_stock';

/** 海外库存统计 */
export interface OverseasStats {
  totalQuantity: number;
  skuCount: number;
  lowStockCount: number;
  lastSyncAt: string | null;
}

/** 仓库选项（用于筛选下拉） */
export interface WarehouseOption {
  id: string;
  name: string;
  country: string;
}
