// 库存同步 — 加载骨架
import { Skeleton } from '@/components/ui/skeleton';

export default function SyncLoading() {
  return (
    <div className="px-4 sm:px-6 py-4 sm:py-6">
      {/* 页头骨架 */}
      <Skeleton className="h-6 w-32 mb-1" />
      <Skeleton className="h-4 w-64 mb-5" />

      {/* 筛选栏 + 操作按钮骨架 */}
      <div className="flex items-center justify-between mb-5">
        <Skeleton className="h-8 w-[140px]" />
        <Skeleton className="h-9 w-28" />
      </div>

      {/* 表格表头骨架 */}
      <Skeleton className="h-10 w-full mb-0.5 rounded-t-md" />
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full mb-0.5" />
      ))}
    </div>
  );
}
