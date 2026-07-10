'use client';

// 产品表单 Sheet 组件 — 支持新增和编辑
// 编辑模式下展示 SKU 绑定明细（只读），产品基础字段均可编辑（含产品编码）
import { useState } from 'react';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createProduct, updateProduct } from '../actions';
import { productFormSchema } from '../schema';
import type { ProductItem, ProductVariantBindingBrief } from '../types';

const MATCH_STATUS_LABEL: Record<string, string> = {
  matched: '已匹配',
  unmatched: '未匹配',
  pending: '待确认',
};

const MATCH_STATUS_CLASS: Record<string, string> = {
  matched: 'bg-green-50 text-green-700',
  unmatched: 'bg-gray-100 text-gray-600',
  pending: 'bg-yellow-50 text-yellow-700',
};

const OVERSEAS_COUNTRIES = ['TH', 'ID', 'MY', 'PH', 'VN'] as const;

const COUNTRY_LABEL: Record<string, string> = {
  TH: '泰国',
  ID: '印尼',
  MY: '马来西亚',
  PH: '菲律宾',
  VN: '越南',
};

interface ProductFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'add' | 'edit';
  defaultValues?: ProductItem;
  /** SKU 绑定明细（编辑模式下展示，只读） */
  variants?: ProductVariantBindingBrief[];
}

