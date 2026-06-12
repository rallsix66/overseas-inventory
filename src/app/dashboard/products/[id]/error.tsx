'use client';

// 产品详情 — 错误状态（数据库加载失败等）
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ArrowLeft } from 'lucide-react';

export default function ProductDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    console.error('产品详情加载失败:', error);
  }, [error]);

  return (
    <div className="px-6 py-20 text-center">
      <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-4" />
      <h2 className="text-lg font-semibold text-gray-900 mb-2">加载失败</h2>
      <p className="text-sm text-muted-foreground mb-5">
        数据库查询失败，请稍后重试
      </p>
      <div className="flex items-center justify-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard/products')}>
          <ArrowLeft className="w-4 h-4" />
          返回产品列表
        </Button>
        <Button variant="outline" onClick={reset}>
          重试
        </Button>
      </div>
    </div>
  );
}
