'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Ship } from 'lucide-react';
import { toast } from 'sonner';
import { cancelPlannedShipment } from '@/features/shipments/actions';
import { getReplenishmentInTransitDetail } from '@/features/replenishment/actions';
import type {
  ReplenishmentInTransitDetail,
  ReplenishmentSuggestion,
} from '@/features/replenishment/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const STATUS_LABELS: Record<string, string> = {
  booking: '计划发货',
  loading: '装柜',
  departed: '已离港',
  arrived: '已到港',
  customs: '清关中',
};

interface Props {
  suggestion: ReplenishmentSuggestion;
  isAdmin: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InTransitDetailDialog({ suggestion, isAdmin, open, onOpenChange }: Props) {
  const [data, setData] = useState<ReplenishmentInTransitDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getReplenishmentInTransitDetail(
      suggestion.variantId,
      suggestion.warehouseId,
    ).then((result) => {
      if (cancelled) return;
      if (result.success) {
        setData(result.data ?? []);
      } else {
        setError(result.error ?? '查询在途明细失败');
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [suggestion.variantId, suggestion.warehouseId]);

  async function handleCancel(shipmentId: string) {
    setCancellingId(shipmentId);
    setError(null);
    try {
      const result = await cancelPlannedShipment(shipmentId);
      if (!result.success) {
        setError(result.error ?? '取消计划发货失败');
        return;
      }
      setData((current) => current.filter((item) => item.shipmentId !== shipmentId));
      toast.success('计划发货已取消');
    } catch {
      setError('取消计划发货失败，请稍后重试');
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>ETA 已知的计划及在途</DialogTitle>
          <DialogDescription>
            {suggestion.sku} · {suggestion.warehouseName}，仅展示仍有剩余数量且未取消的批次。
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> 正在加载…
          </div>
        ) : error && data.length === 0 ? (
          <p role="alert" className="py-8 text-center text-sm text-destructive">{error}</p>
        ) : data.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Ship className="size-4" /> 暂无 ETA 已知的计划或在途批次
          </div>
        ) : (
          <div className="max-h-[420px] space-y-2 overflow-y-auto">
            {data.map((item) => (
              <div key={item.shipmentId} className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge variant={item.isPlanned ? 'outline' : 'secondary'}>
                      {STATUS_LABELS[item.status] ?? item.status}
                    </Badge>
                    <span className="text-sm font-medium">剩余 {item.remainingQuantity}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">预计到达：{item.estimatedArrival}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button variant="ghost" size="sm" render={<Link href={`/dashboard/shipments/${item.shipmentId}`} />}>
                    详情
                  </Button>
                  {isAdmin && item.isPlanned && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={cancellingId !== null}
                      onClick={() => void handleCancel(item.shipmentId)}
                    >
                      {cancellingId === item.shipmentId && <Loader2 className="size-3.5 animate-spin" />}
                      取消计划
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {error && data.length > 0 && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
