// 用户模块表格列定义
import type { ColumnDef } from '@/types/common';
import type { UserItem } from './types';

export const userColumns: ColumnDef<UserItem>[] = [
  {
    key: 'displayName',
    header: '显示名',
    sortable: true,
  },
  {
    key: 'email',
    header: '邮箱',
    render: (item) => item.email || '—',
  },
  {
    key: 'roleName',
    header: '角色',
    render: (item) => {
      const isAdmin = item.roleName === 'admin';
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
            isAdmin ? 'bg-purple-50 text-purple-700' : 'bg-blue-50 text-blue-700'
          }`}
        >
          {isAdmin ? '管理员' : '运营'}
        </span>
      );
    },
  },
  {
    key: 'isActive',
    header: '状态',
    render: (item) =>
      item.isActive ? (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700">
          启用
        </span>
      ) : (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
          禁用
        </span>
      ),
  },
  {
    key: 'createdAt',
    header: '创建时间',
    render: (item) => new Date(item.createdAt).toLocaleString('zh-CN'),
  },
];
