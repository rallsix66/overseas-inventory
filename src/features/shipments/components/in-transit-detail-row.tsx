'use client';

// P3-S2E: 海外库存行展开 — 显示该 SKU + 仓库的内部在途明细
// 轻量展开：仅单号、采购单号、在途数量、预计到货时间、详情链接
// 不展示状态、船名、航次、轨迹、目的国等详细物流字段
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Loader2Icon, ChevronRightIcon, PackageIcon } from 'lucide-react';
import { getInTransitDetails } from '@/features/shipments/actions';
import type { InTransitDetailItem } from '@/features/shipments/types';

interface Props {
  variantId: string;
  warehouseId: string;
  open: boolean;
}

export function InTransitDetailRow({ variantId, warehouseId, open }: Props) {
  const [details, setDetails] = useState<InTransitDetailItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    getInTransitDetails(variantId, warehouseId)
      .then((result) => {
        if (cancelled) return;
        if (!result.success) {
          setError(result.error ?? '查询失败');
          return;
        }
        setDetails(result.data ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setError('查询在途明细失败，请稍后重试');
      });

    return () => {
      cancelled = true;
    };
  }, [open, variantId, warehouseId]);

  if (!open) return null;

  // Derived loading: no data or error yet
  const loading = details === null && error === null;

  return (
    <div className="bg-gray-50/50 border-t px-4 py-3">
      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2Icon className="size-3.5 animate-spin" />
          加载在途明细...
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-sm text-red-600 py-2">{error}</p>
      )}

      {/* Empty */}
      {!loading && !error && details !== null && details.length === 0 && (
        <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <PackageIcon className="size-4" />
          暂无在途明细
        </div>
      )}

      {/* Detail rows */}
      {!loading && !error && details !== null && details.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground mb-2">
            内部在途明细（{details.length} 条）
          </p>
          {details.map((d) => (
            <Link
              key={d.shipmentId}
              href={`/dashboard/shipments/${d.shipmentId}`}
              className="flex items-center gap-4 text-sm py-1.5 px-2 rounded hover:bg-gray-100 transition-colors group"
            >
              <span className="font-medium tabular-nums min-w-[120px]">
                {d.shipmentNo}
              </span>
              <span className="text-muted-foreground min-w-[120px]">
                {d.purchaseOrderNo || '—'}
              </span>
              <span className="tabular-nums text-blue-600 font-medium min-w-[60px] text-right">
                {d.quantity.toLocaleString()}
              </span>
              <span className="text-muted-foreground min-w-[100px]">
                {d.estimatedArrival
                  ? new Date(d.estimatedArrival).toLocaleDateString('zh-CN')
                  : '—'}
              </span>
              <ChevronRightIcon className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 ml-auto" />
            </Link>
          ))}
          {/* P6-UI-CLARITY: 最近物流更新时间 — 取所有明细中最新的 tracking_event.occurred_at */}
          {(() => {
            const latestTs = details.reduce<string | null>((best, d) => {
              if (!d.latestTrackingAt) return best;
              if (!best || d.latestTrackingAt > best) return d.latestTrackingAt;
              return best;
            }, null);
            return latestTs ? (
              <p className="text-xs text-muted-foreground pt-1 border-t border-gray-200 mt-1">
                最近物流更新{' '}
                {new Date(latestTs).toLocaleString('zh-CN', {
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground pt-1 border-t border-gray-200 mt-1">
                最近物流更新 —
              </p>
            );
          })()}
        </div>
      )}
    </div>
  );
}
