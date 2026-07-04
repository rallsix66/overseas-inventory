// 待处理 SKU — Server Component
// 显示活跃的未匹配/待确认 SKU（当前用户已归档 SKU 不显示）
// 无归档筛选标签、无归档/恢复按钮
// Admin 和 Operator 均可查看
//
// P5-SY11G: 排除当前用户已归档 Variant（user_variant_preference），
// 而非全局 is_archived。
//
// UNMATCHED-PAGINATION: getUnmatched 改为分页查询（DB 层 notIn + range）。
import { requireActiveAuth } from '@/lib/auth';
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
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '待处理 SKU',
};

const PAGE_SIZE = 20;

export default async function UnmatchedVariantsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requireActiveAuth();
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const result = await variantRepository.getUnmatched({
    userId: user.id,
    page,
    pageSize: PAGE_SIZE,
  });

  const totalPages = Math.ceil(result.total / PAGE_SIZE);

  return (
    <div className="px-6">
      <h1 className="text-xl font-semibold mb-5">待处理 SKU</h1>

      <p className="text-sm text-muted-foreground mb-4">
        以下 SKU 尚未匹配到标准产品，需要管理员处理。您已归档的 SKU 不在此显示。
      </p>

      {result.data.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg mb-2">暂无待处理 SKU</p>
          <p className="text-sm">
            所有活跃 SKU 均已匹配到标准产品，或尚未有海外仓同步数据。
          </p>
        </div>
      ) : (
        <>
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
                {result.data.map((item) => (
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

          {/* 分页导航 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm">
              <span className="text-muted-foreground">
                第 {page} 页，共 {result.total} 条
              </span>
              <div className="flex items-center gap-2">
                {page > 1 ? (
                  <Link
                    href={`?page=${page - 1}`}
                    className="px-3 py-1.5 border rounded-md hover:bg-gray-50 transition-colors"
                  >
                    上一页
                  </Link>
                ) : (
                  <span className="px-3 py-1.5 border rounded-md text-gray-300 cursor-not-allowed">
                    上一页
                  </span>
                )}
                {page < totalPages ? (
                  <Link
                    href={`?page=${page + 1}`}
                    className="px-3 py-1.5 border rounded-md hover:bg-gray-50 transition-colors"
                  >
                    下一页
                  </Link>
                ) : (
                  <span className="px-3 py-1.5 border rounded-md text-gray-300 cursor-not-allowed">
                    下一页
                  </span>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
