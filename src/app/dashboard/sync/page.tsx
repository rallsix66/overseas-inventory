// 库存同步页 — Server Component
// 获取当前用户角色和同步运行列表，传递数据给客户端组件
// 查询失败时抛出错误，由 error.tsx 边界捕获
import { getCurrentActiveUser } from '@/lib/auth';
import { getSyncRuns, getOverseasWarehouseOptions } from '@/features/sync/server-actions';
import { SyncPageContent } from './_components/sync-page-content';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '库存同步',
};

export default async function SyncPage() {
  const user = await getCurrentActiveUser();
  const [runs, warehouses] = await Promise.all([
    getSyncRuns(),
    getOverseasWarehouseOptions(),
  ]);

  return (
    <SyncPageContent
      runs={runs}
      isAdmin={user?.roleName === 'admin'}
      warehouses={warehouses}
    />
  );
}
