// P3-S3: 手动创建在途记录页面
import { getCurrentActiveUser } from '@/lib/auth';
import { shipmentRepository } from '@/features/shipments/repository';
import { ShipmentCreateForm } from '@/features/shipments/components/shipment-create-form';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '新建在途记录 — DIS 库存看板',
};

export default async function NewShipmentPage() {
  const user = await getCurrentActiveUser();

  if (!user) {
    return (
      <div className="px-6 py-12 text-center text-muted-foreground">
        请先登录
      </div>
    );
  }

  // P3-S2E: 仅 Admin 可访问新建页面
  if (user.roleName !== 'admin') {
    return (
      <div className="px-6 py-12 text-center text-muted-foreground">
        仅管理员可创建在途记录
      </div>
    );
  }

  const warehouses = await shipmentRepository.getWarehousesForSelector(user.id);

  return (
    <div>
      <h2 className="px-6 py-4 text-lg font-semibold border-b">新建在途记录</h2>
      <ShipmentCreateForm user={user} warehouses={warehouses} />
    </div>
  );
}
