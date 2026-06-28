'use server';

// 物流模块 Server Actions
// 运营和管理员都可创建和推进在途记录
import { revalidatePath } from 'next/cache';
import { requireActiveAuth } from '@/lib/auth';
import { shipmentRepository } from './repository';
import { warehouseAccessRepository } from '@/features/warehouse-access/repository';
import { createShipmentSchema, advanceStatusSchema, searchVariantsSchema } from './schema';
import type { ActionResult } from '@/types/common';
import type { CreateShipmentData, VariantSelectorItem } from './types';

export async function createShipment(
  formData: CreateShipmentData,
): Promise<ActionResult<string>> {
  try {
    const user = await requireActiveAuth();

    const parsed = createShipmentSchema.safeParse(formData);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? '表单校验失败' };
    }

    const { country, warehouseId, items } = parsed.data;

    // Operator 权限校验（先于仓库业务校验）
    if (user.roleName === 'operator') {
      if (!warehouseId) {
        return { success: false, error: '请选择仓库' };
      }
      const canAccess = await warehouseAccessRepository.canAccessWarehouse(user.id, warehouseId);
      if (!canAccess) {
        return { success: false, error: '您没有该仓库的操作权限' };
      }
    }

    // 仓库数据一致性校验（warehouseId 非空时 Admin 与 Operator 均需通过）
    if (warehouseId) {
      await shipmentRepository.validateWarehouseForShipment(warehouseId, country);
    }

    // Variant 服务端校验：存在（RLS 可见）、国家一致
    const variantIds = items.map((i) => i.variantId);
    await shipmentRepository.validateVariantsForShipment(variantIds, country);

    const shipmentId = await shipmentRepository.create(parsed.data);

    revalidatePath('/dashboard/shipments');
    return { success: true, data: shipmentId };
  } catch (error) {
    if (error instanceof Error && error.name === 'ShipmentError') {
      return { success: false, error: error.message };
    }
    return { success: false, error: '创建在途记录失败，请稍后重试' };
  }
}

/** P3-S3: 服务端搜索 Variant（按目的国 + 关键词） */
export async function searchVariants(
  country: string,
  search?: string,
): Promise<ActionResult<VariantSelectorItem[]>> {
  try {
    const user = await requireActiveAuth();

    const parsed = searchVariantsSchema.safeParse({ country, search });
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? '搜索参数无效' };
    }

    const results = await shipmentRepository.searchVariants(
      parsed.data.country,
      parsed.data.search,
      user.id,
    );

    return { success: true, data: results };
  } catch (error) {
    if (error instanceof Error && error.name === 'ShipmentError') {
      return { success: false, error: error.message };
    }
    return { success: false, error: '搜索 SKU 失败，请稍后重试' };
  }
}

export async function advanceShipmentStatus(
  shipmentId: string,
  nextStatus: string,
  description?: string,
): Promise<ActionResult> {
  try {
    const user = await requireActiveAuth();

    const parsed = advanceStatusSchema.safeParse({ shipmentId, nextStatus, description });
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? '校验失败' };
    }

    const ok = await shipmentRepository.advanceStatus(
      shipmentId,
      nextStatus,
      user.id,
      description,
    );
    if (!ok) {
      return { success: false, error: '状态推进失败' };
    }

    revalidatePath('/dashboard/shipments');
    revalidatePath(`/dashboard/shipments/${shipmentId}`);
    return { success: true };
  } catch (error) {
    return { success: false, error: '状态推进失败，请稍后重试' };
  }
}
