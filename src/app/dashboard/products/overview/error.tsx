'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ProductOverviewError({ reset }: { reset: () => void }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <AlertTriangle className="size-9 text-destructive" />
      <div>
        <h2 className="font-semibold">全球库存作战室加载失败</h2>
        <p className="mt-1 text-sm text-muted-foreground">请稍后重试；若持续失败，请联系管理员。</p>
      </div>
      <Button variant="outline" onClick={reset}>
        重新加载
      </Button>
    </div>
  );
}
