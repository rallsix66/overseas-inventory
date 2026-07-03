// P3-S2A/P3-S2B: 在途详情 — Server Component
// 读取路由参数、获取数据、渲染详情
// 查询失败时抛出错误，由 error.tsx 边界捕获
// PERF-S1D: 交互区（header + action buttons + items table）委托 ShipmentDetailClient，
//           操作成功后局部获取最新数据，不再 router.refresh()
import { notFound } from 'next/navigation';
import { getShipmentDetail } from '@/features/shipments/actions';
import { shipmentRepository } from '@/features/shipments/repository';
import { getCurrentActiveUser } from '@/lib/auth';
import { ArrowLeft, Anchor, MapPin, Calendar, User, FileText, Hash } from 'lucide-react';
import { ShipmentDetailClient } from '@/features/shipments/components/shipment-detail-client';
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
  const isAdmin = user?.roleName === 'admin';

  // Fetch warehouse list for edit form
  let warehouses: { id: string; name: string; country: string }[] = [];
  if (user) {
    try {
      warehouses = await shipmentRepository.getWarehousesForSelector(user.id);
    } catch {
      // Edit form gracefully degrades without warehouse list
    }
  }

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

      {/* PERF-S1D: 交互区（header + action buttons + items table）委托给 Client Component，
           操作成功后通过 getShipmentDetail 局部获取最新数据，不触发整页 router.refresh() */}
      <ShipmentDetailClient
        initialShipment={shipment}
        isAdmin={isAdmin}
        warehouses={warehouses}
      />

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
