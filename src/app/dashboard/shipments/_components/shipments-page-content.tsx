'use client';

// P3-S2A: 在途列表 — 客户端交互层
// 处理筛选、表格渲染和分页导航
// 查询错误由 error.tsx 边界处理，本组件不渲染错误状态
import { useRouter } from 'next/navigation';
import { Plus, Ship } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { shipmentColumns } from '@/features/shipments/columns';
import type { ShipmentListItem } from '@/features/shipments/types';

const COUNTRIES = [
  { value: 'TH', label: '泰国' },
  { value: 'ID', label: '印尼' },
  { value: 'MY', label: '马来西亚' },
  { value: 'PH', label: '菲律宾' },
  { value: 'VN', label: '越南' },
  { value: 'CN', label: '中国' },
];

const STATUSES = [
  { value: 'booking', label: '订舱' },
  { value: 'loading', label: '装柜' },
  { value: 'departed', label: '离港' },
  { value: 'arrived', label: '到港' },
  { value: 'customs', label: '清关' },
];

interface Filters {
  country: string;
  status: string;
}

interface Props {
  data: ShipmentListItem[];
  total: number;
  page: number;
  pageSize: number;
  filters: Filters;
}

export function ShipmentsPageContent({ data, total, page, pageSize, filters }: Props) {
  const router = useRouter();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function buildUrl(overrides: Partial<Filters> & { page?: number }) {
    const next = { ...filters, page: 1, ...overrides };
    const params = new URLSearchParams();
    if (next.country) params.set('country', next.country);
    if (next.status) params.set('status', next.status);
    if ((next.page ?? 1) > 1) params.set('page', String(next.page));
    const qs = params.toString();
    return `/dashboard/shipments${qs ? `?${qs}` : ''}`;
  }

  return (
    <div className="px-4 sm:px-6 py-4 sm:py-6">
      {/* 页头 */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">在途管理</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            手动创建和跟踪在途物流记录
          </p>
        </div>
        <Button size="sm" onClick={() => router.push('/dashboard/shipments/new')}>
          <Plus className="w-4 h-4 mr-1.5" />
          新建在途
        </Button>
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-wrap gap-2 mb-5">
        <Select
          value={filters.country || 'all'}
          onValueChange={(v) => router.push(buildUrl({ country: !v || v === 'all' ? '' : v }))}
        >
          <SelectTrigger size="sm" className="w-[120px]">
            <SelectValue placeholder="全部国家" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部国家</SelectItem>
            {COUNTRIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.status || 'all'}
          onValueChange={(v) => router.push(buildUrl({ status: !v || v === 'all' ? '' : v }))}
        >
          <SelectTrigger size="sm" className="w-[120px]">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* 清除筛选 */}
        {(filters.country || filters.status) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/dashboard/shipments')}
          >
            清除
          </Button>
        )}
      </div>

      {/* 空数据状态 */}
      {data.length === 0 && (
        <div className="text-center py-16">
          <Ship className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {filters.country || filters.status
              ? '未找到匹配的在途记录'
              : '暂无在途记录'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {!filters.country && !filters.status
              ? '点击「新建在途」手动创建在途物流记录'
              : '请尝试调整筛选条件'}
          </p>
        </div>
      )}

      {/* 表格 */}
      {data.length > 0 && (
        <>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  {shipmentColumns.map((col) => (
                    <TableHead key={col.key} className={col.className}>
                      {col.header}
                    </TableHead>
                  ))}
                  <TableHead className="w-[60px]">{/* 操作 */}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((item) => (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => router.push(`/dashboard/shipments/${item.id}`)}
                  >
                    {shipmentColumns.map((col) => (
                      <TableCell key={col.key} className={col.className}>
                        {col.render!(item)}
                      </TableCell>
                    ))}
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/dashboard/shipments/${item.id}`);
                        }}
                      >
                        详情
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* 分页 */}
          <div className="flex items-center justify-between mt-5">
            <p className="text-sm text-muted-foreground">
              共 {total} 条，第 {page} / {totalPages} 页
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
        </>
      )}
    </div>
  );
}
