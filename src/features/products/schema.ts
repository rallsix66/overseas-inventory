// 产品模块 Zod 校验 schema
import { z } from 'zod';

/** 产品表单校验 */
export const productFormSchema = z.object({
  code: z
    .string()
    .min(1, '产品编码不能为空')
    .max(50, '产品编码最长 50 个字符'),
  name: z
    .string()
    .min(1, '产品名称不能为空')
    .max(200, '产品名称最长 200 个字符'),
  safetyStock: z
    .number()
    .int('安全库存必须为整数')
    .min(0, '安全库存不能为负数'),
  category: z
    .string()
    .max(100, '分类最长 100 个字符')
    .optional()
    .or(z.literal('')),
  unit: z
    .string()
    .min(1, '单位不能为空')
    .max(20, '单位最长 20 个字符')
    .default('件'),
});

export type ProductFormValues = z.infer<typeof productFormSchema>;

/** 产品搜索参数校验 */
export const productSearchSchema = z.object({
  search: z.string().optional(),
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(100).optional().default(20),
});
