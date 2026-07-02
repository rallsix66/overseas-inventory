'use client';

// P3-S5B4: 批量确认到仓客户端页面
// Admin 可查看 customs+已分配仓库的 shipment 列表，选择并逐条配置入仓数量
// 调 batchWarehouseShipments Server Action（逐笔串行，单笔失败不影响后续）
import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  batchWarehouseShipments,
  getShipmentDetail,
} from '@/features/shipments/actions';
import { listEligibleForBatchWarehousingAction } from '@/features/shipments/actions';
import { Loader2Icon, PackageCheckIcon, ChevronDown, ChevronRight, ArrowLeft, Ship } from 'lucide-react';
import type {
  EligibleShipmentItem,
  ShipmentItemDetail,
  BatchWarehouseItemResult,
} from '@/features/shipments/types';
import type { PaginatedResult } from '@/types/common';

interface Props {
  initialData: PaginatedResult<EligibleShipmentItem>;
}

export function BatchWarehousePage({ initialData }: Props) {
  const router = useRouter();

  // 列表数据
  const [data, setData] = useState<EligibleShipmentItem[]>(initialData.data);
  const [total, setTotal] = useState(initialData.total);
  const [page, setPage] = useState(initialData.page);
  const [pageSize] = useState(initialData.pageSize);
  const [loading, setLoading] = useState(false);

  // 选中状态
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // 展开状态（一次展开一个 shipment）
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // 展开 shipment 的 items 缓存
  const [itemsCache, setItemsCache] = useState<Record<string, ShipmentItemDetail[]>>({});
  const [itemsLoading, setItemsLoading] = useState(false);
  // 每个 shipment 的 item 数量输入（key: `${shipmentId}:${itemId}`）
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  // 字段错误（同上 key）
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // 提交状态
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<BatchWarehouseItemResult[] | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // ─── 分页加载 ────────────────────────────────────────────────────────────
  const loadPage = useCallback(
    async (targetPage: number) => {
      setLoading(true);
      setGlobalError(null);
      try {
        const res = await listEligibleForBatchWarehousingAction({
          page: targetPage,
          pageSize,
        });
        if (res.success && res.data) {
          setData(res.data.data);
          setTotal(res.data.total);
          setPage(res.data.page);
        } else {
          setGlobalError(res.error ?? '加载失败');
        }
      } catch {
        setGlobalError('加载失败，请稍后重试');
      } finally {
        setLoading(false);
      }
    },
    [pageSize],
  );

  // ─── 选择与展开 ──────────────────────────────────────────────────────────
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === data.length && data.length > 0) {
        return new Set();
      }
      return new Set(data.map((s) => s.id));
    });
  }, [data]);

  const toggleExpand = useCallback(
    async (shipment: EligibleShipmentItem) => {
      if (expandedId === shipment.id) {
        setExpandedId(null);
        return;
      }
      setExpandedId(shipment.id);
      // 清除该 shipment 的错误
      setFieldErrors((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (key.startsWith(`${shipment.id}:`)) delete next[key];
        }
        return next;
      });

      // 如果已有缓存则跳过请求
      if (itemsCache[shipment.id]) return;

      setItemsLoading(true);
      try {
        const res = await getShipmentDetail(shipment.id);
        if (res.success && res.data) {
          setItemsCache((prev) => ({ ...prev, [shipment.id]: res.data!.items }));
        } else {
          toast.error(res.error ?? '加载产品明细失败');
        }
      } catch {
        toast.error('加载产品明细失败，请稍后重试');
      } finally {
        setItemsLoading(false);
      }
    },
    [expandedId, itemsCache],
  );

  // ─── 数量输入 ────────────────────────────────────────────────────────────
  const handleQuantityChange = useCallback(
    (shipmentId: string, itemId: string, value: string) => {
      const key = `${shipmentId}:${itemId}`;
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setQuantities((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  /** 一键全额：将展开 shipment 的所有 item 在途余量填入 */
  const fillAllRemaining = useCallback(
    (shipmentId: string) => {
      const items = itemsCache[shipmentId];
      if (!items) return;
      const filled: Record<string, string> = {};
      for (const item of items) {
        const remaining = Math.max(0, item.quantity - item.warehousedQuantity);
        if (remaining > 0) {
          filled[`${shipmentId}:${item.id}`] = String(remaining);
        }
      }
      setQuantities((prev) => ({ ...prev, ...filled }));
      setFieldErrors((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (key.startsWith(`${shipmentId}:`)) delete next[key];
        }
        return next;
      });
      setGlobalError(null);
    },
    [itemsCache],
  );

  // ─── 校验辅助 ────────────────────────────────────────────────────────────
  function validateEntry(
    raw: string,
    sku: string,
    remaining: number,
  ): { ok: true; value: number } | { ok: false; error: string } {
    const trimmed = raw.trim();
    if (trimmed === '') return { ok: false, error: '' };

    const num = Number(trimmed);
    if (isNaN(num)) return { ok: false, error: `SKU「${sku}」请输入有效整数` };
    if (!/^\d+$/.test(trimmed)) return { ok: false, error: `SKU「${sku}」数量必须为整数，不支持小数` };
    if (num < 0) return { ok: false, error: `SKU「${sku}」数量不能为负数` };
    if (num === 0) return { ok: false, error: `SKU「${sku}」数量必须大于 0` };
    if (num > remaining) return { ok: false, error: `SKU「${sku}」入仓数量 (${num}) 超过在途余量 (${remaining})` };
    return { ok: true, value: num };
  }

  // ─── 提交 ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setGlobalError(null);
    setResults(null);
    setFieldErrors({});

    // 收集每个 shipment 的 items
    const shipments: { shipmentId: string; items: { variantId: string; quantity: number }[] }[] = [];
    const newFieldErrors: Record<string, string> = {};

    for (const shipmentId of selectedIds) {
      const items = itemsCache[shipmentId];
      if (!items) continue;

      const entryItems: { variantId: string; quantity: number }[] = [];
      for (const item of items) {
        const key = `${shipmentId}:${item.id}`;
        const raw = quantities[key];
        if (!raw || raw.trim() === '') continue;

        const remaining = Math.max(0, item.quantity - item.warehousedQuantity);
        const result = validateEntry(raw, item.sku, remaining);
        if (!result.ok) {
          if (result.error) newFieldErrors[key] = result.error;
          continue;
        }
        entryItems.push({ variantId: item.variantId, quantity: result.value });
      }

      if (entryItems.length > 0) {
        shipments.push({ shipmentId, items: entryItems });
      }
    }

    if (Object.keys(newFieldErrors).length > 0) {
      setFieldErrors(newFieldErrors);
      setGlobalError('请修正以下错误后再提交');
      return;
    }

    if (shipments.length === 0) {
      setGlobalError('请至少为一个在途记录配置入仓数量');
      return;
    }

    setSubmitting(true);
    try {
      const res = await batchWarehouseShipments({ shipments });
      if (res.success && res.data) {
        setResults(res.data);
        const successCount = res.data.filter((r) => r.success).length;
        const failCount = res.data.length - successCount;
        if (failCount === 0) {
          toast.success(`批量入仓完成：${successCount} 条全部成功`);
        } else {
          toast.warning(`批量入仓完成：${successCount} 条成功，${failCount} 条失败`);
        }
        // 清除已成功的 shipment 数据
        const successIds = new Set(res.data.filter((r) => r.success).map((r) => r.shipmentId));
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const id of successIds) next.delete(id);
          return next;
        });
        // 清除已成功 shipment 的缓存和输入
        setItemsCache((prev) => {
          const next = { ...prev };
          for (const id of successIds) delete next[id];
          return next;
        });
        setQuantities((prev) => {
          const next = { ...prev };
          for (const key of Object.keys(next)) {
            for (const id of successIds) {
              if (key.startsWith(`${id}:`)) delete next[key];
            }
          }
          return next;
        });
        // 刷新列表
        loadPage(page);
      } else {
        setGlobalError(res.error ?? '批量入仓失败');
      }
    } catch {
      setGlobalError('批量入仓失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── 是否有已配置数量的 shipment ─────────────────────────────────────────
  const hasConfiguredShipments = (() => {
    for (const shipmentId of selectedIds) {
      const items = itemsCache[shipmentId];
      if (!items) continue;
      for (const item of items) {
        const raw = quantities[`${shipmentId}:${item.id}`];
        if (raw && raw.trim() !== '' && Number(raw) > 0) return true;
      }
    }
    return false;
  })();

  // ─── 渲染 ────────────────────────────────────────────────────────────────
  return (
    <div className="px-4 sm:px-6 py-4 sm:py-6">
      {/* 页头 */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push('/dashboard/shipments')}
            >
              <ArrowLeft className="size-4 mr-1" />
              返回在途管理
            </Button>
          </div>
          <h1 className="text-lg font-semibold text-gray-900 mt-2">批量确认到仓</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            选择多条在途记录，逐条配置入仓数量后批量提交确认
          </p>
        </div>
      </div>

      {/* 全局错误 */}
      {globalError && (
        <div className="mb-4 p-3 rounded-md bg-red-50 text-sm text-red-700">
          {globalError}
        </div>
      )}

      {/* 结果汇总 */}
      {results && results.length > 0 && (
        <div className="mb-4 p-3 rounded-md border bg-card">
          <h3 className="text-sm font-medium mb-2">提交结果</h3>
          <div className="space-y-1">
            {results.map((r) => {
              const ship = data.find((s) => s.id === r.shipmentId);
              return (
                <div
                  key={r.shipmentId}
                  className={`text-xs flex items-center gap-2 ${
                    r.success ? 'text-green-700' : 'text-red-700'
                  }`}
                >
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      r.success ? 'bg-green-500' : 'bg-red-500'
                    }`}
                  />
                  {ship?.shipmentNo ?? r.shipmentId.slice(0, 8)}
                  ：{r.success ? '入仓成功' : r.error ?? '失败'}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 空数据 */}
      {!loading && data.length === 0 && (
        <div className="text-center py-16">
          <Ship className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">暂无待入仓的在途记录</p>
          <p className="text-xs text-muted-foreground mt-1">
            只有状态为&ldquo;清关&rdquo;且已分配仓库的在途记录才会出现在此列表
          </p>
        </div>
      )}

      {/* 表格 */}
      {data.length > 0 && (
        <>
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-3 py-2 w-[36px]">
                    <input
                      type="checkbox"
                      checked={data.length > 0 && selectedIds.size === data.length}
                      onChange={toggleSelectAll}
                      aria-label="全选"
                      className="size-4 rounded border-gray-300 cursor-pointer"
                    />
                  </th>
                  <th className="px-3 py-2 w-[28px]" />
                  <th className="px-3 py-2 text-left font-medium text-gray-600 text-xs">单号</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 text-xs">仓库</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 text-xs">国家</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600 text-xs">总数</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600 text-xs">在途余量</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 text-xs">品名</th>
                </tr>
              </thead>
              <tbody>
                {data.map((shipment) => {
                  const isExpanded = expandedId === shipment.id;
                  return (
                    <tr key={shipment.id} className="border-b last:border-b-0">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(shipment.id)}
                          onChange={() => toggleSelect(shipment.id)}
                          aria-label={`选择 ${shipment.shipmentNo}`}
                          className="size-4 rounded border-gray-300 cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => toggleExpand(shipment)}
                          className="inline-flex items-center"
                          disabled={itemsLoading}
                        >
                          {itemsLoading && isExpanded ? (
                            <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />
                          ) : isExpanded ? (
                            <ChevronDown className="size-3.5 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="size-3.5 text-muted-foreground" />
                          )}
                        </button>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {shipment.shipmentNo}
                        {shipment.purchaseOrderNo && (
                          <div className="text-muted-foreground text-[10px]">
                            PO: {shipment.purchaseOrderNo}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">{shipment.warehouseName ?? '—'}</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-700">
                          {shipment.country}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-xs">
                        {shipment.totalQuantity.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-xs">
                        <span className={shipment.remainingQuantity > 0 ? 'text-blue-600 font-medium' : 'text-green-600'}>
                          {shipment.remainingQuantity.toLocaleString()}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs max-w-[200px] truncate">
                        {shipment.productNames ?? '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 展开行：items 明细（渲染在表格外部，关联到展开的 shipment） */}
          {expandedId && itemsCache[expandedId] && (() => {
            const items = itemsCache[expandedId];
            const shipment = data.find((s) => s.id === expandedId);
            if (!shipment || !items) return null;
            return (
              <div className="mt-3 border rounded-md p-4 bg-gray-50/50">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-medium">
                    {shipment.shipmentNo} — 产品明细
                    <span className="text-xs text-muted-foreground ml-2">
                      共 {items.length} 项，在途余量 {shipment.remainingQuantity.toLocaleString()}
                    </span>
                  </h4>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fillAllRemaining(expandedId)}
                    disabled={submitting || shipment.remainingQuantity === 0}
                  >
                    <PackageCheckIcon className="size-3.5 mr-1" />
                    全额确认
                  </Button>
                </div>
                <div className="overflow-x-auto border rounded-md bg-white">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-600 text-xs">SKU</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600 text-xs">产品名称</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600 text-xs">总数</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600 text-xs">已入仓</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600 text-xs">在途余量</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600 text-xs w-28">本次入仓</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const remaining = Math.max(0, item.quantity - item.warehousedQuantity);
                        const key = `${expandedId}:${item.id}`;
                        const currentRaw = quantities[key] ?? '';
                        const fieldError = fieldErrors[key];
                        return (
                          <tr key={item.id} className="border-b last:border-b-0">
                            <td className="px-3 py-2 font-mono text-xs">{item.sku}</td>
                            <td className="px-3 py-2 max-w-[180px] truncate text-xs">
                              {item.productName ?? (
                                <span className="text-muted-foreground">未匹配</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-xs">
                              {item.quantity.toLocaleString()}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
                              {item.warehousedQuantity.toLocaleString()}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-xs">
                              <span className={remaining > 0 ? 'text-blue-600 font-medium' : 'text-green-600'}>
                                {remaining.toLocaleString()}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="flex flex-col items-end">
                                <Input
                                  type="number"
                                  min={0}
                                  max={remaining}
                                  value={currentRaw}
                                  onChange={(e) =>
                                    handleQuantityChange(expandedId, item.id, e.target.value)
                                  }
                                  placeholder="0"
                                  disabled={submitting || remaining === 0}
                                  className={`h-8 w-24 text-right text-sm ml-auto ${fieldError ? 'border-destructive' : ''}`}
                                />
                                {fieldError && (
                                  <span className="text-xs text-destructive mt-1 text-right whitespace-nowrap">
                                    {fieldError}
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

          {itemsLoading && !itemsCache[expandedId ?? ''] && (
            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin mr-2" />
              加载产品明细…
            </div>
          )}

          {/* 操作栏 */}
          <div className="flex items-center justify-between mt-5">
            <div className="flex items-center gap-3">
              <Button
                onClick={handleSubmit}
                disabled={submitting || !hasConfiguredShipments}
                size="sm"
                aria-label="批量提交入仓"
              >
                {submitting ? (
                  <>
                    <Loader2Icon className="size-3.5 animate-spin mr-1" />
                    提交中…
                  </>
                ) : (
                  <>
                    <PackageCheckIcon className="size-3.5 mr-1" />
                    批量提交入仓
                  </>
                )}
              </Button>
              <span className="text-xs text-muted-foreground">
                已选 {selectedIds.size} 条记录
              </span>
            </div>

            {/* 分页 */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                共 {total} 条，第 {page} / {totalPages} 页
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || loading}
                onClick={() => loadPage(page - 1)}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages || loading}
                onClick={() => loadPage(page + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
