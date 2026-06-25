// 待处理 SKU — Server Component
// 显示活跃的未匹配/待确认 SKU（已归档 SKU 不显示）
// 无归档筛选标签、无归档/恢复按钮
// Admin 和 Operator 均可查看
import { requireAuth } from '@/lib/auth';
import { variantRepository } from '@/features/variants/repository';
import { variantColumns } from '@/features/variants/columns';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '待处理 SKU',
};

export default async function UnmatchedVariantsPage() {
  await requireAuth();
  const items = await variantRepository.getUnmatched();

  return (
    <div className="px-6">
      <h1 className="text-xl font-semibold mb-5">待处理 SKU</h1>

      <p className="text-sm text-muted-foreground mb-4">
        以下 SKU 尚未匹配到标准产品，需要管理员处理。已归档 SKU 不在此显示。
      </p>

      {items.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg mb-2">暂无待处理 SKU</p>
          <p className="text-sm">
            所有活跃 SKU 均已匹配到标准产品，或尚未有海外仓同步数据。
          </p>
        </div>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                {variantColumns.map((col) => (
                  <TableHead key={col.key}>{col.header}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id} className="hover:bg-gray-50">
                  {variantColumns.map((col) => (
                    <TableCell key={col.key}>
                      {col.render
                        ? col.render(item)
                        : String(item[col.key as keyof typeof item] ?? '—')}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
