import type { Database } from '@/types/database';

export type ShipmentExternalRefRow = Database['public']['Tables']['shipment_external_ref']['Row'];
export type ShipmentExternalRefInsert = Database['public']['Tables']['shipment_external_ref']['Insert'];
export type ShipmentExternalRefUpdate = Database['public']['Tables']['shipment_external_ref']['Update'];

export type ShipmentExternalItemRow = Database['public']['Tables']['shipment_external_item']['Row'];
export type ShipmentExternalItemInsert = Database['public']['Tables']['shipment_external_item']['Insert'];
export type ShipmentExternalItemUpdate = Database['public']['Tables']['shipment_external_item']['Update'];

export type TrackingEventExternalRow = Database['public']['Tables']['tracking_event_external']['Row'];

export type ExternalProvider = 'best' | 'golucky';

export type ExternalSyncStatus = 'active' | 'stale' | 'error';

/** 外部在途主单详情（含商品明细与轨迹） */
export interface ShipmentExternalRefDetail extends ShipmentExternalRefRow {
  items: ShipmentExternalItemRow[];
  events: TrackingEventExternalRow[];
}

/** 可与未绑定外部物流记录关联的内部 Shipment。 */
export interface ShipmentBindingCandidate {
  id: string;
  shipmentNo: string;
  purchaseOrderNo: string | null;
  country: string;
  warehouseId: string | null;
  status: string;
  estimatedArrival: string | null;
  createdAt: string;
}
