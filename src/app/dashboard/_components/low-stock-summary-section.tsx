'use client';

// P2-D2: 低库存汇总区块
// 展示当前用户可访问范围内的全部低库存项（不依赖关注），按仓库分组，缺口大的优先。
// 空状态：库存正常。错误状态：低库存数据加载失败。不崩溃 Dashboard。
import { AlertTriangle, Package, ArrowRight, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';

export interface LowStockSummaryItem {
  sku: string;
  productName: string | null;
  productCode: string | null;
  country: string;
  warehouseName: string;
  warehouseId: string;
  quantity: number;
  safetyStock: number;
  gap: number;
}

interface WarehouseGroup {
  name: string;
  country: string;
  items: LowStockSummaryItem[];
}

interface Props {
  items: LowStockSummaryItem[];
  error?: string | null;
  limit?: number;
  compact?: boolean;
}

const MAX_DISPLAY = 15;

function groupByWarehouse(items: LowStockSummaryItem[]): WarehouseGroup[] {
  const map = new Map<string, WarehouseGroup>();
  for (const item of items) {
    const key = item.warehouseId;
    if (!map.has(key)) {
      map.set(key, { name: item.warehouseName, country: item.country, items: [] });
    }
    map.get(key)!.items.push(item);
  }
  // 按各仓缺口总和降序排列
  return [...map.values()].sort((a, b) => {
    const aGap = a.items.reduce((s, i) => s + i.gap, 0);
    const bGap = b.items.reduce((s, i) => s + i.gap, 0);
    return bGap - aGap;
  });
}

export function LowStockSummarySection({
  items,
  error,
  limit = MAX_DISPLAY,
  compact = false,
}: Props) {
  const containerClass = `rounded-lg border ${compact ? 'p-4' : 'p-5 mb-6'}`;
  // 错误状态
  if (error) {
    return (
      <section className={`${containerClass} border-red-200 bg-red-50/50`}>
        <div className="flex items-center gap-2 text-red-600">
          <AlertTriangle className="h-4 w-4" />
          <h2 className="text-sm font-semibold">低库存汇总</h2>
        </div>
        <p className="text-xs text-red-500 mt-1.5">低库存数据加载失败：{error}</p>
      </section>
    );
  }

  // 空状态
  if (items.length === 0) {
    return (
      <section className={`${containerClass} border-green-200 bg-green-50/50`}>
        <div className="flex items-center gap-2 text-green-600">
          <Package className="h-4 w-4" />
          <h2 className="text-sm font-semibold">低库存汇总</h2>
        </div>
        <p className="text-xs text-green-500 mt-1.5">
          当前所有海外仓库存均高于安全库存线，无低库存项目
        </p>
      </section>
    );
  }

  const grouped = groupByWarehouse(items);
  const remaining = Math.max(0, items.length - limit);

  return (
    <section className={containerClass}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-red-500" />
          <h2 className="text-sm font-semibold text-gray-900">低库存汇总</h2>
          <span className="text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full font-medium">
            {items.length} 项
          </span>
        </div>
        <Link
          href="/dashboard/inventory/overseas?stockStatus=low"
          className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-0.5 shrink-0"
        >
          查看全部 <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {/* 按仓库分组展示 */}
      {grouped.map((group) => {
        const visibleItems = group.items.filter((_, i) => {
          const globalIdx = items.indexOf(group.items[i]);
          return globalIdx < limit;
        });

        if (visibleItems.length === 0) return null;

        return (
          <div key={group.name} className="mb-4 last:mb-0">
            <div className="flex items-center gap-2 mb-2">
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-gray-700">
                {group.country} · {group.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {group.items.length} 项低库存
              </span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">SKU</TableHead>
                  <TableHead>产品</TableHead>
                  <TableHead className="text-right w-[80px]">库存</TableHead>
                  <TableHead className="text-right w-[80px]">安全库存</TableHead>
                  <TableHead className="text-right w-[72px]">缺口</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleItems.map((item, i) => (
                  <TableRow key={`${item.sku}-${item.warehouseId}-${i}`}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/dashboard/inventory/overseas?search=${encodeURIComponent(item.sku)}`}
                        className="text-blue-600 hover:underline"
                      >
                        {item.sku}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs max-w-[180px] truncate">
                      {item.productName || item.productCode || '-'}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {item.quantity.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                      {item.safetyStock.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-xs text-red-600 font-medium tabular-nums">
                      {item.gap.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        );
      })}

      {/* 还有 N 项提示 */}
      {remaining > 0 && (
        <p className="text-xs text-muted-foreground mt-2 text-center">
          还有 {remaining} 项未展示，{' '}
          <Link
            href="/dashboard/inventory/overseas?stockStatus=low"
            className="text-blue-600 hover:underline"
          >
            查看全部低库存
          </Link>
        </p>
      )}
    </section>
  );
}
