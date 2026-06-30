// 物流模块 Zod 校验 schema
import { z } from 'zod';

const YMD_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function isValidDate(ymd: string): boolean {
  if (!YMD_RE.test(ymd)) return false;
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 新建在途主单 */
export const createShipmentSchema = z.object({
  shipmentNo: z
    .string()
    .min(1, '单号不能为空')
    .max(50, '单号最长 50 个字符')
    .refine((val) => /^[A-Za-z0-9\-_]+$/.test(val), {
      message: '单号只允许字母、数字、连字符和下划线',
    }),
  vesselName: z.string().max(200).optional(),
  voyageNumber: z.string().max(100).optional(),
  originPort: z.string().max(100).optional(),
  destinationPort: z.string().max(100).optional(),
  country: z.enum(['TH', 'ID', 'MY', 'PH', 'VN', 'CN'], {
    error: '请选择目的国',
  }),
  warehouseId: z.string().uuid('无效的仓库 ID').optional(),
  estimatedArrival: z
    .string()
    .optional()
    .refine((val) => !val || isValidDate(val), {
      message: '预计到仓日期不合法',
    }),
  note: z.string().max(500).optional(),
  items: z
    .array(
      z.object({
        variantId: z.string().uuid('无效的 SKU ID'),
        quantity: z.number().int('数量必须为整数').min(1, '数量最少为 1'),
      })
    )
    .min(1, '至少添加一个产品')
    .max(50, '最多添加 50 个产品')
    .refine(
      (items) => {
        const ids = items.map((i) => i.variantId);
        return new Set(ids).size === ids.length;
      },
      { message: '产品明细中存在重复 SKU' },
    ),
});

export type CreateShipmentValues = z.infer<typeof createShipmentSchema>;

/** P3-S2B: 编辑在途基本信息 */
export const updateShipmentSchema = z.object({
  id: z.string().uuid('无效的在途记录 ID'),
  shipmentNo: z
    .string()
    .min(1, '单号不能为空')
    .max(50, '单号最长 50 个字符')
    .refine((val) => /^[A-Za-z0-9\-_]+$/.test(val), {
      message: '单号只允许字母、数字、连字符和下划线',
    }),
  vesselName: z.string().max(200).optional(),
  voyageNumber: z.string().max(100).optional(),
  originPort: z.string().max(100).optional(),
  destinationPort: z.string().max(100).optional(),
  country: z.enum(['TH', 'ID', 'MY', 'PH', 'VN', 'CN'], {
    error: '请选择目的国',
  }),
  warehouseId: z.string().uuid('无效的仓库 ID').optional(),
  estimatedArrival: z
    .string()
    .optional()
    .refine((val) => !val || isValidDate(val), {
      message: '预计到仓日期不合法',
    }),
  note: z.string().max(500).optional(),
});

export type UpdateShipmentValues = z.infer<typeof updateShipmentSchema>;

/** P3-S2B: 手动变更物流状态（本任务禁用 warehoused） */
export const changeStatusSchema = z.object({
  shipmentId: z.string().uuid('无效的在途记录 ID'),
  status: z.enum(['booking', 'loading', 'departed', 'arrived', 'customs'], {
    error: '无效的物流状态',
  }),
  description: z.string().max(500).optional(),
});

export type ChangeStatusValues = z.infer<typeof changeStatusSchema>;

/** Variant 搜索参数 */
export const searchVariantsSchema = z.object({
  country: z.enum(['TH', 'ID', 'MY', 'PH', 'VN', 'CN'], {
    error: '请选择目的国',
  }),
  search: z.string().trim().max(100).optional(),
});

/** P3-S2A: 在途列表筛选（URL search params） */
export const shipmentFiltersSchema = z.object({
  country: z.enum(['TH', 'ID', 'MY', 'PH', 'VN', 'CN']).optional(),
  status: z
    .enum(['booking', 'loading', 'departed', 'arrived', 'customs'])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ShipmentFiltersValues = z.infer<typeof shipmentFiltersSchema>;

/** P3-S2A: 在途详情路由参数 */
export const shipmentDetailParamsSchema = z.object({
  id: z.string().uuid('无效的在途记录 ID'),
});

/** 物流状态推进 */
export const advanceStatusSchema = z.object({
  shipmentId: z.string().uuid(),
  nextStatus: z.enum(['loading', 'departed', 'arrived', 'customs', 'warehoused']),
  description: z.string().max(500).optional(),
});

export type AdvanceStatusValues = z.infer<typeof advanceStatusSchema>;
