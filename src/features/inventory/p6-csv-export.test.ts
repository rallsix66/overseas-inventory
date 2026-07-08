// P6-CSV-EXPORT: 海外库存 CSV 导出 — 静态契约测试
//
// 验证：
// 1.  CSV 工具 (src/lib/csv.ts)
//     - UTF-8 BOM 头
//     - 逗号分隔
//     - 双引号转义（含逗号/换行/双引号字段）
//     - null/undefined → 空字符串
//     - 空数据仅含 BOM + 表头行
// 2.  Server Action (exportOverseasInventoryCsv)
//     - 使用独立的 exportCsvSchema（不含 page/pageSize）
//     - 不直接调用 supabase.from() / supabase.rpc()
//     - 使用 inventoryRepository.getOverseasList() 分页循环
//     - 调用 getInTransitConfirmedAggregate 获取在途聚合
//     - 按 (variantId, warehouseId) 维度回填 inTransitQuantity
//     - pageSize 固定 100，最大 10000 行
// 3.  页面组件
//     - 存在"导出 CSV"按钮
//     - 空数据时 disabled
//     - 使用 Blob + URL.createObjectURL + a[download] 触发下载
//     - 文件名格式 overseas-inventory-YYYYMMDD.csv
// 4.  不新增 Migration / RPC / RLS
// 5.  不修改 inventoryRepository 签名
//
// 纯静态文本检查 + 纯函数单元测试，不连接 Supabase。

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { toCsv } from '@/lib/csv';
import type { CsvColumn } from '@/lib/csv';

// ─── 1. CSV 工具纯函数测试 ──────────────────────────────────────────

describe('P6-CSV-EXPORT — toCsv() 纯函数', () => {
  type TestRow = { name: string; count: number; note: string | null };

  const columns: CsvColumn<TestRow>[] = [
    { header: '名称', accessor: (r) => r.name },
    { header: '数量', accessor: (r) => r.count },
    { header: '备注', accessor: (r) => r.note },
  ];

  it('基本 CSV 生成：表头 + 数据行', () => {
    const rows: TestRow[] = [
      { name: 'SKU-A', count: 10, note: '正常' },
      { name: 'SKU-B', count: 0, note: null },
    ];
    const csv = toCsv(rows, columns);
    const lines = csv.split('\n');
    // BOM + header
    expect(lines[0]).toBe('﻿名称,数量,备注');
    expect(lines[1]).toBe('SKU-A,10,正常');
    expect(lines[2]).toBe('SKU-B,0,');
  });

  it('UTF-8 BOM 头 (﻿)', () => {
    const rows: TestRow[] = [{ name: 'X', count: 1, note: '' }];
    const csv = toCsv(rows, columns);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
  });

  it('逗号分隔', () => {
    const rows: TestRow[] = [
      { name: 'A', count: 1, note: 'x' },
      { name: 'B', count: 2, note: 'y' },
    ];
    const csv = toCsv(rows, columns);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('﻿名称,数量,备注');
    // 每行恰好 3 个字段
    for (let i = 1; i <= 2; i++) {
      expect(lines[i].split(',')).toHaveLength(3);
    }
  });

  it('含逗号的字段用双引号包裹', () => {
    const rows: TestRow[] = [{ name: '产品,型号', count: 5, note: null }];
    const csv = toCsv(rows, columns);
    expect(csv).toContain('"产品,型号"');
  });

  it('含双引号的字段转义为 ""', () => {
    const rows: TestRow[] = [{ name: '3" 屏幕', count: 1, note: null }];
    const csv = toCsv(rows, columns);
    expect(csv).toContain('"3"" 屏幕"');
  });

  it('含换行符的字段用双引号包裹', () => {
    const rows: TestRow[] = [{ name: '行1\n行2', count: 1, note: null }];
    const csv = toCsv(rows, columns);
    expect(csv).toContain('"行1\n行2"');
  });

  it('null / undefined → 空字符串', () => {
    const rows: TestRow[] = [{ name: 'X', count: 1, note: null }];
    const csv = toCsv(rows, columns);
    expect(csv).toContain('X,1,');
  });

  it('数字字段正常输出', () => {
    const rows: TestRow[] = [{ name: 'X', count: 999, note: null }];
    const csv = toCsv(rows, columns);
    expect(csv).toContain(',999,');
  });

  it('空数据仅含 BOM + 表头行（无多余换行）', () => {
    const rows: TestRow[] = [];
    const csv = toCsv(rows, columns);
    // BOM + 表头，末尾无多余换行（dataLines 为空时 join 后为空）
    expect(csv).toBe('﻿名称,数量,备注');
  });
});

// ─── 2. Server Action 源码检查 ─────────────────────────────────────

const ACTIONS_PATH = path.resolve(process.cwd(), 'src/features/inventory/actions.ts');
const SCHEMA_PATH = path.resolve(process.cwd(), 'src/features/inventory/schema.ts');
const REPO_PATH = path.resolve(process.cwd(), 'src/features/inventory/repository.ts');

