// 库存同步页 — Server Component
// 获取当前用户角色和同步运行列表（服务端分页），传递数据给客户端组件
// 查询失败时抛出错误，由 error.tsx 边界捕获
import { getCurrentActiveUser } from '@/lib/auth';
import { getSyncRunsPaginated, getOverseasWarehouseOptions } from '@/features/sync/server-actions';
import { SyncPageContent } from './_components/sync-page-content';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '库存同步',
};

export default async function SyncPage() {
  const user = await getCurrentActiveUser();
  const [paginated, warehouses] = await Promise.all([
    getSyncRunsPaginated(),
    getOverseasWarehouseOptions(),
  ]);

  return (
    <SyncPageContent
      initialRows={paginated.rows}
      initialTotal={paginated.total}
      initialPage={paginated.page}
      initialPageSize={paginated.pageSize}
      isAdmin={user?.roleName === 'admin'}
      warehouses={warehouses}
    />
  );
}
