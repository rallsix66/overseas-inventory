'use client';

// 库存同步页 — 客户端交互层
// 处理同步运行列表、仓库筛选和触发同步 Dialog
import { useState, useMemo, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Eye, Play, RefreshCw, LogIn, CheckCircle, AlertTriangle, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  syncWarehouse,
  syncAllWarehouses,
  getSyncRunDetail,
  establishBigSellerSession,
  verifyBigSellerSession,
} from '@/features/sync/server-actions';
import type {
  SyncRunAdminRow,
  SyncRunOperatorRow,
  SyncRunsResponse,
  SyncRunDetailAdmin,
  SyncRunDetailOperator,
  SessionHealthResult,
} from '@/features/sync/types';

// ─── Type helpers ──────────────────────────────────────────────

type SyncRunRow = SyncRunAdminRow | SyncRunOperatorRow;

interface WarehouseOption {
  id: string;
  name: string;
  country: string;
}

// ─── Badge helpers ─────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'in_progress':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
          执行中
        </span>
      );
    case 'completed':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-600">
          已完成
        </span>
      );
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700">
          失败
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
          {status || '—'}
        </span>
      );
  }
}

function ModeBadge({ mode }: { mode: string }) {
  switch (mode) {
    case 'dry_run':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600">
          Dry Run
        </span>
      );
    case 'real_write':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-700">
          Real Write
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
          {mode}
        </span>
      );
  }
}

function DriftBadge({ check }: { check: string | null }) {
  if (!check) return <span className="text-xs text-muted-foreground">—</span>;
  if (check === 'PASS') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-600">
        一致
      </span>
    );
  }
  if (check === 'DRIFT_DETECTED') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-50 text-yellow-700">
        漂移
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">{check}</span>;
}

// ─── Time formatter ────────────────────────────────────────────

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Detail field helper ────────────────────────────────────────

function DetailField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <span className="text-xs text-muted-foreground">{label}</span>
      <p className={`text-sm mt-0.5 ${mono ? 'font-mono text-xs break-all' : ''}`}>
        {value}
      </p>
    </div>
  );
}

// ─── Props ─────────────────────────────────────────────────────

interface Props {
  runs: SyncRunsResponse;
  isAdmin: boolean;
  warehouses: WarehouseOption[];
}

// ─── Default trigger form state ────────────────────────────────

const DEFAULT_TRIGGER_FORM = {
  warehouseId: '',
};

// ─── Component ─────────────────────────────────────────────────

