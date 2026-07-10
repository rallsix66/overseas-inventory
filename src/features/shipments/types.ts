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
  purchaseOrderNo: string | null;
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

/** P3-S4A: 状态流转规则 — 仅允许按顺序推进，warehoused 禁止手动推进 */
export const SHIPMENT_STATUS_FLOW: Record<string, string | null> = {
  booking: 'loading',
  loading: 'departed',
  departed: 'arrived',
  arrived: 'customs',
  customs: null, // 无合法下一状态（warehoused 禁止手动推进）
};

/** P3-S4A: 获取当前状态的下一合法目标状态（null 表示无） */
export function getNextValidStatus(current: string): string | null {
  return SHIPMENT_STATUS_FLOW[current] ?? null;
}

/** P3-S4A: 轨迹事件含创建人姓名 */
export interface TrackingEventDetail {
  id: string;
  shipmentId: string;
  status: string;
  description: string | null;
  occurredAt: string;
  createdBy: string;
  createdAt: string;
  creatorName: string | null;
}

/** 物流主单详情 */
export interface ShipmentDetail extends ShipmentRow {
  items: ShipmentItemDetail[];
  events: TrackingEventDetail[];
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
  purchaseOrderNo?: string;
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
  purchaseOrderNo?: string;
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

/** P3-S5A: 确认入仓参数 */
export interface WarehouseShipmentData {
  shipmentId: string;
  description?: string;
}

/** P3-S5B1: 部分入仓 — 单项明细 */
export interface PartialWarehouseItem {
  variantId: string;
  quantity: number;
}

/** P3-S5B1: 部分/批量确认入仓参数 */
export interface PartialWarehouseShipmentData {
  shipmentId: string;
  items: PartialWarehouseItem[];
  description?: string;
}

/** P3-S5B1: 部分入仓 RPC 返回结果 */
export interface PartialWarehouseResult {
  success: boolean;
  allWarehoused: boolean;
  itemsUpdated: number;
}

/** P3-S2E: 海外库存行展开 — 内部在途明细项 */
export interface InTransitDetailItem {
  shipmentId: string;
  shipmentNo: string;
  purchaseOrderNo: string | null;
  /** 在途数量 = quantity - warehoused_quantity */
  quantity: number;
  /** P3-S2E-EXPAND: 物流状态（shipment.status 原始枚举，组件层映射中文标签；非 warehoused） */
  status: string;
  /** 预计到货时间 */
  estimatedArrival: string | null;
  /** P6-UI-CLARITY: 最近物流更新时间（tracking_event.occurred_at 或 shipment.updated_at，用于展示物流时效） */
  latestTrackingAt: string | null;
}

// ─── P3-S5B2: 批量入仓 / BigSeller 吸收确认 ────────────────────────────────

/** P3-S5B2: 批量入仓 — 单条 entry */
export interface BatchWarehouseEntry {
  shipmentId: string;
  items: PartialWarehouseItem[];
  description?: string;
}

/** P3-S5B2: 批量入仓 — 请求数据 */
export interface BatchWarehouseData {
  shipments: BatchWarehouseEntry[];
}

/** P3-S5B2: 批量入仓 — 单条结果 */
export interface BatchWarehouseItemResult {
  shipmentId: string;
  success: boolean;
  error?: string;
  result?: PartialWarehouseResult;
}

/** P3-S5B2: 批量入仓可选筛选 */
export interface EligibleShipmentFilters {
  country?: string;
  warehouseId?: string;
  page?: number;
  pageSize?: number;
}

/** P3-S5B2: 可批量入仓的 shipment 摘要 */
export interface EligibleShipmentItem {
  id: string;
  shipmentNo: string;
  purchaseOrderNo: string | null;
  vesselName: string | null;
  voyageNumber: string | null;
  country: string;
  warehouseId: string;
  warehouseName: string | null;
  status: string;
  estimatedArrival: string | null;
  /** shipment_item 数量 */
  itemCount: number;
  /** 各 shipment_item 的 quantity 总和 */
  totalQuantity: number;
  /** 剩余在途 = SUM(quantity - warehoused_quantity) */
  remainingQuantity: number;
  /** 聚合品名（最多 3 个） */
  productNames: string | null;
}

/** P3-S5B2: 已确认到仓数量 — 按 warehouse 聚合 */
export interface ConfirmedWarehousedAggregation {
  variantId: string;
  confirmedQuantity: number;
}
