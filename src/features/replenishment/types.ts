export type ReplenishmentUrgency =
  | 'critical'
  | 'warning'
  | 'ok'
  | 'data_incomplete';

export interface ReplenishmentSuggestion {
  variantId: string;
  warehouseId: string;
  sku: string;
  productName: string | null;
  productCode: string | null;
  variantName: string;
  country: string;
  warehouseName: string;
  avgDailySales: number | null;
  leadTime: number | null;
  bufferRatio: number;
  coverMult: number;
  safetyStock: number | null;
  onHand: number;
  effectiveInbound: number;
  targetStock: number | null;
  netDemand: number;
  suggestQty: number;
  estStockoutDate: string | null;
  latestOrderDate: string | null;
  urgency: ReplenishmentUrgency;
}

export interface ReplenishmentFilters {
  variantId?: string;
  warehouseId?: string;
  country?: string;
  urgency?: ReplenishmentUrgency;
  search?: string;
  includeZero?: boolean;
  page?: number;
  pageSize?: number;
}

export interface ReplenishmentResult {
  data: ReplenishmentSuggestion[];
  total: number;
  page: number;
  pageSize: number;
}

export type { InTransitDetail as ReplenishmentInTransitDetail } from '@/features/shipments/types';
