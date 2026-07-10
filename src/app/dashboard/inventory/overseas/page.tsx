// 海外库存页 — Server Component
// 读取 URL searchParams、校验权限、获取数据
// 查询失败时抛出错误，由 error.tsx 边界捕获
// 客户端交互（筛选/表格/分页）委托给 OverseasPageContent
import { getOverseasInventory } from '@/features/inventory/actions';
import { getOverseasWarehouseSyncStatus } from '@/features/sync/server-actions';
import { getCurrentUser } from '@/lib/auth';
import { OverseasPageContent } from './_components/overseas-page-content';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '海外库存',
};

// ── URL 参数清洗 ────────────────────────────────────────────────────────────
// 旧 URL / 书签 / 外部链接可能携带非法参数（如 warehouse=all、country=undefined），
// 这些值会穿透到 inventorySearchSchema（z.string().uuid() / z.enum(...)）导致
// Zod safeParse 失败 → Server Component render 抛错 → Suspense 边界兜底为
// "Recoverable Error"。清洗只做参数过滤，不改 repository/schema/业务口径。

const VALID_COUNTRIES = new Set(['TH', 'ID', 'MY', 'PH', 'VN', 'CN']);
const VALID_STOCK_STATUSES = new Set(['normal', 'low', 'out_of_stock', 'in_transit']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NON_UUID_SENTINELS = new Set(['all', '__all__', 'undefined', 'null']);

function normalizeCountry(v: string | undefined): string | undefined {
  if (!v) return undefined;
  return VALID_COUNTRIES.has(v) ? v : undefined;
}

function normalizeStockStatus(v: string | undefined): string | undefined {
  if (!v) return undefined;
  return VALID_STOCK_STATUSES.has(v) ? v : undefined;
}

function normalizeWarehouse(v: string | undefined): string | undefined {
  if (!v) return undefined;
  if (NON_UUID_SENTINELS.has(v)) return undefined;
  return UUID_RE.test(v) ? v : undefined;
}

function normalizeSearch(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export default async function OverseasInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; country?: string; warehouse?: string; stockStatus?: string; page?: string; pageSize?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = [20, 50, 100].includes(Number(sp.pageSize)) ? Number(sp.pageSize) : 20;

  // 清洗 URL 参数：非法值转为 undefined，避免 Zod 校验失败导致 Server Component 渲染崩溃
  const cleanCountry = normalizeCountry(sp.country);
  const cleanWarehouse = normalizeWarehouse(sp.warehouse);
  const cleanStockStatus = normalizeStockStatus(sp.stockStatus);
  const cleanSearch = normalizeSearch(sp.search);

  const [data, syncStatus, currentUser] = await Promise.all([
    getOverseasInventory({
      search: cleanSearch,
      country: cleanCountry,
      warehouseId: cleanWarehouse,
      stockStatus: cleanStockStatus as 'normal' | 'low' | 'out_of_stock' | 'in_transit' | undefined,
      page,
      pageSize,
    }),
    getOverseasWarehouseSyncStatus().catch(() => ({})),
    getCurrentUser(),
  ]);

  // 仅传清洗后的值给客户端，避免 UI 再次带出坏 query
  return (
    <OverseasPageContent
      stats={data.stats}
      warehouses={data.warehouses}
      result={data.result}
      syncStatus={syncStatus}
      filters={{
        search: cleanSearch ?? '',
        country: cleanCountry ?? '',
        warehouse: cleanWarehouse ?? '',
        stockStatus: cleanStockStatus ?? '',
      }}
      canBindProduct={currentUser?.roleName === 'admin'}
    />
  );
}
