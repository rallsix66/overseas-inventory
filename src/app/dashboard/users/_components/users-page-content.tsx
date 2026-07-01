'use client';

// P4-U2: 用户列表 — 客户端交互层
// 处理筛选、表格渲染、分页导航和行详情触发
// 查询错误由 error.tsx 边界处理，本组件不渲染查询错误状态
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { UserDetailSheet } from '@/features/users/components/user-detail-sheet';
import type { UserItem } from '@/features/users/types';

interface Filters {
  status: string;
  role: string;
}

interface RoleOption {
  id: string;
  name: string;
}

interface Props {
  data: UserItem[];
  total: number;
  page: number;
  pageSize: number;
  filters: Filters;
  roles: RoleOption[];
}

const ROLE_LABELS: Record<string, string> = {
  admin: '管理员',
  operator: '运营',
};

export function UsersPageContent({
  data,
  total,
  page,
  pageSize,
  filters,
  roles,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const updateFilter = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== 'all') {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    // 切换筛选条件时重置页码
    if (key !== 'page') {
      params.delete('page');
    }
    router.push(`/dashboard/users?${params.toString()}`);
  };

  return (
    <div>
      {/* 筛选栏 */}
      <div className="flex gap-3 mb-4">
        <Select
          value={filters.status || 'all'}
          onValueChange={(v) => updateFilter('status', v)}
        >
          <SelectTrigger className="w-32">
            <SelectValue placeholder="状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="active">启用</SelectItem>
            <SelectItem value="disabled">禁用</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.role || 'all'}
          onValueChange={(v) => updateFilter('role', v)}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="角色" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部角色</SelectItem>
            {roles.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {ROLE_LABELS[r.name] ?? r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 空数据 */}
      {data.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          暂无匹配的用户
        </div>
      ) : (
        <>
          {/* 用户表格 */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>邮箱</TableHead>
                <TableHead>显示名</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead>用户 ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((u) => (
                <TableRow
                  key={u.id}
                  className="cursor-pointer hover:bg-gray-50"
                  onClick={() => setSelectedUserId(u.id)}
                >
                  <TableCell className="max-w-[220px] truncate">
                    {u.email || '-'}
                  </TableCell>
                  <TableCell>{u.displayName}</TableCell>
                  <TableCell>
                    <Badge variant={u.roleName === 'admin' ? 'default' : 'secondary'}>
                      {ROLE_LABELS[u.roleName] ?? u.roleName}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {u.isActive ? (
                      <Badge variant="outline" className="border-green-300 bg-green-50 text-green-700">
                        启用
                      </Badge>
                    ) : (
                      <Badge variant="destructive">禁用</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                    {new Date(u.createdAt).toLocaleDateString('zh-CN')}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground max-w-[120px] truncate">
                    {u.id.slice(0, 8)}…
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* 分页 */}
          <div className="flex items-center justify-between mt-4">
            <span className="text-sm text-muted-foreground">
              共 {total} 条，第 {page}/{totalPages} 页
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => updateFilter('page', String(page - 1))}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => updateFilter('page', String(page + 1))}
              >
                下一页
              </Button>
            </div>
          </div>
        </>
      )}

      {/* 用户详情 Sheet */}
      {selectedUserId && (
        <UserDetailSheet
          userId={selectedUserId}
          roles={roles}
          onClose={() => setSelectedUserId(null)}
        />
      )}
    </div>
  );
}
