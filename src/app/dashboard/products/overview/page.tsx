import type { Metadata } from 'next';
import { requireActiveAuth } from '@/lib/auth';
import { productOverviewRepository } from '@/features/product-overview/repository';
import { productOverviewParamsSchema } from '@/features/product-overview/schema';
import { ProductOverviewPageContent } from './_components/product-overview-page-content';

export const metadata: Metadata = { title: '全球库存作战室' };

export default async function ProductOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    country?: string;
    stockoutUrgency?: string;
    page?: string;
  }>;
}) {
  const [user, params] = await Promise.all([requireActiveAuth(), searchParams]);
  const parsed = productOverviewParamsSchema.safeParse({
    search: params.search || undefined,
    country: params.country || undefined,
    stockoutUrgency: params.stockoutUrgency || undefined,
    page: params.page ?? 1,
    pageSize: 20,
  });
  const filters = parsed.success ? parsed.data : productOverviewParamsSchema.parse({});
  const result = await productOverviewRepository.getProductOverview(user.id, filters);

  return (
    <ProductOverviewPageContent
      rows={result.items}
      totalCount={result.totalCount}
      queueCounts={result.queueCounts}
      page={result.page}
      pageSize={result.pageSize}
      filters={{
        search: filters.search ?? '',
        country: filters.country ?? '',
        stockoutUrgency: filters.stockoutUrgency ?? '',
      }}
    />
  );
}
