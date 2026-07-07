// CSV 生成工具
//
// 纯函数，浏览器/服务端均可使用。
// - UTF-8 BOM 头（Excel 兼容中文）
// - 逗号分隔
// - 双引号转义（含逗号、换行、双引号的字段）
// - null / undefined → 空字符串

/** CSV 列定义 */
export interface CsvColumn<T> {
  /** 列头文本 */
  header: string;
  /** 从行数据中提取该列的值 */
  accessor: (row: T) => string | number | null | undefined;
}

/**
 * 将行数据数组转为 CSV 字符串
 *
 * @param rows    数据行
 * @param columns 列定义
 * @returns UTF-8 BOM + CSV 字符串（空数据时仅含 BOM + 表头行）
 */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const BOM = '﻿';

  const headerLine = columns.map((c) => escapeCsvField(c.header)).join(',');

  const dataLines = rows.map((row) =>
    columns.map((c) => escapeCsvField(c.accessor(row))).join(',')
  );

  const body = dataLines.join('\n');
  return BOM + headerLine + (body ? '\n' + body + '\n' : '');
}

/**
 * 转义单个 CSV 字段值
 *
 * 规则（RFC 4180）：
 * - null / undefined → 空字符串
 * - 不含逗号、双引号、换行 → 原样返回
 * - 含上述字符 → 双引号包裹，内部双引号转义为 ""
 */
function escapeCsvField(value: string | number | null | undefined): string {
  if (value == null) return '';
  const s = typeof value === 'number' ? String(value) : value;

  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }

  return s;
}
