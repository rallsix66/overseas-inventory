// 产品模块表格列定义
import type { ColumnDef } from '@/types/common';
import type { ProductItem } from './types';

export const productColumns: ColumnDef<ProductItem>[] = [
  {
    key: 'code',
    header: '产品编码',
    sortable: true,
  },
  {
    key: 'name',
    header: '产品名称',
    sortable: true,
  },
  {
    key: 'category',
    header: '分类',
    render: (item) => item.category || '—',
  },
  {
    key: 'safety_stock',
    header: '安全库存',
    className: 'text-right',
  },
  {
    key: 'skuCount',
    header: '关联 SKU 数',
    className: 'text-center',
    render: (item) => item.skuCount,
  },
  {
    key: 'is_active',
    header: '状态',
    render: (item) =>
      item.is_active ? (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700">
          启用
        </span>
      ) : (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
          停用
        </span>
      ),
  },
];
