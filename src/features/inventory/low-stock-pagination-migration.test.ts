// LOW-STOCK-PAGINATION: Migration 00028 静态契约测试
//
// 验证:
// 1.  新 migration 文件存在，编号 00028
// 2.  包含 get_low_stock RPC
// 3.  SECURITY INVOKER
// 4.  SET search_path = ''
// 5.  auth.uid() IS NOT NULL 检查
// 6.  p_user_id 绑定 auth.uid()
// 7.  REVOKE EXECUTE FROM PUBLIC + anon
// 8.  GRANT EXECUTE TO authenticated
// 9.  包含 quantity <= safety_stock 低库存定义
// 10. 包含 match_status = 'matched' 仅匹配 variant
// 11. 包含 user_variant_preference archived 排除
// 12. 包含仓库隔离（get_user_role / get_assigned_warehouse_ids）
// 13. 包含 gap = safety_stock - quantity 计算
// 14. 包含 ORDER BY gap DESC, quantity ASC
// 15. 包含 LIMIT p_limit
// 16. 参数防御：COALESCE / limit 归一化 / 上限 200
// 17. 所有 RAISE EXCEPTION 为中文
// 18. 不修改 00001~00027 旧 migration
// 19. RLS：不修改 RLS 策略
//
// 纯静态文本检查，不连接 Supabase。

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATION_PATH = path.resolve(
  process.cwd(),
  'supabase/migrations/00028_low_stock_rpc.sql'
);

