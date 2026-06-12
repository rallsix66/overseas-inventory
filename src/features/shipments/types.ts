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
  vesselName: string | null;
  voyageNumber: string | null;
  country: string;
  status: string;
  estimatedArrival: string | null;
  productCount: number;
  totalQuantity: number;
  inTransitQuantity: number;
  createdBy: string;
  createdAt: string;
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
