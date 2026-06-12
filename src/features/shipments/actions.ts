'use server';

// 物流模块 Server Actions
// 运营和管理员都可创建和推进在途记录
import { revalidatePath } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import { shipmentRepository } from './repository';
import { createShipmentSchema, advanceStatusSchema } from './schema';
import type { ActionResult } from '@/types/common';
import type { CreateShipmentData } from './types';

export async function createShipment(
  formData: CreateShipmentData
): Promise<ActionResult<string>> {
  try {
    await requireAuth();

    const parsed = createShipmentSchema.safeParse(formData);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? '表单校验失败' };
    }

    const shipmentId = await shipmentRepository.create(parsed.data);
    if (!shipmentId) {
      return { success: false, error: '创建在途记录失败' };
    }

    revalidatePath('/dashboard/shipments');
    return { success: true, data: shipmentId };
  } catch (error) {
    return { success: false, error: '创建在途记录失败，请稍后重试' };
  }
}

export async function advanceShipmentStatus(
  shipmentId: string,
  nextStatus: string,
  description?: string
): Promise<ActionResult> {
  try {
    const user = await requireAuth();

    const parsed = advanceStatusSchema.safeParse({ shipmentId, nextStatus, description });
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? '校验失败' };
    }

    const ok = await shipmentRepository.advanceStatus(
      shipmentId,
      nextStatus,
      user.id,
      description
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