export function SyncPageContent({ runs, isAdmin, warehouses }: Props) {
  const router = useRouter();

  const rows: SyncRunRow[] = useMemo(() => {
    if (!Array.isArray(runs)) return [];
    return runs as SyncRunRow[];
  }, [runs]);

  // Warehouse filter
  const [filterWarehouseId, setFilterWarehouseId] = useState('all');

  const filteredRows = useMemo(() => {
    if (filterWarehouseId === 'all') return rows;
    return rows.filter((r) => r.warehouse_id === filterWarehouseId);
  }, [rows, filterWarehouseId]);

  // Trigger dialog
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [triggerForm, setTriggerForm] = useState(DEFAULT_TRIGGER_FORM);
  const [submitting, setSubmitting] = useState(false);

  // Detail sheet
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState<SyncRunDetailAdmin | SyncRunDetailOperator | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  async function openDetail(runId: string) {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailData(null);
    setDetailError(null);
    try {
      const data = await getSyncRunDetail(runId);
      if (!data) {
        setDetailError('未找到该同步运行记录');
      } else {
        setDetailData(data as SyncRunDetailAdmin | SyncRunDetailOperator);
      }
    } catch (err) {
      setDetailError('加载详情失败，请稍后重试');
      console.error('加载同步详情失败:', err);
    } finally {
      setDetailLoading(false);
    }
  }

  function handleDetailClose() {
    setDetailOpen(false);
    setDetailData(null);
    setDetailError(null);
  }

  function resetTriggerForm() {
    setTriggerForm(DEFAULT_TRIGGER_FORM);
  }

  // Session health check (P5-SY9B)
  const [healthStatus, setHealthStatus] = useState<SessionHealthResult | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const isSessionHealthy = healthStatus?.status === 'healthy';
  const isSyncDisabled = !isSessionHealthy;

  const checkHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const result = await verifyBigSellerSession();
      setHealthStatus(result);
    } catch (catchErr) {
      const errMsg = (catchErr as Error).message || String(catchErr);
      setHealthStatus({
        status: 'unknown_error',
        message: `健康检查失败: ${errMsg}`,
        checkedAt: new Date().toISOString(),
      });
    } finally {
      setHealthLoading(false);
    }
  }, []);

  // Auto-check health on mount for admin
  useEffect(() => {
    if (isAdmin) {
      const timer = setTimeout(() => {
        void checkHealth();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isAdmin, checkHealth]);

  // Establish session
  const [establishing, setEstablishing] = useState(false);

  async function handleEstablishSession() {
    setEstablishing(true);
    try {
      const result = await establishBigSellerSession();
      if (result.success) {
        toast.success(result.message, { duration: 8000 });
        // 建立登录会话后提示用户稍后检查健康状态
        toast.info('登录完成后，请点击「检查会话状态」确认 headless 同步可用', { duration: 6000 });
      } else {
        toast.error(result.message);
      }
    } catch (catchErr) {
      const errMsg = (catchErr as Error).message || String(catchErr);
      toast.error(`操作失败: ${errMsg}`, { duration: 10000 });
    } finally {
      setEstablishing(false);
    }
  }

  // Sync-all dialog
  const [syncAllOpen, setSyncAllOpen] = useState(false);
  const [syncAllSubmitting, setSyncAllSubmitting] = useState(false);

  async function handleSyncAll() {
    setSyncAllSubmitting(true);
    try {
      const result = await syncAllWarehouses();
      const successCount = result.results.filter((r) => r.success).length;
      const failCount = result.results.length - successCount;

      if (result.allSuccess) {
        toast.success(`全部 ${result.results.length} 个仓库同步完成`);
      } else if (successCount > 0) {
        toast.warning(`${successCount}/${result.results.length} 仓库同步成功，${failCount} 失败`);
      } else {
        toast.error(`全部 ${result.results.length} 个仓库同步失败`);
      }

      for (const r of result.results) {
        if (!r.success) {
          toast.error(`${r.warehouseName}: ${r.error || '同步失败'}`, { duration: 6000 });
        }
      }

      setSyncAllOpen(false);
      router.refresh();
    } catch (catchErr) {
      const errMsg = (catchErr as Error).message || String(catchErr);
      console.error('批量同步失败:', catchErr);
      toast.error(`批量同步失败: ${errMsg}`, { duration: 10000 });
    } finally {
      setSyncAllSubmitting(false);
    }
  }

  async function handleTrigger(e: React.FormEvent) {
    e.preventDefault();
    if (!triggerForm.warehouseId) {
      toast.error('请选择仓库');
      return;
    }

    setSubmitting(true);
    try {
      const result = await syncWarehouse(triggerForm.warehouseId);
      if (result.success) {
        toast.success(`${result.warehouseName} 同步完成（${result.runId.slice(0, 8)}…）`);
        router.refresh();
      } else {
        toast.error(result.error || '同步失败');
      }
      setTriggerOpen(false);
      resetTriggerForm();
    } catch (catchErr) {
      const errMsg = (catchErr as Error).message || String(catchErr);
      console.error('触发同步失败:', catchErr);
      toast.error(`触发同步失败: ${errMsg}`, { duration: 10000 });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="px-4 sm:px-6 py-4 sm:py-6">
      {/* 页头 */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">库存同步</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            管理海外仓库存同步运行，查看执行记录与状态
          </p>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => {
                resetTriggerForm();
                setTriggerOpen(true);
              }}
              disabled={isSyncDisabled}
              title={isSyncDisabled ? 'BigSeller 登录会话不可用，请先检查会话状态' : undefined}
            >
              <Play className="w-4 h-4 mr-1.5" />
              触发同步
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setSyncAllOpen(true)}
              disabled={isSyncDisabled}
              title={isSyncDisabled ? 'BigSeller 登录会话不可用，请先检查会话状态' : undefined}
            >
              <RefreshCw className="w-4 h-4 mr-1.5" />
              同步所有国家
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleEstablishSession}
              disabled={establishing}
            >
              <LogIn className="w-4 h-4 mr-1.5" />
              {establishing ? '启动中…' : '重新建立登录会话'}
            </Button>
          </div>
        )}
      </div>

      {/* BigSeller 会话健康状态 (P5-SY9B) */}
      {isAdmin && (
        <div className="mb-5">
          {healthLoading && !healthStatus && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-gray-50 rounded-md px-4 py-3">
              <RefreshCw className="w-4 h-4 animate-spin" />
              正在检查 BigSeller 登录会话状态…
            </div>
          )}

          {healthStatus && isSessionHealthy && (
            <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-md px-4 py-3">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <div>
                  <span className="text-sm font-medium text-green-700">会话状态：已登录可用</span>
                  <span className="text-xs text-green-600 ml-2">
                    {new Date(healthStatus.checkedAt).toLocaleTimeString('zh-CN')}
                  </span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={checkHealth}
                disabled={healthLoading}
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1 ${healthLoading ? 'animate-spin' : ''}`} />
                刷新
              </Button>
            </div>
          )}

          {healthStatus && !isSessionHealthy && (
            <div className="bg-amber-50 border border-amber-200 rounded-md px-4 py-3">
              <div className="flex items-start gap-2">
                {healthStatus.status === 'need_login' || healthStatus.status === 'need_verification' ? (
                  <ShieldAlert className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-amber-800">
                      会话状态：
                      {healthStatus.status === 'need_login' && '需要登录'}
                      {healthStatus.status === 'need_verification' && '需要验证码'}
                      {healthStatus.status === 'profile_unavailable' && 'Profile 不可用'}
                      {healthStatus.status === 'page_structure_changed' && '页面结构异常'}
                      {healthStatus.status === 'table_not_loaded' && '表格未加载'}
                      {healthStatus.status === 'unknown_error' && '未知错误'}
                    </span>
                    <span className="text-xs text-amber-600">
                      {new Date(healthStatus.checkedAt).toLocaleTimeString('zh-CN')}
                    </span>
                  </div>
                  <p className="text-sm text-amber-700 mt-1">{healthStatus.message}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-amber-600">
                      ⚠ 同步功能已禁用，请先解决会话问题
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={checkHealth}
                      disabled={healthLoading}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 mr-1 ${healthLoading ? 'animate-spin' : ''}`} />
                      重新检查
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {!healthLoading && !healthStatus && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-gray-50 rounded-md px-4 py-3">
              <AlertTriangle className="w-4 h-4 text-gray-400" />
              会话状态未知，请检查
              <Button
                variant="ghost"
                size="sm"
                onClick={checkHealth}
                disabled={healthLoading}
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1" />
                检查
              </Button>
            </div>
          )}
        </div>
      )}

      {/* 筛选栏 */}
      <div className="flex items-center gap-2 mb-5">
        <Select
          value={filterWarehouseId}
          onValueChange={(v) => setFilterWarehouseId(v ?? 'all')}
        >
          <SelectTrigger size="sm" className="w-[180px]">
            <SelectValue placeholder="全部仓库" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部仓库</SelectItem>
            {warehouses.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {(filterWarehouseId !== 'all') && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFilterWarehouseId('all')}
          >
            清除
          </Button>
        )}
      </div>

      {/* 空数据状态 */}
      {filteredRows.length === 0 && (
        <div className="text-center py-16">
          <RefreshCw className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {rows.length === 0
              ? '暂无同步记录'
              : '未找到匹配的同步记录'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {rows.length === 0
              ? isAdmin
                ? '点击右上角"触发同步"开始首次库存同步'
                : '请联系管理员触发库存同步'
              : '请尝试调整筛选条件'}
          </p>
        </div>
      )}

      {/* 同步运行列表 */}
      {filteredRows.length > 0 && (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead>仓库</TableHead>
                <TableHead>模式</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>开始时间</TableHead>
                <TableHead>结束时间</TableHead>
                <TableHead>计划漂移</TableHead>
                {isAdmin && <TableHead className="text-right">退出码</TableHead>}
                {isAdmin && <TableHead>错误信息</TableHead>}
                <TableHead>触发者</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map((row) => (
                <TableRow key={row.id} className="hover:bg-gray-50">
                  <TableCell className="text-sm max-w-[160px] truncate">
                    {row.warehouse_name}
                  </TableCell>
                  <TableCell>
                    <ModeBadge mode={row.mode} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {formatTime(row.started_at)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {formatTime(row.finished_at)}
                  </TableCell>
                  <TableCell>
                    <DriftBadge check={row.plan_drift_check} />
                  </TableCell>
                  {isAdmin && (
                    <TableCell className="text-right tabular-nums text-sm">
                      {(row as SyncRunAdminRow).exit_code ?? '—'}
                    </TableCell>
                  )}
                  {isAdmin && (
                    <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                      {(row as SyncRunAdminRow).error_message || '—'}
                    </TableCell>
                  )}
                  <TableCell className="text-xs text-muted-foreground">
                    {isAdmin
                      ? (row as SyncRunAdminRow).display_name
                      : (row as SyncRunOperatorRow).triggered_by_email ?? '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openDetail(row.id)}
                    >
                      <Eye className="w-3.5 h-3.5 mr-1" />
                      查看详情
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* 页脚计数 */}
      {filteredRows.length > 0 && (
        <p className="text-sm text-muted-foreground mt-5">
          {filteredRows.length === rows.length
            ? `共 ${rows.length} 条记录`
            : `显示 ${filteredRows.length} / ${rows.length} 条记录`}
        </p>
      )}

      {/* 触发同步 Dialog */}
      <Dialog open={triggerOpen} onOpenChange={setTriggerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>触发同步</DialogTitle>
            <DialogDescription>
              选择仓库和同步模式以启动库存同步运行
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleTrigger}>
            <div className="grid gap-4 py-4">
              {/* 仓库选择 */}
              <div className="grid gap-2">
                <Label htmlFor="trigger-warehouse">仓库 *</Label>
                <Select
                  value={triggerForm.warehouseId}
                  onValueChange={(v) =>
                    setTriggerForm((prev) => ({ ...prev, warehouseId: v ?? '' }))
                  }
                >
                  <SelectTrigger id="trigger-warehouse">
                    <SelectValue placeholder="选择仓库" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <p className="text-xs text-muted-foreground">
                系统将自动执行 Dry Run 验证后写入，无需手动填写令牌和 Dry Run ID
              </p>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setTriggerOpen(false);
                  resetTriggerForm();
                }}
                disabled={submitting}
              >
                取消
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && (
                  <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />
                )}
                {submitting ? '同步中…' : '开始同步'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 同步所有国家 Dialog */}
      <Dialog open={syncAllOpen} onOpenChange={setSyncAllOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>同步所有国家</DialogTitle>
            <DialogDescription>
              系统将依次对以下仓库执行 Dry Run 验证后写入：
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* 仓库清单 */}
            <div className="rounded-md bg-gray-50 p-3">
              <ul className="text-sm text-muted-foreground space-y-1.5">
                {warehouses.map((w) => (
                  <li key={w.id} className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                    {w.name}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSyncAllOpen(false)}
              disabled={syncAllSubmitting}
            >
              取消
            </Button>
            <Button onClick={handleSyncAll} disabled={syncAllSubmitting}>
              {syncAllSubmitting && (
                <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />
              )}
              {syncAllSubmitting ? '同步中…' : '开始批量同步'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 查看详情 Sheet */}
      <Sheet open={detailOpen} onOpenChange={(open) => { if (!open) handleDetailClose(); }}>
        <SheetContent side="right" className="w-[420px] sm:max-w-[420px]">
          <SheetHeader>
            <SheetTitle>同步运行详情</SheetTitle>
            <SheetDescription>
              查看同步运行的完整信息和执行结果
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto -mx-4 px-4">
            {detailLoading && (
              <div className="space-y-3 py-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="grid gap-1">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-5 w-full" />
                  </div>
                ))}
              </div>
            )}

            {detailError && !detailLoading && (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground">{detailError}</p>
              </div>
            )}

            {detailData && !detailLoading && (
              <div className="py-4 space-y-4 text-sm">
                {/* 基本信息 */}
                <div className="grid gap-3">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">基本信息</h3>

                  <DetailField label="运行 ID" value={detailData.id} mono />

                  <DetailField
                    label="仓库"
                    value={detailData.warehouse_name}
                  />

                  <div className="grid grid-cols-2 gap-3">
                    <DetailField
                      label="模式"
                      value={
                        detailData.mode === 'dry_run' ? 'Dry Run（只读试跑）' : 'Real Write（真实写入）'
                      }
                    />
                    <DetailField
                      label="状态"
                      value={
                        detailData.status === 'in_progress'
                          ? '执行中'
                          : detailData.status === 'completed'
                            ? '已完成'
                            : '失败'
                      }
                    />
                  </div>

                  <DetailField
                    label="触发者"
                    value={
                      isAdmin
                        ? (detailData as SyncRunDetailAdmin).display_name
                        : (detailData as SyncRunDetailOperator).triggered_by_email ?? '—'
                    }
                  />

                  <DetailField
                    label="触发来源"
                    value={detailData.triggered_from === 'web' ? '网页端' : 'CLI'}
                  />

                  <div className="grid grid-cols-2 gap-3">
                    <DetailField
                      label="开始时间"
                      value={formatTime(detailData.started_at)}
                    />
                    <DetailField
                      label="结束时间"
                      value={formatTime(detailData.finished_at)}
                    />
                  </div>

                  <DetailField
                    label="创建时间"
                    value={formatTime(detailData.created_at)}
                  />
                </div>

                {/* 计划漂移 */}
                <div className="grid gap-3">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">计划漂移</h3>

                  <div className="grid grid-cols-2 gap-3">
                    <DetailField
                      label="漂移检查"
                      value={
                        detailData.plan_drift_check === 'PASS'
                          ? '一致'
                          : detailData.plan_drift_check === 'DRIFT_DETECTED'
                            ? '检测到漂移'
                            : '—'
                      }
                    />
                    <DetailField
                      label="漂移数量"
                      value={detailData.plan_drift_count?.toString() ?? '—'}
                    />
                  </div>
                </div>

                {/* Admin-only 字段 */}
                {isAdmin && (
                  <div className="grid gap-3">
                    <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">管理信息</h3>

                    <div className="grid grid-cols-2 gap-3">
                      <DetailField
                        label="退出码"
                        value={(detailData as SyncRunDetailAdmin).exit_code?.toString() ?? '—'}
                      />
                      <DetailField
                        label="Dry Run ID"
                        value={
                          (detailData as SyncRunDetailAdmin).dry_run_run_id
                            ? (detailData as SyncRunDetailAdmin).dry_run_run_id!.slice(0, 12) + '…'
                            : '—'
                        }
                        mono
                      />
                    </div>

                    <DetailField
                      label="错误信息"
                      value={(detailData as SyncRunDetailAdmin).error_message || '—'}
                    />

                    {(detailData as SyncRunDetailAdmin).plan_drift_differences &&
                      (detailData as SyncRunDetailAdmin).plan_drift_differences!.length > 0 && (
                        <div>
                          <span className="text-xs text-muted-foreground">漂移差异</span>
                          <ul className="mt-1 text-xs text-muted-foreground list-disc list-inside space-y-0.5">
                            {(detailData as SyncRunDetailAdmin).plan_drift_differences!.map((diff, i) => (
                              <li key={i}>{diff}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                    {(!(detailData as SyncRunDetailAdmin).plan_drift_differences ||
                      (detailData as SyncRunDetailAdmin).plan_drift_differences!.length === 0) && (
                        <DetailField label="漂移差异" value="—" />
                      )}
                  </div>
                )}

                {/* 结果摘要（通用） */}
                {detailData.result_summary && (
                  <div className="grid gap-3">
                    <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">结果摘要</h3>
                    <pre className="text-xs bg-gray-50 rounded p-3 overflow-x-auto whitespace-pre-wrap break-all">
                      {JSON.stringify(detailData.result_summary, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
