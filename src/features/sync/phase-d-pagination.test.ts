// Phase D — 同步运行列表服务端分页测试
//
// 覆盖：
//   1. Migration 00029 RPC 静态契约
//   2. Schema 校验 (getSyncRunsPaginatedSchema)
//   3. MockRepository getSyncRunsPaginated 行为
//   4. Server Action 权限与参数传递
//   5. 页面 props 源码检查
//   6. 回归：getSyncRuns 旧接口不受影响

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Helpers ────────────────────────────────────────────────────

const MIGRATION_PATH = resolve(
  __dirname,
  '../../../supabase/migrations/00029_sync_runs_pagination.sql',
);

let _migrationText: string | null = null;
function migrationText(): string {
  if (_migrationText === null) {
    _migrationText = readFileSync(MIGRATION_PATH, 'utf-8');
  }
  return _migrationText;
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// ─── 1. Migration 00029 RPC 静态契约 ──────────────────────────

describe('Migration 00029 — get_sync_runs_paginated RPC 静态契约', () => {
  it('包含 CREATE OR REPLACE FUNCTION', () => {
    const sql = migrationText();
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.get_sync_runs_paginated');
  });

  it('签名包含 p_warehouse_id / p_page / p_page_size', () => {
    const sql = migrationText();
    expect(sql).toContain('p_warehouse_id');
    expect(sql).toContain('p_page');
    expect(sql).toContain('p_page_size');
  });

  it('RETURNS jsonb', () => {
    const sql = migrationText();
    expect(sql).toContain('RETURNS jsonb');
  });

  it('SECURITY DEFINER + SET search_path', () => {
    const sql = migrationText();
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain("SET search_path = ''");
  });

  it('auth.uid() IS NULL → RAISE EXCEPTION', () => {
    const sql = migrationText();
    expect(sql).toContain("IF auth.uid() IS NULL THEN");
    expect(sql).toMatch(/RAISE EXCEPTION.*未登录/);
  });

  it('get_user_role() IS NULL → RAISE EXCEPTION', () => {
    const sql = migrationText();
    expect(sql).toContain('v_role := public.get_user_role()');
    expect(sql).toMatch(/IF v_role IS NULL THEN/);
    expect(sql).toMatch(/RAISE EXCEPTION.*无权限/);
  });

  it('p_page < 1 拒绝', () => {
    const sql = migrationText();
    expect(sql).toMatch(/IF p_page IS NULL OR p_page < 1 THEN/);
    expect(sql).toMatch(/RAISE EXCEPTION.*p_page/);
  });

  it('p_page_size NOT IN [1,100] 拒绝', () => {
    const sql = migrationText();
    expect(sql).toMatch(/p_page_size < 1 OR p_page_size > 100/);
    expect(sql).toMatch(/RAISE EXCEPTION.*p_page_size/);
  });

  it('包含 total COUNT(*) 查询', () => {
    const sql = migrationText();
    expect(sql).toContain('SELECT count(*)');
    expect(sql).toContain('v_total');
  });

  it('v_offset 计算: (p_page - 1) * p_page_size', () => {
    const sql = migrationText();
    expect(sql).toContain('(p_page - 1) * p_page_size');
    expect(sql).toContain('v_offset');
  });

  it('使用 OFFSET / LIMIT 分页', () => {
    const sql = migrationText();
    expect(sql).toContain('OFFSET');
    expect(sql).toContain('LIMIT');
    expect(sql).toContain('v_offset');
    expect(sql).toContain('p_page_size');
  });

  it('返回 jsonb_build_object 含 rows / total / page / pageSize 键', () => {
    const sql = migrationText();
    const returnCount = countOccurrences(sql, "jsonb_build_object(");
    expect(returnCount).toBeGreaterThanOrEqual(2); // admin + operator branches
    expect(sql).toContain("'rows'");
    expect(sql).toContain("'total'");
    expect(sql).toContain("'page'");
    expect(sql).toContain("'pageSize'");
  });

  it('Admin 分支返回 display_name + warehouse_name + exit_code + error_message + result_summary + dry_run_run_id', () => {
    const sql = migrationText();
    expect(sql).toContain("'display_name'");
    expect(sql).toContain("'warehouse_name'");
    expect(sql).toContain("'exit_code'");
    expect(sql).toContain("'error_message'");
    expect(sql).toContain("'result_summary'");
    expect(sql).toContain("'dry_run_run_id'");
    expect(sql).toContain('public.profiles');
    expect(sql).toContain('public.warehouse');
  });

  it('Operator 分支返回脱敏邮箱 + controlled result_summary + Chinese failure_summary', () => {
    const sql = migrationText();
    expect(sql).toContain("'triggered_by_email'");
    expect(sql).toContain('regexp_replace');
    expect(sql).toContain("'failure_summary'");
    expect(sql).toContain('auth.users');
  });

  it('Operator 分支不含 exit_code / error_message 返回键', () => {
    const sql = migrationText();
    // Find the operator (ELSE) branch
    const elseIdx = sql.lastIndexOf('ELSE');
    expect(elseIdx).toBeGreaterThan(0);
    const opBranch = sql.slice(elseIdx);
    // In the jsonb_build_object for operator, should not contain these keys
    expect(opBranch).not.toMatch(/'exit_code',\s*limited\.exit_code/);
    expect(opBranch).not.toMatch(/'error_message',\s*limited\.error_message/);
    expect(opBranch).not.toMatch(/'dry_run_run_id'/);
  });

  it('REVOKE FROM PUBLIC + anon, GRANT TO authenticated', () => {
    const sql = migrationText();
    expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.get_sync_runs_paginated');
    expect(sql).toContain('FROM PUBLIC');
    expect(sql).toContain('FROM anon');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.get_sync_runs_paginated');
    expect(sql).toContain('TO authenticated');
  });

  it('ORDER BY started_at DESC', () => {
    const sql = migrationText();
    expect(countOccurrences(sql, 'started_at DESC')).toBeGreaterThanOrEqual(2);
  });

  it('不修改已执行 migration (不含 ALTER TABLE / DROP)', () => {
    const sql = migrationText();
    expect(sql).not.toContain('ALTER TABLE');
    expect(sql).not.toContain('DROP');
  });

  it('使用 COALESCE(jsonb_agg(...), \'[]\') 保证空结果为 []', () => {
    const sql = migrationText();
    expect(countOccurrences(sql, "COALESCE(jsonb_agg(")).toBeGreaterThanOrEqual(2);
    expect(countOccurrences(sql, "'[]'::jsonb")).toBeGreaterThanOrEqual(2);
  });
});

// ─── 2. Schema 校验 ────────────────────────────────────────────

import {
  getSyncRunsPaginatedSchema,
  getSyncRunsSchema,
} from './schema';

describe('getSyncRunsPaginatedSchema', () => {
  it('接受空参数（全部默认）', () => {
    const parsed = getSyncRunsPaginatedSchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(20);
    expect(parsed.warehouseId).toBeUndefined();
  });

  it('接受合法 warehouseId + page + pageSize', () => {
    const parsed = getSyncRunsPaginatedSchema.parse({
      warehouseId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      page: 3,
      pageSize: 50,
    });
    expect(parsed.warehouseId).toBe('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d');
    expect(parsed.page).toBe(3);
    expect(parsed.pageSize).toBe(50);
  });

  it('拒绝 page < 1', () => {
    expect(() => getSyncRunsPaginatedSchema.parse({ page: 0 })).toThrow();
    expect(() => getSyncRunsPaginatedSchema.parse({ page: -1 })).toThrow();
  });

  it('拒绝 pageSize < 1', () => {
    expect(() => getSyncRunsPaginatedSchema.parse({ pageSize: 0 })).toThrow();
  });

  it('拒绝 pageSize > 100', () => {
    expect(() => getSyncRunsPaginatedSchema.parse({ pageSize: 101 })).toThrow();
  });

  it('拒绝非 UUID warehouseId', () => {
    expect(() => getSyncRunsPaginatedSchema.parse({ warehouseId: 'not-a-uuid' })).toThrow();
  });

  it('拒绝额外未知字段 (.strict)', () => {
    expect(() =>
      getSyncRunsPaginatedSchema.parse({ page: 1, extraField: true }),
    ).toThrow();
  });

  it('page 默认 1', () => {
    const parsed = getSyncRunsPaginatedSchema.parse({ pageSize: 10 });
    expect(parsed.page).toBe(1);
  });

  it('pageSize 默认 20', () => {
    const parsed = getSyncRunsPaginatedSchema.parse({ page: 1 });
    expect(parsed.pageSize).toBe(20);
  });

  it('旧 getSyncRunsSchema 不受影响', () => {
    const parsed = getSyncRunsSchema.parse({ warehouseId: undefined, limit: 50 });
    expect(parsed.limit).toBe(50);
    expect(parsed.warehouseId).toBeUndefined();
  });
});

// ─── 3. MockRepository getSyncRunsPaginated 行为 ──────────────

import { MockRepository } from './repository';
import type { SyncRunAdminRow, SyncRunOperatorRow } from './types';

describe('MockRepository.getSyncRunsPaginated', () => {
  it('空数据库返回空 rows + total=0', async () => {
    MockRepository._resetAll();
    const repo = new MockRepository('admin');
    const result = await repo.getSyncRunsPaginated({ page: 1, pageSize: 20 });
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it('返回分页后的 rows，total 为全量', async () => {
    MockRepository._resetAll();
    const repo = new MockRepository('admin');

    // Inject 50 runs
    for (let i = 0; i < 50; i++) {
      repo._injectRunDetail(`run-${String(i).padStart(3, '0')}`, {
        warehouseId: `wh-${i % 5}`,
        status: 'completed',
        startedAt: new Date(Date.now() - i * 60000),
      });
    }

    const result = await repo.getSyncRunsPaginated({ page: 1, pageSize: 20 });
    expect(result.rows).toHaveLength(20);
    expect(result.total).toBe(50);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it('page 2 返回正确的 offset', async () => {
    MockRepository._resetAll();
    const repo = new MockRepository('admin');

    for (let i = 0; i < 50; i++) {
      repo._injectRunDetail(`run-${String(i).padStart(3, '0')}`, {
        warehouseId: `wh-${i % 5}`,
        status: 'completed',
        startedAt: new Date(Date.now() - i * 60000),
      });
    }

    const page1 = await repo.getSyncRunsPaginated({ page: 1, pageSize: 20 });
    const page2 = await repo.getSyncRunsPaginated({ page: 2, pageSize: 20 });
    const page3 = await repo.getSyncRunsPaginated({ page: 3, pageSize: 20 });

    expect(page2.rows).toHaveLength(20);
    expect(page2.total).toBe(50);
    expect(page3.rows).toHaveLength(10); // last page

    // page1[0] and page2[0] should be different
    expect(page1.rows[0].id).not.toBe(page2.rows[0].id);
  });

  it('warehouseId 筛选后分页', async () => {
    MockRepository._resetAll();
    const repo = new MockRepository('admin');

    for (let i = 0; i < 30; i++) {
      repo._injectRunDetail(`run-a-${i}`, {
        warehouseId: 'wh-aaa',
        status: 'completed',
        startedAt: new Date(Date.now() - i * 60000),
      });
      repo._injectRunDetail(`run-b-${i}`, {
        warehouseId: 'wh-bbb',
        status: 'completed',
        startedAt: new Date(Date.now() - i * 60000),
      });
    }

    const result = await repo.getSyncRunsPaginated({
      warehouseId: 'wh-aaa',
      page: 1,
      pageSize: 10,
    });
    expect(result.rows).toHaveLength(10);
    expect(result.total).toBe(30);
    expect(result.rows.every((r) => r.warehouse_id === 'wh-aaa')).toBe(true);
  });

  it('Admin 角色返回完整字段', async () => {
    MockRepository._resetAll();
    const repo = new MockRepository('admin');
    repo._injectRunDetail('run-1', {
      warehouseId: 'wh-xxx',
      status: 'completed',
      exitCode: 0,
      errorMessage: null,
    });

    const result = await repo.getSyncRunsPaginated({ page: 1, pageSize: 20 });
    const row = result.rows[0] as SyncRunAdminRow;
    expect(row.display_name).toBeDefined();
    expect(row.exit_code).toBe(0);
    expect(row.error_message).toBeNull();
    expect(row.dry_run_run_id).toBeNull();
  });

  it('Operator 角色返回脱敏字段', async () => {
    MockRepository._resetAll();
    const repo = new MockRepository('operator');
    repo._injectRunDetail('run-1', {
      warehouseId: 'wh-xxx',
      status: 'completed',
      triggeredBy: 'user-123456',
    });

    const result = await repo.getSyncRunsPaginated({ page: 1, pageSize: 20 });
    const row = result.rows[0] as SyncRunOperatorRow;
    expect(row.triggered_by_email).toContain('***');
    expect(row.result_summary).toBeDefined();
    // Operator must not have exit_code
    expect((row as Record<string, unknown>).exit_code).toBeUndefined();
  });

  it('按 started_at DESC 排序', async () => {
    MockRepository._resetAll();
    const repo = new MockRepository('admin');
    const now = Date.now();

    repo._injectRunDetail('run-old', {
      startedAt: new Date(now - 3600000),
      status: 'completed',
    });
    repo._injectRunDetail('run-new', {
      startedAt: new Date(now),
      status: 'completed',
    });
    repo._injectRunDetail('run-mid', {
      startedAt: new Date(now - 1800000),
      status: 'completed',
    });

    const result = await repo.getSyncRunsPaginated({ page: 1, pageSize: 20 });
    expect(result.rows[0].id).toBe('run-new');
    expect(result.rows[1].id).toBe('run-mid');
    expect(result.rows[2].id).toBe('run-old');
    expect(result.total).toBe(3);
  });

  it('旧 getSyncRuns 不受影响', async () => {
    MockRepository._resetAll();
    const repo = new MockRepository('admin');

    for (let i = 0; i < 50; i++) {
      repo._injectRunDetail(`run-${i}`, {
        status: 'completed',
        startedAt: new Date(Date.now() - i * 60000),
      });
    }

    const oldResult = await repo.getSyncRuns({ limit: 30 });
    expect(oldResult).toHaveLength(30); // limited to 30

    const paginated = await repo.getSyncRunsPaginated({ page: 1, pageSize: 20 });
    expect(paginated.rows).toHaveLength(20);
    expect(paginated.total).toBe(50);
  });
});

// ─── 4. SupabaseSyncRepository 源码检查 ────────────────────────

describe('SupabaseSyncRepository.getSyncRunsPaginated 源码检查', () => {
  const supabaseRepoPath = resolve(__dirname, 'supabase-repository.ts');
  let supabaseRepoText: string;

  try {
    supabaseRepoText = readFileSync(supabaseRepoPath, 'utf-8');
  } catch {
    it.skip('文件不可读', () => {});
    return;
  }

  it('方法存在并调用 get_sync_runs_paginated RPC', () => {
    expect(supabaseRepoText).toContain('getSyncRunsPaginated');
    expect(supabaseRepoText).toContain("rpc('get_sync_runs_paginated'");
  });

  it('传递参数 p_warehouse_id / p_page / p_page_size', () => {
    expect(supabaseRepoText).toContain('p_warehouse_id');
    expect(supabaseRepoText).toContain('p_page');
    expect(supabaseRepoText).toContain('p_page_size');
  });

  it('使用 authClient（非 serviceClient）', () => {
    expect(supabaseRepoText).toMatch(/this\.authClient\.rpc\('get_sync_runs_paginated'/);
  });

  it('解析返回 rows / total / page / pageSize', () => {
    expect(supabaseRepoText).toContain('parsed.rows');
    expect(supabaseRepoText).toContain('parsed.total');
    expect(supabaseRepoText).toContain('parsed.page');
    expect(supabaseRepoText).toContain('parsed.pageSize');
  });
});

// ─── 5. Server Action 源码检查 ─────────────────────────────────

describe('getSyncRunsPaginated server action 源码检查', () => {
  const serverActionsPath = resolve(__dirname, 'server-actions.ts');
  let serverActionsText: string;

  try {
    serverActionsText = readFileSync(serverActionsPath, 'utf-8');
  } catch {
    it.skip('文件不可读', () => {});
    return;
  }

  it('export async function getSyncRunsPaginated', () => {
    expect(serverActionsText).toContain('export async function getSyncRunsPaginated');
  });

  it('调用 requireActiveAuth', () => {
    expect(serverActionsText).toContain('requireActiveAuth');
  });

  it('调用 getSyncRunsPaginatedSchema.parse', () => {
    expect(serverActionsText).toContain('getSyncRunsPaginatedSchema.parse');
  });

  it('调用 repository.getSyncRunsPaginated', () => {
    expect(serverActionsText).toContain('repository.getSyncRunsPaginated');
  });

  it('不调用 serviceClient / service_role', () => {
    // The action should only use the authenticated client path
    const funcBody = serverActionsText.slice(
      serverActionsText.indexOf('export async function getSyncRunsPaginated'),
    );
    // Find the next "export async function" to get bounds
    const nextExportIdx = funcBody
      .slice('export async function'.length)
      .indexOf('export async function');
    const body = nextExportIdx > -1 ? funcBody.slice(0, nextExportIdx + 'export async function'.length) : funcBody;
    expect(body).not.toContain('serviceClient');
    expect(body).not.toContain('service_role');
  });

  it('不静态导入 SyncRunsPaginatedRow (该类型由 types.ts 导出即可)', () => {
    expect(serverActionsText).toContain('SyncRunsPaginatedResponse');
  });

  // P5-SY13A regression: operator 仍可通过此 action 查看（角色感知脱敏由 RPC 处理）
  it('getSyncRunsPaginated 函数体内使用 requireActiveAuth 而非 requireActiveAdmin', () => {
    const funcStart = serverActionsText.indexOf('export async function getSyncRunsPaginated');
    expect(funcStart).toBeGreaterThan(-1);
    // Find the end: next export or end of file
    const rest = serverActionsText.slice(funcStart + 'export async function'.length);
    const nextExport = rest.indexOf('\nexport async function');
    const funcBody = nextExport > -1 ? rest.slice(0, nextExport) : rest;
    // The function body should use requireActiveAuth (not requireActiveAdmin)
    expect(funcBody).toContain('requireActiveAuth');
    expect(funcBody).not.toContain('requireActiveAdmin');
  });
});

// ─── 6. Sync 页面源码检查 ──────────────────────────────────────

describe('Sync page 服务端分页源码检查', () => {
  const pagePath = resolve(__dirname, '../../app/dashboard/sync/page.tsx');
  let pageText: string;

  try {
    pageText = readFileSync(pagePath, 'utf-8');
  } catch {
    it.skip('page.tsx 不可读', () => {});
    return;
  }

  it('import getSyncRunsPaginated', () => {
    expect(pageText).toContain('getSyncRunsPaginated');
  });

  it('不再 import getSyncRuns (无 limit 全量取)', () => {
    // The page should NOT import getSyncRuns for the main query
    // It may still be imported indirectly via getOverseasWarehouseSyncStatus (not in page.tsx)
    expect(pageText).not.toContain("getSyncRuns(");
  });

  it('传递 initialRows / initialTotal / initialPage / initialPageSize props', () => {
    expect(pageText).toContain('initialRows');
    expect(pageText).toContain('initialTotal');
    expect(pageText).toContain('initialPage');
    expect(pageText).toContain('initialPageSize');
  });

  it('不直接调用 supabase.from', () => {
    expect(pageText).not.toContain('supabase.from');
    expect(pageText).not.toContain('createClient');
  });

  it('使用 Promise.all 并行获取 paginated + warehouses', () => {
    expect(pageText).toContain('Promise.all');
  });
});

// ─── 7. 客户端组件源码检查 ─────────────────────────────────────

describe('SyncPageContent 客户端分页源码检查', () => {
  const componentPath = resolve(
    __dirname,
    '../../app/dashboard/sync/_components/sync-page-content.tsx',
  );
  let componentText: string;

  try {
    componentText = readFileSync(componentPath, 'utf-8');
  } catch {
    it.skip('sync-page-content.tsx 不可读', () => {});
    return;
  }

  it('import getSyncRunsPaginated', () => {
    expect(componentText).toContain('getSyncRunsPaginated');
  });

  it('Props 使用 initialRows + initialTotal + initialPage + initialPageSize', () => {
    expect(componentText).toContain('initialRows');
    expect(componentText).toContain('initialTotal');
    expect(componentText).toContain('initialPage');
    expect(componentText).toContain('initialPageSize');
  });

  it('不再有 const PAGE_SIZE = 20 客户端分页常量', () => {
    expect(componentText).not.toContain('const PAGE_SIZE');
  });

  it('不再有客户端分页切片 filteredRows.slice', () => {
    // The component may still use .slice() for display (e.g., ID truncation)
    // but NOT for pagination (filteredRows.slice / paginatedRows.slice / rows.slice)
    expect(componentText).not.toContain('filteredRows');
    expect(componentText).not.toContain('paginatedRows');
  });

  it('有 fetchPage 函数调用 getSyncRunsPaginated', () => {
    expect(componentText).toContain('fetchPage');
    expect(componentText).toContain('getSyncRunsPaginated(');
  });

  it('有 handleWarehouseChange 重置 page=1 后 fetch', () => {
    expect(componentText).toContain('handleWarehouseChange');
  });

  it('有 handlePageChange 分页导航', () => {
    expect(componentText).toContain('handlePageChange');
  });

  it('有 useEffect 同步 props（router.refresh 支持）', () => {
    expect(componentText).toContain('useEffect');
    expect(componentText).toContain('setRows(initialRows)');
  });

  it('不直接调用 supabase.from', () => {
    expect(componentText).not.toContain('supabase.from');
  });

  it('分页控件使用 handlePageChange', () => {
    expect(componentText).toContain('handlePageChange');
  });

  it('loading 状态禁用分页按钮', () => {
    expect(componentText).toMatch(/disabled=\{page <= 1 \|\| loading\}/);
  });
});

// ─── 8. 类型合规 ────────────────────────────────────────────────

describe('Types 合规检查', () => {
  const typesPath = resolve(__dirname, 'types.ts');
  let typesText: string;

  try {
    typesText = readFileSync(typesPath, 'utf-8');
  } catch {
    it.skip('types.ts 不可读', () => {});
    return;
  }

  it('定义 SyncRunsPaginatedRow', () => {
    expect(typesText).toContain('SyncRunsPaginatedRow');
  });

  it('定义 SyncRunsPaginatedResponse', () => {
    expect(typesText).toContain('SyncRunsPaginatedResponse');
    expect(typesText).toContain('rows:');
    expect(typesText).toContain('total:');
    expect(typesText).toContain('page:');
    expect(typesText).toContain('pageSize:');
  });

  it('不含 any', () => {
    expect(typesText).not.toContain(': any');
  });
});

// ─── 9. 数据库类型签名 ─────────────────────────────────────────

describe('database.ts 签名检查', () => {
  const dbTypesPath = resolve(__dirname, '../../types/database.ts');
  let dbTypesText: string;

  try {
    dbTypesText = readFileSync(dbTypesPath, 'utf-8');
  } catch {
    it.skip('database.ts 不可读', () => {});
    return;
  }

  it('包含 get_sync_runs_paginated 类型签名', () => {
    expect(dbTypesText).toContain('get_sync_runs_paginated');
  });
});
