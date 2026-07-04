// 产品详情页 — Phase 1 Task 1.4
// Server Component：读取 params、获取详情数据、处理 404
// 客户端交互（编辑 Sheet）委托给 ProductDetailClient
import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { productRepository } from '@/features/products/repository';
import { ProductDetailClient } from '../_components/product-detail-client';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '产品详情',
};

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // PERF-C2B: getCurrentUser() 与 productRepository.getById(id) 互不依赖，并行执行
  const [user, product] = await Promise.all([
    getCurrentUser(),
    productRepository.getById(id),
  ]);

  const isAdmin = user?.roleName === 'admin';

  if (!product) {
    notFound();
  }

  return <ProductDetailClient product={product} isAdmin={isAdmin} />;
}
