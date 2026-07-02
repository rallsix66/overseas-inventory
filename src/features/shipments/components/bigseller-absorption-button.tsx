'use client';

// P3-S5B3: 确认 BigSeller 吸收按钮
// status='warehoused' 且 bigseller_absorbed_at IS NULL 时 Admin 可见
// 二次确认后调用 confirmBigsellerAbsorption Server Action
import { useState } from 'react';
import { useRouter } from 'next/navigation';
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
}

export function BigsellerAbsorptionButton({ shipmentId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      router.refresh();
    } catch {
      toast.error('确认 BigSeller 吸收失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

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
