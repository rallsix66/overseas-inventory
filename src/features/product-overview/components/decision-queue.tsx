import { AlertTriangle, CircleCheck, CircleHelp, Siren } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ProductOverviewQueueCounts, StockoutUrgency } from '../types';

const QUEUES: Array<{
  value: StockoutUrgency;
  label: string;
  icon: typeof Siren;
}> = [
  { value: 'critical', label: '紧急', icon: Siren },
  { value: 'warning', label: '预警', icon: AlertTriangle },
  { value: 'ok', label: '正常', icon: CircleCheck },
  { value: 'data_incomplete', label: '数据不足', icon: CircleHelp },
];

export function DecisionQueue({
  counts,
  active,
  onSelect,
}: {
  counts: ProductOverviewQueueCounts;
  active?: StockoutUrgency;
  onSelect: (value?: StockoutUrgency) => void;
}) {
  const countByUrgency: Record<StockoutUrgency, number> = {
    critical: counts.critical,
    warning: counts.warning,
    ok: counts.ok,
    data_incomplete: counts.dataIncomplete,
  };

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="断货决策队列">
      {QUEUES.map((queue) => {
        const Icon = queue.icon;
        const selected = active === queue.value;
        return (
          <Button
            key={queue.value}
            type="button"
            variant={selected ? 'default' : 'outline'}
            className="h-auto justify-between px-4 py-3"
            aria-pressed={selected}
            onClick={() => onSelect(selected ? undefined : queue.value)}
          >
            <span className="flex items-center gap-2 text-sm">
              <Icon className="size-4" /> {queue.label}
            </span>
            <span className="font-mono text-lg font-semibold">{countByUrgency[queue.value]}</span>
          </Button>
        );
      })}
    </div>
  );
}
