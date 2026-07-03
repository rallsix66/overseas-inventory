'use client';

// P3-S4A: 手动变更物流状态 — 仅允许按顺序推进到下一合法状态
// booking → loading → departed → arrived → customs（禁用 warehoused / 倒退 / 跳步）
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { changeShipmentStatus } from '@/features/shipments/actions';
import { getNextValidStatus } from '@/features/shipments/types';
import { Loader2Icon, ArrowRightIcon } from 'lucide-react';

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
  /** PERF-S1D: 操作成功后的回调，用于父组件局部更新（替代 router.refresh()） */
  onSuccess?: () => void;
}

export function ShipmentStatusChange({ shipmentId, currentStatus, onSuccess }: Props) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const currentLabel = STATUS_LABELS[currentStatus] ?? currentStatus;
  const nextValidStatus = getNextValidStatus(currentStatus);
  // P3-S4A: 没有合法下一状态时（如已到 customs），不显示变更按钮
  const canAdvance = nextValidStatus !== null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nextValidStatus) return;
    setSubmitting(true);

    try {
      const result = await changeShipmentStatus(
        shipmentId,
        nextValidStatus,
        description.trim() || undefined,
      );

      if (!result.success) {
        toast.error(result.error ?? '状态变更失败');
        return;
      }
      toast.success(`物流状态已变更为「${STATUS_LABELS[nextValidStatus] ?? nextValidStatus}」`);
      setOpen(false);
      setDescription('');
      onSuccess?.();
    } catch {
      toast.error('状态变更失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  // 无可推进状态时不显示按钮
  if (!canAdvance) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          当前：{currentLabel}（已是最终状态）
        </span>
      </div>
    );
  }

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
          推进至「{STATUS_LABELS[nextValidStatus]}」
        </Button>
        <span className="text-xs text-muted-foreground">
          当前：{currentLabel}
        </span>
      </div>
    );
  }

  const nextLabel = STATUS_LABELS[nextValidStatus] ?? nextValidStatus;

  return (
    <form onSubmit={handleSubmit} className="border rounded-md p-4 space-y-3 bg-gray-50/50">
      <h3 className="text-sm font-medium text-gray-700">推进物流状态</h3>

      <div className="flex items-center gap-3">
        <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700">
          {currentLabel}
        </span>
        <ArrowRightIcon className="size-3.5 text-muted-foreground" />
        <span className="text-sm font-medium text-blue-600">{nextLabel}</span>
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
        <Button type="submit" disabled={submitting} size="sm" aria-label="确认推进">
          {submitting ? <><Loader2Icon className="size-3.5 animate-spin mr-1" />提交中...</> : `确认推进至「${nextLabel}」`}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)} aria-label="取消变更">取消</Button>
      </div>
    </form>
  );
}
