'use client';

// 海外库存页 — 客户端交互层
// 处理筛选、表格渲染和分页导航
// 查询错误由 error.tsx 边界处理，本组件不渲染错误状态
import { useOptimistic, startTransition, useState, useRef, useEffect, Fragment, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Package, AlertTriangle, Clock, RefreshCw, Star, Truck, ChevronDown, ChevronRight, Download, X } from 'lucide-react';
import { toast } from 'sonner';
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
import { Pagination } from '@/components/ui/pagination';
import { toggleFavoriteAction } from '@/features/preferences/actions';
import { exportOverseasInventoryCsv } from '@/features/inventory/actions';
import { InTransitDetailRow } from '@/features/shipments/components/in-transit-detail-row';
import { BindProductDialog } from '@/features/inventory/components/bind-product-dialog';
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
  /** P6-UX-V2-D: Admin 才允许绑定产品。Operator 不显示绑定入口（Server Action 另有 requireActiveAdmin 双重保护）。 */
  canBindProduct: boolean;
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  colorClass,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  colorClass?: string;
  onClick?: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border bg-card p-4 ${onClick ? 'cursor-pointer hover:shadow-md hover:border-gray-300 transition-shadow' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
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

/**
 * P5-SY12: 星标关注按钮 — 乐观更新
 *
 * PERF-S1D: 移除 router.refresh()，仅乐观更新。关注状态不改变库存数量/统计/在途数据。
 * toggleFavoriteAction 内 revalidatePath 已处理缓存失效，下次导航自动获取最新数据。
 *
 * - 乐观更新即时切换星标 UI
 * - 成功：以服务端返回的 isFavorited 为准
 * - 失败：回滚乐观状态 + toast.error 提示
 */
function FavoriteStar({
  variantId,
  initialFavorited,
}: {
  variantId: string;
  initialFavorited: boolean;
}) {
  const [optimisticFavorited, setOptimisticFavorited] = useOptimistic(
    initialFavorited,
    (_state: boolean, next: boolean) => next
  );

  function handleClick() {
    startTransition(async () => {
      const next = !optimisticFavorited;
      setOptimisticFavorited(next);
      try {
        const result = await toggleFavoriteAction(variantId);
        if (!result.success) {
          // 失败：回滚乐观状态 + toast
          setOptimisticFavorited(!next);
          toast.error(result.error ?? '关注操作失败');
          return;
        }
        // 成功：以服务端返回为准更新本地状态
        setOptimisticFavorited(result.data!.isFavorited);
      } catch {
        // 异常：回滚 + toast
        setOptimisticFavorited(!next);
        toast.error('关注操作失败，请稍后重试');
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
        optimisticFavorited
          ? 'text-amber-500 hover:text-amber-600 hover:bg-amber-50'
          : 'text-gray-300 hover:text-amber-400 hover:bg-gray-50'
      }`}
      title={optimisticFavorited ? '取消关注' : '关注'}
    >
      <Star
        className={`w-4 h-4 ${optimisticFavorited ? 'fill-current' : ''}`}
      />
    </button>
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

// ── P6-UX-V2-D: 列宽拖拽伸缩（模块级常量，不依赖 component props/state）──

const COL_STORAGE_KEY = 'overseasInventoryColumnWidths';

const COL_DEFAULTS: Record<string, number> = {
  expand: 28, favorite: 36, country: 70, warehouse: 100,
  productName: 320, sku: 140, quantity: 80, inTransit: 60,
  total: 85, safetyStock: 75, status: 80, syncStatus: 110,
};

const COL_MIN: Record<string, number> = {
  expand: 28, favorite: 36, country: 50, warehouse: 70,
  productName: 220, sku: 80, quantity: 60, inTransit: 50,
  total: 60, safetyStock: 60, status: 60, syncStatus: 80,
};

const COL_MAX: Record<string, number> = {
  expand: 28, favorite: 36, country: 150, warehouse: 300,
  productName: 640, sku: 300, quantity: 150, inTransit: 120,
  total: 150, safetyStock: 120, status: 150, syncStatus: 200,
};

/** 可见列宽拖拽分隔线 — 模块级组件，不在 render 内创建 */
function ResizeHandle({
  columnKey,
  label,
  isActive,
  onResizeStart,
  onReset,
}: {
  columnKey: string;
  label: string;
  isActive: boolean;
  onResizeStart: (key: string, e: React.MouseEvent) => void;
  onReset: (key: string) => void;
}) {
  return (
    <div
      className="absolute right-0 top-0 bottom-0 w-6 z-10 cursor-col-resize flex items-center justify-center group"
      onMouseDown={(e) => onResizeStart(columnKey, e)}
      onDoubleClick={(e) => { e.stopPropagation(); onReset(columnKey); }}
      title="拖拽调整列宽，双击恢复默认"
      aria-label={`调整${label}列宽`}
    >
      <div
        className={`h-full transition-colors ${
          isActive
            ? 'w-0.5 bg-blue-500'
            : 'w-px bg-gray-200 group-hover:w-0.5 group-hover:bg-blue-400'
        }`}
      />
    </div>
  );
}

export function OverseasPageContent({ stats, warehouses, result, syncStatus, filters, canBindProduct }: Props) {
  const router = useRouter();
  const { data, total, page, pageSize } = result;

  // P3-S2E: 行展开状态 — 记录展开的 (variantId, warehouseId)
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // P6-CSV-EXPORT: 导出按钮 loading 状态
  const [exporting, setExporting] = useState(false);

  // P6-UX-V2-D: 产品绑定 Dialog 状态
  const [bindTarget, setBindTarget] = useState<{ variantId: string; sku: string } | null>(null);

  // ── P6-UX-V2-D: 列宽拖拽伸缩 ────────────────────────────────────────────

  // 初始化不读 localStorage，避免 SSR hydration mismatch
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({ ...COL_DEFAULTS });
  const [activeResizeKey, setActiveResizeKey] = useState<string | null>(null);

  const resizeRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const colWidthsRef = useRef(columnWidths);
  colWidthsRef.current = columnWidths;

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const state = resizeRef.current;
      if (!state) return;
      const delta = e.clientX - state.startX;
      const min = COL_MIN[state.key] ?? 50;
      const max = COL_MAX[state.key] ?? 640;
      const newWidth = Math.min(max, Math.max(min, state.startWidth + delta));
      setColumnWidths((prev) => {
        const next = { ...prev, [state.key]: newWidth };
        try { localStorage.setItem(COL_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    };
    const onMouseUp = () => {
      resizeRef.current = null;
      setActiveResizeKey(null);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // Hydrate 列宽：客户端 mount 后从 localStorage 读取并 clamp
  useEffect(() => {
    try {
      const stored = localStorage.getItem(COL_STORAGE_KEY);
      if (!stored) return;
      const parsed: unknown = JSON.parse(stored);
      if (typeof parsed !== 'object' || parsed === null) return;
      const next: Record<string, number> = { ...COL_DEFAULTS };
      let hasValid = false;
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === 'number' && key in COL_DEFAULTS) {
          const min = COL_MIN[key] ?? 50;
          const max = COL_MAX[key] ?? 640;
          next[key] = Math.min(max, Math.max(min, value));
          hasValid = true;
        }
      }
      if (hasValid) startTransition(() => setColumnWidths(next));
    } catch { /* ignore */ }
  }, []);

  function handleResizeStart(key: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setActiveResizeKey(key);
    resizeRef.current = {
      key,
      startX: e.clientX,
      startWidth: colWidthsRef.current[key] ?? COL_DEFAULTS[key] ?? 100,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function resetColumnWidth(key: string) {
    setColumnWidths((prev) => {
      const next = { ...prev, [key]: COL_DEFAULTS[key] ?? 100 };
      try { localStorage.setItem(COL_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  // 表格固定布局总宽度
  const totalTableWidth = useMemo(
    () => Object.values(columnWidths).reduce((sum, w) => sum + w, 0),
    [columnWidths],
  );

  /** P6-UI-CLARITY: 统计卡片点击 → 设置对应筛选 */
  function handleStatCardClick(type: 'all' | 'low') {
    if (type === 'low') {
      router.push(buildUrl({ stockStatus: 'low' }), { scroll: false });
    } else {
      router.push('/dashboard/inventory/overseas', { scroll: false });
    }
  }

  /** P6-UX-V2-D: "绑定产品"入口 — 打开 BindProductDialog 执行真实绑定 */
  function handleBindProduct(variantId: string, sku: string) {
    setBindTarget({ variantId, sku });
  }

  /** 触发 CSV 导出下载 */
  async function handleExportCsv() {
    setExporting(true);
    try {
      const result = await exportOverseasInventoryCsv({
        country: filters.country || undefined,
        warehouseId: filters.warehouse || undefined,
        stockStatus: filters.stockStatus || undefined,
        search: filters.search || undefined,
      });

      if (!result.success || !result.data) {
        toast.error(result.error ?? '导出失败');
        return;
      }

      // Blob + download
      const blob = new Blob([result.data], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const today = new Date().toISOString().slice(0, 10);
      a.download = `overseas-inventory-${today.replace(/-/g, '')}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast.error('导出失败，请稍后重试');
    } finally {
      setExporting(false);
    }
  }

  function toggleExpand(item: InventoryItem) {
    const key = `${item.variantId}:${item.warehouseId}`;
    setExpandedKey((prev) => (prev === key ? null : key));
  }

  function buildUrl(overrides: Partial<Filters> & { page?: number; pageSize?: number }) {
    // pageSize 变更时 page 重置为 1
    const pageToUse = 'pageSize' in overrides ? 1 : (overrides.page ?? 1);
    const next = { ...filters, ...overrides, page: pageToUse };
    const params = new URLSearchParams();
    if (next.search) params.set('search', next.search);
    if (next.country) params.set('country', next.country);
    if (next.warehouse) params.set('warehouse', next.warehouse);
    if (next.stockStatus) params.set('stockStatus', next.stockStatus);
    if ((next.page ?? 1) > 1) params.set('page', String(next.page));
    // pageSize 非默认值时才写入 URL
    const ps = next.pageSize ?? pageSize;
    if (ps !== 20) params.set('pageSize', String(ps));
    const qs = params.toString();
    return `/dashboard/inventory/overseas${qs ? `?${qs}` : ''}`;
  }

  function handleSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const q = (formData.get('search') as string)?.trim() ?? '';
    router.push(buildUrl({ search: q }), { scroll: false });
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

  /** P6-UX-V2: 筛选状态标签中文映射 */
  const STOCK_STATUS_LABELS: Record<string, string> = {
    low: '低库存',
    normal: '正常',
    out_of_stock: '缺货',
  };

  const countryLabel = COUNTRIES.find((c) => c.value === filters.country)?.label;
  const warehouseLabel = warehouses.find((w) => w.id === filters.warehouse)?.name;
  const stockStatusLabel = STOCK_STATUS_LABELS[filters.stockStatus];

  /** 是否有任何生效的筛选条件 */
  const hasActiveFilters = !!(filters.search || filters.country || filters.warehouse || filters.stockStatus);

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
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        <StatCard
          icon={Package}
          label="库存总量"
          value={stats.totalQuantity.toLocaleString()}
          colorClass="bg-blue-50 text-blue-600"
          onClick={() => handleStatCardClick('all')}
        />
        <StatCard
          icon={Package}
          label="SKU 数量"
          value={stats.skuCount.toLocaleString()}
          colorClass="bg-indigo-50 text-indigo-600"
          onClick={() => handleStatCardClick('all')}
        />
        <StatCard
          icon={AlertTriangle}
          label="低库存"
          value={stats.lowStockCount.toLocaleString()}
          sub={stats.skuCount > 0 ? `占比 ${Math.round((stats.lowStockCount / stats.skuCount) * 100)}%` : undefined}
          colorClass={stats.lowStockCount > 0 ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}
          onClick={() => handleStatCardClick('low')}
        />
        <StatCard
          icon={Clock}
          label="最后同步"
          value={formatTime(stats.lastSyncAt)}
          colorClass="bg-slate-50 text-slate-600"
        />
        {/* P6-UX-V2-B: 在途库存卡片不可点击。
            在途数据来自 shipment 聚合（getInTransitConfirmedAggregate），
            不是 inventory 表的筛选维度。后端不支持按 "有在途数量" 筛选 inventory 列表，
            需扩展 Repository 和数据查询后才能实现真实联动。避免制造无效跳转。 */}
        <StatCard
          icon={Truck}
          label="在途库存"
          value={stats.inTransitTotalQuantity.toLocaleString()}
          sub={`${stats.inTransitSkuCount} 个 SKU`}
          colorClass="bg-cyan-50 text-cyan-600"
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
          onValueChange={(v) => router.push(buildUrl({ country: !v || v === 'all' ? '' : v }), { scroll: false })}
        >
          <SelectTrigger size="sm" className="w-[110px]">
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
          value={filters.warehouse || 'all'}
          onValueChange={(v) => router.push(buildUrl({ warehouse: !v || v === 'all' ? '' : v }), { scroll: false })}
        >
          <SelectTrigger size="sm" className="w-[130px]">
            <SelectValue placeholder="全部仓库" />
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
          onValueChange={(v) => router.push(buildUrl({ stockStatus: !v || v === 'all' ? '' : v }), { scroll: false })}
        >
          <SelectTrigger size="sm" className="w-[110px]">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            {STOCK_STATUSES.map((s) => (
              <SelectItem key={s.value || 'all'} value={s.value || 'all'}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* P6-CSV-EXPORT: 导出 CSV */}
        <Button
          variant="outline"
          size="sm"
          disabled={exporting || total === 0}
          onClick={handleExportCsv}
        >
          <Download className="w-4 h-4 mr-1.5" />
          {exporting ? '导出中...' : '导出 CSV'}
        </Button>
      </div>

      {/* P6-UX-V2: 筛选状态标签 — 不受 data.length 影响，有筛选条件即显示 */}
      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs text-muted-foreground mr-1">当前筛选：</span>
          {filters.country && countryLabel && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
              国家：{countryLabel}
              <button
                type="button"
                onClick={() => router.push(buildUrl({ country: '' }), { scroll: false })}
                className="inline-flex items-center ml-0.5 hover:text-blue-900"
                aria-label={`清除国家筛选 ${countryLabel}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {filters.warehouse && warehouseLabel && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
              仓库：{warehouseLabel}
              <button
                type="button"
                onClick={() => router.push(buildUrl({ warehouse: '' }), { scroll: false })}
                className="inline-flex items-center ml-0.5 hover:text-blue-900"
                aria-label={`清除仓库筛选 ${warehouseLabel}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {filters.stockStatus && stockStatusLabel && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700">
              状态：{stockStatusLabel}
              <button
                type="button"
                onClick={() => router.push(buildUrl({ stockStatus: '' }), { scroll: false })}
                className="inline-flex items-center ml-0.5 hover:text-amber-900"
                aria-label={`清除状态筛选 ${stockStatusLabel}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {filters.search && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
              搜索：{filters.search}
              <button
                type="button"
                onClick={() => router.push(buildUrl({ search: '' }), { scroll: false })}
                className="inline-flex items-center ml-0.5 hover:text-gray-900"
                aria-label={`清除搜索 ${filters.search}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          <Button
            variant="ghost"
            size="xs"
            onClick={() => router.push('/dashboard/inventory/overseas', { scroll: false })}
            className="h-5 px-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            清空筛选
          </Button>
        </div>
      )}

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
            <Table style={{ tableLayout: 'fixed', width: totalTableWidth, minWidth: totalTableWidth }}>
              {/* P6-UX-V2-D: colgroup 控制列宽，支持拖拽伸缩 */}
              <colgroup>
                <col style={{ width: columnWidths.expand }} />
                <col style={{ width: columnWidths.favorite }} />
                <col style={{ width: columnWidths.country }} />
                <col style={{ width: columnWidths.warehouse }} />
                <col style={{ width: columnWidths.productName }} />
                <col style={{ width: columnWidths.sku }} />
                <col style={{ width: columnWidths.quantity }} />
                <col style={{ width: columnWidths.inTransit }} />
                <col style={{ width: columnWidths.total }} />
                <col style={{ width: columnWidths.safetyStock }} />
                <col style={{ width: columnWidths.status }} />
                <col style={{ width: columnWidths.syncStatus }} />
              </colgroup>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead />
                  <TableHead>关注</TableHead>
                  <TableHead className="relative">
                    <span>国家</span>
                    <ResizeHandle columnKey="country" label="国家" isActive={activeResizeKey === 'country'} onResizeStart={handleResizeStart} onReset={resetColumnWidth} />
                  </TableHead>
                  <TableHead className="relative">
                    <span>仓库</span>
                    <ResizeHandle columnKey="warehouse" label="仓库" isActive={activeResizeKey === 'warehouse'} onResizeStart={handleResizeStart} onReset={resetColumnWidth} />
                  </TableHead>
                  <TableHead className="relative">
                    <span>产品名称</span>
                    <ResizeHandle columnKey="productName" label="产品名称" isActive={activeResizeKey === 'productName'} onResizeStart={handleResizeStart} onReset={resetColumnWidth} />
                  </TableHead>
                  <TableHead className="relative">
                    <span>SKU</span>
                    <ResizeHandle columnKey="sku" label="SKU" isActive={activeResizeKey === 'sku'} onResizeStart={handleResizeStart} onReset={resetColumnWidth} />
                  </TableHead>
                  <TableHead className="relative text-right">
                    <span>当前库存</span>
                    <ResizeHandle columnKey="quantity" label="当前库存" isActive={activeResizeKey === 'quantity'} onResizeStart={handleResizeStart} onReset={resetColumnWidth} />
                  </TableHead>
                  <TableHead className="relative text-right">
                    <span>在途</span>
                    <ResizeHandle columnKey="inTransit" label="在途" isActive={activeResizeKey === 'inTransit'} onResizeStart={handleResizeStart} onReset={resetColumnWidth} />
                  </TableHead>
                  <TableHead className="relative text-right">
                    <span>库存+在途</span>
                    <ResizeHandle columnKey="total" label="库存+在途" isActive={activeResizeKey === 'total'} onResizeStart={handleResizeStart} onReset={resetColumnWidth} />
                  </TableHead>
                  <TableHead className="relative text-right">
                    <span>安全库存</span>
                    <ResizeHandle columnKey="safetyStock" label="安全库存" isActive={activeResizeKey === 'safetyStock'} onResizeStart={handleResizeStart} onReset={resetColumnWidth} />
                  </TableHead>
                  <TableHead className="relative">
                    <span>库存状态</span>
                    <ResizeHandle columnKey="status" label="库存状态" isActive={activeResizeKey === 'status'} onResizeStart={handleResizeStart} onReset={resetColumnWidth} />
                  </TableHead>
                  <TableHead className="relative">
                    <span>同步状态</span>
                    <ResizeHandle columnKey="syncStatus" label="同步状态" isActive={activeResizeKey === 'syncStatus'} onResizeStart={handleResizeStart} onReset={resetColumnWidth} />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((item) => {
                  const whSync = syncStatus[item.warehouseId];
                  const expandKey = `${item.variantId}:${item.warehouseId}`;
                  const isExpanded = expandedKey === expandKey;
                  return (
                  <Fragment key={item.id}>
                  <TableRow
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => toggleExpand(item)}
                  >
                    <TableCell>
                      {isExpanded ? (
                        <ChevronDown className="size-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-3.5 text-muted-foreground" />
                      )}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <FavoriteStar
                        variantId={item.variantId}
                        initialFavorited={item.isFavorited}
                      />
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                        {item.country}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">{item.warehouseName}</TableCell>
                    <TableCell className="text-sm min-w-0">
                      {item.matchStatus === 'matched' ? (
                        <div className="flex flex-col min-w-0">
                          {/* 主行：BigSeller 原始品名（始终显示） */}
                          <span className="min-w-0 truncate">
                            {item.variantName ?? item.productName ?? <span className="text-muted-foreground">—</span>}
                          </span>
                          {/* 辅助信息：标准产品绑定信息 */}
                          {item.standardProductName ? (
                            <span className="text-xs text-muted-foreground truncate">
                              标准品：{item.standardProductName}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground truncate italic">
                              已匹配标准品缺失
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="flex w-full min-w-0 items-center gap-1.5">
                          {/* 主行：BigSeller 原始品名 */}
                          <span className="min-w-0 flex-1 truncate">
                            {item.variantName ?? item.productName ?? <span className="text-muted-foreground">未匹配产品</span>}
                          </span>
                          {/* 未匹配 Badge — 始终在未匹配/待确认行显示 */}
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-50 text-yellow-700 shrink-0">未匹配</span>
                          {/* P6-UX-V2-D: "绑定产品"入口 — Admin-only，真实绑定到 DIS 标准产品 */}
                          {canBindProduct && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleBindProduct(item.variantId, item.sku); }}
                              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border border-gray-300 text-gray-600 hover:bg-gray-100 hover:border-gray-400 shrink-0 transition-colors"
                            >
                              绑定产品
                            </button>
                          )}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{item.sku}</TableCell>
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
                      {item.inTransitQuantity > 0 ? item.inTransitQuantity : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {item.inTransitQuantity > 0
                        ? (item.quantity + item.inTransitQuantity).toLocaleString()
                        : item.quantity}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                      {item.matchStatus === 'matched' ? item.safetyStock : '—'}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>{getStatusBadge(item)}</TableCell>
                    {/* P5-SY9H: 同步状态（含最近同步时间和失败原因） */}
                    <TableCell className="text-xs" onClick={(e) => e.stopPropagation()}>
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
                  {/* P3-S2E: 展开行 — 在途明细 */}
                  {isExpanded && (
                    <TableRow key={`${item.id}-expand`} className="hover:bg-transparent">
                      <TableCell colSpan={12} className="p-0 border-t-0">
                        <InTransitDetailRow
                          variantId={item.variantId}
                          warehouseId={item.warehouseId}
                          open={isExpanded}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                  </Fragment>
                );
                })}
              </TableBody>
            </Table>
          </div>

          {/* P6-UX-V2: BigSeller 风格分页 */}
          <Pagination
            total={total}
            page={page}
            pageSize={pageSize}
            onPageChange={(p) => router.push(buildUrl({ page: p }), { scroll: false })}
            onPageSizeChange={(ps) => router.push(buildUrl({ pageSize: ps }), { scroll: false })}
          />
        </>
      )}

      {/* P6-UX-V2-D: 产品绑定 Dialog */}
      {bindTarget && (
        <BindProductDialog
          open={!!bindTarget}
          variantId={bindTarget.variantId}
          sku={bindTarget.sku}
          onOpenChange={(open) => { if (!open) setBindTarget(null); }}
          onSuccess={() => {
            setBindTarget(null);
            // router.refresh 保留当前 URL（筛选/分页/pageSize/滚动位置），
            // 配合 Server Action 的 revalidatePath 刷新数据
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
