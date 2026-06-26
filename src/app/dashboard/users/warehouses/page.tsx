// 仓库分配管理页 — Server Component
// P5-SY13B: Admin-only warehouse assignment management
import { getCurrentActiveUser } from '@/lib/auth';
import {
  listOperatorsWithAssignments,
  getAssignableWarehouses,
} from '@/features/warehouse-access/actions';
import { WarehouseAssignmentContent } from '@/features/warehouse-access/components/warehouse-assignment-content';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '仓库分配',
};

export default async function WarehouseAssignmentPage() {
  const user = await getCurrentActiveUser();
  const [operatorsResult, warehousesResult] = await Promise.all([
    listOperatorsWithAssignments(),
    getAssignableWarehouses(),
  ]);

  return (
    <WarehouseAssignmentContent
      operatorsResult={operatorsResult}
      warehousesResult={warehousesResult}
      isAdmin={user?.roleName === 'admin'}
    />
  );
}
