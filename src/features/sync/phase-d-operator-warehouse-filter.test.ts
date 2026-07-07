// Phase D 生产收口：get_sync_runs_paginated 必须继承 P5-SY13A 仓库分配隔离
//
// 00029 已执行后发现分页 RPC 的 Operator 分支遗漏 assigned warehouse 过滤。
// 00030 通过 CREATE OR REPLACE FUNCTION 前向修复，不能回改已执行 00029。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  __dirname,
  '../../../supabase/migrations/00030_fix_paginated_sync_runs_operator_warehouse_filter.sql',
);

function migrationText(): string {
  return readFileSync(migrationPath, 'utf8');
}

function sectionBetween(source: string, start: string, end: string): string {
  const startIdx = source.indexOf(start);
  expect(startIdx).toBeGreaterThanOrEqual(0);
  const endIdx = source.indexOf(end, startIdx + start.length);
  expect(endIdx).toBeGreaterThan(startIdx);
  return source.slice(startIdx, endIdx);
}

describe('Migration 00030 — get_sync_runs_paginated Operator 仓库隔离修复', () => {
  it('使用前向 CREATE OR REPLACE FUNCTION 修复同名 RPC', () => {
    const sql = migrationText();

    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.get_sync_runs_paginated');
    expect(sql).toContain('p_warehouse_id uuid');
    expect(sql).toContain('p_page');
    expect(sql).toContain('p_page_size');
  });

  it('不修改已执行表结构', () => {
    const sql = migrationText();

    expect(sql).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bCREATE\s+TABLE\b/i);
  });

  it('Admin 分支不使用 assigned warehouse 过滤', () => {
    const sql = migrationText();
    const adminBranch = sectionBetween(sql, "IF v_role = 'admin' THEN", 'ELSE');

    expect(adminBranch).not.toContain('get_assigned_warehouse_ids');
    expect(adminBranch).toContain('SELECT count(*)');
    expect(adminBranch).toContain('OFFSET v_offset');
    expect(adminBranch).toContain('LIMIT p_page_size');
  });

  it('Operator total 计数限制为已分配仓库', () => {
    const sql = migrationText();
    const operatorBranch = sql.slice(sql.indexOf('ELSE'));

    expect(operatorBranch).toMatch(
      /SELECT\s+count\(\*\)[\s\S]*?FROM\s+public\.sync_run\s+sr[\s\S]*?sr\.warehouse_id\s+IN\s+\(\s*SELECT\s+public\.get_assigned_warehouse_ids\s*\(\s*\)\s*\)/i,
    );
  });

  it('Operator rows 查询限制为已分配仓库', () => {
    const sql = migrationText();
    const operatorBranch = sql.slice(sql.indexOf('ELSE'));

    expect(operatorBranch).toMatch(
      /WITH\s+limited\s+AS\s*\([\s\S]*?FROM\s+public\.sync_run\s+sr[\s\S]*?sr\.warehouse_id\s+IN\s+\(\s*SELECT\s+public\.get_assigned_warehouse_ids\s*\(\s*\)\s*\)[\s\S]*?OFFSET\s+v_offset[\s\S]*?LIMIT\s+p_page_size/i,
    );
  });

  it('Operator 分支仍保留脱敏矩阵', () => {
    const sql = migrationText();
    const operatorBranch = sql.slice(sql.indexOf('ELSE'));

    expect(operatorBranch).toContain("'triggered_by_email'");
    expect(operatorBranch).toContain("'failure_summary'");
    expect(operatorBranch).not.toMatch(/'exit_code',\s*limited\.exit_code/);
    expect(operatorBranch).not.toMatch(/'error_message',\s*limited\.error_message/);
    expect(operatorBranch).not.toContain("'dry_run_run_id'");
  });

  it('权限仍收口到 authenticated', () => {
    const sql = migrationText();

    expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.get_sync_runs_paginated');
    expect(sql).toContain('FROM PUBLIC');
    expect(sql).toContain('FROM anon');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.get_sync_runs_paginated');
    expect(sql).toContain('TO authenticated');
  });
});
