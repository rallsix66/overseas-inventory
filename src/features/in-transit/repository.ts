// 外部物流模块数据访问层
// P0: 新增 golucky (喜运达) provider 支持
//
// 所有查询方法接受可选的 SupabaseClient 参数：
//   - 不传 → 使用用户会话客户端（createClient，含 RLS）
//   - 传入 service_role 客户端 → 绕过 RLS（仅 cron / 服务端同步任务）
import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type {
  ShipmentBindingCandidate,
  ShipmentExternalRefRow,
  TrackingEventExternalRow,
} from './types';
import type { PostgrestError } from '@supabase/supabase-js';

export type ExternalRefWithTracking = ShipmentExternalRefRow & {
  events: TrackingEventExternalRow[];
};

export class ExternalTrackingError extends Error {
  constructor(
    message: string,
    public code: 'NOT_FOUND' | 'DB_ERROR' | 'FORBIDDEN' | 'VALIDATION',
  ) {
    super(message);
    this.name = 'ExternalTrackingError';
  }
}

function handlePgError(error: PostgrestError | null, message: string): void {
  if (error) {
    throw new ExternalTrackingError(`${message}: ${error.message}`, 'DB_ERROR');
  }
}

type DbClient = SupabaseClient<Database>;

export const externalTrackingRepository = {
  /** P0: 按 provider 查询 active 外部物流记录 */
  async getExternalRefsByProvider(
    provider: string,
    db?: DbClient,
  ): Promise<ShipmentExternalRefRow[]> {
    const supabase = db ?? await createClient();
    const { data, error } = await supabase
      .from('shipment_external_ref')
      .select('*')
      .eq('provider', provider)
      .eq('sync_status', 'active');

    handlePgError(error, '查询外部物流记录失败');
    return data ?? [];
  },

  /** P0: Upsert 喜运达轨迹事件（按 external_event_id 去重） */
  async upsertGoluckyEvents(
    externalRefId: string,
    provider: string,
    events: Array<{
      externalEventId: string;
      externalCategory: string;
      status: string;
      description: string;
      occurredAt: string;
      rawPayload: Record<string, unknown>;
    }>,
    db?: DbClient,
  ): Promise<{ inserted: number; skipped: number }> {
    if (events.length === 0) {
      return { inserted: 0, skipped: 0 };
    }

    const supabase = db ?? await createClient();
    let inserted = 0;
    let skipped = 0;

    for (const event of events) {
      const { error } = await supabase
        .from('tracking_event_external')
        .upsert(
          {
            external_ref_id: externalRefId,
            provider,
            external_event_id: event.externalEventId,
            external_category: event.externalCategory,
            status: event.status,
            description: event.description,
            occurred_at: event.occurredAt,
            raw_payload: event.rawPayload,
          },
          {
            onConflict: 'external_ref_id,external_event_id',
            ignoreDuplicates: true,
          },
        );

      if (error) {
        // 唯一约束冲突 → 已存在，跳过
        if (error.code === '23505') {
          skipped++;
          continue;
        }
        throw new ExternalTrackingError(`写入轨迹事件失败: ${error.message}`, 'DB_ERROR');
      }

      inserted++;
    }

    return { inserted, skipped };
  },

  /** P0: 更新外部物流记录的同步状态 */
  async updateExternalRefSync(
    refId: string,
    syncStatus: 'active' | 'stale' | 'error',
    lastSyncedAt?: string,
    rawPayload?: Record<string, unknown>,
    db?: DbClient,
  ): Promise<void> {
    const supabase = db ?? await createClient();

    const { error } = await supabase
      .from('shipment_external_ref')
      .update({
        sync_status: syncStatus,
        last_synced_at: lastSyncedAt ?? new Date().toISOString(),
        ...(rawPayload ? { raw_payload: rawPayload } : {}),
      })
      .eq('id', refId);

    handlePgError(error, '更新外部物流记录同步状态失败');
  },

  /** P0: 按 shipment_id 查询绑定的外部轨迹（供详情页展示） */
  async getExternalTrackingByShipment(
    shipmentId: string,
  ): Promise<ExternalRefWithTracking[]> {
    const supabase = await createClient();

    const { data: refs, error: refError } = await supabase
      .from('shipment_external_ref')
      .select('*')
      .eq('shipment_id', shipmentId);

    handlePgError(refError, '查询外部物流记录失败');

    if (!refs || refs.length === 0) {
      return [];
    }

    const result: ExternalRefWithTracking[] = [];

    for (const ref of refs) {
      const { data: events, error: eventsError } = await supabase
        .from('tracking_event_external')
        .select('*')
        .eq('external_ref_id', ref.id)
        .order('occurred_at', { ascending: true });

      handlePgError(eventsError, '查询外部轨迹失败');

      result.push({
        ...ref,
        events: events ?? [],
      });
    }

    return result;
  },

  /** P0: 查询未绑定的外部物流记录列表 */
  async listUnboundExternalRefs(
    provider?: string,
  ): Promise<ShipmentExternalRefRow[]> {
    const supabase = await createClient();

    let query = supabase
      .from('shipment_external_ref')
      .select('*')
      .is('shipment_id', null);

    if (provider) {
      query = query.eq('provider', provider);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    handlePgError(error, '查询未绑定外部物流记录失败');
    return data ?? [];
  },

  /** P0: 查询与未绑定喜运达记录仓库、国家一致的 Shipment 候选。 */
  async listShipmentBindingCandidates(
    refId: string,
  ): Promise<ShipmentBindingCandidate[]> {
    const supabase = await createClient();

    const { data: ref, error: refError } = await supabase
      .from('shipment_external_ref')
      .select('id, provider, country, warehouse_id, shipment_id')
      .eq('id', refId)
      .eq('provider', 'golucky')
      .single();

    if (refError) {
      if (refError.code === 'PGRST116') {
        throw new ExternalTrackingError('喜运达外部物流记录不存在或无权访问', 'NOT_FOUND');
      }
      throw new ExternalTrackingError(`查询喜运达外部物流记录失败: ${refError.message}`, 'DB_ERROR');
    }

    if (ref.shipment_id) {
      throw new ExternalTrackingError('该外部物流记录已绑定 Shipment', 'VALIDATION');
    }

    if (!ref.warehouse_id) {
      return [];
    }

    const { data, error } = await supabase
      .from('shipment')
      .select(
        'id, shipment_no, purchase_order_no, country, warehouse_id, status, estimated_arrival, created_at',
      )
      .eq('warehouse_id', ref.warehouse_id)
      .eq('country', ref.country)
      .order('created_at', { ascending: false })
      .limit(100);

    handlePgError(error, '查询可绑定 Shipment 失败');

    return (data ?? []).map((shipment) => ({
      id: shipment.id,
      shipmentNo: shipment.shipment_no,
      purchaseOrderNo: shipment.purchase_order_no,
      country: shipment.country,
      warehouseId: shipment.warehouse_id,
      status: shipment.status,
      estimatedArrival: shipment.estimated_arrival,
      createdAt: shipment.created_at,
    }));
  },

  /** P0: 查询同步失败的外部物流记录 */
  async listFailedExternalRefs(
    provider?: string,
  ): Promise<ShipmentExternalRefRow[]> {
    const supabase = await createClient();

    let query = supabase
      .from('shipment_external_ref')
      .select('*')
      .eq('sync_status', 'error');

    if (provider) {
      query = query.eq('provider', provider);
    }

    const { data, error } = await query.order('last_synced_at', { ascending: false });

    handlePgError(error, '查询失败记录失败');
    return data ?? [];
  },

  /** P0: 按 ID 获取单条外部物流记录 */
  async getExternalRefById(refId: string): Promise<ShipmentExternalRefRow | null> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('shipment_external_ref')
      .select('*')
      .eq('id', refId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new ExternalTrackingError(`查询外部物流记录失败: ${error.message}`, 'DB_ERROR');
    }

    return data;
  },
};
