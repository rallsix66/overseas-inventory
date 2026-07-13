'use client';

// P0: 喜运达同步失败记录列表
//
// 显示 sync_status = 'error' 的记录，含失败原因和重试按钮。
// 重试调用 reactivateExternalRef（status → active），由下次 Cron 同步。
// 不直接写数据库，不绕过 Repository/Server Action/RLS。

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, AlertCircle, Clock } from 'lucide-react';
import { reactivateExternalRef } from '@/features/in-transit/actions';

interface FailedRecord {
  id: string;
  waybill_no: string | null;
  sync_status: string;
  last_synced_at: string | null;
  raw_payload: Record<string, unknown> | null;
  provider: string;
  country: string | null;
  warehouse_id: string | null;
}

interface RetryState {
  [refId: string]: { loading: boolean; error?: string; done?: boolean };
}

function extractError(rawPayload: Record<string, unknown> | null): string {
  if (!rawPayload || typeof rawPayload !== 'object') return '未知错误（无详情）';
  const msg = (rawPayload as Record<string, unknown>)._sync_error;
  return typeof msg === 'string' && msg.length > 0 ? msg : '未知错误（无详情）';
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

interface Props {
  records: FailedRecord[];
}

export function GoluckyFailedRecords({ records: initialRecords }: Props) {
  const router = useRouter();
  const [records, setRecords] = useState<FailedRecord[]>(initialRecords);
  const [retryState, setRetryState] = useState<RetryState>({});

  const handleRetry = useCallback(async (refId: string) => {
    setRetryState((prev) => ({ ...prev, [refId]: { loading: true } }));

    try {
      const result = await reactivateExternalRef(refId);
      if (result.success) {
        setRetryState((prev) => ({ ...prev, [refId]: { loading: false, done: true } }));
        // 从列表中移除已重激活的记录
        setRecords((prev) => prev.filter((r) => r.id !== refId));
      } else {
        setRetryState((prev) => ({
          ...prev,
          [refId]: { loading: false, error: result.error ?? '重激活失败' },
        }));
      }
    } catch {
      setRetryState((prev) => ({
        ...prev,
        [refId]: { loading: false, error: '网络错误，请重试' },
      }));
    }
  }, []);

  const handleRefresh = useCallback(() => {
    router.refresh();
  }, [router]);

  if (records.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-4 border rounded-md">
        <Clock className="w-4 h-4" />
        暂无同步失败的记录
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-500" />
          <h2 className="text-lg font-semibold">
            同步失败记录
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({records.length} 条)
            </span>
          </h2>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh}>
          <RefreshCw className="w-4 h-4 mr-1" />
          刷新
        </Button>
      </div>

      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground w-[200px]">
                运单号
              </th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground w-[80px]">
                状态
              </th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground w-[160px]">
                最后同步
              </th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                失败原因
              </th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground w-[100px]">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => {
              const state = retryState[record.id];
              const errorMsg = extractError(record.raw_payload);

              return (
                <tr key={record.id} className="border-b last:border-b-0 hover:bg-muted/30">
                  <td className="px-4 py-2.5 font-mono text-xs">
                    {record.waybill_no || '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant="destructive" className="text-xs">
                      同步失败
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">
                    {formatTime(record.last_synced_at)}
                  </td>
                  <td className="px-4 py-2.5 text-red-700 text-xs max-w-[400px] truncate" title={errorMsg}>
                    {errorMsg}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {state?.done ? (
                      <span className="text-xs text-green-600">已重激活</span>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={state?.loading}
                        onClick={() => handleRetry(record.id)}
                      >
                        {state?.loading ? (
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3 h-3 mr-1" />
                        )}
                        重试
                      </Button>
                    )}
                    {state?.error && (
                      <p className="text-xs text-red-500 mt-1">{state.error}</p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
