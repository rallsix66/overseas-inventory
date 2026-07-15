'use client';

import { useState } from 'react';
import { Loader2, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { updateWarehouseParams } from '@/features/warehouse/actions';
import type { WarehouseReplenishmentParams } from '@/features/warehouse/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function WarehouseParamsDialog({ initialRows }: { initialRows: WarehouseReplenishmentParams[] }) {
  const [rows, setRows] = useState(initialRows);
  const [selectedId, setSelectedId] = useState(initialRows[0]?.id ?? '');
  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const [bufferRatio, setBufferRatio] = useState(String(selected?.bufferRatio ?? 0.25));
  const [coverMultiplier, setCoverMultiplier] = useState(
    String(selected?.targetCoverMultiplier ?? 1.5),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function selectWarehouse(id: string) {
    setSelectedId(id);
    const row = rows.find((item) => item.id === id);
    setBufferRatio(String(row?.bufferRatio ?? 0.25));
    setCoverMultiplier(String(row?.targetCoverMultiplier ?? 1.5));
    setError(null);
  }

  async function handleSave() {
    if (!selected || pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await updateWarehouseParams({
        warehouseId: selected.id,
        bufferRatio: Number(bufferRatio),
        targetCoverMultiplier: Number(coverMultiplier),
      });
      if (!result.success || !result.data) {
        setError(result.error ?? '更新仓库参数失败');
        return;
      }
      setRows((current) => current.map((row) => row.id === result.data?.id ? result.data : row));
      toast.success('仓库补货参数已更新');
    } catch {
      setError('更新仓库参数失败，请稍后重试');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Settings2 className="size-4" /> 仓库参数
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>仓库补货参数</DialogTitle>
          <DialogDescription>安全库存用于阈值展示；目标覆盖倍数决定建议补货量。</DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">暂无启用中的海外仓</p>
        ) : (
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>仓库</Label>
              <Select value={selectedId} onValueChange={(value) => selectWarehouse(value ?? '')}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {rows.map((row) => (
                    <SelectItem key={row.id} value={row.id}>{row.country} · {row.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="buffer-ratio">安全库存缓冲比例</Label>
                <Input id="buffer-ratio" type="number" min={0} step="0.05" value={bufferRatio} onChange={(event) => setBufferRatio(event.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="cover-multiplier">目标覆盖倍数</Label>
                <Input id="cover-multiplier" type="number" min="0.01" step="0.1" value={coverMultiplier} onChange={(event) => setCoverMultiplier(event.target.value)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">当前补货周期：{selected?.leadTimeDays ?? '未配置'} 天</p>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button disabled={pending || !selected} onClick={() => void handleSave()}>
              {pending && <Loader2 className="size-4 animate-spin" />} 保存参数
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

