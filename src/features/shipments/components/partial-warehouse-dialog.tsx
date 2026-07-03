'use client';

// P3-S5B3: 部分/全额确认入仓对话框
// status='customs' 时 Admin 可打开，输入每个 item 本次入仓数量
// 调 partialWarehouseShipment Server Action（走 00026 RPC，不写 inventory）
import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { partialWarehouseShipment } from '@/features/shipments/actions';
import { partialWarehouseItemSchema } from '@/features/shipments/schema';
import { Loader2Icon, PackageCheckIcon } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ShipmentItemDetail, PartialWarehouseResult } from '@/features/shipments/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shipmentId: string;
  items: ShipmentItemDetail[];
  /** PERF-S1D: 操作成功后的回调，用于父组件局部更新（替代 router.refresh()） */
  onSuccess?: () => void;
}

interface ItemEntry {
  variantId: string;
  quantity: number;
}

export function PartialWarehouseDialog({
  open,
  onOpenChange,
  shipmentId,
  items,
  onSuccess,
}: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 每个 item 的本次入仓数量（key = item.id），存储原始输入字符串
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  // 每个 item 的字段级错误
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleQuantityChange = useCallback(
    (itemId: string, value: string) => {
      // 清除字段级错误
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      setQuantities((prev) => ({ ...prev, [itemId]: value }));
    },
    [],
  );

  /** 一键全额：将每个 item 的本次入仓数量设为剩余在途数量 */
  const fillAllRemaining = useCallback(() => {
    const filled: Record<string, string> = {};
    for (const item of items) {
      const remaining = Math.max(0, item.quantity - item.warehousedQuantity);
      if (remaining > 0) {
        filled[item.id] = String(remaining);
      }
    }
    setQuantities(filled);
    setFieldErrors({});
    setError(null);
  }, [items]);

  /** 重置所有字段 */
  const resetForm = useCallback(() => {
    setQuantities({});
    setFieldErrors({});
    setError(null);
  }, []);

  /** 校验单个输入值，返回 Number 或错误消息 */
  function validateEntry(
    raw: string,
    item: ShipmentItemDetail,
  ): { ok: true; value: number } | { ok: false; error: string } {
    const trimmed = raw.trim();

    // 空值
    if (trimmed === '') {
      return { ok: false, error: '' }; // 空值不报错，跳过该项
    }

    // 小数检测（Number.isInteger 在 isNaN 之后）
    const num = Number(trimmed);
    if (isNaN(num)) {
      return { ok: false, error: `SKU「${item.sku}」请输入有效整数` };
    }

    // 检测原始输入是否含小数点或非整数字符
    if (!/^\d+$/.test(trimmed)) {
      return { ok: false, error: `SKU「${item.sku}」数量必须为整数，不支持小数` };
    }

    // 负数
    if (num < 0) {
      return { ok: false, error: `SKU「${item.sku}」数量不能为负数` };
    }

    // 零
    if (num === 0) {
      return { ok: false, error: `SKU「${item.sku}」数量必须大于 0` };
    }

    // 超过在途余量
    const remaining = Math.max(0, item.quantity - item.warehousedQuantity);
    if (num > remaining) {
      return { ok: false, error: `SKU「${item.sku}」本次入仓数量 (${num}) 超过在途余量 (${remaining})` };
    }

    return { ok: true, value: num };
  }

  const handleSubmit = async () => {
    setError(null);
    setFieldErrors({});

    // 收集有数量的 items，逐项校验
    const entries: ItemEntry[] = [];
    const newFieldErrors: Record<string, string> = {};

    for (const item of items) {
      const raw = quantities[item.id];
      if (!raw || raw.trim() === '') continue;

      const result = validateEntry(raw, item);
      if (!result.ok) {
        if (result.error) {
          newFieldErrors[item.id] = result.error;
        }
        continue;
      }

      entries.push({ variantId: item.variantId, quantity: result.value });
    }

    if (Object.keys(newFieldErrors).length > 0) {
      setFieldErrors(newFieldErrors);
      setError('请修正以下错误后再提交');
      return;
    }

    if (entries.length === 0) {
      setError('请至少为一个产品输入入仓数量');
      return;
    }

    // Zod 校验提交 payload（双重保障：int / min / max）
    const zodResult = partialWarehouseItemSchema
      .array()
      .min(1, '至少指定一项入仓明细')
      .safeParse(entries);

    if (!zodResult.success) {
      const firstIssue = zodResult.error.issues[0];
      setError(firstIssue?.message ?? '数据校验失败');
      return;
    }

    setSubmitting(true);

    try {
      const result = await partialWarehouseShipment({
        shipmentId,
        items: entries,
      });

      if (!result.success) {
        toast.error(result.error ?? '确认入仓失败');
        setError(result.error ?? '确认入仓失败');
        setSubmitting(false);
        return;
      }

      const data: PartialWarehouseResult = result.data!;
      if (data.allWarehoused) {
        toast.success('全部入仓完成，在途记录已标记为入仓');
      } else {
        toast.success(`已确认 ${data.itemsUpdated} 项入仓，在途记录保持清关状态`);
      }

      onOpenChange(false);
      resetForm();
      onSuccess?.();
    } catch {
      toast.error('确认入仓失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = (newOpen: boolean) => {
    if (!submitting) {
      if (!newOpen) resetForm();
      onOpenChange(newOpen);
    }
  };

  const hasAnyQuantity = Object.values(quantities).some(
    (v) => v.trim() !== '' && Number(v) > 0,
  );
  const inTransitTotal = items.reduce(
    (sum, i) => sum + Math.max(0, i.quantity - i.warehousedQuantity),
    0,
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>确认到仓</DialogTitle>
          <DialogDescription>
            <span>输入每个产品本次实际到仓数量。未输入数量的产品不参与本次入仓。</span>
            <span className="block mt-1 text-xs text-muted-foreground">
              在途合计：{inTransitTotal.toLocaleString()} &middot; 共 {items.length} 项产品
            </span>
          </DialogDescription>
        </DialogHeader>

        {/* 操作栏 */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={fillAllRemaining}
            disabled={submitting || inTransitTotal === 0}
          >
            <PackageCheckIcon className="size-3.5 mr-1" />
            全额确认
          </Button>
          <span className="text-xs text-muted-foreground">
            将所有在途数量一键填入
          </span>
        </div>

        {/* 产品明细表格 */}
        <div className="overflow-x-auto border rounded-md">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-600 text-xs">SKU</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600 text-xs">产品名称</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600 text-xs">总数</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600 text-xs">已入仓</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600 text-xs">在途余量</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600 text-xs w-28">
                  本次入仓数量
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const remaining = Math.max(0, item.quantity - item.warehousedQuantity);
                const currentRaw = quantities[item.id] ?? '';
                const fieldError = fieldErrors[item.id];
                return (
                  <tr key={item.id} className="border-b last:border-b-0">
                    <td className="px-3 py-2 font-mono text-xs">{item.sku}</td>
                    <td className="px-3 py-2 max-w-[180px] truncate">
                      {item.productName ?? (
                        <span className="text-muted-foreground">未匹配</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {item.quantity.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {item.warehousedQuantity.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className={remaining > 0 ? 'text-blue-600 font-medium' : 'text-green-600'}>
                        {remaining.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex flex-col items-end">
                        <Input
                          type="number"
                          min={0}
                          max={remaining}
                          value={currentRaw}
                          onChange={(e) => handleQuantityChange(item.id, e.target.value)}
                          placeholder="0"
                          disabled={submitting || remaining === 0}
                          className={`h-8 w-24 text-right text-sm ml-auto ${fieldError ? 'border-destructive' : ''}`}
                        />
                        {fieldError && (
                          <span className="text-xs text-destructive mt-1 text-right whitespace-nowrap">
                            {fieldError}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 全局错误提示 */}
        {error && (
          <div className="text-sm text-destructive">{error}</div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" disabled={submitting} onClick={() => handleClose(false)}>
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !hasAnyQuantity}
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
  );
}
