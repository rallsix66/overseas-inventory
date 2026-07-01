'use client';

// P4-U4: 启用/禁用用户账号确认对话框
// 通过 toggleUserActive Server Action 提交状态变更
// 禁止在 pending 时重复提交、失败展示中文错误
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { toggleUserActive } from '@/features/users/actions';

interface Props {
  open: boolean;
  userId: string;
  isActive: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function UserActiveToggleDialog({
  open,
  userId,
  isActive,
  onClose,
  onSuccess,
}: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const action = isActive ? '禁用' : '启用';
  const description = isActive
    ? '禁用后该用户将无法登录系统，确认继续？'
    : '启用后该用户将恢复系统访问权限，确认继续？';

  const handleConfirm = async () => {
    setPending(true);
    setError(null);

    try {
      const result = await toggleUserActive(userId, !isActive);

      if (result.success) {
        onSuccess();
      } else {
        setError(result.error ?? '操作失败');
      }
    } catch {
      setError('操作失败，请稍后重试');
    } finally {
      setPending(false);
    }
  };

  const resetAndClose = () => {
    setError(null);
    onClose();
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      resetAndClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{action}用户账号</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {error && (
          <div className="text-destructive text-sm">{error}</div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={resetAndClose} disabled={pending}>
            取消
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            确认{action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