export function ProductForm({
  open,
  onOpenChange,
  mode,
  defaultValues,
  variants,
}: ProductFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // 按国内/海外分组
  const domesticVariants = (variants ?? []).filter((v) => v.country === 'CN');
  const overseasByCountry: Record<string, ProductVariantBindingBrief[]> = {};
  for (const c of OVERSEAS_COUNTRIES) {
    overseasByCountry[c] = [];
  }
  for (const v of variants ?? []) {
    if (v.country !== 'CN' && overseasByCountry[v.country]) {
      overseasByCountry[v.country].push(v);
    }
  }
  const allOverseas = OVERSEAS_COUNTRIES.flatMap((c) =>
    (overseasByCountry[c] ?? []).map((v) => ({ ...v, _country: c }))
  );
  const overseasTotal = allOverseas.length;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setErrors({});

    const form = e.currentTarget;
    const formData = new FormData(form);

    const data = {
      code: ((formData.get('code') as string) ?? '').trim(),
      name: ((formData.get('name') as string) ?? '').trim(),
      safetyStock: Number(formData.get('safetyStock')),
      category: ((formData.get('category') as string) ?? '').trim() || undefined,
      unit: ((formData.get('unit') as string) ?? '').trim() || '件',
    };

    const parsed = productFormSchema.safeParse(data);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? '');
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      setSubmitting(false);
      return;
    }

    const result =
      mode === 'add'
        ? await createProduct(data)
        : await updateProduct(defaultValues!.id, data);

    setSubmitting(false);

    if (result.success) {
      toast.success(mode === 'add' ? '产品已创建' : '产品已更新');
      onOpenChange(false);
    } else {
      toast.error(result.error ?? '操作失败');
    }
  }

  function formatTime(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="!max-w-[760px] !w-[760px] max-[820px]:!w-[calc(100vw-24px)] overflow-hidden p-0 flex flex-col gap-0"
      >
        {/* ── Header ── */}
        <div className="shrink-0 px-5 py-4 border-b">
          <SheetHeader className="text-left p-0 gap-0.5">
            <SheetTitle>
              {mode === 'add' ? '新增产品' : '编辑产品'}
            </SheetTitle>
            <SheetDescription>
              {mode === 'add'
                ? '创建一个新的标准产品'
                : '修改标准产品信息，SKU 绑定仅展示'}
            </SheetDescription>
          </SheetHeader>
        </div>

        {/* ── Body (scrollable) ── */}
        <form
          id="product-form"
          onSubmit={handleSubmit}
          className="flex flex-col flex-1 min-h-0"
        >
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <div className="flex flex-col gap-4">
              {/* 基础信息 */}
              <div>
                <h3 className="text-sm font-medium text-gray-900 mb-3">
                  基础信息
                </h3>
                <div className="flex flex-col gap-3">
                  {/* 产品编码 */}
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="code">
                      产品编码 <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="code"
                      name="code"
                      defaultValue={defaultValues?.code ?? ''}
                      maxLength={50}
                      placeholder="如 PRD-001"
                      aria-invalid={!!errors.code}
                    />
                    {errors.code && (
                      <p className="text-xs text-destructive">{errors.code}</p>
                    )}
                  </div>

                  {/* 产品名称 */}
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="name">
                      产品名称 <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="name"
                      name="name"
                      defaultValue={defaultValues?.name ?? ''}
                      maxLength={200}
                      placeholder="如 蓝牙耳机 Pro"
                      aria-invalid={!!errors.name}
                    />
                    {errors.name && (
                      <p className="text-xs text-destructive">{errors.name}</p>
                    )}
                  </div>

                  {/* 安全库存 + 单位 */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="safetyStock">
                        安全库存 <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="safetyStock"
                        name="safetyStock"
                        type="number"
                        min={0}
                        step={1}
                        defaultValue={defaultValues?.safety_stock ?? 0}
                        aria-invalid={!!errors.safetyStock}
                      />
                      {errors.safetyStock && (
                        <p className="text-xs text-destructive">
                          {errors.safetyStock}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="unit">
                        单位 <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="unit"
                        name="unit"
                        defaultValue={defaultValues?.unit ?? '件'}
                        maxLength={20}
                        placeholder="件"
                        aria-invalid={!!errors.unit}
                      />
                      {errors.unit && (
                        <p className="text-xs text-destructive">{errors.unit}</p>
                      )}
                    </div>
                  </div>

                  {/* 分类 */}
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="category">分类</Label>
                    <Input
                      id="category"
                      name="category"
                      defaultValue={defaultValues?.category ?? ''}
                      maxLength={100}
                      placeholder="如 电子产品"
                      aria-invalid={!!errors.category}
                    />
                    {errors.category && (
                      <p className="text-xs text-destructive">
                        {errors.category}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* SKU 绑定展示区（仅编辑模式） */}
              {mode === 'edit' && (
                <div className="border rounded-lg border-gray-200 overflow-hidden">
                  {/* 区块标题 + 摘要 */}
                  <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="text-sm font-medium text-gray-900">
                      SKU 绑定
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      国内 {domesticVariants.length} · 海外 {overseasTotal}
                    </span>
                  </div>

                  <div className="px-4 py-3 space-y-3">
                    {/* 国内 SKU */}
                    <div>
                      <h4 className="text-xs font-medium text-gray-600 mb-1.5">
                        国内 SKU
                      </h4>
                      {domesticVariants.length === 0 ? (
                        <div className="flex items-center gap-2 py-1.5">
                          <span className="text-xs text-muted-foreground">
                            暂无国内 SKU 绑定 / 国内库存待接入
                          </span>
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                            待接入
                          </span>
                        </div>
                      ) : (
                        <div className="overflow-x-auto border rounded border-gray-100">
                          <table className="w-full text-xs table-fixed">
                            <thead>
                              <tr className="bg-gray-50 border-b border-gray-100">
                                <th className="text-left px-2 py-1.5 font-medium text-gray-600 w-[150px] whitespace-nowrap">
                                  SKU
                                </th>
                                <th className="text-left px-2 py-1.5 font-medium text-gray-600">
                                  仓库产品名
                                </th>
                                <th className="text-left px-2 py-1.5 font-medium text-gray-600 w-[86px] whitespace-nowrap">
                                  匹配状态
                                </th>
                                <th className="text-left px-2 py-1.5 font-medium text-gray-600 w-[96px] whitespace-nowrap">
                                  最后同步
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {domesticVariants.map((v, i) => (
                                <tr
                                  key={v.id}
                                  className={
                                    i > 0 ? 'border-t border-gray-100' : ''
                                  }
                                >
                                  <td className="px-2 py-1.5 font-mono text-xs whitespace-nowrap">
                                    {v.sku}
                                  </td>
                                  <td
                                    className="px-2 py-1.5 text-gray-600 truncate max-w-0"
                                    title={v.name}
                                  >
                                    {v.name}
                                  </td>
                                  <td className="px-2 py-1.5 whitespace-nowrap">
                                    <span
                                      className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                                        MATCH_STATUS_CLASS[v.matchStatus] ??
                                        'bg-gray-100 text-gray-600'
                                      }`}
                                    >
                                      {MATCH_STATUS_LABEL[v.matchStatus] ??
                                        v.matchStatus}
                                    </span>
                                  </td>
                                  <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">
                                    {formatTime(v.lastSyncAt)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* 海外仓 SKU — 统一表格 */}
                    <div>
                      <h4 className="text-xs font-medium text-gray-600 mb-1.5">
                        海外仓 SKU
                      </h4>
                      {allOverseas.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-1.5">
                          暂无海外仓 SKU 绑定
                        </p>
                      ) : (
                        <div className="overflow-x-auto border rounded border-gray-100">
                          <table className="w-full text-xs table-fixed">
                            <thead>
                              <tr className="bg-gray-50 border-b border-gray-100">
                                <th className="text-left px-2 py-1.5 font-medium text-gray-600 w-[96px] whitespace-nowrap">
                                  国家
                                </th>
                                <th className="text-left px-2 py-1.5 font-medium text-gray-600 w-[150px] whitespace-nowrap">
                                  SKU
                                </th>
                                <th className="text-left px-2 py-1.5 font-medium text-gray-600">
                                  仓库产品名
                                </th>
                                <th className="text-left px-2 py-1.5 font-medium text-gray-600 w-[86px] whitespace-nowrap">
                                  匹配状态
                                </th>
                                <th className="text-left px-2 py-1.5 font-medium text-gray-600 w-[96px] whitespace-nowrap">
                                  最后同步
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {allOverseas.map((v, i) => (
                                <tr
                                  key={v.id}
                                  className={
                                    i > 0 ? 'border-t border-gray-100' : ''
                                  }
                                >
                                  <td className="px-2 py-1.5 whitespace-nowrap">
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                                      {COUNTRY_LABEL[v._country] ??
                                        v._country}
                                    </span>
                                  </td>
                                  <td className="px-2 py-1.5 font-mono text-xs whitespace-nowrap">
                                    {v.sku}
                                  </td>
                                  <td
                                    className="px-2 py-1.5 text-gray-600 truncate max-w-0"
                                    title={v.name}
                                  >
                                    {v.name}
                                  </td>
                                  <td className="px-2 py-1.5 whitespace-nowrap">
                                    <span
                                      className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                                        MATCH_STATUS_CLASS[v.matchStatus] ??
                                        'bg-gray-100 text-gray-600'
                                      }`}
                                    >
                                      {MATCH_STATUS_LABEL[v.matchStatus] ??
                                        v.matchStatus}
                                    </span>
                                  </td>
                                  <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">
                                    {formatTime(v.lastSyncAt)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Footer (fixed bottom) ── */}
          <div className="shrink-0 border-t bg-popover px-5 py-3 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              取消
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? '保存中...' : '保存'}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
