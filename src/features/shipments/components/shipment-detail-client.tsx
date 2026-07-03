'use client';

// PERF-S1D: 在途详情交互区 Client Component
// 管理 shipment 本地状态，操作成功后通过 getShipmentDetail 局部获取最新数据，
// 替代整页 router.refresh()
// P3-S5B0: WarehouseShipmentButton 已隐藏（旧版 00023 入口封存）
// P3-S5B3: 新增双模式确认到仓按钮（全额/部分，走 00026 RPC）+ BigSeller 吸收确认
import { useState, useCallback } from 'react';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { ShipmentEditForm } from './shipment-edit-form';
import { ShipmentStatusChange } from './shipment-status-change';
import { PartialWarehouseEntry } from './partial-warehouse-entry';
import { BigsellerAbsorptionButton } from './bigseller-absorption-button';
import { getShipmentDetail } from '@/features/shipments/actions';
import type { ShipmentDetail } from '@/features/shipments/types';

const STATUS_LABELS: Record<string, string> = {
  booking: '订舱',
  loading: '装柜',
  departed: '离港',
  arrived: '到港',
  customs: '清关',
  warehoused: '入仓',
};

const STATUS_CLASSES: Record<string, string> = {
  booking: 'bg-gray-100 text-gray-700',
  loading: 'bg-yellow-50 text-yellow-700',
  departed: 'bg-blue-50 text-blue-700',
  arrived: 'bg-indigo-50 text-indigo-700',
  customs: 'bg-orange-50 text-orange-700',
  warehoused: 'bg-green-50 text-green-700',
};

interface Props {
  initialShipment: ShipmentDetail;
  isAdmin: boolean;
  warehouses: { id: string; name: string; country: string }[];
}

export function ShipmentDetailClient({ initialShipment, isAdmin, warehouses }: Props) {
  const [shipment, setShipment] = useState<ShipmentDetail>(initialShipment);

  const refreshShipment = useCallback(async () => {
    try {
      const result = await getShipmentDetail(shipment.id);
      if (result.success && result.data) {
        setShipment(result.data);
      }
    } catch {
      // 静默失败 — revalidatePath 已处理缓存，下次导航自动获取最新数据
    }
  }, [shipment.id]);

  const statusLabel = STATUS_LABELS[shipment.status] ?? shipment.status;
  const statusClass = STATUS_CLASSES[shipment.status] ?? 'bg-gray-100 text-gray-700';
  const isWarehoused = shipment.status === 'warehoused';

  const inTransitTotal = shipment.items.reduce(
    (sum, i) => sum + (i.quantity - i.warehousedQuantity),
    0,
  );

  // 确认到仓仅 Admin + customs + 已分配仓库
  const warehouseBlockReason = ((): string | null => {
    if (!isAdmin || isWarehoused) return null;
    if (!shipment.warehouse_id) return '该在途记录未指定仓库，无法入仓';
    if (shipment.status !== 'customs') return `当前状态为「${statusLabel}」，清关后方可确认入仓`;
    return null; // customs + has warehouse → 可入仓
  })();

  return (
    <>
      {/* 页头 */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">
            {shipment.shipment_no}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            创建于{' '}
            {new Date(shipment.created_at).toLocaleString('zh-CN')}
            {shipment.creatorName && ` · ${shipment.creatorName}`}
          </p>
        </div>
        <span
          className={`inline-flex items-center px-2.5 py-1 rounded text-sm font-medium ${statusClass}`}
        >
          {statusLabel}
        </span>
      </div>

      {/* 操作区 — 仅 Admin */}
      {isAdmin && !isWarehoused && (
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <ShipmentEditForm
            shipment={shipment}
            warehouses={warehouses}
            isAdmin={isAdmin}
          />
          <ShipmentStatusChange
            shipmentId={shipment.id}
            currentStatus={shipment.status}
          />
          {/* P3-S5B3: 双模式确认到仓按钮（Admin + customs + 已分配仓库 → 全额/部分） */}
          {shipment.status === 'customs' && shipment.warehouse_id && (
            <PartialWarehouseEntry
              shipmentId={shipment.id}
              items={shipment.items}
              onSuccess={refreshShipment}
            />
          )}
        </div>
      )}

      {/* P3-S5B3: BigSeller 吸收确认 — warehoused + 未确认吸收 */}
      {isAdmin && shipment.status === 'warehoused' && !shipment.bigseller_absorbed_at && (
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <BigsellerAbsorptionButton
            shipmentId={shipment.id}
            onSuccess={refreshShipment}
          />
        </div>
      )}

      {/* 不可入仓时显示阻止原因 */}
      {warehouseBlockReason && (
        <div className="mb-5 text-sm text-muted-foreground flex items-center gap-2">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-muted">
            确认入仓
          </span>
          <span>{warehouseBlockReason}</span>
        </div>
      )}

      {/* 产品明细 */}
      <div className="rounded-md border mb-5">
        <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-700">
            产品明细（{shipment.items.length} 项）
          </h2>
          <span className="text-xs text-muted-foreground">
            在途合计：{inTransitTotal.toLocaleString()}
          </span>
        </div>
        {shipment.items.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            暂无产品明细
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead>SKU</TableHead>
                  <TableHead>产品名称</TableHead>
                  <TableHead className="text-right">数量</TableHead>
                  <TableHead className="text-right">已入仓</TableHead>
                  <TableHead className="text-right">在途</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shipment.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                    <TableCell className="text-sm max-w-[200px] truncate">
                      {item.productName || (
                        <span className="text-muted-foreground">未匹配</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.quantity.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                      {item.warehousedQuantity.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span
                        className={
                          item.quantity - item.warehousedQuantity > 0
                            ? 'text-blue-600 font-medium'
                            : 'text-green-600'
                        }
                      >
                        {(item.quantity - item.warehousedQuantity).toLocaleString()}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </>
  );
}
