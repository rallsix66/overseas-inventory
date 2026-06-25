// SKU 模块表格列定义
import type { ColumnDef } from '@/types/common';
import type { VariantItem } from './types';

export const variantColumns: ColumnDef<VariantItem>[] = [
  {
    key: 'sku',
    header: '仓库 SKU',
    sortable: true,
  },
  {
    key: 'name',
    header: '仓库产品名',
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
    key: 'match_status',
    header: '匹配状态',
    render: (item) => {
      const statusMap = {
        matched: { label: '已匹配', className: 'bg-green-50 text-green-700' },
        unmatched: { label: '未匹配', className: 'bg-red-50 text-red-700' },
        pending: { label: '待确认', className: 'bg-yellow-50 text-yellow-700' },
      };
      const s = statusMap[item.match_status as keyof typeof statusMap] ?? statusMap.unmatched;
      return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${s.className}`}>
          {s.label}
        </span>
      );
    },
  },
  {
    key: 'productName',
    header: '标准产品',
    render: (item) => item.productName || '—',
  },
  {
    key: 'last_sync_at',
    header: '最后同步',
    render: (item) =>
      item.last_sync_at
        ? new Date(item.last_sync_at).toLocaleString('zh-CN')
        : '—',
  },
  {
    key: 'is_archived',
    header: '归档状态',
    render: (item) =>
      item.is_archived ? (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700">
          📦 已归档
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
          活跃
        </span>
      ),
  },
];
