'use client';

import { Button } from '@/components/ui/button';

export default function ReplenishmentError({ reset }: { reset: () => void }) {
  return (
    <div className="px-6 py-16 text-center">
      <h2 className="text-lg font-semibold">补货建议加载失败</h2>
      <p className="mt-2 text-sm text-muted-foreground">请确认数据库 Migration 已执行，然后重试。</p>
      <Button className="mt-4" onClick={reset}>重试</Button>
    </div>
  );
}

