// 产品详情 — 加载骨架
import { Skeleton } from '@/components/ui/skeleton';

export default function ProductDetailLoading() {
  return (
    <div className="px-6 py-6">
      {/* 返回按钮骨架 */}
      <Skeleton className="h-7 w-28 mb-4" />

      {/* 标题骨架 */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-32 mt-1.5" />
        </div>
        <Skeleton className="h-7 w-20" />
      </div>

      {/* 信息卡片骨架 */}
      <div className="grid grid-cols-4 gap-4 mb-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="p-4 rounded-lg border">
            <Skeleton className="h-3 w-12 mb-1.5" />
            <Skeleton className="h-5 w-20" />
          </div>
        ))}
      </div>

      {/* SKU 表骨架 */}
      <Skeleton className="h-5 w-20 mb-3" />
      <Skeleton className="h-10 w-full mb-0.5" />
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full mb-0.5" />
      ))}

      {/* 库存表骨架 */}
      <Skeleton className="h-5 w-20 mt-5 mb-3" />
      <Skeleton className="h-10 w-full mb-0.5" />
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full mb-0.5" />
      ))}
    </div>
  );
}
