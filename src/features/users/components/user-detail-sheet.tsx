'use client';

// P4-U2 / P4-U3 / P4-U4: 用户详情 Sheet（只读 + 修改角色入口 + 启用/禁用入口）
// 通过 getUserById Server Action 获取单个用户详情
// P4-U3 新增"修改角色"按钮，调用 updateUserRole action
// P4-U4 新增"启用/禁用"按钮，通过 UserActiveToggleDialog 提交
// P4-UX: 操作成功后局部刷新用户详情 + 通知父组件刷新列表（替代整页 router refresh）
import { useEffect, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getUserById } from '@/features/users/actions';
import { UserRoleChangeDialog } from '@/features/users/components/user-role-change-dialog';
import { UserActiveToggleDialog } from '@/features/users/components/user-active-toggle-dialog';
import type { UserItem } from '@/features/users/types';

interface RoleOption {
  id: string;
  name: string;
}

interface Props {
  userId: string;
  onClose: () => void;
  roles: RoleOption[];
  /** P4-UX: 用户变更后通知父组件刷新列表 */
  onUserChanged?: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  admin: '管理员',
  operator: '运营',
};

export function UserDetailSheet({ userId, onClose, roles, onUserChanged }: Props) {
  const [user, setUser] = useState<UserItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [toggleDialogOpen, setToggleDialogOpen] = useState(false);

  const handleRoleChangeSuccess = async () => {
    setRoleDialogOpen(false);
    // P4-UX: 局部刷新用户详情，不关闭 Sheet，不整页刷新
    try {
      const result = await getUserById(userId);
      if (result.success && result.data) {
        setUser(result.data);
      }
    } catch {
      // 重新获取失败不做额外处理，旧数据已可见
    }
    onUserChanged?.();
  };

  const handleToggleSuccess = async () => {
    setToggleDialogOpen(false);
    // P4-UX: 局部刷新用户详情，不关闭 Sheet，不整页刷新
    try {
      const result = await getUserById(userId);
      if (result.success && result.data) {
        setUser(result.data);
      }
    } catch {
      // 重新获取失败不做额外处理，旧数据已可见
    }
    onUserChanged?.();
  };

  useEffect(() => {
    let cancelled = false;
    async function fetch() {
      setLoading(true);
      setError(null);
      try {
        const result = await getUserById(userId);
        if (cancelled) return;
        if (result.success && result.data) {
          setUser(result.data);
        } else {
          setError(result.error ?? '加载用户详情失败');
        }
      } catch {
        if (!cancelled) setError('加载用户详情失败，请稍后重试');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetch();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>用户详情</SheetTitle>
        </SheetHeader>

        <div className="mt-6">
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-5 w-2/3" />
            </div>
          ) : error ? (
            <div className="text-destructive text-sm">{error}</div>
          ) : user ? (
            <div className="space-y-4">
              <DetailRow label="邮箱" value={user.email || '-'} />
              <DetailRow label="显示名" value={user.displayName} />
              <DetailRow label="角色">
                <div className="flex items-center gap-2">
                  <Badge variant={user.roleName === 'admin' ? 'default' : 'secondary'}>
                    {ROLE_LABELS[user.roleName] ?? user.roleName}
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRoleDialogOpen(true)}
                  >
                    修改角色
                  </Button>
                </div>
              </DetailRow>
              <DetailRow label="状态">
                <div className="flex items-center gap-2">
                  {user.isActive ? (
                    <Badge variant="outline" className="border-green-300 bg-green-50 text-green-700">
                      启用
                    </Badge>
                  ) : (
                    <Badge variant="destructive">禁用</Badge>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setToggleDialogOpen(true)}
                  >
                    {user.isActive ? '禁用' : '启用'}
                  </Button>
                </div>
              </DetailRow>
              <DetailRow
                label="创建时间"
                value={new Date(user.createdAt).toLocaleString('zh-CN')}
              />
              <DetailRow label="用户 ID" value={user.id} mono />
            </div>
          ) : null}
        </div>
      </SheetContent>

      {/* 修改角色确认对话框 */}
      {user && (
        <UserRoleChangeDialog
          open={roleDialogOpen}
          userId={user.id}
          currentRoleId={user.roleId}
          currentRoleName={user.roleName}
          roles={roles}
          onClose={() => setRoleDialogOpen(false)}
          onSuccess={handleRoleChangeSuccess}
        />
      )}

      {/* 启用/禁用确认对话框 */}
      {user && (
        <UserActiveToggleDialog
          open={toggleDialogOpen}
          userId={user.id}
          isActive={user.isActive}
          onClose={() => setToggleDialogOpen(false)}
          onSuccess={handleToggleSuccess}
        />
      )}
    </Sheet>
  );
}

/** 详情行：标签 + 值/子元素 */
function DetailRow({
  label,
  value,
  children,
  mono,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-sm text-muted-foreground mb-1">{label}</div>
      {children ?? (
        <div className={mono ? 'font-mono text-xs break-all' : 'text-sm'}>
          {value ?? '-'}
        </div>
      )}
    </div>
  );
}
