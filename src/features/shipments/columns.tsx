// 物流模块表格列定义
import type { ColumnDef } from '@/types/common';
import type { ShipmentListItem } from './types';

/** 状态 → 中文 + 颜色 */
const STATUS_MAP: Record<string, { label: string; className: string }> = {
  booking: { label: '订舱', className: 'bg-gray-100 text-gray-700' },
  loading: { label: '装柜', className: 'bg-yellow-50 text-yellow-700' },
  departed: { label: '离港', className: 'bg-blue-50 text-blue-700' },
  arrived: { label: '到港', className: 'bg-indigo-50 text-indigo-700' },
  customs: { label: '清关', className: 'bg-orange-50 text-orange-700' },
  warehoused: { label: '入仓', className: 'bg-green-50 text-green-700' },
};

export const shipmentColumns: ColumnDef<ShipmentListItem>[] = [
  {
    key: 'vesselName',
    header: '船名航次',
    render: (item) => {
      const name = item.vesselName || '';
      const voyage = item.voyageNumber || '';
      if (!name && !voyage) return '—';
      return `${name} ${voyage}`.trim();
    },
  },
  {
    key: 'country',
    header: '目的国',
    render: (item) => (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
        {item.country}
      </span>
    ),
  },
  {
    key: 'status',
    header: '状态',
    render: (item) => {
      const s = STATUS_MAP[item.status] ?? STATUS_MAP.booking;
      return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${s.className}`}>
          {s.label}
        </span>
      );
    },
  },
  {
    key: 'productCount',
    header: '产品数',
    className: 'text-center',
  },
  {
    key: 'totalQuantity',
    header: '总件数',
    className: 'text-right',
  },
  {
    key: 'inTransitQuantity',
    header: '在途剩余',
    className: 'text-right',
    render: (item) => (
      <span className={item.inTransitQuantity > 0 ? 'text-blue-600 font-medium' : 'text-green-600'}>
        {item.inTransitQuantity}
      </span>
    ),
  },
  {
    key: 'estimatedArrival',
    header: '预计到港',
    render: (item) => item.estimatedArrival || '—',
  },
  {
    key: 'createdAt',
    header: '创建时间',
    render: (item) => new Date(item.createdAt).toLocaleString('zh-CN'),
  },
];
