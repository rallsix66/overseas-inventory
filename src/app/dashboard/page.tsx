// Dashboard 首页 — 库存概览
// Server Component：展示各仓库库存入口和关键指标
import { getCurrentUser } from '@/lib/auth';
import { inventoryRepository } from '@/features/inventory/repository';
import { Package, Globe, Truck, ArrowRight, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '首页',
};

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const isAdmin = user?.roleName === 'admin';

  // 获取海外库存统计（失败不影响首页渲染）
  let overseasStats;
  try {
    overseasStats = await inventoryRepository.getOverseasStats();
  } catch {
    // 统计获取失败时静默处理，首页仍可渲染
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

        {/* 在途库存 — 即将推出 */}
        <div className="flex items-start gap-4 rounded-lg border border-gray-200 bg-gray-50/50 p-5 opacity-60 cursor-not-allowed">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-400">
            <Truck className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-900">在途库存</h3>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              已发货未入仓的货物追踪
            </p>
            <p className="text-xs text-gray-400 mt-2">即将推出</p>
          </div>
        </div>
      </div>

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
