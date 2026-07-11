// SKU 管理页 — Server Component
// 读取 URL searchParams、校验身份、获取 SKU 列表
// 查询失败时抛出错误，由 error.tsx 边界捕获
// 客户端交互（筛选标签/复选框/归档恢复）委托给 VariantPageContent
//
// P5-SY11G: 归档已迁移为用户级偏好，所有登录用户均可查看全部归档筛选标签
// 并操作自己的归档/恢复。匹配/取消匹配仍仅 Admin。
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

  // 所有登录用户均可切换 active/archived/all 筛选标签（每人独立偏好）
  const rawArchiveStatus = sp.archiveStatus ?? 'active';
  const archiveStatus: VariantArchiveStatus =
    ['active', 'archived', 'all'].includes(rawArchiveStatus)
      ? (rawArchiveStatus as VariantArchiveStatus)
      : 'active';

  const page = Math.max(1, Number(sp.page) || 1);
  const search = sp.search?.trim() || undefined;

  // 传递 userId 用于查询当前用户的个人归档偏好
  const result = await variantRepository.list({
    archiveStatus,
    search,
    page,
    pageSize: 20,
    userId: user.id,
  });

  return (
    <VariantPageContent
      result={result}
      archiveStatus={archiveStatus}
      search={sp.search ?? ''}
    />
  );
}
