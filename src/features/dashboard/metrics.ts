import type { InTransitDetail } from '@/features/shipments/types';
import type { SyncWarehouseOverviewItem } from '@/features/sync/types';

export interface InTransitKpis {
  activeInTransitQuantity: number;
  activeInTransitSkuCount: number;
  activeInTransitShipmentCount: number;
  future7dArrivalCount: number;
}

function addUtcDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function aggregateInTransitKpis(
  rows: InTransitDetail[],
  today: string,
): InTransitKpis {
  const variants = new Set<string>();
  const shipments = new Set<string>();
  const futureShipments = new Set<string>();
  const endDate = addUtcDays(today, 7);
  let activeInTransitQuantity = 0;

  for (const row of rows) {
    activeInTransitQuantity += row.remainingQuantity;
    variants.add(row.variantId);
    shipments.add(row.shipmentId);
    if (
      ['departed', 'arrived', 'customs'].includes(row.status)
      && row.estimatedArrival >= today
      && row.estimatedArrival <= endDate
    ) {
      futureShipments.add(row.shipmentId);
    }
  }

  return {
    activeInTransitQuantity,
    activeInTransitSkuCount: variants.size,
    activeInTransitShipmentCount: shipments.size,
    future7dArrivalCount: futureShipments.size,
  };
}

export function countSyncErrors(rows: SyncWarehouseOverviewItem[]): number {
  return rows.filter(
    (row) =>
      row.latestDryRun?.status === 'failed'
      || row.latestRealWrite?.status === 'failed',
  ).length;
}
