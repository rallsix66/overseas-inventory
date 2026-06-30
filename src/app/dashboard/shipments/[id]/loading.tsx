// 在途详情 — 加载骨架
import { Skeleton } from '@/components/ui/skeleton';

export default function ShipmentDetailLoading() {
  return (
    <div className="px-4 sm:px-6 py-4 sm:py-6">
      <Skeleton className="h-8 w-24 mb-5" />

      <div className="flex items-start justify-between mb-5">
        <div>
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-48 mt-1" />
        </div>
        <Skeleton className="h-7 w-16" />
      </div>

      {/* 基本信息骨架 */}
      <div className="rounded-md border mb-5">
        <Skeleton className="h-10 w-full" />
        <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="h-3 w-12 mb-1" />
              <Skeleton className="h-5 w-24" />
            </div>
          ))}
        </div>
      </div>

      {/* 产品明细骨架 */}
      <div className="rounded-md border mb-5">
        <Skeleton className="h-10 w-full" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="px-4 py-3 border-b last:border-0">
            <div className="flex gap-8">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-16" />
            </div>
          </div>
        ))}
      </div>

      {/* 物流轨迹骨架 */}
      <div className="rounded-md border">
        <Skeleton className="h-10 w-full" />
        <div className="p-4 space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-2.5 w-2.5 rounded-full mt-1.5" />
              <div>
                <div className="flex gap-2">
                  <Skeleton className="h-5 w-12" />
                  <Skeleton className="h-4 w-20" />
                </div>
                <Skeleton className="h-4 w-40 mt-1" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
