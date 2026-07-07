// PERF-H: Migration 00033 静态契约测试
//
// 验证:
// 1.  新 migration 文件存在，编号 00033
// 2.  仅 DROP INDEX IF EXISTS 两个目标索引
// 3.  不包含 CREATE INDEX / ALTER TABLE / UPDATE / INSERT / DELETE
// 4.  不修改 00001 旧 migration
// 5.  保留 00001 中 idx_inventory_warehouse_id（不触及非目标索引）
// 6.  声明 PERF-H 标识
//
// 纯静态文本检查，不连接 Supabase。

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATION_PATH = path.resolve(
  process.cwd(),
  'supabase/migrations/00033_drop_unused_inventory_quantity_indexes.sql'
);
const MIGRATION_00001_PATH = path.resolve(
  process.cwd(),
  'supabase/migrations/00001_initial_schema.sql'
);

describe('PERF-H — Migration 00033', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  // ─── 1. 文件存在 + 编号 ────────────────────────────────────────────────

  it('文件编号为 00033，存在且内容非空', () => {
    expect(migrationSrc).toBeTruthy();
    expect(migrationSrc.length).toBeGreaterThan(200);
    expect(MIGRATION_PATH).toMatch(/00033/);
  });

  it('注释声明 PERF-H', () => {
    expect(migrationSrc).toMatch(/PERF-H/);
  });

  // ─── 2. 仅 DROP 两个目标索引 ──────────────────────────────────────────

  it('DROP INDEX IF EXISTS public.idx_inventory_low_stock', () => {
    expect(migrationSrc).toMatch(/DROP INDEX IF EXISTS public\.idx_inventory_low_stock\s*;/i);
  });

  it('DROP INDEX IF EXISTS public.idx_inventory_quantity', () => {
    expect(migrationSrc).toMatch(/DROP INDEX IF EXISTS public\.idx_inventory_quantity\s*;/i);
  });

  it('恰好包含两行 DROP INDEX IF EXISTS（排除 SQL 注释行）', () => {
    const lines = migrationSrc.split('\n').filter(l => !l.trimStart().startsWith('--'));
    const matches = lines.join('\n').match(/DROP INDEX IF EXISTS/gi);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(2);
  });

  // ─── 3. 不包含写操作 / 模式变更 ────────────────────────────────────────

  it('不包含 CREATE INDEX（排除 SQL 注释行）', () => {
    const nonCommentLines = migrationSrc.split('\n').filter(l => !l.trimStart().startsWith('--'));
    expect(nonCommentLines.join('\n')).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i);
  });

  it('不包含 ALTER TABLE', () => {
    expect(migrationSrc).not.toMatch(/ALTER\s+TABLE/i);
  });

  it('不包含 INSERT / UPDATE / DELETE', () => {
    expect(migrationSrc).not.toMatch(/\bINSERT\b/i);
    expect(migrationSrc).not.toMatch(/\bUPDATE\b/i);
    expect(migrationSrc).not.toMatch(/\bDELETE\b/i);
  });

  it('不包含 CREATE OR REPLACE FUNCTION / RPC', () => {
    expect(migrationSrc).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i);
  });

  it('不包含 REVOKE / GRANT', () => {
    expect(migrationSrc).not.toMatch(/\bREVOKE\b/i);
    expect(migrationSrc).not.toMatch(/\bGRANT\b/i);
  });

  // ─── 4. 不修改 00001 ──────────────────────────────────────────────────

  it('00001 migration 未被修改（idx_inventory_low_stock 仍存在）', () => {
    const m1 = fs.readFileSync(MIGRATION_00001_PATH, 'utf-8');
    expect(m1).toMatch(/CREATE INDEX idx_inventory_low_stock/);
  });

  it('00001 migration 未被修改（idx_inventory_quantity 仍存在）', () => {
    const m1 = fs.readFileSync(MIGRATION_00001_PATH, 'utf-8');
    expect(m1).toMatch(/CREATE INDEX idx_inventory_quantity/);
  });

  // ─── 5. 不触及非目标索引 ──────────────────────────────────────────────

  it('不删除 idx_inventory_warehouse_id', () => {
    expect(migrationSrc).not.toMatch(/idx_inventory_warehouse_id/);
  });

  it('不匹配其他 inventory 索引', () => {
    // 仅允许删除两个目标索引，不触碰任何其他索引
    const allDrops = migrationSrc.match(/DROP INDEX IF EXISTS public\.(\w+)/gi) ?? [];
    const targetNames = allDrops.map(d => d.toLowerCase());
    expect(targetNames).toEqual([
      'drop index if exists public.idx_inventory_low_stock',
      'drop index if exists public.idx_inventory_quantity',
    ]);
  });
});
