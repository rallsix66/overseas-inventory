import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Calculator, Globe2, RefreshCw } from 'lucide-react';
import { requireActiveAuth } from '@/lib/auth';
import { aggregateInTransitKpis, countSyncErrors } from '@/features/dashboard/metrics';
import { inventoryRepository } from '@/features/inventory/repository';
import type { InventoryItem, WarehouseHealthOverview } from '@/features/inventory/types';
import { preferencesRepository } from '@/features/preferences/repository';
import { FollowedProductsSection } from '@/features/preferences/components/followed-products-section';
import type { FollowedVariantBasic } from '@/features/preferences/types';
import { shipmentRepository } from '@/features/shipments/repository';
import type { InTransitDetail, UpcomingArrival } from '@/features/shipments/types';
import { getSyncWarehouseOverview } from '@/features/sync/server-actions';
import type { SyncWarehouseOverviewItem } from '@/features/sync/types';
import { DashboardKpiCards } from './_components/dashboard-kpi-cards';
import { LowStockSummarySection } from './_components/low-stock-summary-section';
import type { LowStockSummaryItem } from './_components/low-stock-summary-section';
import { UpcomingArrivals } from './_components/upcoming-arrivals';
import { WarehouseHealthCard } from './_components/warehouse-health-card';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '首页' };

interface LoadResult<T> {
  data: T;
  error: string | null;
}

function load<T>(promise: Promise<T>, fallback: T, errorMessage: string): Promise<LoadResult<T>> {
  return promise
    .then((data) => ({ data, error: null }))
    .catch(() => ({ data: fallback, error: errorMessage }));
}

export default async function DashboardPage() {
  const user = await requireActiveAuth();

  const [healthResult, inTransitResult, lowStockResult, followedResult, arrivalsResult, syncResult] =
    await Promise.all([
      load<WarehouseHealthOverview | null>(
        inventoryRepository.getWarehouseHealthOverview(user.id),
        null,
        '库存健康度加载失败',
      ),
      load<InTransitDetail[]>(
        shipmentRepository.getInTransitDetail(user.id),
        [],
        '计划及在途加载失败',
      ),
      load<InventoryItem[]>(
        inventoryRepository.getLowStock({ userId: user.id }),
        [],
        '低库存数据加载失败',
      ),
      load<FollowedVariantBasic[]>(
        preferencesRepository.getFollowedVariantsBasic(user.id),
        [],
        '关注产品加载失败',
      ),
      load<UpcomingArrival[]>(
        shipmentRepository.getUpcomingArrivals(user.id, 7),
        [],
        '近期到港加载失败',
      ),
      load<SyncWarehouseOverviewItem[]>(
        getSyncWarehouseOverview(),
        [],
        '同步状态加载失败',
      ),
    ]);

  const today = new Date().toISOString().slice(0, 10);
  const inTransitKpis = inTransitResult.error
    ? null
    : aggregateInTransitKpis(inTransitResult.data, today);
  const syncErrorCount = syncResult.error ? null : countSyncErrors(syncResult.data);

  const inTransitByVariant = new Map<string, number>();
  for (const row of inTransitResult.data) {
    inTransitByVariant.set(
      row.variantId,
      (inTransitByVariant.get(row.variantId) ?? 0) + row.remainingQuantity,
    );
  }

  const followedVariants = followedResult.data.map((variant) => ({
    ...variant,
    inTransitQuantity: inTransitByVariant.get(variant.variantId) ?? 0,
  }));

  const lowStockItems: LowStockSummaryItem[] = lowStockResult.data
    .map((item) => ({
      sku: item.sku,
      productName: item.productName,
      productCode: item.productCode,
      country: item.country,
      warehouseName: item.warehouseName,
      warehouseId: item.warehouseId,
      quantity: item.quantity,
      safetyStock: item.safetyStock,
      gap: Math.max(item.safetyStock - item.quantity, 0),
    }))
    .sort((a, b) => b.gap - a.gap || a.quantity - b.quantity);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">决策看板</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            汇总库存健康、有效在途、近期到港与需要立即处理的异常
          </p>
        </div>
        <nav className="flex flex-wrap gap-2" aria-label="首页快捷动作">
          <Link href="/dashboard/sync" className="inline-flex items-center gap-1.5 rounded-md border bg-white px-3 py-2 text-xs font-medium hover:bg-gray-50">
            <RefreshCw className="size-3.5" /> 库存同步
          </Link>
          <Link href="/dashboard/replenishment" className="inline-flex items-center gap-1.5 rounded-md border bg-white px-3 py-2 text-xs font-medium hover:bg-gray-50">
            <Calculator className="size-3.5" /> 补货建议
          </Link>
          <Link href="/dashboard/products/overview" className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-800">
            <Globe2 className="size-3.5" /> 全球库存总览 <ArrowRight className="size-3" />
          </Link>
        </nav>
      </div>

      <DashboardKpiCards
        health={healthResult.data}
        healthError={healthResult.error}
        inTransit={inTransitKpis}
        inTransitError={inTransitResult.error}
        syncErrorCount={syncErrorCount}
        syncError={syncResult.error}
      />

      <div className="grid gap-3 xl:grid-cols-2">
        <WarehouseHealthCard overview={healthResult.data} error={healthResult.error} />
        <UpcomingArrivals
          arrivals={arrivalsResult.data}
          futureArrivalCount={inTransitKpis?.future7dArrivalCount ?? null}
          error={arrivalsResult.error}
        />
      </div>

      <div className="grid items-start gap-3 xl:grid-cols-2">
        <LowStockSummarySection
          items={lowStockItems}
          error={lowStockResult.error}
          limit={5}
          compact
        />
        <FollowedProductsSection
          variants={followedVariants}
          error={followedResult.error}
          limit={4}
          compact
        />
      </div>
    </div>
  );
}
