'use server';

// 物流模块 Server Actions
// 管理员维护在途记录；运营只读查看已分配仓库数据
import { revalidatePath } from 'next/cache';
import { requireActiveAuth } from '@/lib/auth';
import { shipmentRepository } from './repository';
import {
  createShipmentSchema,
  updateShipmentSchema,
  changeStatusSchema,
  advanceStatusSchema,
  searchVariantsSchema,
  shipmentFiltersSchema,
  shipmentDetailParamsSchema,
  inTransitDetailsSchema,
  partialWarehouseShipmentSchema,
  confirmBigsellerAbsorptionSchema,
  batchWarehouseShipmentsSchema,
  eligibleShipmentFiltersSchema,
  // warehouseShipmentSchema — P3-S5B0 移除引用，旧 warehouseShipment action 已改为阻断桩
} from './schema';
import type { ActionResult } from '@/types/common';
import type { PaginatedResult } from '@/types/common';
import type {
  CreateShipmentData,
  UpdateShipmentData,
  VariantSelectorItem,
  ShipmentListItem,
  ShipmentDetail,
  ShipmentListFilters,
  InTransitDetailItem,
  WarehouseShipmentData,
  PartialWarehouseShipmentData,
  PartialWarehouseResult,
  BatchWarehouseData,
  BatchWarehouseItemResult,
  EligibleShipmentFilters,
  EligibleShipmentItem,
} from './types';

export async function createShipment(
  formData: CreateShipmentData,
): Promise<ActionResult<string>> {
  try {
    const user = await requireActiveAuth();

    // P3-S2E: 仅 Admin 可创建在途记录
    if (user.roleName !== 'admin') {
      return { success: false, error: '仅管理员可创建在途记录' };
    }

    const parsed = createShipmentSchema.safeParse(formData);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? '表单校验失败' };
    }

    const { shipmentNo, country, warehouseId, items } = parsed.data;

    // 仓库数据一致性校验（warehouseId 非空时需通过）
    if (warehouseId) {
      await shipmentRepository.validateWarehouseForShipment(warehouseId, country);
    }

    // Variant 服务端校验：存在（RLS 可见）、国家一致
    const variantIds = items.map((i) => i.variantId);
    await shipmentRepository.validateVariantsForShipment(variantIds, country);

    const shipmentId = await shipmentRepository.create({ ...parsed.data, shipmentNo });

    revalidatePath('/dashboard/shipments');
    return { success: true, data: shipmentId };
  } catch (error) {
    if (error instanceof Error && error.name === 'ShipmentError') {
      return { success: false, error: error.message };
    }
    return { success: false, error: '创建在途记录失败，请稍后重试' };
  }
}

/** P3-S2B: 编辑在途基本信息（P3-S2E: 仅 Admin） */
export async function updateShipment(
  formData: UpdateShipmentData,
): Promise<ActionResult> {
  try {
    const user = await requireActiveAuth();

    // P3-S2E: 仅 Admin 可编辑
    if (user.roleName !== 'admin') {
      return { success: false, error: '仅管理员可编辑在途记录' };
    }

    const parsed = updateShipmentSchema.safeParse(formData);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? '表单校验失败' };
    }

    // Warehouse consistency validation
    if (parsed.data.warehouseId) {
      await shipmentRepository.validateWarehouseForShipment(parsed.data.warehouseId, parsed.data.country);
    }

    await shipmentRepository.update(parsed.data, user.id);

    revalidatePath('/dashboard/shipments');
    revalidatePath(`/dashboard/shipments/${parsed.data.id}`);
    return { success: true };
  } catch (error) {
    if (error instanceof Error && error.name === 'ShipmentError') {
      return { success: false, error: error.message };
    }
    return { success: false, error: '更新在途记录失败，请稍后重试' };
  }
}

