'use client';

// 关注产品动态区 — 客户端交互层（P5-SY12D）
//
// 职责：
// - 状态筛选（全部/紧急/低库存/正常/数据不足）
// - 关注列表表格渲染
// - 每行跳转入口（海外库存 / SKU 管理）
// - 未匹配 SKU 明确提示
// - 空状态、加载失败、筛选无结果等边界状态
//
// 数据获取由 Dashboard Server Component 负责（Repository Pattern），
// 本组件仅处理客户端筛选与展示。
import { useState } from 'react';
import { Star, AlertTriangle, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import type { FollowedVariantBasic } from '../types';

// ─── 筛选类型 ──────────────────────────────────────────────────────────

type AlertFilter = 'all' | 'critical' | 'warning' | 'normal' | 'unknown';

interface FilterOption {
  value: AlertFilter;
  label: string;
}

const FILTER_OPTIONS: FilterOption[] = [
  { value: 'all', label: '全部' },
  { value: 'critical', label: '紧急' },
  { value: 'warning', label: '低库存' },
  { value: 'normal', label: '正常' },
  { value: 'unknown', label: '数据不足' },
];

const UNMATCHED_HINT =
  '该 SKU 未匹配产品，不参与安全库存判断。仍可通过预计可售天数进行动态告警。';

// ─── Props ─────────────────────────────────────────────────────────────

interface FollowedProductsSectionProps {
  variants: FollowedVariantBasic[];
  error: string | null;
}

// ─── 组件 ──────────────────────────────────────────────────────────────

export function FollowedProductsSection({ variants, error }: FollowedProductsSectionProps) {
  const [filter, setFilter] = useState<AlertFilter>('all');

  // ── 错误状态 ──────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="rounded-lg border p-5 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Star className="h-4 w-4 text-amber-500" />
          <h2 className="text-sm font-semibold text-gray-900">关注产品动态</h2>
        </div>
        <div className="text-center py-10">
          <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
          <p className="text-sm text-red-600">关注产品加载失败</p>
          <p className="text-xs text-muted-foreground mt-1">{error}</p>
        </div>
      </div>
    );
  }

  // ── 空关注状态 ────────────────────────────────────────────────────

  if (!variants || variants.length === 0) {
    return (
      <div className="rounded-lg border p-5 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Star className="h-4 w-4 text-amber-500" />
          <h2 className="text-sm font-semibold text-gray-900">关注产品动态</h2>
        </div>
        <div className="text-center py-10">
          <Star className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">暂无关注产品</p>
          <p className="text-xs text-muted-foreground mt-1">
            在海外库存列表中点击星标关注您关心的 SKU
          </p>
        </div>
      </div>
    );
  }

  // ── 筛选 ──────────────────────────────────────────────────────────

  const filtered =
    filter === 'all' ? variants : variants.filter((v) => v.alertLevel === filter);

  const criticalCount = variants.filter((v) => v.alertLevel === 'critical').length;
  const warningCount = variants.filter((v) => v.alertLevel === 'warning').length;

  const getFilterCount = (f: AlertFilter): number => {
    if (f === 'all') return variants.length;
    return variants.filter((v) => v.alertLevel === f).length;
  };

  // ── 渲染 ──────────────────────────────────────────────────────────

  return (
    <div className="rounded-lg border p-5 mb-6">
      {/* 标题行 + 汇总 */}
      <div className="flex items-center gap-2 mb-4">
        <Star className="h-4 w-4 text-amber-500" />
        <h2 className="text-sm font-semibold text-gray-900">关注产品动态</h2>
        <span className="text-xs text-muted-foreground">
          {variants.length} 个关注
          {criticalCount > 0 && (
            <span className="text-red-600 ml-1">
              · {criticalCount} 个紧急
            </span>
          )}
          {warningCount > 0 && (
            <span className="text-amber-600 ml-1">
              · {warningCount} 个低库存
            </span>
          )}
        </span>
      </div>

      {/* 状态筛选标签 */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {FILTER_OPTIONS.map((f) => {
          const isActive = filter === f.value;
          const count = getFilterCount(f.value);
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.label}
              <span className="tabular-nums opacity-70">({count})</span>
            </button>
          );
        })}
      </div>

      {/* 筛选无结果 */}
      {filtered.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-muted-foreground">
            当前筛选条件下无匹配的关注产品
          </p>
          <button
            type="button"
            onClick={() => setFilter('all')}
            className="text-xs text-blue-600 hover:underline mt-1"
          >
            查看全部
          </button>
        </div>
      ) : (
        <>
          {/* 关注列表表格 */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs font-medium text-muted-foreground">
                  <th className="py-2 px-3">产品/SKU</th>
                  <th className="py-2 px-3">国家/仓库</th>
                  <th className="py-2 px-3 text-right">库存</th>
                  <th className="py-2 px-3 text-right">在途</th>
                  <th className="py-2 px-3 text-right">日销</th>
                  <th className="py-2 px-3 text-right">可售天数</th>
                  <th className="py-2 px-3 text-right">补货周期</th>
                  <th className="py-2 px-3">状态</th>
                  <th className="py-2 px-3 w-10" aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((v) => (
                  <tr
                    key={`${v.variantId}-${v.warehouseId}`}
                    className="border-b last:border-0 hover:bg-gray-50"
                  >
                    {/* 产品/SKU */}
                    <td className="py-2 px-3">
                      <span className="font-medium text-gray-900">
                        {v.productName}
                      </span>
                      {v.isUnmatched && (
                        <span
                          className="text-xs text-muted-foreground ml-1 cursor-help"
                          title={UNMATCHED_HINT}
                        >
                          (未匹配)
                        </span>
                      )}
                    </td>

                    {/* 国家/仓库 */}
                    <td className="py-2 px-3 text-gray-600">
                      {v.country} / {v.warehouseName}
                    </td>

                    {/* 库存 */}
                    <td
                      className={`py-2 px-3 text-right tabular-nums ${
                        v.alertLevel === 'warning' || v.alertLevel === 'critical'
                          ? 'text-red-600 font-semibold'
                          : ''
                      }`}
                    >
                      {v.quantity}
                    </td>

                    {/* 在途 */}
                    <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
                      {v.inTransitQuantity > 0 ? v.inTransitQuantity : '—'}
                    </td>

                    {/* 日销 */}
                    <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
                      {v.dailySales != null ? v.dailySales : '—'}
                    </td>

                    {/* 可售天数 */}
                    <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
                      {v.estimatedDays != null ? v.estimatedDays : '—'}
                    </td>

                    {/* 补货周期 */}
                    <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
                      {v.leadTimeDays != null ? v.leadTimeDays : '—'}
                    </td>

                    {/* 状态 badge */}
                    <td className="py-2 px-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                          v.alertLevel === 'critical'
                            ? 'bg-red-50 text-red-700'
                            : v.alertLevel === 'warning'
                              ? 'bg-amber-50 text-amber-700'
                              : v.alertLevel === 'unknown'
                                ? 'bg-gray-100 text-gray-600'
                                : 'bg-green-50 text-green-600'
                        }`}
                      >
                        {v.alertLevel === 'critical'
                          ? '紧急'
                          : v.alertLevel === 'warning'
                            ? '低库存'
                            : v.alertLevel === 'unknown'
                              ? '数据不足'
                              : '正常'}
                        {v.isUnmatched && v.alertLevel === 'unknown' && (
                          <span
                            className="cursor-help text-gray-400"
                            title={UNMATCHED_HINT}
                          >
                            ?
                          </span>
                        )}
                      </span>
                    </td>

                    {/* 跳转入口 */}
                    <td className="py-2 px-3">
                      <Link
                        href={`/dashboard/inventory/overseas?search=${encodeURIComponent(v.sku)}`}
                        className="inline-flex items-center text-gray-400 hover:text-blue-600 transition-colors"
                        title="在海外库存中查看该 SKU"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 告警摘要条 — 使用当前筛选结果（visibleAlertItems） */}
          {(() => {
            const visibleAlertItems = filtered.filter(
              (v) => v.alertLevel === 'critical' || v.alertLevel === 'warning',
            );
            if (visibleAlertItems.length === 0) return null;
            return (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground border-t pt-3">
                {visibleAlertItems.slice(0, 3).map((v) => (
                  <span
                    key={`alert-${v.variantId}-${v.warehouseId}`}
                    className={
                      v.alertLevel === 'critical'
                        ? 'text-red-600 font-medium'
                        : 'text-amber-600 font-medium'
                    }
                  >
                    <AlertTriangle className="inline h-3 w-3 mr-0.5" />
                    {v.productName}({v.warehouseName}) {v.alertReason}
                  </span>
                ))}
                {visibleAlertItems.length > 3 && (
                  <span className="text-red-600">
                    等 {visibleAlertItems.length} 项
                  </span>
                )}
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
