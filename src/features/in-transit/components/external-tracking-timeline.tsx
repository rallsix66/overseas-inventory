// P0: Shipment 详情页 — 喜运达外部物流轨迹时间线
//
// 展示通过 externalTrackingRepository 查询到的外部物流轨迹事件。
// 与内部状态轨迹（tracking_event）明确区分：
//   - 外部轨迹：provider 标签 + 橙色时间线
//   - 内部轨迹：状态标签 + 蓝色时间线
//
// 本组件为 Server Component，数据由调用方通过 props 传入。

import { Truck, Package, Ship, CheckCircle, AlertTriangle, Clock } from 'lucide-react';
import type { TrackingEventExternalRow } from '@/features/in-transit/types';

const EXTERNAL_CATEGORY_LABELS: Record<string, string> = {
  created: '已创建',
  in_transit: '运输中',
  customs: '清关中',
  delivered: '已送达',
  exception: '异常',
};

const EXTERNAL_CATEGORY_COLORS: Record<string, string> = {
  created: 'bg-gray-100 text-gray-700',
  in_transit: 'bg-blue-50 text-blue-700',
  customs: 'bg-orange-50 text-orange-700',
  delivered: 'bg-green-50 text-green-700',
  exception: 'bg-red-50 text-red-700',
};

const EXTERNAL_CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  created: Package,
  in_transit: Truck,
  customs: Ship,
  delivered: CheckCircle,
  exception: AlertTriangle,
};

interface ExternalRefEvents {
  provider: string;
  waybillNo: string | null;
  events: TrackingEventExternalRow[];
}

interface Props {
  data: ExternalRefEvents[];
}

export function ExternalTrackingTimeline({ data }: Props) {
  if (data.length === 0) {
    return null; // 无外部物流记录时不显示此区块
  }

  return (
    <div className="rounded-md border mb-5">
      <div className="px-4 py-3 bg-amber-50 border-b flex items-center gap-2">
        <Truck className="w-4 h-4 text-amber-600" />
        <h2 className="text-sm font-medium text-amber-800">
          喜运达物流轨迹（外部）
        </h2>
        <span className="text-xs text-amber-600 ml-auto">
          数据来源：第三方物流平台
        </span>
      </div>

      {data.map((ref) => (
        <div key={ref.provider + ref.waybillNo} className="border-b last:border-b-0">
          {/* 运单信息条 */}
          <div className="px-4 py-2 bg-amber-50/50 border-b flex items-center gap-3 text-xs text-muted-foreground">
            <span className="font-medium text-amber-800">运单号</span>
            <span className="font-mono">{ref.waybillNo ?? '—'}</span>
            <span className="text-amber-400">|</span>
            <span className="font-medium text-amber-800">轨迹数</span>
            <span>{ref.events.length} 条</span>
          </div>

          {/* 轨迹时间线 */}
          {ref.events.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              <Clock className="w-4 h-4 mx-auto mb-2 text-muted-foreground/50" />
              暂无轨迹数据
            </div>
          ) : (
            <div className="p-4">
              <div className="relative">
                {ref.events.map((event, idx) => {
                  const isLast = idx === ref.events.length - 1;
                  const isFirst = idx === 0;
                  const categoryLabel =
                    EXTERNAL_CATEGORY_LABELS[event.external_category] ?? event.external_category;
                  const categoryColor =
                    EXTERNAL_CATEGORY_COLORS[event.external_category] ??
                    'bg-gray-100 text-gray-700';
                  const Icon =
                    EXTERNAL_CATEGORY_ICONS[event.external_category] ?? Clock;

                  return (
                    <div key={event.id} className="flex gap-3 pb-4 last:pb-0">
                      {/* 时间线 */}
                      <div className="flex flex-col items-center">
                        <div
                          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                            isFirst ? 'bg-amber-500 mt-1.5' : 'bg-amber-200 mt-1.5'
                          }`}
                        />
                        {!isLast && <div className="w-px flex-1 bg-amber-200 mt-1" />}
                      </div>

                      {/* 内容 */}
                      <div className="flex-1 min-w-0 pb-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${categoryColor}`}
                          >
                            <Icon className="w-3 h-3" />
                            {categoryLabel}
                          </span>
                          {event.status && (
                            <span className="text-xs text-muted-foreground">
                              {event.status}
                            </span>
                          )}
                          {event.occurred_at && (
                            <span className="text-xs text-muted-foreground">
                              {new Date(event.occurred_at).toLocaleString('zh-CN', {
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          )}
                        </div>
                        {event.description && (
                          <p className="text-sm mt-1 text-gray-700">{event.description}</p>
                        )}
                        {event.location && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            📍 {event.location}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
