'use client';

// 海外库存页 — 客户端交互层
// 处理筛选、表格渲染和分页导航
// 查询错误由 error.tsx 边界处理，本组件不渲染错误状态
import { useRouter } from 'next/navigation';
import { Search, Package, AlertTriangle, Clock, RefreshCw } from 'lucide-react';
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
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import type { InventoryItem, OverseasStats, WarehouseOption } from '@/features/inventory/types';
import type { WarehouseSyncStatus } from '@/features/sync/types';

const COUNTRIES = [
  { value: 'TH', label: '泰国' },
  { value: 'ID', label: '印尼' },
  { value: 'MY', label: '马来西亚' },
  { value: 'PH', label: '菲律宾' },
  { value: 'VN', label: '越南' },
];

const STOCK_STATUSES = [
  { value: '', label: '全部状态' },
  { value: 'normal', label: '正常' },
  { value: 'low', label: '低库存' },
  { value: 'out_of_stock', label: '缺货' },
];

interface Filters {
  search: string;
  country: string;
  warehouse: string;
  stockStatus: string;
}

interface Props {
  stats: OverseasStats;
  warehouses: WarehouseOption[];
  result: {
    data: InventoryItem[];
    total: number;
    page: number;
    pageSize: number;
  };
  syncStatus: Record<string, WarehouseSyncStatus>;
  filters: Filters;
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  colorClass,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  colorClass?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-4">
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${
          colorClass ?? 'bg-blue-50 text-blue-600'
        }`}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold tabular-nums">{value}</p>
        {sub && <p className="text-xs text-muted-foreground truncate">{sub}</p>}
      </div>
    </div>
  );
}

/** P5-SY9H: 同步状态标签 */
function SyncStatusBadge({ status, failureReason }: { status: string; failureReason?: string | null }) {
  switch (status) {
    case 'success':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-600">
          同步成功
        </span>
      );
    case 'failed':
      return (
        <span
          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700 cursor-help"
          title={failureReason ?? undefined}
        >
          同步失败
        </span>
      );
    case 'in_progress':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
          同步中
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
          未同步
        </span>
      );
  }
}

export function OverseasPageContent({ stats, warehouses, result, syncStatus, filters }: Props) {
  const router = useRouter();
  const { data, total, page, pageSize } = result;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function buildUrl(overrides: Partial<Filters> & { page?: number }) {
    const next = { ...filters, page: 1, ...overrides };
    const params = new URLSearchParams();
    if (next.search) params.set('search', next.search);
    if (next.country) params.set('country', next.country);
    if (next.warehouse) params.set('warehouse', next.warehouse);
    if (next.stockStatus) params.set('stockStatus', next.stockStatus);
    if ((next.page ?? 1) > 1) params.set('page', String(next.page));
    const qs = params.toString();
    return `/dashboard/inventory/overseas${qs ? `?${qs}` : ''}`;
  }

  function handleSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const q = (formData.get('search') as string)?.trim() ?? '';
    router.push(buildUrl({ search: q }));
  }

  const formatTime = (iso: string | null) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  /**
   * 库存状态标签
   *
   * 规则：
   * - quantity = 0 → 缺货（无论是否匹配）
   * - 未匹配 + quantity > 0 → 未匹配（无法判断 low/normal）
   * - 已匹配 + 0 < quantity <= safetyStock → 低库存
   * - 已匹配 + quantity > safetyStock → 正常
   */
  const getStatusBadge = (item: InventoryItem) => {
    // quantity = 0 统一为缺货
    if (item.quantity === 0) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
          缺货
        </span>
      );
    }

    // 未匹配 — 无法判断 low/normal
    if (item.matchStatus !== 'matched') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-50 text-yellow-700">
          未匹配
        </span>
      );
    }

    // 已匹配 + 低库存
    if (item.quantity <= item.safetyStock) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700">
          低库存
        </span>
      );
    }

    // 已匹配 + 正常
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-600">
        正常
      </span>
    );
  };

  return (
    <div className="px-4 sm:px-6 py-4 sm:py-6">
      {/* 页头 */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">海外库存</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            泰国、印尼、马来西亚、菲律宾、越南五大海外仓库存概览
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => router.push('/dashboard/sync')}
        >
          <RefreshCw className="w-4 h-4 mr-1.5" />
          同步管理
        </Button>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard
          icon={Package}
          label="库存总量"
          value={stats.totalQuantity.toLocaleString()}
          colorClass="bg-blue-50 text-blue-600"
        />
        <StatCard
          icon={Package}
          label="SKU 数量"
          value={stats.skuCount.toLocaleString()}
          colorClass="bg-indigo-50 text-indigo-600"
        />
        <StatCard
          icon={AlertTriangle}
          label="低库存"
          value={stats.lowStockCount.toLocaleString()}
          sub={stats.skuCount > 0 ? `占比 ${Math.round((stats.lowStockCount / stats.skuCount) * 100)}%` : undefined}
          colorClass={stats.lowStockCount > 0 ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}
        />
        <StatCard
          icon={Clock}
          label="最后同步"
          value={formatTime(stats.lastSyncAt)}
          colorClass="bg-slate-50 text-slate-600"
        />
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-col sm:flex-row flex-wrap gap-2 mb-5">
        <form onSubmit={handleSearch} className="flex gap-2 flex-1 min-w-0">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              key={`search-${filters.search}`}
              name="search"
              defaultValue={filters.search}
              placeholder="搜索 SKU 或产品名称..."
              className="pl-8"
            />
          </div>
          <Button type="submit" variant="outline" size="sm">
            搜索
          </Button>
        </form>

        <Select
          value={filters.country || 'all'}
          onValueChange={(v) => router.push(buildUrl({ country: !v || v === 'all' ? '' : v }))}
        >
          <SelectTrigger size="sm" className="w-[110px]">
            <SelectValue placeholder="国家" />
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
          value={filters.warehouse || 'all'}
          onValueChange={(v) => router.push(buildUrl({ warehouse: !v || v === 'all' ? '' : v }))}
        >
          <SelectTrigger size="sm" className="w-[130px]">
            <SelectValue placeholder="仓库" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部仓库</SelectItem>
            {warehouses.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.stockStatus || 'all'}
          onValueChange={(v) => router.push(buildUrl({ stockStatus: !v || v === 'all' ? '' : v }))}
        >
          <SelectTrigger size="sm" className="w-[110px]">
            <SelectValue placeholder="状态" />
          </SelectTrigger>
          <SelectContent>
            {STOCK_STATUSES.map((s) => (
              <SelectItem key={s.value || 'all'} value={s.value || 'all'}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* 清除全部筛选 */}
        {(filters.search || filters.country || filters.warehouse || filters.stockStatus) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/dashboard/inventory/overseas')}
          >
            清除
          </Button>
        )}
      </div>

      {/* 空数据状态 */}
      {data.length === 0 && (
        <div className="text-center py-16">
          <Package className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {(filters.search || filters.country || filters.warehouse || filters.stockStatus)
              ? '未找到匹配的库存记录'
              : '暂无海外库存数据'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {!filters.search && !filters.country && !filters.warehouse && !filters.stockStatus
              ? '请执行数据同步以导入库存数据'
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
                  <TableHead>国家</TableHead>
                  <TableHead>仓库</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>产品名称</TableHead>
                  <TableHead className="text-right">当前库存</TableHead>
                  <TableHead className="text-right">安全库存</TableHead>
                  <TableHead>库存状态</TableHead>
                  <TableHead>同步状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((item) => {
                  const whSync = syncStatus[item.warehouseId];
                  return (
                  <TableRow key={item.id}>
                    <TableCell>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                        {item.country}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">{item.warehouseName}</TableCell>
                    <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                    <TableCell className="max-w-[180px] truncate text-sm">
                      {item.productName || (
                        <span className="text-muted-foreground">未匹配</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span
                        className={
                          item.quantity === 0
                            ? 'text-gray-400'
                            : item.matchStatus === 'matched' && item.quantity <= item.safetyStock
                              ? 'text-red-600 font-semibold'
                              : ''
                        }
                      >
                        {item.quantity}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                      {item.matchStatus === 'matched' ? item.safetyStock : '—'}
                    </TableCell>
                    <TableCell>{getStatusBadge(item)}</TableCell>
                    {/* P5-SY9H: 同步状态（含最近同步时间和失败原因） */}
                    <TableCell className="text-xs">
                      <div className="flex flex-col gap-0.5">
                        <SyncStatusBadge
                          status={whSync?.lastSyncStatus ?? 'never'}
                          failureReason={whSync?.lastFailureReason}
                        />
                        {whSync?.lastSyncAt && (
                          <span className="text-muted-foreground">{formatTime(whSync.lastSyncAt)}</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
                })}
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
