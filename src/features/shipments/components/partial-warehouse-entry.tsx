'use client';

// P3-S5B3: 确认到仓入口 — 管理 PartialWarehouseDialog 的开关状态
// status='customs' 时 Admin 可见
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { PackageCheckIcon } from 'lucide-react';
import { PartialWarehouseDialog } from './partial-warehouse-dialog';
import type { ShipmentItemDetail } from '@/features/shipments/types';

interface Props {
  shipmentId: string;
  items: ShipmentItemDetail[];
}

export function PartialWarehouseEntry({ shipmentId, items }: Props) {
  const [open, setOpen] = useState(false);

  const hasRemaining = items.some(
    (i) => i.quantity - i.warehousedQuantity > 0,
  );

  return (
    <>
      <Button
        type="button"
        variant="default"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={!hasRemaining}
        aria-label="确认到仓"
      >
        <PackageCheckIcon className="size-3.5 mr-1" />
        确认到仓
      </Button>

      <PartialWarehouseDialog
        open={open}
        onOpenChange={setOpen}
        shipmentId={shipmentId}
        items={items}
      />
    </>
  );
}
