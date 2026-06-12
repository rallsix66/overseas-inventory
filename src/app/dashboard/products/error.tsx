'use client';

// 产品列表 — 错误状态（数据库加载失败等）
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

export default function ProductsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('产品列表加载失败:', error);
  }, [error]);

  return (
    <div className="px-6 py-20 text-center">
      <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-4" />
      <h2 className="text-lg font-semibold text-gray-900 mb-2">加载失败</h2>
      <p className="text-sm text-muted-foreground mb-5">
        数据库查询失败，请稍后重试
      </p>
      <Button variant="outline" onClick={reset}>
        重试
      </Button>
    </div>
  );
}
