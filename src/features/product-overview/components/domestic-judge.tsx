import { Info } from 'lucide-react';
import type { DomesticStatus } from '../types';

export function DomesticJudge({ status }: { status: DomesticStatus }) {
  if (status !== 'data_unavailable') return null;

  return (
    <div className="flex gap-2 rounded-lg border border-dashed bg-gray-50 px-4 py-3 text-sm">
      <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div>
        <p className="font-medium">国内库存待接入</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          当前不使用假定为零的国内库存，也不生成跨国支援结论。
        </p>
      </div>
    </div>
  );
}
