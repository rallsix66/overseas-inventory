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
  // 关联信息 — 字段语义（P6-UX-V2-D 修正）：
  //   variantName        = product_variant.name  → BigSeller 原始品名（海外库存主品名）
  //   standardProductName = product.name         → DIS 标准产品名（绑定辅助信息）
  //   standardProductCode = product.code         → DIS 标准产品编码（绑定辅助信息）
  //   productName / productCode 保持向后兼容：productName=variantName, productCode=standardProductCode
  /** BigSeller 原始商品名（来自 product_variant.name），用作海外库存主品名 */
  variantName: string | null;
  /** DIS 标准产品名称（来自 product.name），绑定成功后展示为辅助信息 */
  standardProductName: string | null;
  /** DIS 标准产品编码（来自 product.code），绑定成功后展示为辅助信息 */
  standardProductCode: string | null;
  /** @deprecated 使用 variantName；保留兼容，值等同于 variantName */
  productName: string | null;
  /** @deprecated 使用 standardProductCode；保留兼容，值等同于 standardProductCode */
  productCode: string | null;
  sku: string;
  country: string;
  warehouseName: string;
  warehouseType: string;
  safetyStock: number;
  matchStatus: string;
  /** 当前用户是否已关注此 Variant（P5-SY12，基于 user_variant_preference preference_type='favorited'） */
  isFavorited: boolean;
  /** P3-S2C: 该 Variant 的聚合在途数量（shipment_item.quantity - warehoused_quantity，不含 warehoused 状态） */
  inTransitQuantity: number;
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
  /** P3-S2C: 内部在途 SKU 数（shipment_item 聚合，不含 warehoused） */
  inTransitSkuCount: number;
  /** P3-S2C: 内部在途总量（shipment_item 聚合，不含 warehoused） */
  inTransitTotalQuantity: number;
}

/** 仓库选项（用于筛选下拉） */
export interface WarehouseOption {
  id: string;
  name: string;
  country: string;
}
