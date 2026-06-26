// P5-SY12C: Migration 00014 静态契约测试
//
// 验证:
// - ALTER TABLE inventory ADD COLUMN daily_sales / estimated_days
// - ALTER TABLE warehouse ADD COLUMN lead_time_days
// - CREATE OR REPLACE FUNCTION sync_warehouse_inventory 签名不变
// - RPC 步骤 5b 包含 daily_sales / estimated_days 校验
// - RPC 步骤 5b 拒绝 NaN/Infinity 非有限值
// - RPC 步骤 8 INSERT 写入 daily_sales / estimated_days
// - RPC 步骤 8 UPDATE (quantity 变更) 写入 daily_sales / estimated_days
// - RPC 步骤 8 UPDATE (unchanged) 写入 daily_sales / estimated_days
// - 权限收口 GRANT service_role 不变
// - 不新建表
// - 不修改已执行 Migration 00001~00013
//
// 纯静态文本检查，不连接 Supabase。

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATION_PATH = path.resolve(
  process.cwd(),
  'supabase/migrations/00014_dynamic_alert_fields.sql'
);

describe('P5-SY12C — Migration 00014', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  // ─── 1. inventory 新增字段 ──────────────────────────────────────────

  it('ADD COLUMN IF NOT EXISTS daily_sales NUMERIC NULL on inventory', () => {
    expect(migrationSrc).toMatch(
      /ADD COLUMN IF NOT EXISTS daily_sales\s+NUMERIC\s+NULL/i
    );
  });

  it('ADD COLUMN IF NOT EXISTS estimated_days NUMERIC NULL on inventory', () => {
    expect(migrationSrc).toMatch(
      /ADD COLUMN IF NOT EXISTS estimated_days\s+NUMERIC\s+NULL/i
    );
  });

  // ─── 2. warehouse 新增字段 ──────────────────────────────────────────

  it('ADD COLUMN IF NOT EXISTS lead_time_days INTEGER NULL on warehouse', () => {
    expect(migrationSrc).toMatch(
      /ADD COLUMN IF NOT EXISTS lead_time_days\s+INTEGER\s+NULL/i
    );
  });

  // ─── 3. RPC 函数签名不变 ─────────────────────────────────────────────

  it('CREATE OR REPLACE FUNCTION public.sync_warehouse_inventory 签名不变', () => {
    expect(migrationSrc).toMatch(/CREATE OR REPLACE FUNCTION public\.sync_warehouse_inventory/);
    expect(migrationSrc).toMatch(/p_warehouse_id\s+uuid/);
    expect(migrationSrc).toMatch(/p_variants\s+jsonb/);
    expect(migrationSrc).toMatch(/p_inventory\s+jsonb/);
    expect(migrationSrc).toMatch(/p_warehouse_name\s+text/);
    expect(migrationSrc).toMatch(/RETURNS jsonb/);
  });

  // ─── 4. RPC 包含 daily_sales / estimated_days 声明 ──────────────────

  it('RPC 声明 v_daily_sales 变量', () => {
    expect(migrationSrc).toMatch(/v_daily_sales\s+numeric/i);
  });

  it('RPC 声明 v_estimated_days 变量', () => {
    expect(migrationSrc).toMatch(/v_estimated_days\s+numeric/i);
  });

  // ─── 5. RPC 步骤 5b 校验 daily_sales ─────────────────────────────────

  it('RPC 步骤 5b 校验 daily_sales 非数字类型报错', () => {
    expect(migrationSrc).toMatch(/daily_sales 必须为数字类型/);
  });

  it('RPC 步骤 5b 拒绝 daily_sales NaN/Infinity 非有限值', () => {
    expect(migrationSrc).toMatch(/daily_sales 不能为非有限值/);
  });

  it('RPC 步骤 5b 校验 estimated_days 非数字类型报错', () => {
    expect(migrationSrc).toMatch(/estimated_days 必须为数字类型/);
  });

  it('RPC 步骤 5b 拒绝 estimated_days NaN/Infinity 非有限值', () => {
    expect(migrationSrc).toMatch(/estimated_days 不能为非有限值/);
  });

  // ─── 6. RPC 步骤 8 INSERT 写入新字段 ─────────────────────────────────

  it('RPC 步骤 8 INSERT 包含 daily_sales, estimated_days 列', () => {
    expect(migrationSrc).toMatch(
      /INSERT INTO public\.inventory\s*\([^)]*daily_sales[^)]*estimated_days[^)]*\)/
    );
  });

  // ─── 7. RPC 步骤 8 UPDATE (quantity 变更) 写入新字段 ────────────────

  it('RPC 步骤 8 UPDATE (quantity 变更) 包含 daily_sales', () => {
    expect(migrationSrc).toMatch(/daily_sales\s*=\s*v_daily_sales/);
  });

  it('RPC 步骤 8 UPDATE (quantity 变更) 包含 estimated_days', () => {
    expect(migrationSrc).toMatch(/estimated_days\s*=\s*v_estimated_days/);
  });

  // ─── 8. 权限收口不变 ─────────────────────────────────────────────────

  it('REVOKE 权限收口不变', () => {
    expect(migrationSrc).toMatch(/REVOKE EXECUTE ON FUNCTION.*FROM PUBLIC/);
    expect(migrationSrc).toMatch(/GRANT EXECUTE ON FUNCTION.*TO service_role/);
  });

  // ─── 9. 不新建表 ─────────────────────────────────────────────────────

  it('不包含 CREATE TABLE', () => {
    expect(migrationSrc).not.toMatch(/CREATE TABLE/i);
  });

  // ─── 10. 注释声明 ────────────────────────────────────────────────────

  it('注释声明不修改已执行 Migration 00001~00013', () => {
    expect(migrationSrc).toMatch(/不修改.*Migration/);
  });

  it('注释声明 P5-SY12C 告警升级', () => {
    expect(migrationSrc).toMatch(/P5-SY12C/);
  });
});
