// PERF-S1A: Migration 00027 静态契约测试
//
// 验证:
// 1.  新 migration 文件存在，编号 00027
// 2.  包含三个 RPC 名称
// 3.  三个 RPC 都是 SECURITY INVOKER
// 4.  三个 RPC 都 SET search_path = ''
// 5.  三个 RPC 都有 auth.uid() IS NOT NULL
// 6.  三个 RPC 都绑定 p_user_id = auth.uid()
// 7.  REVOKE EXECUTE FROM PUBLIC + anon（共 6 条）
// 8.  GRANT EXECUTE TO authenticated（共 3 条）
// 9.  get_overseas_inventory 包含 LIMIT / OFFSET
// 10. get_overseas_inventory 包含 total = COUNT(*) 计算
// 11. get_overseas_inventory 包含 user_variant_preference archived 过滤
// 12. get_overseas_inventory 包含 favorited 标记逻辑
// 13. get_overseas_inventory 包含 warehouse.type = 'overseas'
// 14. get_overseas_stats 使用 SQL 聚合 COUNT / SUM / MAX
// 15. get_in_transit_confirmed_aggregate 包含 bigseller_absorbed_at IS NULL 口径
// 16. get_in_transit_confirmed_aggregate 不引用 inventory.quantity
// 17. 整个 migration 不含 UPDATE public.inventory / INSERT INTO public.inventory
// 18. 所有 RAISE EXCEPTION 为中文
// 19. 不修改 00001~00026 旧 migration
// 20. 权限审计：每个 RPC 有完整的函数存在 + 安全合规链
//
// 纯静态文本检查，不连接 Supabase。

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATION_PATH = path.resolve(
  process.cwd(),
  'supabase/migrations/00027_overseas_inventory_performance_rpc.sql'
);

