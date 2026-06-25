'use client';

// 归档/恢复批量操作组件 — 所有登录用户可用
// 根据选中项在当前用户视角下的状态显示对应操作按钮，含确认 Dialog
// P5-SY11G: 归档是用户个人偏好，A 的归档不影响 B
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Archive, ArchiveRestore } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { archiveVariants, restoreVariants } from '../actions';
import type { VariantItem } from '../types';

interface ArchiveControlsProps {
  /** 当前页已选中的 Variant 列表 */
  selectedItems: VariantItem[];
  /** 当前归档筛选状态 */
  archiveStatus: 'active' | 'archived' | 'all';
  /** 所有选中项全部清除回调 */
  onClearSelection: () => void;
}

export function ArchiveControls({
  selectedItems,
  onClearSelection,
}: ArchiveControlsProps) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState<'archive' | 'restore' | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // P5-SY11G: 基于当前用户的 isArchivedByUser 判断，而非全局 is_archived
  const activeSelected = selectedItems.filter((item) => !item.isArchivedByUser);
  const archivedSelected = selectedItems.filter((item) => item.isArchivedByUser);

  // 可归档：有选中活跃项
  const canArchive = activeSelected.length > 0;
  // 可恢复：有选中已归档项
  const canRestore = archivedSelected.length > 0;

  async function handleArchive() {
    setSubmitting(true);
    try {
      const result = await archiveVariants(activeSelected.map((item) => item.id));
      if (result.success) {
        toast.success(`成功归档 ${result.data?.archived ?? activeSelected.length} 个 SKU`);
        onClearSelection();
        router.refresh();
      } else {
        toast.error(result.error ?? '归档失败');
      }
    } catch {
      toast.error('归档失败，请稍后重试');
    } finally {
      setSubmitting(false);
      setDialogOpen(null);
    }
  }

  async function handleRestore() {
    setSubmitting(true);
    try {
      const result = await restoreVariants(archivedSelected.map((item) => item.id));
      if (result.success) {
        toast.success(`成功恢复 ${result.data?.restored ?? archivedSelected.length} 个 SKU`);
        onClearSelection();
        router.refresh();
      } else {
        toast.error(result.error ?? '恢复失败');
      }
    } catch {
      toast.error('恢复失败，请稍后重试');
    } finally {
      setSubmitting(false);
      setDialogOpen(null);
    }
  }

  if (selectedItems.length === 0) return null;

  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm text-muted-foreground">
          已选 {selectedItems.length} 项
          {activeSelected.length > 0 && archivedSelected.length > 0 && (
            <span className="ml-2 text-amber-600">
              （{activeSelected.length} 活跃 + {archivedSelected.length} 已归档）
            </span>
          )}
        </span>

        {canArchive && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDialogOpen('archive')}
            className="text-amber-700 border-amber-300 hover:bg-amber-50"
          >
            <Archive className="w-4 h-4 mr-1" />
            归档选中
          </Button>
        )}

        {canRestore && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDialogOpen('restore')}
            className="text-blue-700 border-blue-300 hover:bg-blue-50"
          >
            <ArchiveRestore className="w-4 h-4 mr-1" />
            恢复选中
          </Button>
        )}

        <Button variant="ghost" size="sm" onClick={onClearSelection}>
          取消选择
        </Button>
      </div>

      {/* 归档确认 Dialog */}
      <Dialog open={dialogOpen === 'archive'} onOpenChange={(v) => !v && setDialogOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认归档</DialogTitle>
            <DialogDescription>
              将 {activeSelected.length} 个活跃 SKU 归档。归档后默认库存列表和低库存统计将不再显示这些 SKU，但同步链路不受影响。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(null)} disabled={submitting}>
              取消
            </Button>
            <Button
              variant="default"
              onClick={handleArchive}
              disabled={submitting}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {submitting ? '归档中…' : '确认归档'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 恢复确认 Dialog */}
      <Dialog open={dialogOpen === 'restore'} onOpenChange={(v) => !v && setDialogOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认恢复</DialogTitle>
            <DialogDescription>
              将 {archivedSelected.length} 个已归档 SKU 恢复为活跃状态。恢复后这些 SKU 将重新出现在默认库存列表中。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(null)} disabled={submitting}>
              取消
            </Button>
            <Button
              variant="default"
              onClick={handleRestore}
              disabled={submitting}
            >
              {submitting ? '恢复中…' : '确认恢复'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
