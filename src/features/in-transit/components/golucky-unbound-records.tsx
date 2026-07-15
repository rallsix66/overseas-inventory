'use client';

// P0: 未绑定喜运达外部物流记录列表与 Shipment 绑定入口。
// 候选查询和绑定写入均通过 Server Action，客户端不直接访问 Supabase。

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Link2, Loader2, PackageSearch, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  bindExternalRefToShipment,
  listShipmentBindingCandidates,
} from '@/features/in-transit/actions';
import type {
  ShipmentBindingCandidate,
  ShipmentExternalRefRow,
} from '@/features/in-transit/types';

interface WarehouseSummary {
  id: string;
  name: string;
  country: string;
}

interface Props {
  records: ShipmentExternalRefRow[];
  warehouses: WarehouseSummary[];
  isAdmin: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  active: '同步中',
  stale: '终态',
  error: '同步失败',
};

const SHIPMENT_STATUS_LABELS: Record<string, string> = {
  booking: '订舱',
  loading: '装柜',
  departed: '已离港',
  arrived: '已到港',
  customs: '清关中',
  warehoused: '已入仓',
};

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN');
}

export function GoluckyUnboundRecords({
  records: initialRecords,
  warehouses,
  isAdmin,
}: Props) {
  const router = useRouter();
  const loadRequestRef = useRef(0);
  const [records, setRecords] = useState(initialRecords);
  const [activeRecord, setActiveRecord] = useState<ShipmentExternalRefRow | null>(null);
  const [candidates, setCandidates] = useState<ShipmentBindingCandidate[]>([]);
  const [selectedShipmentId, setSelectedShipmentId] = useState('');
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [binding, setBinding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCandidate = candidates.find((item) => item.id === selectedShipmentId) ?? null;

  function warehouseName(warehouseId: string | null): string {
    if (!warehouseId) return '待分配';
    return warehouses.find((warehouse) => warehouse.id === warehouseId)?.name ?? '未知仓库';
  }

  async function openBindingDialog(record: ShipmentExternalRefRow) {
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    setActiveRecord(record);
    setCandidates([]);
    setSelectedShipmentId('');
    setError(null);
    setLoadingCandidates(true);

    try {
      const result = await listShipmentBindingCandidates(record.id);
      if (requestId !== loadRequestRef.current) return;

      if (result.success) {
        setCandidates(result.data ?? []);
      } else {
        setError(result.error ?? '查询可绑定 Shipment 失败');
      }
    } catch {
      if (requestId === loadRequestRef.current) {
        setError('查询可绑定 Shipment 失败，请稍后重试');
      }
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoadingCandidates(false);
      }
    }
  }

  function closeDialog() {
    if (binding) return;
    loadRequestRef.current += 1;
    setActiveRecord(null);
    setCandidates([]);
    setSelectedShipmentId('');
    setLoadingCandidates(false);
    setError(null);
  }

  async function handleBind() {
    if (!activeRecord || !selectedShipmentId || binding) return;

    setBinding(true);
    setError(null);
    try {
      const result = await bindExternalRefToShipment(activeRecord.id, selectedShipmentId);
      if (!result.success) {
        setError(result.error ?? '绑定失败');
        return;
      }

      setRecords((current) => current.filter((record) => record.id !== activeRecord.id));
      toast.success(`运单 ${activeRecord.waybill_no ?? '—'} 已绑定到 Shipment`);
      setActiveRecord(null);
      setCandidates([]);
      setSelectedShipmentId('');
      router.refresh();
    } catch {
      setError('绑定失败，请稍后重试');
    } finally {
      setBinding(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link2 className="size-4 text-amber-600" />
          <h2 className="text-lg font-semibold">
            未绑定外部物流记录
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({records.length} 条)
            </span>
          </h2>
        </div>
        <Button variant="outline" size="sm" onClick={() => router.refresh()}>
          <RefreshCw className="size-4" />
          刷新
        </Button>
      </div>

      {records.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border p-4 text-sm text-muted-foreground">
          <PackageSearch className="size-4" />
          暂无未绑定的喜运达物流记录
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">运单号</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">国家</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">仓库</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">同步状态</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">最后同步</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">操作</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id} className="border-b last:border-b-0 hover:bg-muted/30">
                  <td className="px-4 py-2.5 font-mono text-xs">{record.waybill_no ?? '—'}</td>
                  <td className="px-4 py-2.5">{record.country}</td>
                  <td className="px-4 py-2.5">{warehouseName(record.warehouse_id)}</td>
                  <td className="px-4 py-2.5">
                    <Badge variant={record.sync_status === 'error' ? 'destructive' : 'outline'}>
                      {STATUS_LABELS[record.sync_status] ?? record.sync_status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {formatDate(record.last_synced_at)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!record.warehouse_id}
                      onClick={() => void openBindingDialog(record)}
                    >
                      <Link2 className="size-3.5" />
                      绑定 Shipment
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={activeRecord !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>绑定 Shipment</DialogTitle>
            <DialogDescription>
              将喜运达运单{' '}
              <span className="font-mono text-foreground">{activeRecord?.waybill_no ?? '—'}</span>{' '}
              绑定到同国家、同仓库的内部 Shipment。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <p>国家：{activeRecord?.country ?? '—'}</p>
              <p>仓库：{warehouseName(activeRecord?.warehouse_id ?? null)}</p>
            </div>

            {loadingCandidates ? (
              <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                正在查询可绑定 Shipment…
              </div>
            ) : candidates.length === 0 && !error ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                当前国家和仓库暂无可绑定的 Shipment。
                {isAdmin ? ' 请先在“在途管理”中新建匹配的在途记录。' : ' 请联系管理员创建匹配的在途记录。'}
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="golucky-shipment-candidate">
                  选择 Shipment
                </label>
                <Select
                  value={selectedShipmentId}
                  onValueChange={(value) => setSelectedShipmentId(value ?? '')}
                >
                  <SelectTrigger id="golucky-shipment-candidate" className="w-full">
                    <SelectValue placeholder="请选择同仓同国 Shipment" />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>
                        {candidate.shipmentNo} · {SHIPMENT_STATUS_LABELS[candidate.status] ?? candidate.status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedCandidate && (
                  <div className="rounded-md border p-3 text-xs text-muted-foreground">
                    <p>采购单号：{selectedCandidate.purchaseOrderNo ?? '—'}</p>
                    <p>预计到仓：{formatDate(selectedCandidate.estimatedArrival)}</p>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <p>请确认仓库与业务单据一致。P0 暂不支持解绑，绑定后该 Shipment 也不能更换仓库。</p>
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" disabled={binding} onClick={closeDialog}>
              取消
            </Button>
            <Button disabled={!selectedShipmentId || loadingCandidates || binding} onClick={handleBind}>
              {binding && (
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
              )}
              确认绑定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
