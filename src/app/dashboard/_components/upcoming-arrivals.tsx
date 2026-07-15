import Link from 'next/link';
import { ArrowRight, CalendarClock } from 'lucide-react';
import type { UpcomingArrival } from '@/features/shipments/types';

function itemSummary(arrival: UpcomingArrival): string {
  const first = arrival.itemNames[0] ?? '未命名 SKU';
  return arrival.itemCount > 1 ? `${first} 等 ${arrival.itemCount} 项` : first;
}

export function UpcomingArrivals({
  arrivals,
  futureArrivalCount,
  error,
}: {
  arrivals: UpcomingArrival[];
  futureArrivalCount: number | null;
  error: string | null;
}) {
  const remaining = Math.max(0, (futureArrivalCount ?? 0) - arrivals.length);
  return (
    <section className="rounded-lg border bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="size-4" /> 未来 7 日到港
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">已发货、未入仓且仍有剩余数量</p>
        </div>
        <Link href="/dashboard/shipments" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
          查看全部 <ArrowRight className="size-3" />
        </Link>
      </div>

      {error ? (
        <p className="py-10 text-center text-sm text-destructive">近期到港加载失败</p>
      ) : arrivals.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">未来 7 日暂无到港安排</p>
      ) : (
        <div className="divide-y">
          {arrivals.map((arrival) => (
            <Link
              key={arrival.shipmentId}
              href={`/dashboard/shipments/${arrival.shipmentId}`}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-2.5 hover:bg-gray-50"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{itemSummary(arrival)}</p>
                <p className="text-xs text-muted-foreground">
                  {arrival.shipmentNo} · {arrival.country} / {arrival.warehouseName}
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-sm">{arrival.estimatedArrival}</p>
                <p className="text-xs text-muted-foreground">{arrival.remainingQuantity} 件</p>
              </div>
            </Link>
          ))}
          {remaining > 0 && (
            <p className="pt-3 text-center text-xs text-muted-foreground">还有 {remaining} 单，请在在途管理查看</p>
          )}
        </div>
      )}
    </section>
  );
}
