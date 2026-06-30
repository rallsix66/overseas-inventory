'use client';

// P3-S5A: 确认入仓按钮 — 仅 Admin 在 customs 状态时可见
// 二次确认后调用 warehouseShipment Server Action
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { warehouseShipment } from '@/features/shipments/actions';
import { Loader2Icon, PackageCheckIcon } from 'lucide-react';
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

export function WarehouseShipmentButton({ shipmentId }: Props) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    setSubmitting(true);

    try {
      const result = await warehouseShipment({
        shipmentId,
        description: description.trim() || undefined,
      });

      if (!result.success) {
        toast.error(result.error ?? '确认入仓失败');
        setSubmitting(false);
        return;
      }
      toast.success('确认入仓成功，库存已更新');
      setOpen(false);
      setDescription('');
    } catch {
      toast.error('确认入仓失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="default"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label="确认入仓"
      >
        <PackageCheckIcon className="size-3.5 mr-1" />
        确认入仓
      </Button>

      <Dialog open={open} onOpenChange={(newOpen) => { if (!submitting) setOpen(newOpen); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认入仓</DialogTitle>
            <DialogDescription>
              <span>
                确认后系统将：
              </span>
              <ul className="list-disc pl-5 mt-2 space-y-1 text-sm">
                <li>将所有产品明细的数量计入目标仓库库存</li>
                <li>将在途单状态设为「入仓」</li>
                <li>为每项明细记录完整的已入仓数量</li>
              </ul>
              <span className="block mt-2 font-medium text-destructive">
                此操作不可撤销，请确认后再执行。
              </span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="wh-description" className="text-xs">入仓备注（可选）</Label>
            <Input
              id="wh-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="入仓说明"
              maxLength={500}
              className="h-8 text-sm"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" disabled={submitting} onClick={() => setOpen(false)}>取消</Button>
            <Button
              onClick={handleConfirm}
              disabled={submitting}
              size="sm"
              aria-label="确认入仓操作"
            >
              {submitting ? (
                <><Loader2Icon className="size-3.5 animate-spin mr-1" />执行中...</>
              ) : (
                '确认入仓'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
