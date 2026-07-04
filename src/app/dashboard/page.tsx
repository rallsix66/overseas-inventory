// Dashboard 首页 — 库存概览
// Server Component：展示各仓库库存入口、关键指标、低库存汇总和关注产品动态
// P2-D2: 新增低库存汇总区块（全局低库存风险概览，不依赖关注）
import { getCurrentUser } from '@/lib/auth';
import { inventoryRepository } from '@/features/inventory/repository';
import { preferencesRepository } from '@/features/preferences/repository';
import { shipmentRepository } from '@/features/shipments/repository';
import { FollowedProductsSection } from '@/features/preferences/components/followed-products-section';
import { LowStockSummarySection } from './_components/low-stock-summary-section';
import type { LowStockSummaryItem } from './_components/low-stock-summary-section';
import type { FollowedVariantBasic } from '@/features/preferences/types';
import type { InventoryItem } from '@/features/inventory/types';
import { Package, Globe, Truck, ArrowRight, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '首页',
};

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const isAdmin = user?.roleName === 'admin';

  // PERF-C1: 将彼此独立的数据加载重排为并行执行
  // 每个查询保留独立错误处理，单个失败不影响其他区块
  let overseasStats;
  let inTransitMap: Map<string, number> = new Map();
  let inTransitSkuCount = 0;
  let inTransitTotalQuantity = 0;
  let followedVariants: FollowedVariantBasic[] = [];
  let followedError: string | null = null;
  let lowStockItems: LowStockSummaryItem[] = [];
  let lowStockError: string | null = null;

  if (user?.id) {
    // PERF-C1: 将彼此独立的数据加载重排为并行执行
    // 每个查询的 .catch() 返回结构化结果（数据 + 错误），Promise.all 之后再赋值
    const [osResult, itResult, fvResult, lsResult] = await Promise.all([
      inventoryRepository.getOverseasStats(user.id).catch(() => undefined),
      shipmentRepository.getInTransitByVariant(user.id).catch(() => new Map<string, number>()),
      preferencesRepository.getFollowedVariantsBasic(user.id)
        .then((data) => ({ data, error: null as string | null }))
        .catch((e: unknown) => ({
          data: [] as FollowedVariantBasic[],
          error: e instanceof Error ? e.message : '关注产品加载失败',
        })),
      inventoryRepository.getLowStock({ userId: user.id })
        .then((data) => ({ data, error: null as string | null }))
        .catch((e: unknown) => ({
          data: [] as InventoryItem[],
          error: e instanceof Error ? e.message : '低库存数据加载失败',
        })),
    ]);

    overseasStats = osResult;
    inTransitMap = itResult;

    for (const qty of inTransitMap.values()) {
      if (qty > 0) {
        inTransitSkuCount++;
        inTransitTotalQuantity += qty;
      }
    }

    followedVariants = fvResult.data;
    followedError = fvResult.error;
    // P3-S2C: 注入在途数量到每个关注产品行
    if (inTransitMap.size > 0) {
      for (const v of followedVariants) {
        v.inTransitQuantity = inTransitMap.get(v.variantId) ?? 0;
      }
    }

    lowStockItems = lsResult.data
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
    lowStockError = lsResult.error;
  } else {
    // 无 user.id — 仅获取海外统计，静默失败
    try {
      overseasStats = await inventoryRepository.getOverseasStats(user?.id);
    } catch {
      // 统计获取失败时静默处理，首页仍可渲染
    }
  }

  return (
    <div className="px-6 py-6">
      {/* 页头 */}
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-gray-900">库存概览</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          快速查看各仓库库存状态与关键指标
        </p>
      </div>

      {/* 快捷入口卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {/* 海外库存 — 主要入口 */}
        <Link
          href="/dashboard/inventory/overseas"
          className="group flex items-start gap-4 rounded-lg border border-blue-200 bg-blue-50/50 p-5 hover:border-blue-300 hover:bg-blue-50 transition-colors"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-100 text-blue-600">
            <Globe className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-900">海外库存</h3>
              <ArrowRight className="h-4 w-4 text-blue-500 opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0" />
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              泰国、印尼、马来西亚、菲律宾、越南
            </p>
            {overseasStats && (
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-2 text-xs text-muted-foreground">
                <span>
                  库存总量{' '}
                  <span className="font-semibold text-gray-900 tabular-nums">
                    {overseasStats.totalQuantity.toLocaleString()}
                  </span>
                </span>
                <span>
                  SKU{' '}
                  <span className="font-semibold text-gray-900 tabular-nums">
                    {overseasStats.skuCount}
                  </span>
                </span>
                {overseasStats.lowStockCount > 0 ? (
                  <span className="text-red-600 font-medium">
                    <AlertTriangle className="inline h-3 w-3 mr-0.5" />
                    低库存 {overseasStats.lowStockCount}
                  </span>
                ) : (
                  <span className="text-green-600">库存正常</span>
                )}
              </div>
            )}
          </div>
        </Link>

        {/* 国内库存 — 即将推出 */}
        <div className="flex items-start gap-4 rounded-lg border border-gray-200 bg-gray-50/50 p-5 opacity-60 cursor-not-allowed">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-400">
            <Package className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-900">国内库存</h3>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              国内仓库存管理与查询
            </p>
            <p className="text-xs text-gray-400 mt-2">即将推出</p>
          </div>
        </div>

        {/* 在途库存 — P3-S2C: 接入内部手动在途数据 */}
        <Link
          href="/dashboard/shipments"
          className="group flex items-start gap-4 rounded-lg border border-cyan-200 bg-cyan-50/50 p-5 hover:border-cyan-300 hover:bg-cyan-50 transition-colors"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-cyan-100 text-cyan-600">
            <Truck className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-900">在途库存</h3>
              <ArrowRight className="h-4 w-4 text-cyan-500 opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0" />
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              已发货未入仓的货物追踪
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-2 text-xs text-muted-foreground">
              <span>
                在途总量{' '}
                <span className="font-semibold text-gray-900 tabular-nums">
                  {inTransitTotalQuantity.toLocaleString()}
                </span>
              </span>
              <span>
                SKU{' '}
                <span className="font-semibold text-gray-900 tabular-nums">
                  {inTransitSkuCount}
                </span>
              </span>
              {inTransitSkuCount === 0 && (
                <span className="text-gray-400">暂无在途数据</span>
              )}
            </div>
          </div>
        </Link>
      </div>

      {/* P2-D2: 低库存汇总 — 全局低库存风险概览（不依赖关注） */}
      <LowStockSummarySection items={lowStockItems} error={lowStockError} />

      {/* P5-SY12D: 关注产品动态 — 运营可用性收口（筛选/跳转/未匹配说明） */}
      <FollowedProductsSection variants={followedVariants} error={followedError} />

      {/* 操作入口 */}
      <div className="rounded-lg border p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">快捷操作</h2>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/dashboard/inventory/overseas"
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            <Globe className="h-4 w-4" />
            查看海外库存
          </Link>
          {isAdmin && (
            <Link
              href="/dashboard/products"
              className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              管理产品
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