describe('P6-CSV-EXPORT — Server Action (源码)', () => {
  let actionsSrc: string;
  let schemaSrc: string;

  beforeAll(() => {
    actionsSrc = fs.readFileSync(ACTIONS_PATH, 'utf-8');
    schemaSrc = fs.readFileSync(SCHEMA_PATH, 'utf-8');

  });

  it('actions.ts 包含 exportOverseasInventoryCsv 导出', () => {
    expect(actionsSrc).toMatch(/export async function exportOverseasInventoryCsv/);
  });

  it('Server Action 中 requireAuth() 被调用', () => {
    // 提取 exportOverseasInventoryCsv 函数体
    const fn = extractFunctionBody(actionsSrc, 'exportOverseasInventoryCsv');
    expect(fn).toMatch(/requireAuth\(\)/);
  });

  it('使用 exportCsvSchema 校验参数（不含用户可传的 page/pageSize）', () => {
    const fn = extractFunctionBody(actionsSrc, 'exportOverseasInventoryCsv');
    expect(fn).toMatch(/exportCsvSchema/);
    // exportCsvSchema 定义不含 page/pageSize 字段
    const schemaDef = extractBetween(schemaSrc, 'exportCsvSchema', '});');
    expect(schemaDef).not.toMatch(/\bpage\b/);
    expect(schemaDef).not.toMatch(/\bpageSize\b/);
  });

  it('exportCsvSchema country 为海外五国（不含 CN）', () => {
    const schemaDef = extractBetween(schemaSrc, 'exportCsvSchema', '});');
    expect(schemaDef).toMatch(/TH.*ID.*MY.*PH.*VN/);
    expect(schemaDef).not.toMatch(/\bCN\b/);
  });

  it('使用 inventoryRepository.getOverseasList() 分页循环', () => {
    const fn = extractFunctionBody(actionsSrc, 'exportOverseasInventoryCsv');
    expect(fn).toMatch(/inventoryRepository\.getOverseasList/);
    // 分页循环
    expect(fn).toMatch(/while\s*\(true\)/);
  });

  it('pageSize 固定 100', () => {
    const fn = extractFunctionBody(actionsSrc, 'exportOverseasInventoryCsv');
    const lines = fn.split('\n');
    const pageSizeLine = lines.find((l) => l.includes('CSV_EXPORT_PAGE_SIZE'));
    expect(pageSizeLine).toBeDefined();
    expect(actionsSrc).toMatch(/CSV_EXPORT_PAGE_SIZE\s*=\s*100/);
  });

  it('最大行数 10000', () => {
    expect(actionsSrc).toMatch(/CSV_EXPORT_MAX_ROWS\s*=\s*10000/);
  });

  it('超过 10000 行返回中文错误', () => {
    const fn = extractFunctionBody(actionsSrc, 'exportOverseasInventoryCsv');
    expect(fn).toContain('导出结果超过');
    expect(fn).toContain('请缩小筛选范围后重试');
  });

  it('空数据返回中文错误', () => {
    const fn = extractFunctionBody(actionsSrc, 'exportOverseasInventoryCsv');
    expect(fn).toContain('无数据可导出');
  });

  it('Server Action 不直接调用 supabase.from() 或 supabase.rpc()', () => {
    const fn = extractFunctionBody(actionsSrc, 'exportOverseasInventoryCsv');
    expect(fn).not.toMatch(/supabase\.from\(/);
    expect(fn).not.toMatch(/supabase\.rpc\(/);
  });

  it('导出使用 toCsv() 生成 CSV', () => {
    const fn = extractFunctionBody(actionsSrc, 'exportOverseasInventoryCsv');
    expect(fn).toMatch(/toCsv\(/);
  });

  it('exportOverseasInventoryCsv 调用 getInTransitConfirmedAggregate', () => {
    const fn = extractFunctionBody(actionsSrc, 'exportOverseasInventoryCsv');
    expect(fn).toMatch(/getInTransitConfirmedAggregate/);
  });

  it('按 warehouseId + variantId 维度回填 inTransitQuantity', () => {
    const fn = extractFunctionBody(actionsSrc, 'exportOverseasInventoryCsv');
    // 构建 whInTransitMap（variantId → Map<warehouseId, inTransitQty>）
    expect(fn).toMatch(/whInTransitMap/);
    // 回填每行在途数量
    expect(fn).toMatch(/inTransitQuantity\s*=\s*whInTransitMap/);
    // 按 variantId + warehouseId 维度取值
    expect(fn).toMatch(/\.get\(item\.variantId\)\?\.get\(item\.warehouseId\)/);
  });

  it('"库存+在途"列使用 quantity + inTransitQuantity（非仅 quantity）', () => {
    // exportColumns 中的"库存+在途"列定义应使用 inTransitQuantity
    const colDef = extractBetween(actionsSrc, "'库存+在途'", '\n');
    expect(colDef).toMatch(/inTransitQuantity/);
    // 不应只导出 quantity
    expect(colDef).toMatch(/r\.quantity\s*\+\s*\(r\.inTransitQuantity/);
  });
});

// ─── 3. 页面组件源码检查 ───────────────────────────────────────────

const PAGE_PATH = path.resolve(
  process.cwd(),
  'src/app/dashboard/inventory/overseas/_components/overseas-page-content.tsx'
);

describe('P6-CSV-EXPORT — 页面组件 (源码)', () => {
  let pageSrc: string;

  beforeAll(() => {
    pageSrc = fs.readFileSync(PAGE_PATH, 'utf-8');
  });

  it('页面存在"导出 CSV"按钮文案', () => {
    expect(pageSrc).toContain('导出 CSV');
  });

  it('导入 exportOverseasInventoryCsv Server Action', () => {
    expect(pageSrc).toContain('exportOverseasInventoryCsv');
  });

  it('导入 Download 图标', () => {
    expect(pageSrc).toContain('Download');
  });

  it('导出按钮有 disabled 逻辑（exporting || total === 0）', () => {
    expect(pageSrc).toMatch(/disabled.*exporting.*total/);
  });

  it('使用 Blob + URL.createObjectURL 触发下载', () => {
    expect(pageSrc).toMatch(/new Blob\(/);
    expect(pageSrc).toMatch(/URL\.createObjectURL/);
  });

  it('动态创建 a[download] 元素', () => {
    expect(pageSrc).toMatch(/a\.download/);
  });

  it('文件名格式 overseas-inventory-YYYYMMDD.csv', () => {
    expect(pageSrc).toContain('overseas-inventory-');
    expect(pageSrc).toContain('.csv');
    // 日期拼接逻辑
    expect(pageSrc).toContain("replace(/-/g, '')");
  });

  it('导出失败时 toast.error 提示', () => {
    // 在 handleExportCsv 函数内
    const fn = extractBetween(pageSrc, 'handleExportCsv', '\n  }');
    expect(fn).toMatch(/toast\.error/);
  });

  it('handleExportCsv 传递当前筛选条件', () => {
    const fn = extractBetween(pageSrc, 'handleExportCsv', '\n  }');
    expect(fn).toContain('filters.country');
    expect(fn).toContain('filters.warehouse');
    expect(fn).toContain('filters.stockStatus');
    expect(fn).toContain('filters.search');
  });

  it('页面不直接调用 supabase.from()', () => {
    expect(pageSrc).not.toMatch(/supabase\.from\(/);
  });

  it('页面不直接调用 supabase.rpc()', () => {
    expect(pageSrc).not.toMatch(/supabase\.rpc\(/);
  });
});

// ─── 4. 不新增 Migration / RPC / RLS / 不改 Repository ────────────

describe('P6-CSV-EXPORT — 架构边界', () => {
  it('migrations/ 下无 00036+ 文件（00034/00035 为 P6-UX-V2-D 新增，已计入）', () => {
    const m36 = path.resolve(process.cwd(), 'supabase/migrations/00036_');
    const files = fs.readdirSync(path.dirname(m36));
    const post35 = files.filter((f) => /^0003[6-9]|^000[4-9]|^00[1-9]/.test(f));
    expect(post35).toHaveLength(0);
  });

  it('inventoryRepository 签名未修改（exportCsvSchema 不在 repository.ts 中）', () => {
    const repoSrc = fs.readFileSync(REPO_PATH, 'utf-8');
    expect(repoSrc).not.toContain('exportCsv');
  });
});

// ─── Helper ─────────────────────────────────────────────────────────

/** 从源码中提取指定函数的函数体（大括号匹配） */
function extractFunctionBody(src: string, fnName: string): string {
  // 找到函数声明
  const fnRegex = new RegExp(
    `(?:export\\s+)?(?:async\\s+)?function\\s+${fnName}\\s*\\([^)]*\\)\\s*(:\\s*[^{]+)?\\s*\\{`
  );
  const match = src.match(fnRegex);
  if (!match || match.index === undefined) return '';

  let pos = match.index + match[0].length;
  let depth = 1;
  while (pos < src.length && depth > 0) {
    const ch = src[pos];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    pos++;
  }
  return depth === 0 ? src.slice(match.index + match[0].length, pos - 1) : '';
}

/** 从源码中提取两个标记之间的文本 */
function extractBetween(src: string, startMarker: string, endMarker: string): string {
  const startIdx = src.indexOf(startMarker);
  if (startIdx === -1) return '';
  const endIdx = src.indexOf(endMarker, startIdx + startMarker.length);
  if (endIdx === -1) return src.slice(startIdx);
  return src.slice(startIdx, endIdx + endMarker.length);
}
