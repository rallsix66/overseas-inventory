// Dashboard 首页 — 库存概览
// Server Component：展示各仓库库存入口、关键指标和关注产品动态
import { getCurrentUser } from '@/lib/auth';
import { inventoryRepository } from '@/features/inventory/repository';
import { preferencesRepository } from '@/features/preferences/repository';
import type { FollowedVariantBasic } from '@/features/preferences/types';
import { Package, Globe, Truck, ArrowRight, AlertTriangle, Star } from 'lucide-react';
import Link from 'next/link';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '首页',
};

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const isAdmin = user?.roleName === 'admin';

  // 获取海外库存统计（失败不影响首页渲染）
  let overseasStats;
  try {
    overseasStats = await inventoryRepository.getOverseasStats(user?.id);
  } catch {
    // 统计获取失败时静默处理，首页仍可渲染
  }

  // P5-SY12: 获取关注产品动态
  // 查询失败时显示错误状态，不伪装成"暂无关注产品"
  let followedVariants: FollowedVariantBasic[] = [];
  let followedError: string | null = null;
  if (user?.id) {
    try {
      followedVariants = await preferencesRepository.getFollowedVariantsBasic(user.id);
    } catch (e) {
      followedError = e instanceof Error ? e.message : '关注产品加载失败';
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

      {/* P5-SY12C: 关注产品动态 — 阶段 C 动态告警 */}
      <div className="rounded-lg border p-5 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Star className="h-4 w-4 text-amber-500" />
          <h2 className="text-sm font-semibold text-gray-900">关注产品动态</h2>
          {followedVariants && followedVariants.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {followedVariants.length} 个关注
              {followedVariants.filter((v) => v.alertLevel === 'critical').length > 0 && (
                <span className="text-red-600 ml-1">
                  · {followedVariants.filter((v) => v.alertLevel === 'critical').length} 个紧急
                </span>
              )}
              {followedVariants.filter((v) => v.alertLevel === 'warning').length > 0 && (
                <span className="text-amber-600 ml-1">
                  · {followedVariants.filter((v) => v.alertLevel === 'warning').length} 个低库存
                </span>
              )}
            </span>
          )}
        </div>

        {followedError ? (
          /* 查询失败状态 */
          <div className="text-center py-10">
            <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
            <p className="text-sm text-red-600">关注产品加载失败</p>
            <p className="text-xs text-muted-foreground mt-1">
              {followedError}
            </p>
          </div>
        ) : !followedVariants || followedVariants.length === 0 ? (
          /* 空状态 */
          <div className="text-center py-10">
            <Star className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">暂无关注产品</p>
            <p className="text-xs text-muted-foreground mt-1">
              在海外库存列表中点击星标关注您关心的 SKU
            </p>
          </div>
        ) : (
          /* 关注列表 — 紧急/低库存行置顶 */
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs font-medium text-muted-foreground">
                  <th className="py-2 px-3">产品/SKU</th>
                  <th className="py-2 px-3">国家/仓库</th>
                  <th className="py-2 px-3 text-right">库存</th>
                  <th className="py-2 px-3 text-right">日销</th>
                  <th className="py-2 px-3 text-right">可售天数</th>
                  <th className="py-2 px-3 text-right">补货周期</th>
                  <th className="py-2 px-3">状态</th>
                </tr>
              </thead>
              <tbody>
                {followedVariants.map((v) => (
                  <tr key={`${v.variantId}-${v.warehouseId}`} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-2 px-3">
                      <span className="font-medium text-gray-900">{v.productName}</span>
                      {v.isUnmatched && (
                        <span className="text-xs text-muted-foreground ml-1">(未匹配)</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-gray-600">
                      {v.country} / {v.warehouseName}
                    </td>
                    <td className={`py-2 px-3 text-right tabular-nums ${v.alertLevel === 'warning' || v.alertLevel === 'critical' ? 'text-red-600 font-semibold' : ''}`}>
                      {v.quantity}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
                      {v.dailySales != null ? v.dailySales : '—'}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
                      {v.estimatedDays != null ? v.estimatedDays : '—'}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
                      {v.leadTimeDays != null ? v.leadTimeDays : '—'}
                    </td>
                    <td className="py-2 px-3">
                      {v.alertLevel === 'critical' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700">
                          紧急
                        </span>
                      ) : v.alertLevel === 'warning' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700">
                          低库存
                        </span>
                      ) : v.alertLevel === 'unknown' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                          数据不足
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-600">
                          正常
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {followedVariants && followedVariants.length > 0 && (
          (() => {
            const alertItems = followedVariants.filter(
              (v) => v.alertLevel === 'critical' || v.alertLevel === 'warning'
            );
            if (alertItems.length === 0) return null;
            return (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground border-t pt-3">
                {alertItems.slice(0, 3).map((v) => (
                  <span
                    key={`alert-${v.variantId}-${v.warehouseId}`}
                    className={v.alertLevel === 'critical' ? 'text-red-600 font-medium' : 'text-amber-600 font-medium'}
                  >
                    <AlertTriangle className="inline h-3 w-3 mr-0.5" />
                    {v.productName}({v.warehouseName}) {v.alertReason}
                  </span>
                ))}
                {alertItems.length > 3 && (
                  <span className="text-red-600">
                    等 {alertItems.length} 项
                  </span>
                )}
              </div>
            );
          })()
        )}
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
