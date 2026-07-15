export interface WarehouseReplenishmentParams {
  id: string;
  name: string;
  country: string;
  leadTimeDays: number | null;
  bufferRatio: number;
  targetCoverMultiplier: number;
  updatedAt: string;
}

