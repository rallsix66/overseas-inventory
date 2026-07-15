import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { WarehouseReplenishmentParams } from './types';

export class WarehouseError extends Error {
  constructor(
    message: string,
    public code: 'NOT_FOUND' | 'VALIDATION' | 'DB_ERROR',
  ) {
    super(message);
    this.name = 'WarehouseError';
  }
}

function mapWarehouse(row: {
  id: string;
  name: string;
  country: string;
  lead_time_days: number | null;
  buffer_ratio: number;
  target_cover_multiplier: number;
  updated_at: string;
}): WarehouseReplenishmentParams {
  return {
    id: row.id,
    name: row.name,
    country: row.country,
    leadTimeDays: row.lead_time_days,
    bufferRatio: row.buffer_ratio,
    targetCoverMultiplier: row.target_cover_multiplier,
    updatedAt: row.updated_at,
  };
}

export const warehouseRepository = {
  async listReplenishmentParams(): Promise<WarehouseReplenishmentParams[]> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('warehouse')
      .select(
        'id, name, country, lead_time_days, buffer_ratio, target_cover_multiplier, updated_at',
      )
      .eq('type', 'overseas')
      .eq('is_active', true)
      .order('country')
      .order('name');

    if (error) {
      throw new WarehouseError('查询仓库补货参数失败', 'DB_ERROR');
    }
    return (data ?? []).map(mapWarehouse);
  },

  async updateReplenishmentParams(
    warehouseId: string,
    bufferRatio: number,
    targetCoverMultiplier: number,
  ): Promise<WarehouseReplenishmentParams> {
    const supabase = await createClient();
    const { data: existing, error: existingError } = await supabase
      .from('warehouse')
      .select('id, type, is_active')
      .eq('id', warehouseId)
      .single();

    if (existingError || !existing) {
      throw new WarehouseError('仓库不存在或无权访问', 'NOT_FOUND');
    }
    if (!existing.is_active || existing.type !== 'overseas') {
      throw new WarehouseError('只能修改启用中的海外仓参数', 'VALIDATION');
    }

    const { data, error } = await supabase
      .from('warehouse')
      .update({
        buffer_ratio: bufferRatio,
        target_cover_multiplier: targetCoverMultiplier,
      })
      .eq('id', warehouseId)
      .eq('is_active', true)
      .eq('type', 'overseas')
      .select(
        'id, name, country, lead_time_days, buffer_ratio, target_cover_multiplier, updated_at',
      )
      .single();

    if (error || !data) {
      throw new WarehouseError('更新仓库补货参数失败', 'DB_ERROR');
    }
    if (
      data.buffer_ratio !== bufferRatio
      || data.target_cover_multiplier !== targetCoverMultiplier
    ) {
      throw new WarehouseError('仓库补货参数写后校验失败', 'DB_ERROR');
    }
    return mapWarehouse(data);
  },
};

