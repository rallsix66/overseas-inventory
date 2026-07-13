'use server';

// 外部物流模块 Server Actions
// P0: 喜运达(golucky)导入/绑定/重激活
import 'server-only';
import { z } from 'zod';
import { requireActiveAuth } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/types/common';

// ─── Zod Schemas ────────────────────────────────────────

const importGoluckyItemSchema = z.object({
  waybillNo: z.string().min(1, '运单号不能为空'),
  warehouseId: z.string().uuid('仓库 ID 格式无效'),
  country: z.enum(['TH', 'ID', 'MY', 'PH', 'VN'], {
    error: '无效的国家代码',
  }),
  externalOrderNo: z.string().optional(),
});

const importGoluckyRefsSchema = z.object({
  items: z.array(importGoluckyItemSchema).min(1, '至少需要一条运单'),
});

const bindExternalRefSchema = z.object({
  refId: z.string().uuid(),
  shipmentId: z.string().uuid(),
});

const reactivateExternalRefSchema = z.object({
  refId: z.string().uuid(),
});

// ─── Actions ────────────────────────────────────────────

/** P0: 批量导入喜运达运单 */
export async function importGoluckyRefs(
  items: z.infer<typeof importGoluckyItemSchema>[],
): Promise<ActionResult<{ succeeded: number; duplicated: number; failed: unknown[] }>> {
  try {
    const user = await requireActiveAuth();

    // Admin/Operator 均可导入
    const parsed = importGoluckyRefsSchema.safeParse({ items });
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? '导入数据校验失败' };
    }

    const supabase = await createClient();

    // 构建 p_items JSONB 数组
    const pItems = parsed.data.items.map((item) => ({
      waybill_no: item.waybillNo,
      warehouse_id: item.warehouseId,
      country: item.country,
      external_order_no: item.externalOrderNo ?? null,
    }));

    const { data, error } = await supabase.rpc('import_golucky_refs', {
      p_items: pItems,
    });

    if (error) {
      return { success: false, error: `导入失败: ${error.message}` };
    }

    const result = data as {
      succeeded: number;
      duplicated: number;
      failed: Array<{ index: number; waybill_no: string; error: string }>;
    };

    revalidatePath('/dashboard/shipments');
    return { success: true, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知错误';
    return { success: false, error: `导入运单失败: ${message}` };
  }
}

/** P0: 绑定外部物流记录到 Shipment */
export async function bindExternalRefToShipment(
  refId: string,
  shipmentId: string,
): Promise<ActionResult> {
  try {
    const user = await requireActiveAuth();

    const parsed = bindExternalRefSchema.safeParse({ refId, shipmentId });
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? '校验失败' };
    }

    const supabase = await createClient();

    const { error } = await supabase.rpc('bind_external_ref_to_shipment', {
      p_ref_id: parsed.data.refId,
      p_shipment_id: parsed.data.shipmentId,
    });

    if (error) {
      return { success: false, error: `绑定失败: ${error.message}` };
    }

    revalidatePath('/dashboard/shipments');
    revalidatePath(`/dashboard/shipments/${shipmentId}`);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知错误';
    return { success: false, error: `绑定外部物流记录失败: ${message}` };
  }
}

/** P0: 重激活外部物流记录同步 */
export async function reactivateExternalRef(refId: string): Promise<ActionResult> {
  try {
    const user = await requireActiveAuth();

    const parsed = reactivateExternalRefSchema.safeParse({ refId });
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? '校验失败' };
    }

    const supabase = await createClient();

    const { error } = await supabase.rpc('reactivate_external_ref', {
      p_ref_id: parsed.data.refId,
    });

    if (error) {
      return { success: false, error: `重激活失败: ${error.message}` };
    }

    revalidatePath('/dashboard/shipments');
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知错误';
    return { success: false, error: `重激活失败: ${message}` };
  }
}

/** P0: 获取未绑定外部物流记录列表 */
export async function listUnboundExternalRefs(provider?: string) {
  try {
    await requireActiveAuth();
    const supabase = await createClient();

    let query = supabase
      .from('shipment_external_ref')
      .select('*, warehouse:warehouse_id(name)')
      .is('shipment_id', null)
      .order('created_at', { ascending: false });

    if (provider) {
      query = query.eq('provider', provider);
    }

    const { data, error } = await query;

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data ?? [] };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : '未知错误' };
  }
}
