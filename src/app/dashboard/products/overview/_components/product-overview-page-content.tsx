'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Boxes, Globe2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DecisionQueue } from '@/features/product-overview/components/decision-queue';
import { ProductModal } from '@/features/product-overview/components/product-modal';
import { ProductOverviewTable } from '@/features/product-overview/components/product-overview-table';
import type {
  ProductOverviewQueueCounts,
  ProductOverviewRow,
  StockoutUrgency,
} from '@/features/product-overview/types';

const COUNTRIES = ['TH', 'ID', 'MY', 'PH', 'VN'] as const;

interface Filters {
  search: string;
  country: string;
  stockoutUrgency: string;
}

export function ProductOverviewPageContent({
  rows,
  totalCount,
  queueCounts,
  page,
  pageSize,
  filters,
}: {
  rows: ProductOverviewRow[];
  totalCount: number;
  queueCounts: ProductOverviewQueueCounts;
  page: number;
  pageSize: number;
  filters: Filters;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(filters.search);
  const [selectedRow, setSelectedRow] = useState<ProductOverviewRow | null>(null);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  function buildUrl(overrides: Partial<Filters> & { page?: number }) {
    const next = { ...filters, page: 1, ...overrides };
    const params = new URLSearchParams();
    if (next.search) params.set('search', next.search);
    if (next.country) params.set('country', next.country);
    if (next.stockoutUrgency) params.set('stockoutUrgency', next.stockoutUrgency);
    if ((next.page ?? 1) > 1) params.set('page', String(next.page));
    const query = params.toString();
    return `/dashboard/products/overview${query ? `?${query}` : ''}`;
  }

  return (
    <div className="space-y-5 px-4 py-4 sm:px-6 sm:py-6">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
          <Globe2 className="size-5" /> 全球库存作战室
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          按 SKU 聚合当前账号可见海外仓，识别最早断货风险与仓库级补货动作
        </p>
      </div>

      <DecisionQueue
        counts={queueCounts}
        active={(filters.stockoutUrgency || undefined) as StockoutUrgency | undefined}
        onSelect={(value) =>
          router.push(buildUrl({ stockoutUrgency: value ?? '' }))
        }
      />

      <div className="flex flex-wrap gap-2">
        <form
          className="flex min-w-[260px] flex-1 gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            router.push(buildUrl({ search: search.trim() }));
          }}
        >
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索 SKU、产品名或变体名"
          />
          <Button type="submit" variant="outline" size="icon" aria-label="搜索">
            <Search className="size-4" />
          </Button>
        </form>
        <Select
          value={filters.country || 'all'}
          onValueChange={(value) =>
            router.push(buildUrl({ country: value === 'all' ? '' : (value ?? '') }))
          }
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="全部国家" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部国家</SelectItem>
            {COUNTRIES.map((country) => (
              <SelectItem key={country} value={country}>
                {country}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center">
          <Boxes className="mx-auto mb-3 size-10 text-muted-foreground/40" />
          <p className="text-sm font-medium">暂无可见的全球库存数据</p>
          <p className="mt-1 text-xs text-muted-foreground">
            无库存记录的 SKU 不会被虚构；若尚未分配海外仓，请联系管理员。
          </p>
        </div>
      ) : (
        <ProductOverviewTable rows={rows} onSelect={setSelectedRow} />
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          共 {totalCount} 个 SKU，第 {page} / {totalPages} 页
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => router.push(buildUrl({ page: page - 1 }))}
          >
            上一页
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => router.push(buildUrl({ page: page + 1 }))}
          >
            下一页
          </Button>
        </div>
      </div>

      {selectedRow && (
        <ProductModal
          key={selectedRow.variantId}
          row={selectedRow}
          open
          onOpenChange={(open) => !open && setSelectedRow(null)}
        />
      )}
    </div>
  );
}
