'use client';

// P4-U2: 用户详情只读 Sheet
// 通过 getUserById Server Action 获取单个用户详情
// 仅展示信息，不包含角色变更/账号启停等写操作按钮
import { useEffect, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { getUserById } from '@/features/users/actions';
import type { UserItem } from '@/features/users/types';

interface Props {
  userId: string;
  onClose: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  admin: '管理员',
  operator: '运营',
};

export function UserDetailSheet({ userId, onClose }: Props) {
  const [user, setUser] = useState<UserItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
                <Badge variant={user.roleName === 'admin' ? 'default' : 'secondary'}>
                  {ROLE_LABELS[user.roleName] ?? user.roleName}
                </Badge>
              </DetailRow>
              <DetailRow label="状态">
                {user.isActive ? (
                  <Badge variant="outline" className="border-green-300 bg-green-50 text-green-700">
                    启用
                  </Badge>
                ) : (
                  <Badge variant="destructive">禁用</Badge>
                )}
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
