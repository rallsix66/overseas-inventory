// 仓库分配页 — 加载状态
import { Skeleton } from '@/components/ui/skeleton';

export default function WarehouseAssignmentLoading() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">仓库分配</h1>
        <p className="text-sm text-gray-500 mt-1">管理运营人员可访问的海外仓库</p>
      </div>
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="space-y-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    </div>
  );
}
