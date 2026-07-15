import Link from 'next/link';
import { Activity, AlertTriangle, ArrowRight, PackageCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { InTransitKpis } from '@/features/dashboard/metrics';
import type { WarehouseHealthOverview } from '@/features/inventory/types';

function ErrorValue() {
  return <p className="text-sm text-destructive">数据加载失败</p>;
}

export function DashboardKpiCards({
  health,
  healthError,
  inTransit,
  inTransitError,
  syncErrorCount,
  syncError,
}: {
  health: WarehouseHealthOverview | null;
  healthError: string | null;
  inTransit: InTransitKpis | null;
  inTransitError: string | null;
  syncErrorCount: number | null;
  syncError: string | null;
}) {
  const summary = health?.summary;
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Card className="gap-2 py-4 shadow-none">
        <CardHeader className="px-4 py-0">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Activity className="size-4" /> 库存健康
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 py-0">
          {healthError || !summary ? (
            <ErrorValue />
          ) : (
            <>
              <p className="font-mono text-2xl font-semibold tabular-nums">
                {summary.healthRate === null ? '—' : `${summary.healthRate}%`}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                总库存 {summary.totalQuantity.toLocaleString()} · 低库存 {summary.lowStockCount} · 缺货 {summary.outOfStockCount} · 未匹配 {summary.unmatchedCount}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="gap-2 py-4 shadow-none">
        <CardHeader className="px-4 py-0">
          <CardTitle className="flex items-center gap-2 text-sm">
            <PackageCheck className="size-4" /> ETA 已知的计划及在途
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 py-0">
          {inTransitError || !inTransit ? (
            <ErrorValue />
          ) : (
            <>
              <p className="font-mono text-2xl font-semibold tabular-nums">
                {inTransit.activeInTransitQuantity.toLocaleString()}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {inTransit.activeInTransitSkuCount} 个 SKU · {inTransit.activeInTransitShipmentCount} 单 · 未来 7 日 {inTransit.future7dArrivalCount} 单
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                仅统计未取消、未吸收、ETA 已知且 remaining&gt;0 的计划及在途记录
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="gap-2 py-4 shadow-none">
        <CardHeader className="px-4 py-0">
          <CardTitle className="flex items-center gap-2 text-sm">
            <AlertTriangle className="size-4" /> 紧急行动
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 py-0">
          {healthError || syncError || !summary || syncErrorCount === null ? (
            <ErrorValue />
          ) : (
            <p className="text-sm">
              缺货 <strong className="text-destructive">{summary.outOfStockCount}</strong> / 低库存 <strong>{summary.lowStockCount}</strong> / 同步异常仓库 <strong>{syncErrorCount}</strong>
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-3 text-xs">
            <Link href="/dashboard/replenishment" className="inline-flex items-center gap-1 text-blue-600 hover:underline">
              查看补货建议 <ArrowRight className="size-3" />
            </Link>
            <Link href="/dashboard/products/overview" className="inline-flex items-center gap-1 text-blue-600 hover:underline">
              全球库存总览 <ArrowRight className="size-3" />
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
