export type StockoutUrgency = 'critical' | 'warning' | 'ok' | 'data_incomplete';
export type BaseStockStatus = 'out_of_stock' | 'unmatched' | 'low' | 'normal';
export type DomesticStatus = 'data_unavailable';

export interface ProductOverviewInbound {
  eta: string | null;
  quantity: number;
}

export interface ProductOverviewWarehouse {
  warehouseId: string;
  warehouseName: string;
  country: string;
  onHand: number;
  dailySales: number | null;
  inbound: ProductOverviewInbound[];
  baseStockStatus: BaseStockStatus;
}

export interface ProductOverviewRow {
  variantId: string;
  productId: string | null;
  sku: string;
  variantCountry: string;
  productName: string | null;
  variantName: string;
  perWarehouse: ProductOverviewWarehouse[];
  visibleOnHand: number;
  visibleInboundQuantity: number;
  effectiveInbound: number;
  etaMissingQuantity: number;
  visibleTotalQuantity: number;
  baseStockStatus: BaseStockStatus;
  earliestStockout: string | null;
  stockoutUrgency: StockoutUrgency;
  partialData: boolean;
  domesticStatus: DomesticStatus;
}

export interface ProductOverviewQueueCounts {
  critical: number;
  warning: number;
  ok: number;
  dataIncomplete: number;
}

export interface ProductOverviewParams {
  page?: number;
  pageSize?: number;
  search?: string;
  stockoutUrgency?: StockoutUrgency;
  country?: string;
}

export interface ProductOverviewResult {
  items: ProductOverviewRow[];
  totalCount: number;
  queueCounts: ProductOverviewQueueCounts;
  page: number;
  pageSize: number;
}

export interface AssignedWarehouseDetail {
  warehouseId: string;
  warehouseName: string;
  country: string;
  onHand: number;
  dailySales: number | null;
  inbound: ProductOverviewInbound[];
  visibleInboundQuantity: number;
  etaMissingQuantity: number;
  estStockoutDate: string | null;
  effectiveInbound: number;
  baseStockStatus: BaseStockStatus;
  safetyStock: number | null;
  targetStock: number | null;
  netDemand: number;
  suggestQty: number;
  latestOrderDate: string | null;
  replenishmentUrgency: StockoutUrgency;
}

export interface ProductOverviewCountryAggregate {
  country: string;
  onHand: number;
  dailySales: number | null;
  visibleInboundQuantity: number;
  etaMissingQuantity: number;
  earliestStockout: string | null;
}

export interface ProductVariantDetail {
  variantId: string;
  productId: string | null;
  sku: string;
  variantCountry: string;
  productName: string | null;
  variantName: string;
  visibleOnHand: number;
  visibleInboundQuantity: number;
  effectiveInbound: number;
  etaMissingQuantity: number;
  visibleTotalQuantity: number;
  earliestStockout: string | null;
  stockoutUrgency: StockoutUrgency;
  partialData: boolean;
  domesticStatus: DomesticStatus;
  assignedWarehouseDetail: AssignedWarehouseDetail[];
  countryAgg: ProductOverviewCountryAggregate[];
}

export interface ProductOverviewRepository {
  getProductOverview(
    userId: string,
    params: ProductOverviewParams,
  ): Promise<ProductOverviewResult>;
  getProductVariantDetail(userId: string, variantId: string): Promise<ProductVariantDetail>;
}
