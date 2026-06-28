// 新建在途记录 — 加载骨架
import { Skeleton } from '@/components/ui/skeleton';

export default function NewShipmentLoading() {
  return (
    <div>
      <div className="px-6 py-4 border-b">
        <Skeleton className="h-6 w-32" />
      </div>
      <div className="px-6 py-5 space-y-5 max-w-3xl">
        <div className="space-y-4">
          <Skeleton className="h-5 w-20" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-16 w-full" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <div className="flex gap-3">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-16" />
        </div>
      </div>
    </div>
  );
}
