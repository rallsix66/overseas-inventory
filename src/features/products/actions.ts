'use server';

// 产品模块 Server Actions
// 所有产品写操作均需 admin 权限
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { productRepository, ProductError } from './repository';
import { productFormSchema } from './schema';
import type { ActionResult } from '@/types/common';
import type { ProductFormData, ProductItem } from './types';

export async function createProduct(
  formData: ProductFormData
): Promise<ActionResult<ProductItem>> {
  try {
    await requireAdmin();

    const parsed = productFormSchema.safeParse(formData);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? '表单校验失败' };
    }

    // 重复编码预检查（改善体验）
    // getByCode 仅在成功返回 null 时表示编码未占用；DB_ERROR 或查到记录均停止
    const existing = await productRepository.getByCode(parsed.data.code);
    if (existing) {
      return { success: false, error: '产品编码已存在' };
    }

    const product = await productRepository.create({
      code: parsed.data.code,
      name: parsed.data.name,
      safety_stock: parsed.data.safetyStock,
      category: parsed.data.category || null,
      unit: parsed.data.unit,
    });

    revalidatePath('/dashboard/products');
    return { success: true, data: product };
  } catch (error) {
    if (error instanceof ProductError) {
      return { success: false, error: error.message };
    }
    if (error instanceof Error && error.message === '无权限：需要管理员角色') {
      return { success: false, error: '无权限：需要管理员角色' };
    }
    return { success: false, error: '创建产品失败，请稍后重试' };
  }
}

export async function updateProduct(
  id: string,
  formData: ProductFormData
): Promise<ActionResult<ProductItem>> {
  try {
    await requireAdmin();

    const parsed = productFormSchema.safeParse(formData);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? '表单校验失败' };
    }

    const product = await productRepository.update(id, {
      name: parsed.data.name,
      safety_stock: parsed.data.safetyStock,
      category: parsed.data.category || null,
      unit: parsed.data.unit,
    });

    if (!product) {
      return { success: false, error: '产品不存在' };
    }

    revalidatePath('/dashboard/products');
    revalidatePath(`/dashboard/products/${id}`);
    return { success: true, data: product };
  } catch (error) {
    if (error instanceof ProductError) {
      return { success: false, error: error.message };
    }
    if (error instanceof Error && error.message === '无权限：需要管理员角色') {
      return { success: false, error: '无权限：需要管理员角色' };
    }
    return { success: false, error: '更新产品失败，请稍后重试' };
  }
}

export async function toggleProductActive(
  id: string,
  isActive: boolean
): Promise<ActionResult> {
  try {
    await requireAdmin();

    const ok = await productRepository.toggleActive(id, isActive);
    if (!ok) {
      return { success: false, error: '产品不存在' };
    }

    revalidatePath('/dashboard/products');
    return { success: true };
  } catch (error) {
    if (error instanceof ProductError) {
      return { success: false, error: error.message };
    }
    if (error instanceof Error && error.message === '无权限：需要管理员角色') {
      return { success: false, error: '无权限：需要管理员角色' };
    }
    return { success: false, error: '操作失败，请稍后重试' };
  }
}
