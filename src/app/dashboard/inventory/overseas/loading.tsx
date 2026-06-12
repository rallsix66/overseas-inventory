// 海外库存 — 加载骨架
import { Skeleton } from '@/components/ui/skeleton';

export default function OverseasLoading() {
  return (
    <div className="px-4 sm:px-6 py-4 sm:py-6">
      {/* 页头骨架 */}
      <Skeleton className="h-6 w-32 mb-1" />
      <Skeleton className="h-4 w-64 mb-5" />

      {/* 统计卡片骨架 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[72px] w-full rounded-lg" />
        ))}
      </div>

      {/* 筛选栏骨架 */}
      <div className="flex flex-col sm:flex-row flex-wrap gap-2 mb-5">
        <Skeleton className="h-8 w-full max-w-sm" />
        <Skeleton className="h-8 w-[110px]" />
        <Skeleton className="h-8 w-[130px]" />
        <Skeleton className="h-8 w-[110px]" />
      </div>

      {/* 表格骨架 */}
      <Skeleton className="h-10 w-full mb-0.5 rounded-t-md" />
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
