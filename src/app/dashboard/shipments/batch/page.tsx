// P3-S5B4: 批量确认到仓页 — Server Component
// Admin-only：读取当前用户角色 + 首屏合格 shipment 列表
// 客户端交互（选择/展开/数量填写/提交）委托给 BatchWarehousePage
import { getCurrentActiveUser } from '@/lib/auth';
import { shipmentRepository } from '@/features/shipments/repository';
import { redirect } from 'next/navigation';
import { BatchWarehousePage } from '@/features/shipments/components/batch-warehouse-page';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '批量确认到仓',
};

export default async function BatchWarehousePageRoute() {
  const user = await getCurrentActiveUser();

  if (!user || user.roleName !== 'admin') {
    redirect('/dashboard/shipments');
  }

  // 首屏加载第一页合格 shipment（status=customs + warehouse_id IS NOT NULL）
  const initialData = await shipmentRepository.listEligibleForBatchWarehousing(
    { page: 1, pageSize: 20 },
    user.id,
  );

  return <BatchWarehousePage initialData={initialData} />;
}
