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

export default async function OverseasInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; country?: string; warehouse?: string; stockStatus?: string; page?: string; pageSize?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = [20, 50, 100].includes(Number(sp.pageSize)) ? Number(sp.pageSize) : 20;

  const [data, syncStatus, currentUser] = await Promise.all([
    getOverseasInventory({
      search: sp.search,
      country: sp.country,
      warehouseId: sp.warehouse,
      stockStatus: sp.stockStatus as 'normal' | 'low' | 'out_of_stock' | 'in_transit' | undefined,
      page,
      pageSize,
    }),
    getOverseasWarehouseSyncStatus().catch(() => ({})),
    getCurrentUser(),
  ]);

  return (
    <OverseasPageContent
      stats={data.stats}
      warehouses={data.warehouses}
      result={data.result}
      syncStatus={syncStatus}
      filters={{
        search: sp.search ?? '',
        country: sp.country ?? '',
        warehouse: sp.warehouse ?? '',
        stockStatus: sp.stockStatus ?? '',
      }}
      canBindProduct={currentUser?.roleName === 'admin'}
    />
  );
}
