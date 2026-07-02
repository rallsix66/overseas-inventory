// P3-S2A/P3-S2B: 在途详情 — Server Component
// 读取路由参数、获取数据、渲染详情
// 查询失败时抛出错误，由 error.tsx 边界捕获
import { notFound } from 'next/navigation';
import { getShipmentDetail } from '@/features/shipments/actions';
import { shipmentRepository } from '@/features/shipments/repository';
import { getCurrentActiveUser } from '@/lib/auth';
import { ArrowLeft, Anchor, MapPin, Calendar, User, FileText, Hash } from 'lucide-react';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { ShipmentEditForm } from '@/features/shipments/components/shipment-edit-form';
import { ShipmentStatusChange } from '@/features/shipments/components/shipment-status-change';
import { PartialWarehouseEntry } from '@/features/shipments/components/partial-warehouse-entry';
import { BigsellerAbsorptionButton } from '@/features/shipments/components/bigseller-absorption-button';
// P3-S5B0: WarehouseShipmentButton 已隐藏（旧版 00023 入口封存）
// P3-S5B3: 新增双模式确认到仓按钮（全额/部分，走 00026 RPC）+ BigSeller 吸收确认
import Link from 'next/link';
import type { Metadata } from 'next';

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

export const metadata: Metadata = {
  title: '在途详情 — DIS 库存看板',
};

export default async function ShipmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [detailResult, user] = await Promise.all([
    getShipmentDetail(id),
    getCurrentActiveUser(),
  ]);

  if (!detailResult.success) {
    if (detailResult.error === '在途记录不存在或无权访问') {
      notFound();
    }
    throw new Error(detailResult.error ?? '加载在途详情失败');
  }

  const shipment = detailResult.data!;
  const statusLabel = STATUS_LABELS[shipment.status] ?? shipment.status;
  const statusClass = STATUS_CLASSES[shipment.status] ?? 'bg-gray-100 text-gray-700';
  const isAdmin = user?.roleName === 'admin';

  const inTransitTotal = shipment.items.reduce(
    (sum, i) => sum + (i.quantity - i.warehousedQuantity),
    0,
  );

  // Fetch warehouse list for edit form
  let warehouses: { id: string; name: string; country: string }[] = [];
  if (user) {
    try {
      warehouses = await shipmentRepository.getWarehousesForSelector(user.id);
    } catch {
      // Edit form gracefully degrades without warehouse list
    }
  }

  const isWarehoused = shipment.status === 'warehoused';

  // P3-S5B3: 确认到仓仅 Admin + customs + 已分配仓库
  const warehouseBlockReason = ((): string | null => {
    if (!isAdmin || isWarehoused) return null;
    if (!shipment.warehouse_id) return '该在途记录未指定仓库，无法入仓';
    if (shipment.status !== 'customs') return `当前状态为「${statusLabel}」，清关后方可确认入仓`;
    return null; // customs + has warehouse → 可入仓
  })();

  return (
    <div className="px-4 sm:px-6 py-4 sm:py-6">
      {/* 顶部导航 */}
      <div className="flex items-center gap-3 mb-5">
        <Link
          href="/dashboard/shipments"
          className="inline-flex items-center rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          返回列表
        </Link>
      </div>

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

      {/* 操作区 — P3-S2E/P3-S5A: 仅 Admin */}
      {user && isAdmin && !isWarehoused && (
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
            />
          )}
        </div>
      )}

      {/* P3-S5B3: BigSeller 吸收确认 — warehoused + 未确认吸收 */}
      {user && isAdmin && shipment.status === 'warehoused' && !shipment.bigseller_absorbed_at && (
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <BigsellerAbsorptionButton shipmentId={shipment.id} />
        </div>
      )}

      {/* P3-S5A: 不可入仓时显示阻止原因（Admin + 未入仓 + 不满足入仓条件） */}
      {warehouseBlockReason && (
        <div className="mb-5 text-sm text-muted-foreground flex items-center gap-2">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-muted">
            确认入仓
          </span>
          <span>{warehouseBlockReason}</span>
        </div>
      )}

      {/* 基本信息卡片 */}
      <div className="rounded-md border bg-card mb-5">
        <div className="px-4 py-3 bg-gray-50 border-b">
          <h2 className="text-sm font-medium text-gray-700">基本信息</h2>
        </div>
        <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <InfoItem icon={Hash} label="单号" value={shipment.shipment_no} />
          <InfoItem label="采购单号" value={shipment.purchase_order_no} />
          <InfoItem icon={Anchor} label="船名" value={shipment.vessel_name} />
          <InfoItem icon={Anchor} label="航次" value={shipment.voyage_number} />
          <InfoItem icon={MapPin} label="起运港" value={shipment.origin_port} />
          <InfoItem icon={MapPin} label="目的港" value={shipment.destination_port} />
          <InfoItem label="目的国">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
              {shipment.country}
            </span>
          </InfoItem>
          <InfoItem label="仓库" value={shipment.warehouseName} />
          <InfoItem icon={Calendar} label="预计到仓">
            {shipment.estimated_arrival ? (
              <span className="text-sm">
                {new Date(shipment.estimated_arrival).toLocaleDateString('zh-CN')}
              </span>
            ) : (
              <span className="text-muted-foreground text-sm">未设置</span>
            )}
          </InfoItem>
          <InfoItem icon={User} label="创建人" value={shipment.creatorName} />
        </div>
        {shipment.note && (
          <div className="px-4 pb-4 border-t pt-3">
            <InfoItem icon={FileText} label="备注" value={shipment.note} />
          </div>
        )}
      </div>

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

      {/* 物流轨迹 */}
      <div className="rounded-md border">
        <div className="px-4 py-3 bg-gray-50 border-b">
          <h2 className="text-sm font-medium text-gray-700">
            物流轨迹（{shipment.events.length} 条）
          </h2>
        </div>
        {shipment.events.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            暂无物流轨迹
          </div>
        ) : (
          <div className="p-4">
            <div className="relative">
              {shipment.events.map((event, idx) => {
                const isLast = idx === shipment.events.length - 1;
                const isFirst = idx === 0;
                const eventStatusLabel = STATUS_LABELS[event.status] ?? event.status;
                const eventStatusClass =
                  STATUS_CLASSES[event.status] ?? 'bg-gray-100 text-gray-700';
                return (
                  <div key={event.id} className="flex gap-3 pb-4 last:pb-0">
                    {/* 时间线 */}
                    <div className="flex flex-col items-center">
                      <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${isFirst ? 'bg-blue-500 mt-1.5' : 'bg-gray-300 mt-1.5'}`} />
                      {!isLast && <div className="w-px flex-1 bg-gray-200 mt-1" />}
                    </div>
                    {/* 内容 */}
                    <div className="flex-1 min-w-0 pb-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${eventStatusClass}`}
                        >
                          {eventStatusLabel}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(event.occurredAt).toLocaleString('zh-CN', {
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        {event.creatorName && (
                          <span className="text-xs text-muted-foreground">
                            · {event.creatorName}
                          </span>
                        )}
                      </div>
                      {event.description && (
                        <p className="text-sm mt-1 text-gray-700">{event.description}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** 信息字段辅助组件 */
function InfoItem({
  icon: Icon,
  label,
  value,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  value?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
        {Icon && <Icon className="w-3.5 h-3.5" />}
        {label}
      </p>
      {children ??
        (value ? (
          <p className="text-sm truncate">{value}</p>
        ) : (
          <p className="text-sm text-muted-foreground">—</p>
        ))}
    </div>
  );
}
