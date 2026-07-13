// P0: 喜运达物流轨迹定时同步 Cron Route
//
// GET /api/cron/golucky
// Authorization: Bearer <CRON_SECRET>
//
// Vercel Cron 定时调用此端点，拉取全部 active 喜运达外部物流记录的轨迹。
// 使用 service_role 写入 tracking_event_external 表（绕过 RLS）。
//
// 安全边界：
// - CRON_SECRET 缺失 → 500（fail-closed），不读 Authorization、不访问 DB
// - CRON_SECRET 已配置但鉴权失败 → 401，不访问 DB
// - 仅 service_role 写库，绝不对 anon/authenticated 暴露
// - P0 不回写 shipment.status / tracking_event / inventory / estimated_arrival
// - golucky 同步仅此一条调度路径；dry-run Cron 独立共存

import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { GoluckyClient, InMemoryTokenCache } from '@/lib/providers/golucky/client';

const DEFAULT_CONCURRENCY = 5;
const TERMINAL_CATEGORIES = new Set(['delivered', 'exception']);

export async function GET(request: NextRequest) {
  // ── 第一步：配置检查（优先于鉴权） ──────────────────────
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || cronSecret === '') {
    return Response.json(
      { error: 'CRON_SECRET 未配置，喜运达同步不可用' },
      { status: 500 },
    );
  }

  // ── 第二步：请求鉴权 ──────────────────────────────────
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return Response.json(
      { error: '缺少 Authorization header' },
      { status: 401 },
    );
  }

  if (!authHeader.startsWith('Bearer ')) {
    return Response.json(
      { error: 'Authorization 格式错误，期望 Bearer <token>' },
      { status: 401 },
    );
  }

  const token = authHeader.slice(7);
  if (token !== cronSecret) {
    return Response.json(
      { error: 'CRON_SECRET 错误' },
      { status: 401 },
    );
  }

  // ── 第三步：检查环境变量 ──────────────────────────────
  const baseUrl = process.env.GOLUCKY_BASE_URL;
  const appKey = process.env.GOLUCKY_APP_KEY;
  const appSecret = process.env.GOLUCKY_APP_SECRET;

  if (!baseUrl || !appKey || !appSecret) {
    return Response.json(
      { error: '喜运达 API 凭证未配置（GOLUCKY_BASE_URL / GOLUCKY_APP_KEY / GOLUCKY_APP_SECRET）' },
      { status: 500 },
    );
  }

  // ── 第四步：执行同步 ──────────────────────────────────
  const supabase = createServiceClient();

  try {
    // 获取全部 active 喜运达 external refs
    const { data: refs, error: refsError } = await supabase
      .from('shipment_external_ref')
      .select('*')
      .eq('provider', 'golucky')
      .eq('sync_status', 'active');

    if (refsError) {
      return Response.json(
        { error: `查询外部物流记录失败: ${refsError.message}` },
        { status: 500 },
      );
    }

    if (!refs || refs.length === 0) {
      return Response.json({
        total: 0,
        succeeded: 0,
        failed: 0,
        message: '无待同步记录',
      });
    }

    // 创建 GoluckyClient（使用 InMemoryTokenCache，token 由 client 自行管理）
    const tokenCache = new InMemoryTokenCache();
    const client = new GoluckyClient(
      { baseUrl: baseUrl!, appKey: appKey!, appSecret: appSecret!, tokenCache },
    );

    let succeeded = 0;
    let failed = 0;
    const errors: Array<{ waybill_no: string; error: string }> = [];

    // 分批并发（默认并发上限 5）
    for (let i = 0; i < refs.length; i += DEFAULT_CONCURRENCY) {
      const batch = refs.slice(i, i + DEFAULT_CONCURRENCY);

      const batchResults = await Promise.all(
        batch.map(async (ref) => {
          if (!ref.waybill_no) {
            await supabase
              .from('shipment_external_ref')
              .update({ sync_status: 'error', last_synced_at: new Date().toISOString() })
              .eq('id', ref.id);
            return { waybillNo: '(无运单号)', success: false, error: '运单号为空' };
          }

          try {
            const { events, rawResponse } = await client.getTracking(ref.waybill_no);

            // Upsert 轨迹事件
            let inserted = 0;
            for (const event of events) {
              const { error: upsertErr } = await supabase
                .from('tracking_event_external')
                .upsert(
                  {
                    external_ref_id: ref.id,
                    provider: 'golucky',
                    external_event_id: event.externalEventId,
                    external_category: event.externalCategory,
                    status: event.status,
                    description: event.description,
                    occurred_at: event.occurredAt,
                    raw_payload: event.rawPayload,
                  },
                  { onConflict: 'external_ref_id,external_event_id', ignoreDuplicates: true },
                );

              if (upsertErr && upsertErr.code !== '23505') {
                throw new Error(`写入轨迹失败: ${upsertErr.message}`);
              }
              inserted++;
            }

            // 判断终态
            const hasTerminal = events.some((e) =>
              TERMINAL_CATEGORIES.has(e.externalCategory),
            );
            const newStatus = hasTerminal ? 'stale' : 'active';

            await supabase
              .from('shipment_external_ref')
              .update({
                sync_status: newStatus,
                last_synced_at: new Date().toISOString(),
                raw_payload: rawResponse as Record<string, unknown>,
              })
              .eq('id', ref.id);

            return { waybillNo: ref.waybill_no, success: true, eventCount: inserted };
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : '未知错误';
            await supabase
              .from('shipment_external_ref')
              .update({ sync_status: 'error', last_synced_at: new Date().toISOString() })
              .eq('id', ref.id)
              .select('id')
              .maybeSingle();

            return { waybillNo: ref.waybill_no, success: false, error: errorMessage };
          }
        }),
      );

      for (const r of batchResults) {
        if (r.success) succeeded++;
        else {
          failed++;
          errors.push({ waybill_no: r.waybillNo, error: r.error ?? '未知错误' });
        }
      }

      // 批次间短暂延迟
      if (i + DEFAULT_CONCURRENCY < refs.length) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    return Response.json({
      total: refs.length,
      succeeded,
      failed,
      errors: errors.length > 0 ? errors : undefined,
      message: `同步完成：${succeeded} 成功 / ${failed} 失败`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知错误';
    return Response.json(
      { error: `喜运达同步执行失败: ${message}` },
      { status: 500 },
    );
  }
}
