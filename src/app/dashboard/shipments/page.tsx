// P3-S2A: 在途列表 — Server Component
// 读取 URL searchParams、校验权限、获取数据
// 查询失败时抛出错误，由 error.tsx 边界捕获
// 客户端交互（筛选/表格/分页）委托给 ShipmentsPageContent
import { getCurrentActiveUser } from '@/lib/auth';
import { listShipments } from '@/features/shipments/actions';
import { ShipmentsPageContent } from './_components/shipments-page-content';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '在途管理 — DIS 库存看板',
};

export default async function ShipmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ country?: string; status?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);

  const [result, user] = await Promise.all([
    listShipments({
      country: sp.country,
      status: sp.status,
      page,
    }),
    getCurrentActiveUser(),
  ]);

  if (!result.success) {
    throw new Error(result.error ?? '加载在途列表失败');
  }

  const { data, total, pageSize } = result.data!;

  return (
    <ShipmentsPageContent
      data={data}
      total={total}
      page={page}
      pageSize={pageSize}
      filters={{
        country: sp.country ?? '',
        status: sp.status ?? '',
      }}
      isAdmin={user?.roleName === 'admin'}
    />
  );
}
