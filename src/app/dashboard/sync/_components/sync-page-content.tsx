'use client';

// 库存同步页 — 客户端交互层
// 处理同步运行列表、仓库筛选和触发同步 Dialog
import { useState, useMemo, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Eye, Play, RefreshCw, LogIn, CheckCircle, AlertTriangle, ShieldAlert, Package, ArrowRight } from 'lucide-react';
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
  getSyncRunDetail,
  getSyncLogDetail,
  establishBigSellerSession,
  verifyBigSellerSession,
  triggerDryRun,
  confirmRealWrite,
  triggerBatchDryRun,
  triggerBatchRealWrite,
} from '@/features/sync/server-actions';
import type {
  SyncRunAdminRow,
  SyncRunOperatorRow,
  SyncRunsResponse,
  SyncRunDetailAdmin,
  SyncRunDetailOperator,
  SessionHealthResult,
  TriggerDryRunResult,
  BatchDryRunResult,
  BatchDryRunItemResult,
  BatchRealWriteItem,
  BatchRealWriteResult,
  BatchRealWriteItemResult,
  SyncLogRecord,
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

// ─── Batch Review Card (P5-SY9F) ───────────────────────────────

function BatchReviewCard({
  item,
  selectable = false,
  checked = false,
  onToggle,
}: {
  item: BatchDryRunItemResult;
  selectable?: boolean;
  checked?: boolean;
  onToggle?: () => void;
}) {
  const isReady = item.status === 'ready';
  const isSelectable = selectable && isReady;

  const statusConfig = {
    ready: { bg: 'bg-green-50 border-green-200', text: 'text-green-800', label: '✓ 就绪' },
    failed: { bg: 'bg-red-50 border-red-200', text: 'text-red-800', label: '✗ 失败' },
    blocked: { bg: 'bg-yellow-50 border-yellow-200', text: 'text-yellow-800', label: '⚠ 阻断' },
  }[item.status];

  return (
    <div className={`rounded-md border p-3 text-sm ${statusConfig.bg}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {selectable && (
            <input
              type="checkbox"
              checked={checked}
              onChange={onToggle}
              disabled={!isSelectable}
              className={`w-4 h-4 rounded border-gray-300 ${isSelectable ? 'cursor-pointer' : 'cursor-not-allowed opacity-30'}`}
            />
          )}
          <span className="font-medium">
            {item.warehouseName}
            <span className="text-xs text-muted-foreground ml-1.5">({item.country})</span>
          </span>
        </div>
        <span className={`text-xs font-medium ${statusConfig.text}`}>{statusConfig.label}</span>
      </div>

      {/* Run ID */}
      {item.runId && (
        <p className="text-xs text-muted-foreground mb-2 font-mono">
          Run ID: {item.runId.slice(0, 12)}…
        </p>
      )}

      {/* Summary grid — only for ready/blocked (not failed with no run) */}
      {item.status !== 'failed' && (
        <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-xs mb-2">
          <span>抓取行数: {item.rawRowCount}</span>
          <span>有效 SKU: {item.validSkuCount}</span>
          <span>无效 SKU: {item.invalidSkuCount}</span>
          <span>新 Variant: {item.variantsCreated}</span>
          <span>库存新增: {item.inventoryInserted}</span>
          <span>库存更新: {item.inventoryUpdated}</span>
          <span>库存不变: {item.inventoryUnchanged}</span>
          <span className="col-span-2">
            计划漂移: {item.planDriftCheck === 'PASS'
              ? <span className="text-green-700 font-medium">✓ 一致</span>
              : item.planDriftCheck === 'DRIFT_DETECTED'
                ? <span className="text-red-700">检测到漂移（{item.planDriftCount} 项）</span>
                : '—'}
          </span>
        </div>
      )}

      {/* Rename plan */}
      {item.warehouseRenamePlan && item.warehouseRenamePlan.action === 'rename' && (
        <div className="text-xs text-amber-700 bg-amber-100/50 rounded px-2 py-1 mb-2">
          📝 仓库改名：{item.warehouseRenamePlan.currentName} → {item.warehouseRenamePlan.targetName}
        </div>
      )}
      {item.warehouseRenamePlan && item.warehouseRenamePlan.action === 'none' && (
        <div className="text-xs text-muted-foreground mb-2">仓库名称无需更改</div>
      )}

      {/* Failure reason */}
      {item.failureReason && (
        <p className="text-xs text-red-700 mt-1">
          {item.failureReason}
        </p>
      )}
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

  // ─── P5-SY9H: 仓库聚合概览 ──────────────────────────────────────
  const warehouseOverview = useMemo(() => {
    const grouped = new Map<string, {
      warehouseId: string;
      warehouseName: string;
      latestDryRun: { status: string; time: string | null; runId: string } | null;
      latestRealWrite: { status: string; time: string | null; runId: string } | null;
      lastSuccessTime: string | null;
      lastFailureReason: string | null;
    }>();

    for (const row of rows) {
      const entry = grouped.get(row.warehouse_id) || {
        warehouseId: row.warehouse_id,
        warehouseName: row.warehouse_name,
        latestDryRun: null as { status: string; time: string | null; runId: string } | null,
        latestRealWrite: null as { status: string; time: string | null; runId: string } | null,
        lastSuccessTime: null as string | null,
        lastFailureReason: null as string | null,
      };

      const rowTime = row.finished_at ?? row.started_at ?? row.created_at;

      // Track latest per mode
      if (row.mode === 'dry_run') {
        if (!entry.latestDryRun || (rowTime && entry.latestDryRun.time && rowTime > entry.latestDryRun.time)) {
          entry.latestDryRun = { status: row.status, time: rowTime, runId: row.id };
        }
      } else if (row.mode === 'real_write') {
        if (!entry.latestRealWrite || (rowTime && entry.latestRealWrite.time && rowTime > entry.latestRealWrite.time)) {
          entry.latestRealWrite = { status: row.status, time: rowTime, runId: row.id };
        }
      }

      // Track last success
      if (row.status === 'completed' && row.finished_at) {
        if (!entry.lastSuccessTime || row.finished_at > entry.lastSuccessTime) {
          entry.lastSuccessTime = row.finished_at;
        }
      }

      // Track last failure reason (first failed run)
      if (row.status === 'failed') {
        if (!entry.lastFailureReason) {
          const reason = isAdmin
            ? (row as SyncRunAdminRow).error_message
            : (row as SyncRunOperatorRow).failure_summary;
          entry.lastFailureReason = reason ?? null;
        }
      }

      grouped.set(row.warehouse_id, entry);
    }

    return Array.from(grouped.values());
  }, [rows, isAdmin]);

  // ─── P5-SY9H: 客户端分页 ────────────────────────────────────────
  const PAGE_SIZE = 20;
  const [page, setPage] = useState(1);
  const totalFiltered = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const paginatedRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredRows.slice(start, start + PAGE_SIZE);
  }, [filteredRows, page]);

  // Reset page when filter changes — wrap in setTimeout to avoid cascading render warning
  useEffect(() => {
    const timer = setTimeout(() => setPage(1), 0);
    return () => clearTimeout(timer);
  }, [filterWarehouseId]);

  // Trigger dialog
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [triggerForm, setTriggerForm] = useState(DEFAULT_TRIGGER_FORM);
  const [submitting, setSubmitting] = useState(false);

  // Detail sheet
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState<SyncRunDetailAdmin | SyncRunDetailOperator | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  // P5-SY9H: sync_log detail
  const [detailSyncLog, setDetailSyncLog] = useState<SyncLogRecord | null>(null);

  async function openDetail(runId: string) {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailData(null);
    setDetailError(null);
    setDetailSyncLog(null);
    try {
      const [runData, syncLog] = await Promise.all([
        getSyncRunDetail(runId),
        getSyncLogDetail(runId),
      ]);
      if (!runData) {
        setDetailError('未找到该同步运行记录');
      } else {
        setDetailData(runData as SyncRunDetailAdmin | SyncRunDetailOperator);
        setDetailSyncLog(syncLog);
      }
    } catch (err) {
      setDetailError('加载详情失败，请稍后重试');
      console.error('加载同步详情失败:', err);
    } finally {
      setDetailLoading(false);
    }
  }

  // P5-SY9D: Dry Run review flow
  const [dryRunResult, setDryRunResult] = useState<TriggerDryRunResult | null>(null);
  const [dryRunSubmitting, setDryRunSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);

  function handleDetailClose() {
    setDetailOpen(false);
    setDetailData(null);
    setDetailError(null);
    setDetailSyncLog(null);
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

  // Batch Dry Run dialog (P5-SY9F)
  const [syncAllOpen, setSyncAllOpen] = useState(false);
  const [batchDryRunSubmitting, setBatchDryRunSubmitting] = useState(false);
  const [batchDryRunResult, setBatchDryRunResult] = useState<BatchDryRunResult | null>(null);

  async function handleBatchDryRun() {
    setBatchDryRunSubmitting(true);
    setBatchDryRunResult(null);
    setSelectedReadyItems(new Set());
    setConfirmationPhrase('');
    setBatchRealWriteResult(null);
    try {
      const result = await triggerBatchDryRun();
      setBatchDryRunResult(result);

      const readyCount = result.successCount;
      const failedCount = result.failedCount;
      const blockedCount = result.blockedCount;

      if (result.blockReason) {
        toast.error(`批量 Dry Run 已阻断: ${result.blockReason}`, { duration: 8000 });
      } else if (result.allSucceeded) {
        toast.success(`全部 ${readyCount} 个仓库 Dry Run 通过，可进入审核`);
      } else {
        toast.warning(
          `批量 Dry Run 完成：${readyCount} 就绪 / ${failedCount} 失败 / ${blockedCount} 阻断`,
          { duration: 6000 },
        );
      }

      for (const item of result.results) {
        if (item.status === 'failed') {
          toast.error(`${item.warehouseName}: ${item.failureReason || '执行失败'}`, { duration: 6000 });
        } else if (item.status === 'blocked') {
          toast.warning(`${item.warehouseName}: ${item.failureReason || '已阻断'}`, { duration: 5000 });
        }
      }

      if (result.results.some((r) => r.status === 'ready')) {
        router.refresh();
      }
    } catch (catchErr) {
      const errMsg = (catchErr as Error).message || String(catchErr);
      console.error('批量 Dry Run 失败:', catchErr);
      toast.error(`批量 Dry Run 失败: ${errMsg}`, { duration: 10000 });
    } finally {
      setBatchDryRunSubmitting(false);
    }
  }

  // P5-SY9G: Batch real write state
  const [selectedReadyItems, setSelectedReadyItems] = useState<Set<string>>(new Set());
  const [confirmationPhrase, setConfirmationPhrase] = useState('');
  const [batchRealWriteSubmitting, setBatchRealWriteSubmitting] = useState(false);
  const [batchRealWriteResult, setBatchRealWriteResult] = useState<BatchRealWriteResult | null>(null);

  function toggleReadyItem(warehouseId: string) {
    setSelectedReadyItems((prev) => {
      const next = new Set(prev);
      if (next.has(warehouseId)) {
        next.delete(warehouseId);
      } else {
        next.add(warehouseId);
      }
      return next;
    });
  }

  function selectAllReady() {
    if (!batchDryRunResult) return;
    const readyIds = batchDryRunResult.results
      .filter((r) => r.status === 'ready')
      .map((r) => r.warehouseId);
    setSelectedReadyItems(new Set(readyIds));
  }

  function deselectAllReady() {
    setSelectedReadyItems(new Set());
  }

  async function handleBatchRealWrite() {
    if (!batchDryRunResult) return;
    if (selectedReadyItems.size === 0) {
      toast.error('请至少勾选一个就绪仓库');
      return;
    }

    // Build confirmation items from selected ready results
    const selectedResults = batchDryRunResult.results.filter(
      (r) => r.status === 'ready' && selectedReadyItems.has(r.warehouseId),
    );

    const items: BatchRealWriteItem[] = selectedResults.map((r) => ({
      warehouseId: r.warehouseId,
      warehouseName: r.warehouseName,
      country: r.country,
      dryRunRunId: r.runId,
      confirmToken: '', // populated server-side from COUNTRY_TOKEN_MAP
    }));

    setBatchRealWriteSubmitting(true);
    setBatchRealWriteResult(null);
    try {
      const result = await triggerBatchRealWrite(items, confirmationPhrase);
      setBatchRealWriteResult(result);

      if (result.blockReason) {
        toast.error(`批量写入已阻断: ${result.blockReason}`, { duration: 8000 });
      } else {
        toast.info(
          `批量写入完成：${result.successCount} 成功 / ${result.failedCount} 失败 / ${result.skippedCount} 跳过`,
          { duration: 6000 },
        );
      }

      for (const item of result.results) {
        if (item.status === 'failed') {
          toast.error(`${item.warehouseName}: ${item.failureReason || '写入失败'}`, { duration: 6000 });
        }
      }

      if (result.results.some((r) => r.status === 'success')) {
        router.refresh();
      }
    } catch (catchErr) {
      const errMsg = (catchErr as Error).message || String(catchErr);
      console.error('批量写入失败:', catchErr);
      toast.error(`批量写入失败: ${errMsg}`, { duration: 10000 });
    } finally {
      setBatchRealWriteSubmitting(false);
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

  // P5-SY9D: 单仓 Dry Run（审核流程）
  async function handleTriggerDryRun(warehouseId: string) {
    setDryRunSubmitting(true);
    setDryRunResult(null);
    try {
      const result = await triggerDryRun(warehouseId);
      setDryRunResult(result);
      if (result.success) {
        toast.success(`${result.warehouseName} Dry Run 完成，请审核结果`);
        router.refresh();
      } else {
        toast.error(result.error || 'Dry Run 失败');
      }
    } catch (catchErr) {
      const errMsg = (catchErr as Error).message || String(catchErr);
      toast.error(`Dry Run 失败: ${errMsg}`, { duration: 10000 });
    } finally {
      setDryRunSubmitting(false);
    }
  }

  // P5-SY9D: 确认 Real Write
  async function handleConfirmRealWrite() {
    if (!dryRunResult?.runId) return;
    setConfirmSubmitting(true);
    try {
      const result = await confirmRealWrite(dryRunResult.warehouseId, dryRunResult.runId);
      if (result.success) {
        toast.success(`${result.warehouseName} 真实写入完成`);
        setConfirmOpen(false);
        setDryRunResult(null);
        router.refresh();
      } else {
        toast.error(result.error || '写入失败');
      }
    } catch (catchErr) {
      const errMsg = (catchErr as Error).message || String(catchErr);
      toast.error(`写入失败: ${errMsg}`, { duration: 10000 });
    } finally {
      setConfirmSubmitting(false);
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

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => router.push('/dashboard/inventory/overseas')}
          >
            <Package className="w-4 h-4 mr-1.5" />
            海外库存
          </Button>

          {isAdmin && (
            <>
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
                批量 Dry Run
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
            </>
          )}
        </div>
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

      {/* ─── P5-SY9H: 仓库同步概览 ────────────────────────────────── */}
      {warehouseOverview.length > 0 && (
        <div className="mb-5">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
            仓库同步概览
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {warehouseOverview.map((wh) => (
              <button
                key={wh.warehouseId}
                type="button"
                className="text-left rounded-md border bg-card p-3 hover:border-primary/50 hover:shadow-sm transition-colors cursor-pointer"
                onClick={() => setFilterWarehouseId(wh.warehouseId)}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">
                    {wh.warehouseName}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    Dry Run：
                    {wh.latestDryRun ? (
                      <span className={
                        wh.latestDryRun.status === 'completed' ? 'text-green-600' :
                        wh.latestDryRun.status === 'in_progress' ? 'text-blue-600' :
                        'text-red-600'
                      }>
                        {wh.latestDryRun.status === 'completed' ? '通过' :
                         wh.latestDryRun.status === 'in_progress' ? '执行中' : '失败'}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </span>
                  <span>
                    Real Write：
                    {wh.latestRealWrite ? (
                      <span className={
                        wh.latestRealWrite.status === 'completed' ? 'text-green-600' :
                        wh.latestRealWrite.status === 'in_progress' ? 'text-blue-600' :
                        'text-red-600'
                      }>
                        {wh.latestRealWrite.status === 'completed' ? '成功' :
                         wh.latestRealWrite.status === 'in_progress' ? '执行中' : '失败'}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </span>
                  <span className="col-span-2">
                    最后成功：{wh.lastSuccessTime ? formatTime(wh.lastSuccessTime) : <span className="text-gray-400">—</span>}
                  </span>
                  {wh.lastFailureReason && (
                    <span className="col-span-2 text-red-600 truncate" title={wh.lastFailureReason}>
                      ⚠ {wh.lastFailureReason.slice(0, 80)}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
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
      {paginatedRows.length === 0 && (
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
                ? '点击右上角"触发同步"执行单仓 Dry Run，或使用"批量 Dry Run"审核全部仓库'
                : '请联系管理员触发库存同步'
              : '请尝试调整筛选条件'}
          </p>
        </div>
      )}

      {/* 同步运行列表 */}
      {paginatedRows.length > 0 && (
        <>
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
                <TableHead>失败原因</TableHead>
                {isAdmin && <TableHead className="text-right">退出码</TableHead>}
                <TableHead>触发者</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedRows.map((row) => (
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
                  {/* P5-SY9H: 失败原因对两个角色均可见 */}
                  <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                    {row.status === 'failed'
                      ? isAdmin
                        ? (row as SyncRunAdminRow).error_message || '—'
                        : (row as SyncRunOperatorRow).failure_summary || '—'
                      : '—'}
                  </TableCell>
                  {isAdmin && (
                    <TableCell className="text-right tabular-nums text-sm">
                      {(row as SyncRunAdminRow).exit_code ?? '—'}
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

        {/* P5-SY9H: 分页控件 */}
        <div className="flex items-center justify-between mt-5">
          <p className="text-sm text-muted-foreground">
            共 {totalFiltered} 条记录
            {filterWarehouseId !== 'all' && `（仓库筛选）`}
            {totalPages > 1 && `，第 ${page} / ${totalPages} 页`}
          </p>
          {totalPages > 1 && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                下一页
              </Button>
            </div>
          )}
        </div>
        </>
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
                  onValueChange={(v) => {
                    setTriggerForm((prev) => ({ ...prev, warehouseId: v ?? '' }));
                    setDryRunResult(null);
                  }}
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

              {/* Dry Run 审核摘要 */}
              {dryRunResult && dryRunResult.success && dryRunResult.summary && (
                <div className="rounded-md bg-green-50 border border-green-200 p-3 space-y-1.5 text-sm">
                  <p className="font-medium text-green-800">Dry Run 审核摘要</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-green-700">
                    <span>仓库：{dryRunResult.summary.warehouseName}</span>
                    <span>状态：<span className="font-medium text-green-800">READY</span></span>
                    <span>新 Variant：{dryRunResult.summary.variantsCreated}</span>
                    <span>库存新增：{dryRunResult.summary.inventoryInserted}</span>
                    <span>库存更新：{dryRunResult.summary.inventoryUpdated}</span>
                    <span>库存不变：{dryRunResult.summary.inventoryUnchanged}</span>
                    {dryRunResult.summary.warehouseRenamed && (
                      <span className="col-span-2 text-amber-600">仓库改名：是</span>
                    )}
                    <span className="col-span-2">
                      计划漂移：{dryRunResult.summary.planDriftCheck === 'PASS'
                        ? <span className="text-green-700 font-medium">✓ 一致</span>
                        : <span className="text-red-700">{dryRunResult.summary.planDriftCheck}</span>}
                      {dryRunResult.summary.planDriftCount > 0 && `（${dryRunResult.summary.planDriftCount} 项）`}
                    </span>
                  </div>
                  <div className="pt-2 flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => setConfirmOpen(true)}
                      disabled={dryRunResult.summary.planDriftCheck !== 'PASS'}
                      title={
                        dryRunResult.summary.planDriftCheck !== 'PASS'
                          ? '计划漂移未通过，无法执行真实写入'
                          : '确认执行真实写入'
                      }
                    >
                      确认写入
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDryRunResult(null)}
                    >
                      清除
                    </Button>
                  </div>
                </div>
              )}

              {dryRunResult && !dryRunResult.success && (
                <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                  <p className="font-medium">Dry Run 失败</p>
                  <p className="text-xs mt-1">{dryRunResult.error || '未知错误'}</p>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                点击「开始 Dry Run」执行只读试跑验证，审核结果后确认写入
              </p>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setTriggerOpen(false);
                  resetTriggerForm();
                  setDryRunResult(null);
                }}
                disabled={submitting || dryRunSubmitting}
              >
                取消
              </Button>
              {!dryRunResult?.success && (
                <Button
                  type="button"
                  onClick={() => handleTriggerDryRun(triggerForm.warehouseId)}
                  disabled={!triggerForm.warehouseId || dryRunSubmitting}
                >
                  {dryRunSubmitting && (
                    <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />
                  )}
                  {dryRunSubmitting ? '执行中…' : '开始 Dry Run'}
                </Button>
              )}
              <Button type="submit" disabled={submitting}>
                {submitting && (
                  <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />
                )}
                {submitting ? '同步中…' : '快速同步'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 批量 Dry Run / 审核总览 Dialog (P5-SY9F) */}
      <Dialog open={syncAllOpen} onOpenChange={(open) => { if (!open) { setSyncAllOpen(false); setBatchDryRunResult(null); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>批量 Dry Run / 审核总览</DialogTitle>
            <DialogDescription>
              对全部启用海外仓执行只读 Dry Run，生成审核总览。不会写入数据库。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* 仓库清单 */}
            {!batchDryRunResult && (
              <div className="rounded-md bg-gray-50 p-3">
                <p className="text-sm font-medium text-muted-foreground mb-2">
                  将依次对以下 {warehouses.length} 个仓库执行 Dry Run：
                </p>
                <ul className="text-sm text-muted-foreground space-y-1.5">
                  {warehouses.map((w) => (
                    <li key={w.id} className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                      {w.name}
                      <span className="text-xs text-muted-foreground/60">({w.country})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 全局阻断 */}
            {batchDryRunResult?.blockReason && (
              <div className="rounded-md bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
                <p className="font-medium">⚠ 批量 Dry Run 已阻断</p>
                <p className="text-xs mt-1">{batchDryRunResult.blockReason}</p>
              </div>
            )}

            {/* 审核总览结果 */}
            {batchDryRunResult && !batchDryRunResult.blockReason && (
              <>
                {/* 汇总统计 */}
                <div className="flex items-center gap-4 text-sm">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
                    就绪 <span className="font-medium">{batchDryRunResult.successCount}</span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                    失败 <span className="font-medium">{batchDryRunResult.failedCount}</span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                    阻断 <span className="font-medium">{batchDryRunResult.blockedCount}</span>
                  </span>
                </div>

                {/* 逐仓审核明细 */}
                <div className="max-h-[40vh] overflow-y-auto space-y-3">
                  {batchDryRunResult.results.map((item) => (
                    <BatchReviewCard
                      key={item.warehouseId}
                      item={item}
                      selectable={item.status === 'ready'}
                      checked={selectedReadyItems.has(item.warehouseId)}
                      onToggle={() => toggleReadyItem(item.warehouseId)}
                    />
                  ))}
                </div>

                {/* P5-SY9G: 批量真实写入操作区 */}
                {batchDryRunResult.successCount > 0 && !batchRealWriteResult && (
                  <div className="border-t pt-4 space-y-3">
                    {/* 选择工具栏 */}
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">
                        已选择 {selectedReadyItems.size} / {batchDryRunResult.successCount} 个就绪仓库
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={selectAllReady}
                          disabled={selectedReadyItems.size === batchDryRunResult.successCount}
                        >
                          全选就绪仓库
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={deselectAllReady}
                          disabled={selectedReadyItems.size === 0}
                        >
                          取消选择
                        </Button>
                      </div>
                    </div>

                    {/* 确认短语输入 */}
                    <div className="space-y-1.5">
                      <Label htmlFor="batch-confirm-phrase" className="text-sm">
                        确认短语 <span className="text-red-500">*</span>
                      </Label>
                      <input
                        id="batch-confirm-phrase"
                        type="text"
                        className="w-full px-3 py-2 text-sm border rounded-md"
                        placeholder="请输入「确认写入」以确认批量真实写入"
                        value={confirmationPhrase}
                        onChange={(e) => setConfirmationPhrase(e.target.value)}
                        disabled={batchRealWriteSubmitting}
                      />
                      <p className="text-xs text-muted-foreground">
                        输入「确认写入」后，点击下方按钮将逐仓执行真实数据库写入。操作不可撤销。
                      </p>
                    </div>

                    {/* 批量写入按钮 */}
                    <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                      <p>
                        ⚠ 将对已勾选的 <strong>{selectedReadyItems.size}</strong> 个就绪仓库执行真实写入。
                        每仓独立执行，单仓失败不影响其他仓库继续写入。
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="default"
                      className="w-full"
                      onClick={handleBatchRealWrite}
                      disabled={
                        selectedReadyItems.size === 0
                        || confirmationPhrase !== '确认写入'
                        || batchRealWriteSubmitting
                      }
                    >
                      {batchRealWriteSubmitting && (
                        <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />
                      )}
                      {batchRealWriteSubmitting ? '写入中…' : `批量确认写入（${selectedReadyItems.size} 仓）`}
                    </Button>
                  </div>
                )}

                {/* 批量写入结果 */}
                {batchRealWriteResult && (
                  <div className="border-t pt-4 space-y-3">
                    {batchRealWriteResult.blockReason ? (
                      <div className="rounded-md bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
                        <p className="font-medium">⚠ 批量写入已阻断</p>
                        <p className="text-xs mt-1">{batchRealWriteResult.blockReason}</p>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm font-medium">批量写入结果</p>
                        <div className="flex items-center gap-4 text-sm">
                          <span className="inline-flex items-center gap-1">
                            <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
                            成功 <span className="font-medium">{batchRealWriteResult.successCount}</span>
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                            失败 <span className="font-medium">{batchRealWriteResult.failedCount}</span>
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <span className="w-2.5 h-2.5 rounded-full bg-gray-400" />
                            跳过 <span className="font-medium">{batchRealWriteResult.skippedCount}</span>
                          </span>
                        </div>
                        <div className="max-h-[30vh] overflow-y-auto space-y-2">
                          {batchRealWriteResult.results.map((r) => (
                            <div
                              key={r.warehouseId}
                              className={`rounded-md border p-2.5 text-sm ${
                                r.status === 'success'
                                  ? 'bg-green-50 border-green-200'
                                  : r.status === 'failed'
                                    ? 'bg-red-50 border-red-200'
                                    : 'bg-gray-50 border-gray-200'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-medium">
                                  {r.warehouseName}
                                  <span className="text-xs text-muted-foreground ml-1">({r.country})</span>
                                </span>
                                <span className={`text-xs font-medium ${
                                  r.status === 'success'
                                    ? 'text-green-800'
                                    : r.status === 'failed'
                                      ? 'text-red-800'
                                      : 'text-gray-600'
                                }`}>
                                  {r.status === 'success' ? '✓ 成功' : r.status === 'failed' ? '✗ 失败' : '— 跳过'}
                                </span>
                              </div>
                              {r.runId && (
                                <p className="text-xs text-muted-foreground mt-1 font-mono">
                                  Run ID: {r.runId.slice(0, 12)}…
                                </p>
                              )}
                              {r.failureReason && (
                                <p className="text-xs text-red-700 mt-1">{r.failureReason}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSyncAllOpen(false);
                setBatchDryRunResult(null);
                setSelectedReadyItems(new Set());
                setConfirmationPhrase('');
                setBatchRealWriteResult(null);
              }}
              disabled={batchDryRunSubmitting || batchRealWriteSubmitting}
            >
              {batchDryRunResult ? '关闭' : '取消'}
            </Button>
            {!batchDryRunResult && (
              <Button onClick={handleBatchDryRun} disabled={batchDryRunSubmitting}>
                {batchDryRunSubmitting && (
                  <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />
                )}
                {batchDryRunSubmitting ? '执行中…' : '开始批量 Dry Run'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* P5-SY9D: 确认 Real Write Dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认真实写入</DialogTitle>
            <DialogDescription>
              系统将使用已审核的 Dry Run 结果执行真实数据库写入。请确认以下信息：
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {dryRunResult?.summary && (
              <div className="rounded-md bg-gray-50 p-3 space-y-1.5 text-sm">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <span>仓库：{dryRunResult.summary.warehouseName}</span>
                  <span>Run ID：{dryRunResult.runId.slice(0, 12)}…</span>
                  <span>新 Variant：{dryRunResult.summary.variantsCreated}</span>
                  <span>库存新增：{dryRunResult.summary.inventoryInserted}</span>
                  <span>库存更新：{dryRunResult.summary.inventoryUpdated}</span>
                  <span>库存不变：{dryRunResult.summary.inventoryUnchanged}</span>
                  <span className="col-span-2">漂移检查：{dryRunResult.summary.planDriftCheck}</span>
                </div>
              </div>
            )}

            <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
              <p>⚠ 真实写入将修改数据库中的 Variant 和 Inventory 数据，写入后不可撤销。</p>
              <p className="text-xs mt-1">Dry Run ID：{dryRunResult?.runId} — 系统内部绑定，无需手动填写。</p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={confirmSubmitting}
            >
              取消
            </Button>
            <Button
              onClick={handleConfirmRealWrite}
              disabled={confirmSubmitting}
              variant="default"
            >
              {confirmSubmitting && (
                <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />
              )}
              {confirmSubmitting ? '写入中…' : '确认写入'}
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

                {/* ─── P5-SY9H: 同步日志（sync_log） ────────────────── */}
                {detailSyncLog && (
                  <div className="grid gap-3">
                    <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">同步日志</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <DetailField
                        label="日志状态"
                        value={detailSyncLog.status === 'success' ? '成功' : '失败'}
                      />
                      <DetailField
                        label="同步数量"
                        value={detailSyncLog.newVariantsCount.toString()}
                      />
                      <DetailField
                        label="日志开始"
                        value={formatTime(detailSyncLog.startedAt)}
                      />
                      <DetailField
                        label="日志结束"
                        value={formatTime(detailSyncLog.finishedAt)}
                      />
                    </div>
                    {detailSyncLog.errorMessage && (
                      <DetailField
                        label="日志错误"
                        value={detailSyncLog.errorMessage}
                      />
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
