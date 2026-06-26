'use client';

// 仓库分配页 — 错误状态
import { Button } from '@/components/ui/button';

export default function WarehouseAssignmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">仓库分配</h1>
        <p className="text-sm text-gray-500 mt-1">管理运营人员可访问的海外仓库</p>
      </div>
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
        <p className="text-sm text-gray-500 mb-4">加载失败：{error.message || '请稍后重试'}</p>
        <Button variant="outline" size="sm" onClick={reset}>
          重新加载
        </Button>
      </div>
    </div>
  );
}