function extractFunctionBody(src: string, fnName: string): string {
  const fnRegex = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${fnName}[\\s\\S]*?\\$\\$;`,
    'i'
  );
  const match = src.match(fnRegex);
  return match?.[0] ?? '';
}

describe('LOW-STOCK-PAGINATION — Migration 00028', () => {
  let migrationSrc: string;
  let fnBody: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
    fnBody = extractFunctionBody(migrationSrc, 'get_low_stock');
  });

  // ─── 1. 文件存在 + 编号 ────────────────────────────────────────────────

  it('文件编号为 00028，存在且内容非空', () => {
    expect(migrationSrc).toBeTruthy();
    expect(migrationSrc.length).toBeGreaterThan(500);
    expect(MIGRATION_PATH).toMatch(/00028/);
  });

  it('注释声明 LOW-STOCK-PAGINATION', () => {
    expect(migrationSrc).toMatch(/LOW-STOCK-PAGINATION/);
  });

  // ─── 2. RPC 名称 ────────────────────────────────────────────────────────

  it('包含 get_low_stock RPC', () => {
    expect(migrationSrc).toMatch(/CREATE OR REPLACE FUNCTION public\.get_low_stock/);
  });

  // ─── 3. 安全合规 ────────────────────────────────────────────────────────

  it('SECURITY INVOKER', () => {
    expect(fnBody).toMatch(/SECURITY\s+INVOKER/i);
  });

  it('SET search_path = \'\'', () => {
    expect(fnBody).toMatch(/SET\s+search_path\s*=\s*''/);
  });

  it('auth.uid() IS NULL 检查', () => {
    expect(fnBody).toMatch(/auth\.uid\(\)\s+IS\s+NULL/);
    expect(fnBody).toMatch(/未登录/);
  });

  it('p_user_id 绑定 auth.uid()', () => {
    expect(fnBody).toMatch(/p_user_id\s*!=\s*auth\.uid\(\)/);
  });

  // ─── 4. 权限收口 ────────────────────────────────────────────────────────

  it('REVOKE EXECUTE FROM PUBLIC', () => {
    expect(migrationSrc).toMatch(/REVOKE EXECUTE ON FUNCTION public\.get_low_stock.*FROM PUBLIC/);
  });

  it('REVOKE EXECUTE FROM anon', () => {
    expect(migrationSrc).toMatch(/REVOKE EXECUTE ON FUNCTION public\.get_low_stock.*FROM anon/);
  });

  it('GRANT EXECUTE TO authenticated', () => {
    expect(migrationSrc).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_low_stock.*TO authenticated/);
  });

  // ─── 5. 低库存定义 ──────────────────────────────────────────────────────

  it('低库存定义：quantity <= safety_stock', () => {
    expect(fnBody).toMatch(/quantity\s*<=\s*COALESCE\(p\.safety_stock,\s*0\)/);
  });

  it('仅统计已匹配 variant（match_status = \'matched\'）', () => {
    expect(fnBody).toMatch(/match_status\s*=\s*'matched'/);
  });

  it('排除 quantity = 0（quantity > 0）', () => {
    expect(fnBody).toMatch(/quantity\s*>\s*0/);
  });

  // ─── 6. 归档排除 + 仓库隔离 ─────────────────────────────────────────────

  it('user_variant_preference archived 排除', () => {
    expect(fnBody).toMatch(/user_variant_preference/);
    expect(fnBody).toMatch(/preference_type\s*=\s*'archived'/);
    expect(fnBody).toMatch(/uvp_arch\.variant_id\s+IS\s+NULL/);
  });

  it('仓库隔离：get_user_role / get_assigned_warehouse_ids', () => {
    expect(fnBody).toMatch(/get_user_role\(\)/);
    expect(fnBody).toMatch(/get_assigned_warehouse_ids\(\)/);
  });

  // ─── 7. gap 计算 + 排序 + limit ─────────────────────────────────────────

  it('gap = safety_stock - quantity', () => {
    expect(fnBody).toMatch(/safety_stock.*-.*quantity\s+AS\s+gap/);
  });

  it('ORDER BY gap DESC, quantity ASC', () => {
    expect(fnBody).toMatch(/ORDER\s+BY\s+gap\s+DESC,\s+quantity\s+ASC/);
  });

  it('LIMIT p_limit', () => {
    expect(fnBody).toMatch(/LIMIT\s+p_limit/);
  });

  // ─── 8. 参数防御 ────────────────────────────────────────────────────────

  it('COALESCE 默认 limit', () => {
    expect(fnBody).toMatch(/COALESCE\(p_limit/);
  });

  it('limit 上限 200', () => {
    expect(fnBody).toMatch(/p_limit\s*>\s*200/);
  });

  it('limit 下限 1', () => {
    expect(fnBody).toMatch(/p_limit\s*<\s*1/);
  });

  // ─── 9. 中文错误 ────────────────────────────────────────────────────────

  it('RAISE EXCEPTION 为中文（≥2 条）', () => {
    const raiseMatches = fnBody.match(/RAISE\s+EXCEPTION\s+'[^']*[一-鿿]+[^']*'/g);
    expect(raiseMatches).not.toBeNull();
    expect(raiseMatches!.length).toBeGreaterThanOrEqual(2);
  });

  // ─── 10. 边界控制 ───────────────────────────────────────────────────────

  it('不修改 00001~00027 旧 migration（仅新建 get_low_stock，不 DROP/ALTER 旧函数）', () => {
    // 验证 migration 不含 DROP FUNCTION 或 ALTER FUNCTION 操作旧迁移函数
    expect(migrationSrc).not.toMatch(/DROP\s+(FUNCTION|PROCEDURE)/i);
    expect(migrationSrc).not.toMatch(/ALTER\s+FUNCTION/i);
    // 仅含一个 RPC（get_low_stock），不含其他已存在 RPC 的 CREATE
    const createCount = (migrationSrc.match(/CREATE OR REPLACE FUNCTION/g) || []).length;
    expect(createCount).toBe(1);
  });

  it('不修改 RLS 策略', () => {
    expect(migrationSrc).not.toMatch(/POLICY/i);
    expect(migrationSrc).not.toMatch(/ALTER TABLE/i);
  });

  it('不写 inventory.quantity', () => {
    expect(migrationSrc).not.toMatch(/UPDATE.*inventory/i);
    expect(migrationSrc).not.toMatch(/INSERT INTO.*inventory/i);
  });
});
