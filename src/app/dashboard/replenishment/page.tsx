import type { Metadata } from 'next';
import { requireActiveAuth } from '@/lib/auth';
import { replenishmentRepository } from '@/features/replenishment/repository';
import { replenishmentFiltersSchema } from '@/features/replenishment/schema';
import { warehouseRepository } from '@/features/warehouse/repository';
import { ReplenishmentPageContent } from './_components/replenishment-page-content';

export const metadata: Metadata = { title: '预测式补货' };

export default async function ReplenishmentPage({
  searchParams,
}: {
  searchParams: Promise<{
    country?: string;
    warehouseId?: string;
    urgency?: string;
    search?: string;
    includeZero?: string;
    page?: string;
  }>;
}) {
  const [user, params] = await Promise.all([requireActiveAuth(), searchParams]);
  const parsed = replenishmentFiltersSchema.safeParse({
    country: params.country || undefined,
    warehouseId: params.warehouseId || undefined,
    urgency: params.urgency || undefined,
    search: params.search || undefined,
    includeZero: params.includeZero === 'true',
    page: params.page ?? 1,
    pageSize: 20,
  });
  const filters = parsed.success ? parsed.data : replenishmentFiltersSchema.parse({});

  const [result, warehouses] = await Promise.all([
    replenishmentRepository.getSuggestions(user.id, filters),
    warehouseRepository.listReplenishmentParams(),
  ]);

  return (
    <ReplenishmentPageContent
      rows={result.data}
      total={result.total}
      page={result.page}
      pageSize={result.pageSize}
      filters={{
        country: filters.country ?? '',
        warehouseId: filters.warehouseId ?? '',
        urgency: filters.urgency ?? '',
        search: filters.search ?? '',
        includeZero: filters.includeZero,
      }}
      warehouses={warehouses}
      isAdmin={user.roleName === 'admin'}
    />
  );
}