/** P3-S2B: 手动变更物流状态（P3-S2E: 仅 Admin，禁用 warehoused，不触发库存联动） */
export async function changeShipmentStatus(
  shipmentId: string,
  status: string,
  description?: string,
): Promise<ActionResult> {
  try {
    const user = await requireActiveAuth();

    // P3-S2E: 仅 Admin 可变更状态
    if (user.roleName !== 'admin') {
      return { success: false, error: '仅管理员可变更物流状态' };
    }

    const parsed = changeStatusSchema.safeParse({ shipmentId, status, description });
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? '校验失败' };
    }

    await shipmentRepository.changeStatus(
      parsed.data.shipmentId,
      parsed.data.status,
      user.id,
      parsed.data.description,
    );

    revalidatePath('/dashboard/shipments');
    revalidatePath(`/dashboard/shipments/${shipmentId}`);
    return { success: true };
  } catch (error) {
    if (error instanceof Error && error.name === 'ShipmentError') {
      return { success: false, error: error.message };
    }
    return { success: false, error: '状态变更失败，请稍后重试' };
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

/** P3-S4A: 推进物流状态（旧版兼容路径，建议使用 changeShipmentStatus）
 *  收紧为 Admin-only + 禁止 warehoused + 状态流转规则校验 */
export async function advanceShipmentStatus(
  shipmentId: string,
  nextStatus: string,
  description?: string,
): Promise<ActionResult> {
  try {
    const user = await requireActiveAuth();

    // P3-S4A: 仅 Admin 可推进状态
    if (user.roleName !== 'admin') {
      return { success: false, error: '仅管理员可推进物流状态' };
    }

    const parsed = advanceStatusSchema.safeParse({ shipmentId, nextStatus, description });
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? '校验失败' };
    }

    await shipmentRepository.advanceStatus(
      parsed.data.shipmentId,
      parsed.data.nextStatus,
      user.id,
      parsed.data.description,
    );

    revalidatePath('/dashboard/shipments');
    revalidatePath(`/dashboard/shipments/${shipmentId}`);
    return { success: true };
  } catch (error) {
    if (error instanceof Error && error.name === 'ShipmentError') {
      return { success: false, error: error.message };
    }
    return { success: false, error: '状态推进失败，请稍后重试' };
  }
}

// ─── P3-S2A: 在途列表只读 Server Action ─────────────────────────────────

export async function listShipments(
  filters: ShipmentListFilters = {},
): Promise<ActionResult<PaginatedResult<ShipmentListItem>>> {
  try {
    const user = await requireActiveAuth();

    const parsed = shipmentFiltersSchema.safeParse(filters);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? '筛选参数无效' };
    }

    const result = await shipmentRepository.list(parsed.data, user.id);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof Error && error.name === 'ShipmentError') {
      return { success: false, error: error.message };
    }
    return { success: false, error: '查询在途列表失败，请稍后重试' };
  }
}

// ─── P3-S2A: 在途详情只读 Server Action ─────────────────────────────────

export async function getShipmentDetail(
  id: string,
): Promise<ActionResult<ShipmentDetail>> {
  try {
    const user = await requireActiveAuth();

    const parsed = shipmentDetailParamsSchema.safeParse({ id });
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? '参数无效' };
    }

    const detail = await shipmentRepository.getById(parsed.data.id, user.id);
    if (!detail) {
      return { success: false, error: '在途记录不存在或无权访问' };
    }

    return { success: true, data: detail };
  } catch (error) {
    if (error instanceof Error && error.name === 'ShipmentError') {
      return { success: false, error: error.message };
    }
    return { success: false, error: '查询在途详情失败，请稍后重试' };
  }
}

// ─── P3-S5A: 确认入仓 Server Action ─────────────────────────────────────────

/** P3-S5B0: 旧版入仓入口已封存。
 *  此函数不再调用 repository 或 RPC 00023（warehouse_shipment_transactional）。
 *  inventory.quantity 的唯一事实来源是 BigSeller 同步链路，
 *  DIS 入仓是运营跟踪工具，不等同于库存入账。
 *  请使用 P3-S5B3 新增的确认到仓流程。 */
export async function warehouseShipment(
  _formData: WarehouseShipmentData,
): Promise<ActionResult> {
  // 阻断桩：不调用 requireActiveAuth，不调用 shipmentRepository，不调用任何 RPC
  void _formData;
  return {
    success: false,
    error: '旧版入仓入口已停用。请使用新的确认到仓流程。',
  };
}

// ─── P3-S2E: 海外库存行展开 — 在途明细查询 ────────────────────────────────

/** P3-S2E: 查询某 SKU 在某仓库的内部在途明细（只读，不接 Best）
 *  返回轻量字段：单号、采购单号、在途数量、预计到货时间、shipment_id
 *  Admin 全部可见，Operator 仅已分配仓库 */
export async function getInTransitDetails(
  variantId: string,
  warehouseId: string,
): Promise<ActionResult<InTransitDetailItem[]>> {
  try {
    const user = await requireActiveAuth();

    const parsed = inTransitDetailsSchema.safeParse({ variantId, warehouseId });
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? '参数无效' };
    }

    const details = await shipmentRepository.getInTransitDetailsByVariantAndWarehouse(
      parsed.data.variantId,
      parsed.data.warehouseId,
      user.id,
    );

    return { success: true, data: details };
  } catch (error) {
    if (error instanceof Error && error.name === 'ShipmentError') {
      return { success: false, error: error.message };
    }
    return { success: false, error: '查询在途明细失败，请稍后重试' };
  }
}

// ─── P3-S5B2: 部分确认入仓 Server Action ────────────────────────────────────

