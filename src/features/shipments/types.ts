// 物流模块类型
import type { Database } from '@/types/database';
import type { PaginationParams } from '@/types/common';

export type ShipmentRow = Database['public']['Tables']['shipment']['Row'];
export type ShipmentInsert = Database['public']['Tables']['shipment']['Insert'];
export type ShipmentUpdate = Database['public']['Tables']['shipment']['Update'];

export type ShipmentItemRow = Database['public']['Tables']['shipment_item']['Row'];
export type ShipmentItemInsert = Database['public']['Tables']['shipment_item']['Insert'];

export type TrackingEventRow = Database['public']['Tables']['tracking_event']['Row'];

/** 物流主单列表项（含聚合信息） */
export interface ShipmentListItem {
  id: string;
  shipmentNo: string;
  vesselName: string | null;
  voyageNumber: string | null;
  country: string;
  warehouseName: string | null;
  status: string;
  estimatedArrival: string | null;
  productCount: number;
  totalQuantity: number;
  inTransitQuantity: number;
  /** 聚合品名（从 shipment_item → product_variant.product.name，逗号分隔，最多 3 个） */
  productNames: string | null;
  createdBy: string;
  createdAt: string;
}

/** P3-S2A: 在途列表筛选（URL search params 映射） */
export interface ShipmentListFilters {
  country?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

/** 在途状态（六种） */
export type ShipmentStatus =
  | 'booking'
  | 'loading'
  | 'departed'
  | 'arrived'
  | 'customs'
  | 'warehoused';

/** 物流主单详情 */
export interface ShipmentDetail extends ShipmentRow {
  items: ShipmentItemDetail[];
  events: TrackingEventRow[];
  creatorName: string | null;
  warehouseName: string | null;
}

/** 在途明细 */
export interface ShipmentItemDetail {
  id: string;
  quantity: number;
  warehousedQuantity: number;
  productName: string | null;
  sku: string;
  variantId: string;
}

/** 物流筛选 */
export interface ShipmentFilters extends PaginationParams {
  country?: string;
  status?: string;
}

/** 新建在途表单 */
export interface CreateShipmentData {
  shipmentNo: string;
  vesselName?: string;
  voyageNumber?: string;
  originPort?: string;
  destinationPort?: string;
  country: string;
  warehouseId?: string;
  estimatedArrival?: string;
  note?: string;
  items: { variantId: string; quantity: number }[];
}

/** P3-S2B: 编辑在途基本信息 */
export interface UpdateShipmentData {
  id: string;
  shipmentNo: string;
  vesselName?: string;
  voyageNumber?: string;
  originPort?: string;
  destinationPort?: string;
  country: string;
  warehouseId?: string;
  estimatedArrival?: string;
  note?: string;
}

/** P3-S2B: 手动变更物流状态 */
export interface ChangeStatusData {
  shipmentId: string;
  status: string;
  description?: string;
}

/** P3-S3: Variant 选择器条目 */
export interface VariantSelectorItem {
  id: string;
  sku: string;
  name: string;
  productName: string | null;
  country: string;
}

/** P3-S3: 仓库选择器条目 */
export interface WarehouseSelectorItem {
  id: string;
  name: string;
  country: string;
}
