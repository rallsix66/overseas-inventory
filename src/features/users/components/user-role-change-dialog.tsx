'use client';

// P4-U3: 修改用户角色确认对话框
// 通过 updateUserRole Server Action 提交角色变更
// 禁止选择当前角色、提交中显示 pending、失败展示中文错误
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { updateUserRole } from '@/features/users/actions';

interface RoleOption {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  userId: string;
  currentRoleId: string;
  currentRoleName: string;
  roles: RoleOption[];
  onClose: () => void;
  onSuccess: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  admin: '管理员',
  operator: '运营',
};

export function UserRoleChangeDialog({
  open,
  userId,
  currentRoleId,
  currentRoleName,
  roles,
  onClose,
  onSuccess,
}: Props) {
  const [selectedRoleId, setSelectedRoleId] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 过滤掉当前角色，避免重复提交
  const availableRoles = roles.filter((r) => r.id !== currentRoleId);

  const handleConfirm = async () => {
    if (!selectedRoleId) return;

    setPending(true);
    setError(null);

    try {
      const result = await updateUserRole(userId, selectedRoleId);

      if (result.success) {
        onSuccess();
      } else {
        setError(result.error ?? '修改角色失败');
      }
    } catch {
      setError('修改角色失败，请稍后重试');
    } finally {
      setPending(false);
    }
  };

  const resetAndClose = () => {
    setSelectedRoleId(undefined);
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
          <DialogTitle>修改用户角色</DialogTitle>
          <DialogDescription>
            当前角色：
            <Badge
              variant={currentRoleName === 'admin' ? 'default' : 'secondary'}
              className="ml-1"
            >
              {ROLE_LABELS[currentRoleName] ?? currentRoleName}
            </Badge>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">新角色</label>
            <Select
              value={selectedRoleId}
              onValueChange={(v) => {
                setSelectedRoleId(v ?? undefined);
                setError(null);
              }}
            >
              <SelectTrigger className="mt-1.5 w-full">
                <SelectValue placeholder="请选择新角色" />
              </SelectTrigger>
              <SelectContent>
                {availableRoles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {ROLE_LABELS[r.name] ?? r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && (
            <div className="text-destructive text-sm">{error}</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={resetAndClose} disabled={pending}>
            取消
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!selectedRoleId || pending}
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            确认修改
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