describe('PERF-S1A — Migration 00027', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  // ─── 1. 文件存在 + 编号 ────────────────────────────────────────────────

  it('文件编号为 00027，存在且内容非空', () => {
    expect(migrationSrc).toBeTruthy();
    expect(migrationSrc.length).toBeGreaterThan(500);
    expect(MIGRATION_PATH).toMatch(/00027/);
  });

  it('注释声明 PERF-S1A', () => {
    expect(migrationSrc).toMatch(/PERF-S1A/);
  });

  // ─── 2. 三个 RPC 名称 ──────────────────────────────────────────────────

  it('包含 get_overseas_inventory RPC', () => {
    expect(migrationSrc).toMatch(/CREATE OR REPLACE FUNCTION public\.get_overseas_inventory/);
  });

  it('包含 get_overseas_stats RPC', () => {
    expect(migrationSrc).toMatch(/CREATE OR REPLACE FUNCTION public\.get_overseas_stats/);
  });

  it('包含 get_in_transit_confirmed_aggregate RPC', () => {
    expect(migrationSrc).toMatch(/CREATE OR REPLACE FUNCTION public\.get_in_transit_confirmed_aggregate/);
  });

  // ─── 3. SECURITY INVOKER ────────────────────────────────────────────────

  it('get_overseas_inventory — SECURITY INVOKER', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_inventory');
    expect(fn).toMatch(/SECURITY\s+INVOKER/i);
  });

  it('get_overseas_stats — SECURITY INVOKER', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_stats');
    expect(fn).toMatch(/SECURITY\s+INVOKER/i);
  });

  it('get_in_transit_confirmed_aggregate — SECURITY INVOKER', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_in_transit_confirmed_aggregate');
    expect(fn).toMatch(/SECURITY\s+INVOKER/i);
  });

  // ─── 4. SET search_path = '' ────────────────────────────────────────────

  it('get_overseas_inventory — SET search_path = \'\'', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_inventory');
    expect(fn).toMatch(/SET\s+search_path\s*=\s*''/);
  });

  it('get_overseas_stats — SET search_path = \'\'', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_stats');
    expect(fn).toMatch(/SET\s+search_path\s*=\s*''/);
  });

  it('get_in_transit_confirmed_aggregate — SET search_path = \'\'', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_in_transit_confirmed_aggregate');
    expect(fn).toMatch(/SET\s+search_path\s*=\s*''/);
  });

  // ─── 5. auth.uid() IS NOT NULL ──────────────────────────────────────────

  it('get_overseas_inventory — auth.uid() IS NOT NULL 检查', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_inventory');
    expect(fn).toMatch(/auth\.uid\(\)\s+IS\s+NULL/);
    expect(fn).toMatch(/未登录/);
  });

  it('get_overseas_stats — auth.uid() IS NOT NULL 检查', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_stats');
    expect(fn).toMatch(/auth\.uid\(\)\s+IS\s+NULL/);
    expect(fn).toMatch(/未登录/);
  });

  it('get_in_transit_confirmed_aggregate — auth.uid() IS NOT NULL 检查', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_in_transit_confirmed_aggregate');
    expect(fn).toMatch(/auth\.uid\(\)\s+IS\s+NULL/);
    expect(fn).toMatch(/未登录/);
  });

  // ─── 6. p_user_id 绑定 auth.uid() ──────────────────────────────────────

  it('get_overseas_inventory — p_user_id 绑定 auth.uid()', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_inventory');
    expect(fn).toMatch(/p_user_id\s*!=\s*auth\.uid\(\)/);
  });

  it('get_overseas_stats — p_user_id 绑定 auth.uid()', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_stats');
    expect(fn).toMatch(/p_user_id\s*!=\s*auth\.uid\(\)/);
  });

  it('get_in_transit_confirmed_aggregate — p_user_id 绑定 auth.uid()', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_in_transit_confirmed_aggregate');
    expect(fn).toMatch(/p_user_id\s*!=\s*auth\.uid\(\)/);
  });

  // ─── 7. REVOKE EXECUTE FROM PUBLIC + anon ──────────────────────────────

  it('6 条 REVOKE（每个 RPC × PUBLIC + anon = 3 × 2）', () => {
    const revokeCount = (migrationSrc.match(/REVOKE EXECUTE ON FUNCTION public\./g) || []).length;
    expect(revokeCount).toBe(6);
  });

  it('所有 REVOKE 同时撤销 PUBLIC 和 anon', () => {
    const revokes = migrationSrc.match(/REVOKE EXECUTE ON FUNCTION public\.\w+\([^)]*\) FROM (PUBLIC|anon)/g) || [];
    expect(revokes.filter((r) => r.includes('PUBLIC')).length).toBe(3);
    expect(revokes.filter((r) => r.includes('anon')).length).toBe(3);
  });

  // ─── 8. GRANT EXECUTE TO authenticated ─────────────────────────────────

  it('3 条 GRANT 全部 TO authenticated', () => {
    const grants = migrationSrc.match(/GRANT EXECUTE ON FUNCTION public\.\w+\([^)]*\) TO authenticated/g) || [];
    expect(grants.length).toBe(3);
  });

  it('不 GRANT 给 PUBLIC 或 anon', () => {
    expect(migrationSrc).not.toMatch(/GRANT EXECUTE.*TO PUBLIC/);
    expect(migrationSrc).not.toMatch(/GRANT EXECUTE.*TO anon/);
  });

  it('不 GRANT 给 service_role', () => {
    // 这些 RPC 由 authenticated 用户直接调用，不走 service_role
    expect(migrationSrc).not.toMatch(/GRANT EXECUTE.*TO service_role/);
  });

  // ─── 9. get_overseas_inventory — LIMIT / OFFSET ────────────────────────

  it('get_overseas_inventory 使用 LIMIT p_page_size OFFSET v_offset', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_inventory');
    expect(fn).toMatch(/LIMIT\s+p_page_size/);
    expect(fn).toMatch(/OFFSET\s+v_offset/);
  });

  it('get_overseas_inventory 计算 v_offset = (p_page - 1) * p_page_size', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_inventory');
    expect(fn).toMatch(/v_offset\s*:=\s*\(p_page\s*-\s*1\)\s*\*\s*p_page_size/);
  });

  // ─── 10. get_overseas_inventory — COUNT(*) total ───────────────────────

  it('get_overseas_inventory total 字段使用 COUNT(*)', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_inventory');
    expect(fn).toMatch(/'total'.*COUNT\(\*\)/);
  });

  it('get_overseas_inventory total 来自过滤后的 CTE（不是 p_page_size）', () => {
    // total 只可能从 COUNT(*) 产生，不可能从 p_page_size 来
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_inventory');
    expect(fn).toMatch(/COUNT\(\*\)\s+FROM\s+filtered/);
  });

  // ─── 11. get_overseas_inventory — user_variant_preference archived ─────

  it('get_overseas_inventory 过滤已归档 variant', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_inventory');
    expect(fn).toMatch(/user_variant_preference/);
    expect(fn).toMatch(/preference_type\s*=\s*'archived'/);
    expect(fn).toMatch(/uvp_arch\.variant_id\s+IS\s+NULL/);
  });

  // ─── 12. get_overseas_inventory — favorited ────────────────────────────

  it('get_overseas_inventory 包含 favorited 标记', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_inventory');
    expect(fn).toMatch(/preference_type\s*=\s*'favorited'/);
    expect(fn).toMatch(/is_favorited/);
  });

  it('get_overseas_inventory 排序：关注置顶，然后 quantity ASC', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_inventory');
    expect(fn).toMatch(/is_favorited\s+DESC/);
    expect(fn).toMatch(/quantity\s+ASC/);
  });

  it('get_overseas_inventory 支持 p_favorited_only 筛选', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_inventory');
    expect(fn).toMatch(/p_favorited_only/);
    expect(fn).toMatch(/uvp_fav\.variant_id\s+IS\s+NOT\s+NULL/);
  });

  // ─── 13. get_overseas_inventory — warehouse.type = 'overseas' ──────────

  it('get_overseas_inventory 过滤 warehouse.type = \'overseas\'', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_inventory');
    expect(fn).toMatch(/w\.type\s*=\s*'overseas'/);
  });

  it('get_overseas_inventory INNER JOIN warehouse', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_inventory');
    expect(fn).toMatch(/INNER\s+JOIN\s+public\.warehouse/);
  });

  // ─── 14. get_overseas_stats — SQL 聚合 ─────────────────────────────────

  it('get_overseas_stats 使用 COUNT(DISTINCT) 统计 SKU 数', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_stats');
    expect(fn).toMatch(/COUNT\(DISTINCT\s+variant_id\)/);
  });

  it('get_overseas_stats 使用 SUM 统计总量', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_stats');
    expect(fn).toMatch(/SUM\(quantity\)/);
  });

  it('get_overseas_stats 使用 MAX 统计最后同步时间', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_stats');
    expect(fn).toMatch(/MAX\(last_sync_at\)/);
  });

  it('get_overseas_stats 低库存仅统计已匹配 variant（match_status = \'matched\'）', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_stats');
    expect(fn).toMatch(/match_status\s*=\s*'matched'/);
  });

  it('get_overseas_stats 低库存公式：quantity > 0 AND quantity <= safety_stock', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_stats');
    expect(fn).toMatch(/quantity\s*>\s*0/);
    expect(fn).toMatch(/quantity\s*<=\s*COALESCE\(safety_stock/);
  });

  // ─── 15. get_in_transit_confirmed_aggregate — 口径 ─────────────────────

  it('get_in_transit_confirmed_aggregate 在途排除 warehoused 状态', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_in_transit_confirmed_aggregate');
    expect(fn).toMatch(/status\s*!=\s*'warehoused'/);
  });

  it('get_in_transit_confirmed_aggregate 在途公式 = quantity - warehoused_quantity', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_in_transit_confirmed_aggregate');
    expect(fn).toMatch(/si\.quantity\s*-\s*si\.warehoused_quantity/);
  });

  it('get_in_transit_confirmed_aggregate 已确认口径含 customs', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_in_transit_confirmed_aggregate');
    expect(fn).toMatch(/status\s*=\s*'customs'/);
  });

  it('get_in_transit_confirmed_aggregate 已确认口径含 warehoused + bigseller_absorbed_at IS NULL', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_in_transit_confirmed_aggregate');
    expect(fn).toMatch(/status\s*=\s*'warehoused'/);
    expect(fn).toMatch(/bigseller_absorbed_at\s+IS\s+NULL/);
  });

  it('get_in_transit_confirmed_aggregate 两个口径用 OR 连接', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_in_transit_confirmed_aggregate');
    // 确认 customs OR (warehoused + absorbed IS NULL) 在同一查询上下文中
    expect(fn).toMatch(/status\s*=\s*'customs'\s*OR\s*\(/);
  });

  // ─── 16. get_in_transit_confirmed_aggregate — 不引用 inventory ─────────

  it('get_in_transit_confirmed_aggregate 不含 FROM public.inventory', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_in_transit_confirmed_aggregate');
    expect(fn).not.toMatch(/FROM\s+public\.inventory/i);
  });

  it('get_in_transit_confirmed_aggregate 不含 inventory.quantity（仅代码不含注释）', () => {
    // 注释中的 "inventory.quantity 唯一事实来源是 BigSeller" 不算
    const codeOnly = stripComments(extractFunctionBody(migrationSrc, 'get_in_transit_confirmed_aggregate'));
    expect(codeOnly).not.toMatch(/inventory\.quantity/);
  });

  // ─── 17. 整个 migration 不写 inventory ─────────────────────────────────

  it('migration 不含 UPDATE public.inventory', () => {
    expect(migrationSrc).not.toMatch(/UPDATE\s+public\.inventory/i);
  });

  it('migration 不含 INSERT INTO public.inventory', () => {
    expect(migrationSrc).not.toMatch(/INSERT\s+INTO\s+public\.inventory/i);
  });

  it('migration 不创建新表', () => {
    expect(migrationSrc).not.toMatch(/CREATE\s+TABLE/i);
  });

  it('migration 不 ALTER 旧表', () => {
    expect(migrationSrc).not.toMatch(/ALTER\s+TABLE/i);
  });

  // ─── 18. 中文 RAISE EXCEPTION ──────────────────────────────────────────

  it('所有 RAISE EXCEPTION 消息为中文', () => {
    const raises = migrationSrc.match(/RAISE EXCEPTION\s+'([^']+)'/g) || [];
    expect(raises.length).toBeGreaterThanOrEqual(3); // 至少 auth + p_user_id 两条 × 3 RPC
    for (const r of raises) {
      const msg = r.replace(/RAISE EXCEPTION\s+'/, '').replace(/'$/, '');
      // 消息必须含中文字符
      expect(msg).toMatch(/[一-鿿]/);
    }
  });

  it('RAISE EXCEPTION 全部携带 ERRCODE', () => {
    const codeOnly = stripComments(migrationSrc);
    const raises = codeOnly.match(/RAISE EXCEPTION/g) || [];
    // 每条 RAISE EXCEPTION 后（在同一行或下一行）必须有 USING ERRCODE
    const raisesWithCode = codeOnly.match(/RAISE EXCEPTION\s+'[^']+'[\s\S]*?USING ERRCODE/g) || [];
    expect(raisesWithCode.length).toBe(raises.length);
  });

  // ─── 19. 不修改旧 migration ────────────────────────────────────────────

  it('不引用 migration 00001~00026（仅代码不含注释）', () => {
    // 注释中 "不修改已执行 Migration 00001~00026" 是文档声明，不应被匹配
    const codeOnly = stripComments(migrationSrc);
    const oldRefs = [
      '00001', '00002', '00003', '00004', '00005',
      '00006', '00007', '00008', '00009', '00010',
      '00011', '00012', '00013', '00014', '00015',
      '00016', '00017', '00018', '00019', '00020',
      '00021', '00022', '00023', '00024', '00025', '00026',
    ];
    for (const ref of oldRefs) {
      expect(codeOnly).not.toMatch(new RegExp(`Migration\\s+${ref}`));
    }
  });

  it('不 DROP 任何旧 migration 的函数或表', () => {
    expect(migrationSrc).not.toMatch(/DROP\s+(FUNCTION|TABLE|POLICY|TRIGGER)/i);
  });

  it('不 CREATE OR REPLACE 已存在的旧 RPC', () => {
    // 只允许本次新增的三个函数名
    const createOrReplace = migrationSrc.match(/CREATE OR REPLACE FUNCTION public\.(\w+)/g) || [];
    const allowed = [
      'CREATE OR REPLACE FUNCTION public.get_overseas_inventory',
      'CREATE OR REPLACE FUNCTION public.get_overseas_stats',
      'CREATE OR REPLACE FUNCTION public.get_in_transit_confirmed_aggregate',
    ];
    expect(createOrReplace.length).toBe(3);
    for (const c of createOrReplace) {
      expect(allowed).toContain(c);
    }
  });

  // ─── 20. 仓库隔离 ─────────────────────────────────────────────────────

  it('get_overseas_inventory 仓库隔离：admin 全量，operator 仅已分配', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_inventory');
    expect(fn).toMatch(/get_user_role\(\)\s*=\s*'admin'/);
    expect(fn).toMatch(/get_assigned_warehouse_ids\(\)/);
  });

  it('get_overseas_stats 仓库隔离：admin 全量，operator 仅已分配', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_stats');
    expect(fn).toMatch(/get_user_role\(\)\s*=\s*'admin'/);
    expect(fn).toMatch(/get_assigned_warehouse_ids\(\)/);
  });

  it('get_in_transit_confirmed_aggregate 仓库隔离：admin 全量，operator 仅已分配', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_in_transit_confirmed_aggregate');
    expect(fn).toMatch(/get_user_role\(\)\s*=\s*'admin'/);
    expect(fn).toMatch(/get_assigned_warehouse_ids\(\)/);
  });

  // ─── 参数防御 ──────────────────────────────────────────────────────────

  it('get_overseas_inventory — page < 1 归一化', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_inventory');
    expect(fn).toMatch(/p_page\s*<\s*1/);
    expect(fn).toMatch(/p_page\s*:=\s*1/);
  });

  it('get_overseas_inventory — page_size 上限 100', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_inventory');
    expect(fn).toMatch(/p_page_size\s*>\s*100/);
    expect(fn).toMatch(/p_page_size\s*:=\s*100/);
  });

  it('get_overseas_inventory — stock_status 白名单校验', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_inventory');
    expect(fn).toMatch(/p_stock_status\s+NOT\s+IN\s*\(.*out_of_stock.*low.*normal/);
  });

  it('get_overseas_inventory — 不含 p_stock_status = \'zero\'', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_inventory');
    expect(fn).not.toMatch(/'zero'/);
  });

  it('get_overseas_inventory — 含 out_of_stock 筛选条件', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_inventory');
    expect(fn).toMatch(/out_of_stock/);
  });

  it('get_overseas_inventory — low 条件包含 match_status = \'matched\'', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_inventory');
    // low 库存筛选必须要求 variant 已匹配
    expect(fn).toMatch(/p_stock_status\s*=\s*'low'[\s\S]*?match_status\s*=\s*'matched'/);
  });

  it('get_overseas_inventory — normal 条件包含 match_status = \'matched\'', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_inventory');
    // normal 库存筛选必须要求 variant 已匹配
    expect(fn).toMatch(/p_stock_status\s*=\s*'normal'[\s\S]*?match_status\s*=\s*'matched'/);
  });

  it('get_overseas_inventory — p_page COALESCE NULL 防御', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_inventory');
    expect(fn).toMatch(/p_page\s*:=\s*COALESCE\(p_page/);
  });

  it('get_overseas_inventory — p_page_size COALESCE NULL 防御', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_inventory');
    expect(fn).toMatch(/p_page_size\s*:=\s*COALESCE\(p_page_size/);
  });

  it('get_overseas_inventory — p_favorited_only COALESCE NULL 防御', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_inventory');
    expect(fn).toMatch(/p_favorited_only\s*:=\s*COALESCE\(p_favorited_only/);
  });

  it('get_overseas_inventory — 空搜索字符串按 null 处理', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_inventory');
    expect(fn).toMatch(/p_search\s*=\s*''/);
    expect(fn).toMatch(/p_search\s*:=\s*NULL/);
  });

  // ─── 返回结构 ──────────────────────────────────────────────────────────

  it('get_overseas_inventory 返回 jsonb_build_object 含 data 和 total', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_inventory');
    expect(fn).toMatch(/'data'/);
    expect(fn).toMatch(/'total'/);
    expect(fn).toMatch(/jsonb_build_object/);
  });

  it('get_overseas_stats 返回 jsonb_build_object 含 4 个字段', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_overseas_stats');
    expect(fn).toMatch(/'total_skus'/);
    expect(fn).toMatch(/'total_quantity'/);
    expect(fn).toMatch(/'low_stock_count'/);
    expect(fn).toMatch(/'last_sync_at'/);
  });

  it('get_in_transit_confirmed_aggregate 返回 warehouse_id + variant_id + 双数量', () => {
    const fn = extractFunctionBody(migrationSrc, 'get_in_transit_confirmed_aggregate');
    expect(fn).toMatch(/'warehouse_id'/);
    expect(fn).toMatch(/'variant_id'/);
    expect(fn).toMatch(/'in_transit_quantity'/);
    expect(fn).toMatch(/'confirmed_quantity'/);
  });

  // ─── 注释声明 ──────────────────────────────────────────────────────────

  it('注释声明 business rules：quantity 唯一事实来源是 BigSeller', () => {
    expect(migrationSrc).toMatch(/inventory\.quantity.*BigSeller/);
  });

  it('注释声明 不修改已执行 Migration 00001~00026', () => {
    expect(migrationSrc).toMatch(/不修改.*Migration/);
  });

  // ─── 21. 关键 SQL 不在注释行内（防注释吞行） ──────────────────────────
  //
  // 对 migration 按行读取，找到包含关键语句的行后，
  // 断言该行不匹配 ^\s*--（即不是注释行）。
  // 防止可执行 SQL 被 -- 注释吞掉。

  it('IF auth.uid() IS NULL THEN — 三个 RPC 内均为独立可执行行', () => {
    const lines = linesContaining(migrationSrc, /IF auth\.uid\(\) IS NULL THEN/);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) {
      expect(line).not.toMatch(/^\s*--/);
    }
  });

  it('p_page := COALESCE(p_page, 1) — 为独立可执行行', () => {
    const lines = linesContaining(migrationSrc, /p_page\s*:=\s*COALESCE\(p_page/);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const line of lines) {
      expect(line).not.toMatch(/^\s*--/);
    }
  });

  it('REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC — 三条均为独立可执行行', () => {
    const lines = linesContaining(migrationSrc, /REVOKE EXECUTE ON FUNCTION public\.\w+\([^)]*\) FROM PUBLIC/);
    expect(lines.length).toBe(3);
    for (const line of lines) {
      expect(line).not.toMatch(/^\s*--/);
    }
  });

  it('WITH filtered AS — 为独立可执行行', () => {
    const lines = linesContaining(migrationSrc, /WITH\s+filtered\s+AS\s*\(/);
    expect(lines.length).toBe(1);
    for (const line of lines) {
      expect(line).not.toMatch(/^\s*--/);
    }
  });

  it('WITH base AS — 为独立可执行行', () => {
    const lines = linesContaining(migrationSrc, /WITH\s+base\s+AS\s*\(/);
    expect(lines.length).toBe(1);
    for (const line of lines) {
      expect(line).not.toMatch(/^\s*--/);
    }
  });

  it('eligible_shipment AS ( — 为独立可执行行', () => {
    const lines = linesContaining(migrationSrc, /eligible_shipment\s+AS\s*\(/);
    expect(lines.length).toBe(1);
    for (const line of lines) {
      expect(line).not.toMatch(/^\s*--/);
    }
  });

  it('全量扫描：注释行不含可执行 SQL 关键词（防注释吞行）', () => {
    const SQL_KEYWORDS = [
      /IF\s+auth\.uid\(\)\s+IS\s+NULL\s+THEN/,
      /p_page\s*:=\s*COALESCE\(p_page/,
      /REVOKE EXECUTE ON FUNCTION public\.\w+/,
      /GRANT EXECUTE ON FUNCTION public\.\w+/,
      /WITH\s+(filtered|base)\s+AS\s*\(/,
      /eligible_shipment\s+AS\s*\(/,
    ];
    const allLines = migrationSrc.split('\n');
    for (const line of allLines) {
      // 只检查以 -- 开头的注释行
      if (/^\s*--/.test(line)) {
        for (const kw of SQL_KEYWORDS) {
          // 如果注释行包含关键 SQL 模式，说明该 SQL 被注释吞掉了
          if (kw.test(line)) {
            // 允许注释中引用 REVOKE/GRANT 术语进行文档说明，
            // 但不允许完整的函数签名出现在注释行
            // 精确区分：文档提及 vs 被吞掉的 SQL
            const isDocMention =
              /^\s*--\s*(安全|权限|REVOKE|GRANT|业务|规则|不修改)/.test(line);
            if (!isDocMention) {
              expect(line).not.toMatch(kw);
            }
          }
        }
      }
    }
  });
});

// ─── 辅助函数 ────────────────────────────────────────────────────────────

/**
 *  从完整 migration 源码中提取指定函数名的完整定义（含签名与函数体）。
 *  匹配 CREATE OR REPLACE FUNCTION ... 到关闭的 $$;。
 */
function extractFunctionBody(src: string, fnName: string): string {
  const fnRegex = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${fnName}[\\s\\S]*?\\$\\$;`,
    'i'
  );
  const match = src.match(fnRegex);
  return match?.[0] ?? '';
}

/**
 *  返回不含 SQL 注释行（以 -- 开头）的源码。
 *  用于不应匹配注释内容的检查。
 */
function stripComments(src: string): string {
  return src
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

/**
 *  返回包含指定正则模式的所有行。
 *  用于逐行断言关键 SQL 语句不在注释行内。
 */
function linesContaining(src: string, pattern: RegExp): string[] {
  return src.split('\n').filter((line) => pattern.test(line));
}