/** P3-S5B2: 部分/批量确认入仓
 *  Admin-only + Zod 校验 → repository.partialWarehouse → revalidate
 *  不写 inventory.quantity — inventory 唯一事实来源是 BigSeller */
export async function partialWarehouseShipment(
  data: PartialWarehouseShipmentData,
): Promise<ActionResult<PartialWarehouseResult>> {
  try {
    const user = await requireActiveAuth();

    if (user.roleName !== 'admin') {
      return { success: false, error: '仅管理员可确认入仓' };
    }

    const parsed = partialWarehouseShipmentSchema.safeParse(data);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? '入仓参数校验失败',
      };
    }

    const result = await shipmentRepository.partialWarehouse(
      parsed.data.shipmentId,
      parsed.data.items,
      parsed.data.description,
    );

    revalidatePath('/dashboard/shipments');
    revalidatePath(`/dashboard/shipments/${parsed.data.shipmentId}`);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof Error && error.name === 'ShipmentError') {
      return { success: false, error: error.message };
    }
    return { success: false, error: '确认入仓失败，请稍后重试' };
  }
}

/** P3-S5B4: 查询可批量入仓的 shipment 列表（分页）
 *  Admin-only + Zod → repository.listEligibleForBatchWarehousing */
export async function listEligibleForBatchWarehousingAction(
  filters: EligibleShipmentFilters = {},
): Promise<ActionResult<PaginatedResult<EligibleShipmentItem>>> {
  try {
    const user = await requireActiveAuth();

    if (user.roleName !== 'admin') {
      return { success: false, error: '仅管理员可查看批量入仓列表' };
    }

    const parsed = eligibleShipmentFiltersSchema.safeParse(filters);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? '筛选参数无效' };
    }

    const result = await shipmentRepository.listEligibleForBatchWarehousing(
      parsed.data,
      user.id,
    );
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof Error && error.name === 'ShipmentError') {
      return { success: false, error: error.message };
    }
    return { success: false, error: '查询批量入仓列表失败，请稍后重试' };
  }
}

/** P3-S5B2: 批量确认入仓（多条 shipment 逐笔串行调用 partialWarehouse）
 *  Admin-only + Zod 校验 → 逐笔 RPC → 单笔失败不影响后续 → 返回逐笔结果 */
export async function batchWarehouseShipments(
  data: BatchWarehouseData,
): Promise<ActionResult<BatchWarehouseItemResult[]>> {
  try {
    const user = await requireActiveAuth();

    if (user.roleName !== 'admin') {
      return { success: false, error: '仅管理员可批量确认入仓' };
    }

    const parsed = batchWarehouseShipmentsSchema.safeParse(data);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? '批量入仓参数校验失败',
      };
    }

    const results: BatchWarehouseItemResult[] = [];

    for (const entry of parsed.data.shipments) {
      try {
        const result = await shipmentRepository.partialWarehouse(
          entry.shipmentId,
          entry.items,
          entry.description,
        );
        results.push({
          shipmentId: entry.shipmentId,
          success: true,
          result,
        });
      } catch (error) {
        results.push({
          shipmentId: entry.shipmentId,
          success: false,
          error:
            error instanceof Error && error.name === 'ShipmentError'
              ? error.message
              : '确认入仓失败，请稍后重试',
        });
      }
    }

    revalidatePath('/dashboard/shipments');
    // Revalidate each shipment detail page
    for (const entry of parsed.data.shipments) {
      revalidatePath(`/dashboard/shipments/${entry.shipmentId}`);
    }

    return { success: true, data: results };
  } catch (error) {
    if (error instanceof Error && error.name === 'ShipmentError') {
      return { success: false, error: error.message };
    }
    return { success: false, error: '批量确认入仓失败，请稍后重试' };
  }
}

/** P3-S5B2: 确认 BigSeller 已吸收在途记录
 *  Admin-only + UUID Zod 校验 → repository.confirmBigsellerAbsorption → revalidate */
export async function confirmBigsellerAbsorption(
  shipmentId: string,
): Promise<ActionResult> {
  try {
    const user = await requireActiveAuth();

    if (user.roleName !== 'admin') {
      return { success: false, error: '仅管理员可确认 BigSeller 吸收' };
    }

    const parsed = confirmBigsellerAbsorptionSchema.safeParse({ shipmentId });
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? '参数校验失败',
      };
    }

    await shipmentRepository.confirmBigsellerAbsorption(parsed.data.shipmentId);

    revalidatePath('/dashboard/shipments');
    revalidatePath(`/dashboard/shipments/${parsed.data.shipmentId}`);
    return { success: true };
  } catch (error) {
    if (error instanceof Error && error.name === 'ShipmentError') {
      return { success: false, error: error.message };
    }
    return { success: false, error: '确认 BigSeller 吸收失败，请稍后重试' };
  }
}
