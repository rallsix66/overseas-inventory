// 在途管理 — 加载骨架
import { Skeleton } from '@/components/ui/skeleton';

export default function ShipmentsLoading() {
  return (
    <div className="px-4 sm:px-6 py-4 sm:py-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-48 mt-1" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="flex gap-2 mb-5">
        <Skeleton className="h-8 w-[120px]" />
        <Skeleton className="h-8 w-[120px]" />
      </div>
      <div className="rounded-md border">
        <div className="bg-gray-50 px-4 py-2.5 border-b">
          <div className="flex gap-8">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="px-4 py-3 border-b last:border-0">
            <div className="flex gap-8">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-12" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-4 w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
