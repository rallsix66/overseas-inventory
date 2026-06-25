// SKU 管理 — 加载骨架
import { Skeleton } from '@/components/ui/skeleton';

export default function VariantsLoading() {
  return (
    <div className="px-6">
      {/* 页头骨架 */}
      <Skeleton className="h-7 w-28 mb-5" />

      {/* 标签栏 + 搜索框骨架 */}
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-9 w-[220px]" />
        <Skeleton className="h-9 w-[260px]" />
      </div>

      {/* 表格表头骨架 */}
      <Skeleton className="h-10 w-full mb-0.5 rounded-t-md" />
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full mb-0.5" />
      ))}
    </div>
  );
}
