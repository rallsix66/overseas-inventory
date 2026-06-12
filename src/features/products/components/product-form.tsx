'use client';

// 产品表单 Sheet 组件 — 支持新增和编辑
// 编辑模式下产品编码字段禁用（code 创建后不可修改）
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
import type { ProductItem } from '../types';

interface ProductFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'add' | 'edit';
  defaultValues?: ProductItem;
}

export function ProductForm({ open, onOpenChange, mode, defaultValues }: ProductFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setErrors({});

    const form = e.currentTarget;
    const formData = new FormData(form);

    const data = {
      code:
        mode === 'edit'
          ? (defaultValues?.code ?? '')
          : ((formData.get('code') as string) ?? ''),
      name: (formData.get('name') as string) ?? '',
      safetyStock: Number(formData.get('safetyStock')),
      category: (formData.get('category') as string) || undefined,
      unit: (formData.get('unit') as string) || '件',
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[480px] sm:max-w-[480px]">
        <SheetHeader>
          <SheetTitle>{mode === 'add' ? '新增产品' : '编辑产品'}</SheetTitle>
          <SheetDescription>
            {mode === 'add'
              ? '创建一个新的标准产品'
              : '修改产品基本信息，编码创建后不可修改'}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-4">
          {/* 产品编码 */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="code">
              产品编码 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="code"
              name="code"
              defaultValue={defaultValues?.code ?? ''}
              disabled={mode === 'edit'}
              maxLength={50}
              placeholder="如 PRD-001"
              aria-invalid={!!errors.code}
            />
            {errors.code ? (
              <p className="text-xs text-destructive">{errors.code}</p>
            ) : mode === 'edit' ? (
              <p className="text-xs text-muted-foreground">产品编码创建后不可修改</p>
            ) : null}
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
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
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
                <p className="text-xs text-destructive">{errors.safetyStock}</p>
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
              {errors.unit && <p className="text-xs text-destructive">{errors.unit}</p>}
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
              <p className="text-xs text-destructive">{errors.category}</p>
            )}
          </div>

          {/* 操作按钮 */}
          <div className="flex justify-end gap-2 pt-4 border-t">
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
