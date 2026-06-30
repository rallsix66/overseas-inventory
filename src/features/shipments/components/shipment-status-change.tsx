'use client';

// P3-S2B: 手动变更物流状态（禁用 warehoused）
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { changeShipmentStatus } from '@/features/shipments/actions';
import { Loader2Icon, ArrowRightIcon } from 'lucide-react';

const STATUS_OPTIONS = [
  { value: 'booking', label: '订舱' },
  { value: 'loading', label: '装柜' },
  { value: 'departed', label: '离港' },
  { value: 'arrived', label: '到港' },
  { value: 'customs', label: '清关' },
];

const STATUS_LABELS: Record<string, string> = {
  booking: '订舱',
  loading: '装柜',
  departed: '离港',
  arrived: '到港',
  customs: '清关',
};

interface Props {
  shipmentId: string;
  currentStatus: string;
}

export function ShipmentStatusChange({ shipmentId, currentStatus }: Props) {
  const [open, setOpen] = useState(false);
  const [nextStatus, setNextStatus] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const currentLabel = STATUS_LABELS[currentStatus] ?? currentStatus;
  const availableStatuses = STATUS_OPTIONS.filter((s) => s.value !== currentStatus);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nextStatus) return;
    setSubmitting(true);

    try {
      const result = await changeShipmentStatus(
        shipmentId,
        nextStatus,
        description.trim() || undefined,
      );

      if (!result.success) {
        toast.error(result.error ?? '状态变更失败');
        return;
      }
      toast.success(`物流状态已变更为「${STATUS_LABELS[nextStatus] ?? nextStatus}」`);
      setOpen(false);
      setNextStatus('');
      setDescription('');
    } catch {
      toast.error('状态变更失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          aria-label="变更物流状态"
        >
          <ArrowRightIcon className="size-3.5 mr-1" />
          变更状态
        </Button>
        <span className="text-xs text-muted-foreground">
          当前：{currentLabel}
        </span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="border rounded-md p-4 space-y-3 bg-gray-50/50">
      <h3 className="text-sm font-medium text-gray-700">变更物流状态</h3>

      <div className="flex items-center gap-3">
        <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700">
          {currentLabel}
        </span>
        <ArrowRightIcon className="size-3.5 text-muted-foreground" />
        <Select value={nextStatus} onValueChange={(v) => setNextStatus(v ?? '')}>
          <SelectTrigger className="w-36 h-8 text-sm" aria-label="目标状态">
            <SelectValue placeholder="目标状态" />
          </SelectTrigger>
          <SelectContent>
            {availableStatuses.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="status-description" className="text-xs">备注</Label>
        <Input
          id="status-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="状态变更说明（可选）"
          maxLength={500}
          className="h-8 text-sm"
        />
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" disabled={submitting || !nextStatus} size="sm" aria-label="确认变更">
          {submitting ? <><Loader2Icon className="size-3.5 animate-spin mr-1" />提交中...</> : '确认变更'}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)} aria-label="取消变更">取消</Button>
      </div>
    </form>
  );
}
