// 库存模块表格列定义
import type { ColumnDef } from '@/types/common';
import type { InventoryItem } from './types';

export const inventoryColumns: ColumnDef<InventoryItem>[] = [
  {
    key: 'productName',
    header: '产品名称',
    sortable: true,
    render: (item) => (
      <span>
        {item.productName || item.sku}
        {item.matchStatus === 'unmatched' && (
          <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500">
            未匹配
          </span>
        )}
      </span>
    ),
  },
  {
    key: 'country',
    header: '国家',
    render: (item) => (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
        {item.country}
      </span>
    ),
  },
  {
    key: 'warehouseName',
    header: '仓库',
  },
  {
    key: 'sku',
    header: '仓库 SKU',
  },
  {
    key: 'quantity',
    header: '库存数量',
    className: 'text-right',
    sortable: true,
    render: (item) => {
      const isLow = item.quantity <= item.safetyStock;
      return (
        <span className={isLow ? 'text-red-600 font-semibold' : ''}>
          {item.quantity}
        </span>
      );
    },
  },
  {
    key: 'safetyStock',
    header: '安全水位',
    className: 'text-right',
    render: (item) => (item.productName ? item.safetyStock : '—'),
  },
  {
    key: 'status',
    header: '状态',
    render: (item) => {
      if (!item.productName) return null;
      const isLow = item.quantity <= item.safetyStock;
      return isLow ? (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700">
          低库存
        </span>
      ) : (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-600">
          正常
        </span>
      );
    },
  },
  {
    key: 'gap',
    header: '缺口',
    className: 'text-right',
    render: (item) => {
      if (!item.productName) return '—';
      const gap = item.safetyStock - item.quantity;
      if (gap <= 0) return <span className="text-green-600">正常</span>;
      return <span className="text-red-600 font-semibold">{gap}</span>;
    },
  },
  {
    key: 'lastSyncAt',
    header: '最后同步',
    render: (item) =>
      item.lastSyncAt
        ? new Date(item.lastSyncAt).toLocaleString('zh-CN')
        : '—',
  },
];
