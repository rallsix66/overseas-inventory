// 喜运达(golucky)运单导入逻辑
//
// 支持两种输入方式：
//   1. 文本粘贴：运单号一行一个，或用逗号/空格/分号分隔
//   2. CSV 文件上传：解析第一列为运单号
//
// P0 仅支持文本 + CSV；Excel (xlsx) 推迟为独立增强项。

import { z } from 'zod';

/** 喜运达支持的国家代码 */
export const GOLUCKY_COUNTRIES = ['TH', 'ID', 'MY', 'PH', 'VN'] as const;
export type GoluckyCountry = (typeof GOLUCKY_COUNTRIES)[number];

/** 解析后的导入条目 */
export interface ParsedImportItem {
  waybillNo: string;
  warehouseId: string;
  country: GoluckyCountry;
  externalOrderNo?: string;
}

/** 导入结果 */
export interface GoluckyImportResult {
  succeeded: number;
  duplicated: number;
  failed: Array<{
    index: number;
    waybillNo: string;
    error: string;
  }>;
}

/** 单行导入条目 Zod 校验 */
export const goluckyImportItemSchema = z.object({
  waybillNo: z.string().min(1, '运单号不能为空'),
  warehouseId: z.string().uuid('仓库 ID 格式无效'),
  country: z.enum(GOLUCKY_COUNTRIES, { error: '无效的国家代码，仅支持 TH/ID/MY/PH/VN' }),
  externalOrderNo: z.string().optional(),
});

/** 解析文本/CSV 输入为导入条目数组 */
export function parseWaybillInput(
  input: string,
  warehouseId: string,
  country: string,
): { items: ParsedImportItem[]; errors: Array<{ line: number; raw: string; error: string }> } {
  const items: ParsedImportItem[] = [];
  const errors: Array<{ line: number; raw: string; error: string }> = [];

  // 拆行
  const lines = input
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 跳过 CSV 表头
    if (i === 0 && /运单号|waybill|tracking|单号/i.test(line)) {
      continue;
    }

    // CSV 取第一列
    const waybill = line.split(/[\t,;]/)[0].trim().replace(/^["']|["']$/g, '');

    if (!waybill) {
      errors.push({ line: i + 1, raw: line, error: '运单号为空' });
      continue;
    }

    const parsed = goluckyImportItemSchema.safeParse({
      waybillNo: waybill,
      warehouseId,
      country,
    });

    if (!parsed.success) {
      errors.push({
        line: i + 1,
        raw: waybill,
        error: parsed.error.issues[0]?.message ?? '校验失败',
      });
      continue;
    }

    items.push(parsed.data);
  }

  return { items, errors };
}

/** 解析逗号/空格/分号分隔的单行文本 */
export function parseWaybillsInline(
  input: string,
  warehouseId: string,
  country: string,
): { items: ParsedImportItem[]; errors: Array<{ raw: string; error: string }> } {
  const items: ParsedImportItem[] = [];
  const errors: Array<{ raw: string; error: string }> = [];

  const tokens = input
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const seen = new Set<string>();

  for (const wb of tokens) {
    if (seen.has(wb)) continue;
    seen.add(wb);

    const parsed = goluckyImportItemSchema.safeParse({
      waybillNo: wb,
      warehouseId,
      country,
    });

    if (!parsed.success) {
      errors.push({
        raw: wb,
        error: parsed.error.issues[0]?.message ?? '校验失败',
      });
      continue;
    }

    items.push(parsed.data);
  }

  return { items, errors };
}
