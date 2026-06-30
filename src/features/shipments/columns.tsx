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
    key: 'shipmentNo',
    header: '单号',
    render: (item) => (
      <div>
        <span className="font-medium text-sm tabular-nums">{item.shipmentNo}</span>
        {item.purchaseOrderNo && (
          <span className="block text-xs text-muted-foreground mt-0.5">
            采购: {item.purchaseOrderNo}
          </span>
        )}
      </div>
    ),
  },
  {
    key: 'productNames',
    header: '品名',
    render: (item) => {
      if (!item.productNames) return <span className="text-muted-foreground text-sm">—</span>;
      return (
        <span className="text-sm truncate max-w-[200px] block" title={item.productNames}>
          {item.productNames}
        </span>
      );
    },
  },
  {
    key: 'warehouseName',
    header: '仓库',
    render: (item) => (
      <span className="text-sm">{item.warehouseName || <span className="text-muted-foreground">未指定</span>}</span>
    ),
  },
  {
    key: 'status',
    header: '物流状态',
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
    key: 'estimatedArrival',
    header: '预计到仓',
    render: (item) =>
      item.estimatedArrival
        ? new Date(item.estimatedArrival).toLocaleDateString('zh-CN')
        : '—',
  },
  {
    key: 'productCount',
    header: '产品数',
    className: 'text-right',
    render: (item) => (
      <span className="tabular-nums text-sm">{item.productCount}</span>
    ),
  },
  {
    key: 'totalQuantity',
    header: '总数量',
    className: 'text-right',
    render: (item) => (
      <span className="tabular-nums text-sm">{item.totalQuantity.toLocaleString()}</span>
    ),
  },
  {
    key: 'inTransitQuantity',
    header: '在途剩余',
    className: 'text-right',
    render: (item) => (
      <span
        className={`tabular-nums text-sm ${
          item.inTransitQuantity > 0 ? 'text-blue-600 font-medium' : 'text-green-600'
        }`}
      >
        {item.inTransitQuantity.toLocaleString()}
      </span>
    ),
  },
  {
    key: 'createdAt',
    header: '创建时间',
    render: (item) =>
      new Date(item.createdAt).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
  },
];
