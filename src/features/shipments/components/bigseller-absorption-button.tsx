'use client';

// P3-S5B3: 确认 BigSeller 吸收按钮
// status='warehoused' 且 bigseller_absorbed_at IS NULL 时 Admin 可见
// 二次确认后调用 confirmBigsellerAbsorption Server Action
// PERF-S1D: 成功后通过本地状态隐藏自身 + onSuccess 回调触发父组件局部更新，不再 router.refresh()
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { confirmBigsellerAbsorption } from '@/features/shipments/actions';
import { Loader2Icon, ShieldCheckIcon } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Props {
  shipmentId: string;
  /** PERF-S1D: 操作成功后的回调，用于父组件局部更新 */
  onSuccess?: () => void;
}

export function BigsellerAbsorptionButton({ shipmentId, onSuccess }: Props) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** PERF-S1D: 吸收确认后隐藏自身 */
  const [absorbed, setAbsorbed] = useState(false);

  const handleConfirm = async () => {
    setError(null);
    setSubmitting(true);

    try {
      const result = await confirmBigsellerAbsorption(shipmentId);

      if (!result.success) {
        toast.error(result.error ?? '确认失败');
        setError(result.error ?? '确认失败');
        setSubmitting(false);
        return;
      }

      toast.success('已确认 BigSeller 吸收');
      setOpen(false);
      setAbsorbed(true);
      onSuccess?.();
    } catch {
      toast.error('确认 BigSeller 吸收失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  // PERF-S1D: 已确认吸收后不渲染按钮
  if (absorbed) return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label="确认 BigSeller 吸收"
      >
        <ShieldCheckIcon className="size-3.5 mr-1" />
        确认 BigSeller 吸收
      </Button>

      <Dialog open={open} onOpenChange={(newOpen) => { if (!submitting) setOpen(newOpen); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认 BigSeller 吸收</DialogTitle>
            <DialogDescription>
              <span>确认 BigSeller 已吸收该在途记录的全部货物？</span>
              <span className="block mt-2 text-sm text-muted-foreground">
                确认后，该在途记录的已入仓数量将从「已确认到仓」统计中排除。
              </span>
              <span className="block mt-2 font-medium text-destructive">
                此操作不可撤销，请确认后再执行。
              </span>
            </DialogDescription>
          </DialogHeader>

          {error && (
            <div className="text-sm text-destructive">{error}</div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" disabled={submitting} onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={submitting}
              size="sm"
              aria-label="确认 BigSeller 吸收操作"
            >
              {submitting ? (
                <><Loader2Icon className="size-3.5 animate-spin mr-1" />执行中...</>
              ) : (
                '确认吸收'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
