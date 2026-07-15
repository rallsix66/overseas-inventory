'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { createPlannedShipment } from '@/features/shipments/actions';
import type { ReplenishmentSuggestion } from '@/features/replenishment/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  suggestion: ReplenishmentSuggestion;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PlannedShipmentDialog({ suggestion, open, onOpenChange }: Props) {
  const router = useRouter();
  const [quantity, setQuantity] = useState(String(Math.max(1, suggestion.suggestQty)));
  const [plannedShipDate, setPlannedShipDate] = useState('');
  const [expectedArrivalDate, setExpectedArrivalDate] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await createPlannedShipment({
        variantId: suggestion.variantId,
        warehouseId: suggestion.warehouseId,
        quantity: Number(quantity),
        plannedShipDate: plannedShipDate || undefined,
        expectedArrivalDate: expectedArrivalDate || undefined,
      });
      if (!result.success) {
        setError(result.error ?? '创建计划发货失败');
        return;
      }
      toast.success('计划发货已创建');
      onOpenChange(false);
      router.refresh();
    } catch {
      setError('创建计划发货失败，请稍后重试');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>创建计划发货</DialogTitle>
          <DialogDescription>
            {suggestion.sku} · {suggestion.warehouseName}。计划会作为 booking Shipment 计入有效补给。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="planned-quantity">计划数量</Label>
            <Input
              id="planned-quantity"
              type="number"
              min={1}
              step={1}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="planned-ship-date">预计发出日</Label>
              <Input
                id="planned-ship-date"
                type="date"
                value={plannedShipDate}
                onChange={(event) => setPlannedShipDate(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="planned-arrival-date">预计到达日</Label>
              <Input
                id="planned-arrival-date"
                type="date"
                value={expectedArrivalDate}
                onChange={(event) => setExpectedArrivalDate(event.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            预计到达日优先；只填发出日时，系统按仓库补货周期自动推算到达日。
          </p>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={pending || Number(quantity) < 1 || (!plannedShipDate && !expectedArrivalDate)}
            onClick={() => void handleSubmit()}
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            创建计划
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

