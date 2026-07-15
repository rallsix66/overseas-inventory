import { randomUUID } from 'node:crypto';

const COUNTRY_CODES = new Set(['TH', 'ID', 'MY', 'PH', 'VN', 'CN']);

export function normalizeWarehouseCountry(country: string): string {
  const normalized = country.trim().toUpperCase();
  if (!COUNTRY_CODES.has(normalized)) {
    throw new Error('仓库国家不合法，无法生成计划单号');
  }
  return normalized;
}

function formatUtcDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

export function generatePlannedShipmentNo(
  countryCode: string,
  warehouseId: string,
  now: Date = new Date(),
  sequence: string = randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase(),
): string {
  const normalizedCountry = normalizeWarehouseCountry(countryCode);
  const warehouseSegment = warehouseId.replaceAll('-', '').slice(0, 8).toLowerCase();
  const normalizedSequence = sequence.toUpperCase();
  const shipmentNo = `PLN-${normalizedCountry}-${warehouseSegment}-${formatUtcDate(now)}-${normalizedSequence}`;

  if (!/^[A-Za-z0-9_-]+$/.test(shipmentNo) || shipmentNo.length > 50) {
    throw new Error('生成的计划单号不合法');
  }
  return shipmentNo;
}

export function resolvePlannedEstimatedArrival(
  expectedArrivalDate: string | undefined,
  plannedShipDate: string | undefined,
  leadTimeDays: number | null,
): string {
  if (expectedArrivalDate) return expectedArrivalDate;
  if (!plannedShipDate) throw new Error('缺少预计到达日期');
  if (leadTimeDays === null || leadTimeDays <= 0) {
    throw new Error('仓库未配置有效补货周期，无法推算预计到达日');
  }

  const date = new Date(`${plannedShipDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + leadTimeDays);
  return date.toISOString().slice(0, 10);
}
