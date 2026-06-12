// 物流模块数据访问层 — 封装 shipment / shipment_item / tracking_event 查询
import { createClient } from '@/lib/supabase/server';
import { unwrapJoin } from '@/lib/supabase/helpers';
import type {
  ShipmentListItem,
  ShipmentDetail,
  ShipmentFilters,
  CreateShipmentData,
} from './types';
import type { PaginatedResult } from '@/types/common';

const PAGE_SIZE = 20;

export const shipmentRepository = {
  /** 在途列表（不含 warehoused） */
  async list(filters: ShipmentFilters = {}): Promise<PaginatedResult<ShipmentListItem>> {
    const supabase = await createClient();
    const { country, status, page = 1, pageSize = PAGE_SIZE } = filters;

    let query = supabase
      .from('shipment')
      .select(
        `id, vessel_name, voyage_number, country, status, estimated_arrival, created_by, created_at,
         items:shipment_item (quantity, warehoused_quantity)`,
        { count: 'exact' }
      )
      .neq('status', 'warehoused');

    if (country) query = query.eq('country', country);
    if (status) query = query.eq('status', status);

    const from = (page - 1) * pageSize;
    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);

    if (error || !data) {
      return { data: [], total: 0, page, pageSize };
    }

    return {
      data: data.map((row) => {
        const items = (row.items as unknown as { quantity: number; warehoused_quantity: number }[]) ?? [];
        return {
          id: row.id,
          vesselName: row.vessel_name,
          voyageNumber: row.voyage_number,
          country: row.country,
          status: row.status,
          estimatedArrival: row.estimated_arrival,
          productCount: items.length,
          totalQuantity: items.reduce((sum, i) => sum + i.quantity, 0),
          inTransitQuantity: items.reduce((sum, i) => sum + (i.quantity - i.warehoused_quantity), 0),
          createdBy: row.created_by,
          createdAt: row.created_at,
        };
      }),
      total: count ?? 0,
      page,
      pageSize,
    };
  },

  /** 物流单详情 */
  async getById(id: string): Promise<ShipmentDetail | null> {
    const supabase = await createClient();

    // 主单
    const { data: shipment, error } = await supabase
      .from('shipment')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !shipment) return null;

    // 明细 + 关联产品
    const { data: items } = await supabase
      .from('shipment_item')
      .select(
        `id, quantity, warehoused_quantity, variant_id,
         variant:variant_id (sku, product:product_id (name))`
      )
      .eq('shipment_id', id);

    // 物流事件
    const { data: events } = await supabase
      .from('tracking_event')
      .select('*')
      .eq('shipment_id', id)
      .order('occurred_at', { ascending: false });

    // 创建人
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', shipment.created_by)
      .single();

    return {
      ...shipment,
      items: (items ?? []).map((item) => {
        const variant = unwrapJoin<{ sku: string; product: unknown }>(item.variant);
        const product = unwrapJoin<{ name: string }>(variant?.product);
        return {
          id: item.id,
          quantity: item.quantity,
          warehousedQuantity: item.warehoused_quantity,
          productName: product?.name ?? null,
          sku: variant?.sku ?? '',
          variantId: item.variant_id,
        };
      }),
      events: events ?? [],
      creatorName: profile?.display_name ?? null,
    };
  },

  /** 创建在途记录（数据库事务，三步原子写入，created_by 由 auth.uid() 确定） */
  async create(data: CreateShipmentData): Promise<string | null> {
    const supabase = await createClient();

    const itemsJson = data.items.map((item) => ({
      variant_id: item.variantId,
      quantity: item.quantity,
    }));

    const { data: shipmentId, error } = await supabase.rpc(
      'create_shipment_transactional',
      {
        p_vessel_name: data.vesselName ?? null,
        p_voyage_number: data.voyageNumber ?? null,
        p_origin_port: data.originPort ?? null,
        p_destination_port: data.destinationPort ?? null,
        p_country: data.country,
        p_warehouse_id: data.warehouseId ?? null,
        p_estimated_arrival: data.estimatedArrival ?? null,
        p_note: data.note ?? null,
        p_items: itemsJson,
      }
    );

    if (error || !shipmentId) return null;
    return shipmentId;
  },

  /** 推进物流状态 */
  async advanceStatus(
    shipmentId: string,
    nextStatus: string,
    userId: string,
    description?: string
  ): Promise<boolean> {
    const supabase = await createClient();

    // 更新主单状态
    const { error } = await supabase
      .from('shipment')
      .update({ status: nextStatus })
      .eq('id', shipmentId);

    if (error) return false;

    // 推进到 warehoused 时，更新 shipment_item.warehoused_quantity = quantity
    if (nextStatus === 'warehoused') {
      // 查询所有明细的 quantity
      const { data: items } = await supabase
        .from('shipment_item')
        .select('id, quantity')
        .eq('shipment_id', shipmentId);

      if (items) {
        for (const item of items) {
          await supabase
            .from('shipment_item')
            .update({ warehoused_quantity: item.quantity })
            .eq('id', item.id);
        }
      }
    }

    // 创建 tracking_event
    const statusLabel: Record<string, string> = {
      loading: '装柜',
      departed: '离港',
      arrived: '到港',
      customs: '清关',
      warehoused: '入仓',
    };

    await supabase.from('tracking_event').insert({
      shipment_id: shipmentId,
      status: nextStatus,
      description: description ?? statusLabel[nextStatus] ?? nextStatus,
      occurred_at: new Date().toISOString(),
      created_by: userId,
    });

    return true;
  },
};
