// 产品列表页 — Phase 1 Task 1.3
// Server Component：读取 URL searchParams、校验权限、获取数据
// 客户端交互（Sheet/表单/Dialog）委托给 ProductsPageContent
import { getCurrentUser } from '@/lib/auth';
import { productRepository } from '@/features/products/repository';
import { ProductsPageContent } from './_components/products-page-content';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '产品列表',
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const isAdmin = user?.roleName === 'admin';
  const page = Math.max(1, Number(sp.page) || 1);

  const result = await productRepository.list({
    search: sp.search,
    page,
  });

  return (
    <ProductsPageContent
      data={result.data}
      total={result.total}
      page={result.page}
      pageSize={result.pageSize}
      search={sp.search ?? ''}
      isAdmin={isAdmin}
    />
  );
}
