'use client';

import Link from 'next/link';
import { Building2, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { WarehouseHealthItem, WarehouseHealthOverview } from '@/features/inventory/types';

function WarehouseRow({ warehouse }: { warehouse: WarehouseHealthItem }) {
  return (
    <Link
      href={`/dashboard/inventory/overseas?warehouse=${warehouse.warehouseId}`}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md px-3 py-2 hover:bg-gray-50"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{warehouse.warehouseName}</p>
        <p className="text-xs text-muted-foreground">
          {warehouse.country} · 缺货 {warehouse.outOfStockCount} · 低库存 {warehouse.lowStockCount} · 未匹配 {warehouse.unmatchedCount}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm font-semibold tabular-nums">
          {warehouse.healthRate === null ? '—' : `${warehouse.healthRate}%`}
        </span>
        <ChevronRight className="size-3.5 text-muted-foreground" />
      </div>
    </Link>
  );
}

export function WarehouseHealthCard({
  overview,
  error,
}: {
  overview: WarehouseHealthOverview | null;
  error: string | null;
}) {
  return (
    <section className="rounded-lg border bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Building2 className="size-4" /> 仓库健康度
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">优先显示风险最高的可见海外仓</p>
        </div>
        {overview && overview.warehouses.length > 4 && (
          <Dialog>
            <DialogTrigger render={<Button variant="ghost" size="sm" />}>
              查看全部
            </DialogTrigger>
            <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>全部仓库健康度</DialogTitle>
                <DialogDescription>仅包含当前账号可见且未归档的库存位置</DialogDescription>
              </DialogHeader>
              <div className="divide-y">
                {overview.warehouses.map((warehouse) => (
                  <WarehouseRow key={warehouse.warehouseId} warehouse={warehouse} />
                ))}
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {error ? (
        <p className="py-10 text-center text-sm text-destructive">库存健康度加载失败</p>
      ) : !overview || overview.warehouses.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-sm text-muted-foreground">暂无可评估仓库</p>
          <p className="mt-1 text-xs text-muted-foreground">若尚未分配海外仓，请联系管理员。</p>
        </div>
      ) : (
        <div className="divide-y">
          {overview.warehouses.slice(0, 4).map((warehouse) => (
            <WarehouseRow key={warehouse.warehouseId} warehouse={warehouse} />
          ))}
        </div>
      )}
    </section>
  );
}
