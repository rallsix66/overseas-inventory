// 产品列表 — 加载骨架
import { Skeleton } from '@/components/ui/skeleton';

export default function ProductsLoading() {
  return (
    <div className="px-6 py-6">
      {/* 页头骨架 */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-48 mt-1.5" />
        </div>
        <Skeleton className="h-8 w-28" />
      </div>

      {/* 搜索栏骨架 */}
      <Skeleton className="h-8 w-full max-w-sm mb-5" />

      {/* 表格骨架 */}
      <Skeleton className="h-10 w-full mb-0.5" />
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full mb-0.5" />
      ))}

      {/* 分页骨架 */}
      <div className="flex items-center justify-between mt-5">
        <Skeleton className="h-4 w-32" />
        <div className="flex gap-2">
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-7 w-16" />
        </div>
      </div>
    </div>
  );
}
