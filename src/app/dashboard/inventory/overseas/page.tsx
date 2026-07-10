// 海外库存页 — Server Component
// 读取 URL searchParams、校验权限、获取数据
// 查询失败时通过 try/catch 显示受控错误态，不依赖 error.tsx 边界
// 客户端交互（筛选/表格/分页）委托给 OverseasPageContent
import { getOverseasInventory } from '@/features/inventory/actions';
import { getOverseasWarehouseSyncStatus } from '@/features/sync/server-actions';
import { getCurrentUser } from '@/lib/auth';
import { OverseasPageContent } from './_components/overseas-page-content';
import { AlertTriangle } from 'lucide-react';
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

  const [syncStatus, currentUser] = await Promise.all([
    getOverseasWarehouseSyncStatus().catch(() => ({})),
    getCurrentUser(),
  ]);

  // 数据查询可能因 Supabase 网络/连接问题失败，通过 try/catch 展示受控错误态
  let data: Awaited<ReturnType<typeof getOverseasInventory>>;
  try {
    data = await getOverseasInventory({
      search: sp.search,
      country: sp.country,
      warehouseId: sp.warehouse,
      stockStatus: sp.stockStatus as 'normal' | 'low' | 'out_of_stock' | 'in_transit' | undefined,
      page,
      pageSize,
    });
  } catch (error) {
    // 保留真实错误信息到服务端日志，方便排查
    console.error('海外库存查询失败:', error);
    return (
      <div className="px-4 sm:px-6 py-20 text-center">
        <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-gray-900 mb-2">加载失败</h2>
        <p className="text-sm text-muted-foreground mb-5 max-w-md mx-auto">
          海外库存查询失败，请检查 Supabase 连接或稍后重试
        </p>
        <p className="text-xs text-muted-foreground/60 mb-5 font-mono">
          {error instanceof Error ? error.message : String(error)}
        </p>
        <a
          href="/dashboard/inventory/overseas"
          className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-gray-300 bg-white hover:bg-gray-50 h-10 px-4 py-2"
        >
          重试
        </a>
      </div>
    );
  }

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
