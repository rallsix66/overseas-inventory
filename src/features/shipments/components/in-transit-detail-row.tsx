'use client';

// P3-S2E: 海外库存行展开 — 显示该 SKU + 仓库的内部在途明细
// 轻量 mini-table：单号、采购单号、数量、物流状态（+最近物流更新时间小字）、预计到货时间、详情链接
// 不展示船名、航次、目的国等详细物流字段
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

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('zh-CN');
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// P3-S2E-EXPAND: 物流状态 → 中文标签 + 颜色（镜像 shipments/columns.tsx 的 STATUS_MAP，保持主表一致）
// warehoused 已在 repository 层排除，仅保留完整性
const STATUS_MAP: Record<string, { label: string; className: string }> = {
  booking: { label: '订舱', className: 'bg-gray-100 text-gray-700' },
  loading: { label: '装柜', className: 'bg-yellow-50 text-yellow-700' },
  departed: { label: '离港', className: 'bg-blue-50 text-blue-700' },
  arrived: { label: '到港', className: 'bg-indigo-50 text-indigo-700' },
  customs: { label: '清关', className: 'bg-orange-50 text-orange-700' },
  warehoused: { label: '入仓', className: 'bg-green-50 text-green-700' },
};

// 六列 grid 模板（表头与数据行共用）：单号 / 采购单号 / 数量 / 物流状态 / 预计到货时间 / 跳转箭头
const GRID_COLS =
  'grid-cols-[minmax(120px,1.1fr)_minmax(120px,1.1fr)_90px_minmax(170px,1.4fr)_130px_28px]';

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

      {/* Detail rows — 轻量 mini-table（白底细边框圆角，嵌在灰色展开背景内） */}
      {!loading && !error && details !== null && details.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            内部在途明细（{details.length} 条）
          </p>
          <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
            <div className="min-w-[760px]">
              {/* 表头 */}
              <div
                className={`grid ${GRID_COLS} gap-3 border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-muted-foreground`}
              >
                <span>单号</span>
                <span>采购单号</span>
                <span className="text-right">数量</span>
                <span>物流状态</span>
                <span>预计到货时间</span>
                <span aria-hidden="true" />
              </div>
              {/* 数据行 */}
              {details.map((d) => {
                const s = STATUS_MAP[d.status] ?? {
                  label: d.status,
                  className: 'bg-gray-100 text-gray-700',
                };
                return (
                  <Link
                    key={d.shipmentId}
                    href={`/dashboard/shipments/${d.shipmentId}`}
                    className={`grid ${GRID_COLS} gap-3 items-center border-t border-gray-100 px-3 py-2 text-sm transition-colors first:border-t-0 hover:bg-gray-50 group`}
                  >
                    <span className="font-medium tabular-nums truncate" title={d.shipmentNo}>
                      {d.shipmentNo}
                    </span>
                    <span
                      className="text-muted-foreground truncate"
                      title={d.purchaseOrderNo ?? undefined}
                    >
                      {d.purchaseOrderNo || '—'}
                    </span>
                    <span className="tabular-nums text-blue-600 font-medium text-right">
                      {d.quantity.toLocaleString()}
                    </span>
                    {/* 物流状态：主行状态标签 + 下方小字最近物流更新时间 */}
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span
                        className={`inline-flex w-fit items-center rounded px-1.5 py-0.5 text-xs font-medium ${s.className}`}
                      >
                        {s.label}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {d.latestTrackingAt
                          ? `最近物流更新 ${formatDateTime(d.latestTrackingAt)}`
                          : '最近物流更新 —'}
                      </span>
                    </span>
                    <span className="text-muted-foreground">
                      {formatDate(d.estimatedArrival)}
                    </span>
                    <ChevronRightIcon className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 justify-self-end" />
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
