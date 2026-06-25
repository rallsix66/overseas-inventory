// SKU 管理页 — Server Component
// 读取 URL searchParams、校验身份、获取 SKU 列表
// 查询失败时抛出错误，由 error.tsx 边界捕获
// 客户端交互（筛选标签/复选框/归档恢复）委托给 VariantPageContent
import { requireActiveAuth } from '@/lib/auth';
import { variantRepository } from '@/features/variants/repository';
import { VariantPageContent } from './_components/variant-page-content';
import type { Metadata } from 'next';
import type { VariantArchiveStatus } from '@/features/variants/types';

export const metadata: Metadata = {
  title: 'SKU 管理',
};

export default async function VariantsPage({
  searchParams,
}: {
  searchParams: Promise<{ archiveStatus?: string; page?: string; search?: string }>;
}) {
  const user = await requireActiveAuth();
  const sp = await searchParams;
  const isAdmin = user.roleName === 'admin';

  // Operator 只能看活跃 SKU；Admin 可切换 active/archived/all
  const rawArchiveStatus = sp.archiveStatus ?? 'active';
  const archiveStatus: VariantArchiveStatus =
    !isAdmin || !['active', 'archived', 'all'].includes(rawArchiveStatus)
      ? 'active'
      : (rawArchiveStatus as VariantArchiveStatus);

  const page = Math.max(1, Number(sp.page) || 1);
  const search = sp.search?.trim() || undefined;

  const result = await variantRepository.list({
    archiveStatus,
    search,
    page,
    pageSize: 20,
  });

  return (
    <div className="px-6">
      <h1 className="text-xl font-semibold mb-5">SKU 管理</h1>
      <VariantPageContent
        result={result}
        isAdmin={isAdmin}
        archiveStatus={archiveStatus}
        search={sp.search ?? ''}
      />
    </div>
  );
}
