'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Calculator, PackagePlus, Search, Ship } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { InTransitDetailDialog } from '@/features/replenishment/components/in-transit-detail-dialog';
import { PlannedShipmentDialog } from '@/features/replenishment/components/planned-shipment-dialog';
import { WarehouseParamsDialog } from '@/features/replenishment/components/warehouse-params-dialog';
import type {
  ReplenishmentSuggestion,
  ReplenishmentUrgency,
} from '@/features/replenishment/types';
import type { WarehouseReplenishmentParams } from '@/features/warehouse/types';

const COUNTRIES = ['TH', 'ID', 'MY', 'PH', 'VN'] as const;
const URGENCIES: Array<{ value: ReplenishmentUrgency; label: string }> = [
  { value: 'critical', label: '立即下单' },
  { value: 'warning', label: '尽快下单' },
  { value: 'ok', label: '正常' },
  { value: 'data_incomplete', label: '数据不足' },
];

interface Filters {
  country: string;
  warehouseId: string;
  urgency: string;
  search: string;
  includeZero: boolean;
}

interface Props {
  rows: ReplenishmentSuggestion[];
  total: number;
  page: number;
  pageSize: number;
  filters: Filters;
  warehouses: WarehouseReplenishmentParams[];
  isAdmin: boolean;
}

function urgencyBadge(urgency: ReplenishmentUrgency) {
  const label = URGENCIES.find((item) => item.value === urgency)?.label ?? urgency;
  return <Badge variant={urgency === 'critical' ? 'destructive' : 'outline'}>{label}</Badge>;
}

export function ReplenishmentPageContent({
  rows,
  total,
  page,
  pageSize,
  filters,
  warehouses,
  isAdmin,
}: Props) {
  const router = useRouter();
  const [search, setSearch] = useState(filters.search);
  const [planningRow, setPlanningRow] = useState<ReplenishmentSuggestion | null>(null);
  const [detailRow, setDetailRow] = useState<ReplenishmentSuggestion | null>(null);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function buildUrl(overrides: Partial<Filters> & { page?: number }) {
    const next = { ...filters, page: 1, ...overrides };
    const params = new URLSearchParams();
    if (next.country) params.set('country', next.country);
    if (next.warehouseId) params.set('warehouseId', next.warehouseId);
    if (next.urgency) params.set('urgency', next.urgency);
    if (next.search) params.set('search', next.search);
    if (next.includeZero) params.set('includeZero', 'true');
    if ((next.page ?? 1) > 1) params.set('page', String(next.page));
    const query = params.toString();
    return `/dashboard/replenishment${query ? `?${query}` : ''}`;
  }

  return (
    <div className="px-4 py-4 sm:px-6 sm:py-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
            <Calculator className="size-5" /> 预测式补货
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">按库存位置计算该不该补、补多少与最晚下单日</p>
        </div>
        {isAdmin && <WarehouseParamsDialog initialRows={warehouses} />}
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        <form
          className="flex min-w-[260px] flex-1 gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            router.push(buildUrl({ search: search.trim() }));
          }}
        >
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索 SKU、产品名或编码" />
          <Button type="submit" variant="outline" size="icon" aria-label="搜索"><Search className="size-4" /></Button>
        </form>
        <Select value={filters.country || 'all'} onValueChange={(value) => router.push(buildUrl({ country: value === 'all' ? '' : (value ?? '') }))}>
          <SelectTrigger className="w-[120px]"><SelectValue placeholder="全部国家" /></SelectTrigger>
          <SelectContent><SelectItem value="all">全部国家</SelectItem>{COUNTRIES.map((country) => <SelectItem key={country} value={country}>{country}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={filters.warehouseId || 'all'} onValueChange={(value) => router.push(buildUrl({ warehouseId: value === 'all' ? '' : (value ?? '') }))}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="全部仓库" /></SelectTrigger>
          <SelectContent><SelectItem value="all">全部仓库</SelectItem>{warehouses.map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={filters.urgency || 'all'} onValueChange={(value) => router.push(buildUrl({ urgency: value === 'all' ? '' : (value ?? '') }))}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="全部紧急度" /></SelectTrigger>
          <SelectContent><SelectItem value="all">全部紧急度</SelectItem>{URGENCIES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant={filters.includeZero ? 'default' : 'outline'} onClick={() => router.push(buildUrl({ includeZero: !filters.includeZero }))}>
          {filters.includeZero ? '已显示全部' : '显示零建议/数据不足'}
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="py-16 text-center">
          <PackagePlus className="mx-auto mb-3 size-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">暂无匹配的补货建议</p>
          <p className="mt-1 text-xs text-muted-foreground">无 inventory 行的 SKU 不会生成虚假仓库建议</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader><TableRow className="bg-gray-50"><TableHead>产品 / SKU</TableHead><TableHead>仓库</TableHead><TableHead className="text-right">日均销</TableHead><TableHead className="text-right">在手</TableHead><TableHead className="text-right">有效补给</TableHead><TableHead className="text-right">目标库存</TableHead><TableHead className="text-right">建议补货</TableHead><TableHead>最晚下单</TableHead><TableHead>紧急度</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={`${row.variantId}-${row.warehouseId}`}>
                  <TableCell><p className="font-medium">{row.productName ?? row.variantName}</p><p className="text-xs text-muted-foreground">{row.sku}</p></TableCell>
                  <TableCell><p>{row.warehouseName}</p><p className="text-xs text-muted-foreground">{row.country}</p></TableCell>
                  <TableCell className="text-right">{row.avgDailySales ?? '—'}</TableCell>
                  <TableCell className="text-right">{row.onHand}</TableCell>
                  <TableCell className="text-right">{row.effectiveInbound}</TableCell>
                  <TableCell className="text-right">{row.targetStock ?? '—'}</TableCell>
                  <TableCell className="text-right text-base font-semibold">{row.suggestQty}</TableCell>
                  <TableCell>{row.latestOrderDate ?? '—'}</TableCell>
                  <TableCell>{urgencyBadge(row.urgency)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setDetailRow(row)}><Ship className="size-3.5" />在途</Button>
                      {isAdmin && <Button variant="outline" size="sm" onClick={() => setPlanningRow(row)}>计划发货</Button>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">共 {total} 条，第 {page} / {totalPages} 页</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => router.push(buildUrl({ page: page - 1 }))}>上一页</Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => router.push(buildUrl({ page: page + 1 }))}>下一页</Button>
        </div>
      </div>

      {planningRow && (
        <PlannedShipmentDialog key={`${planningRow.variantId}-${planningRow.warehouseId}`} suggestion={planningRow} open onOpenChange={(open) => !open && setPlanningRow(null)} />
      )}
      {detailRow && (
        <InTransitDetailDialog key={`${detailRow.variantId}-${detailRow.warehouseId}`} suggestion={detailRow} isAdmin={isAdmin} open onOpenChange={(open) => !open && setDetailRow(null)} />
      )}
    </div>
  );
}

