'use client';

// 新建在途记录 — 错误状态
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

export default function NewShipmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('新建在途记录页面加载失败:', error);
  }, [error]);

  return (
    <div className="px-6 py-20 text-center">
      <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-4" />
      <h2 className="text-lg font-semibold text-gray-900 mb-2">加载失败</h2>
      <p className="text-sm text-muted-foreground mb-5">
        页面加载失败，请稍后重试
      </p>
      <Button variant="outline" onClick={reset}>
        重试
      </Button>
    </div>
  );
}
