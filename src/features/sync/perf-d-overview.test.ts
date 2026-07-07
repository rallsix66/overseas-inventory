// PERF-D-OVERVIEW: 同步页仓库概览服务端全量聚合测试
//
// 验证:
// - Migration 00032 仅包含 RPC + 权限收口（不包含表结构/RLS 变更）
// - RPC 使用 SECURITY DEFINER + search_path='' + auth.uid() 身份绑定
// - Admin/Operator 仓库隔离逻辑存在
// - MockRepository.getSyncWarehouseOverview() 返回正确结构
// - sync-page-content.tsx 不再有客户端 useMemo warehouseOverview 聚合
// - 客户端组件不直接访问 Supabase
//
// 纯静态文本检查 + Mock 行为测试，不连接 Supabase。

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MockRepository } from './repository';

const MIGRATION_PATH = path.resolve(
  process.cwd(),
  'supabase/migrations/00032_sync_warehouse_overview.sql',
);
const PAGE_CONTENT_PATH = path.resolve(
  process.cwd(),
  'src/app/dashboard/sync/_components/sync-page-content.tsx',
);
const PAGE_PATH = path.resolve(
  process.cwd(),
  'src/app/dashboard/sync/page.tsx',
);

// ─── 静态契约测试: Migration 00032 ────────────────────────────

describe('PERF-D-OVERVIEW — Migration 00032 静态契约', () => {
  let sql: string;

  beforeAll(() => {
    sql = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  describe('仅包含 RPC + 权限收口', () => {
    it('不包含 CREATE TABLE', () => {
      expect(sql).not.toMatch(/CREATE TABLE/i);
    });

    it('不包含 ALTER TABLE', () => {
      expect(sql).not.toMatch(/ALTER TABLE/i);
    });

    it('不包含 CREATE POLICY', () => {
      expect(sql).not.toMatch(/CREATE POLICY/i);
    });

    it('不包含 DROP（函数自身 CREATE OR REPLACE 除外）', () => {
      // 仅允许 DROP 出现在注释中
      const stmtLines = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
      expect(stmtLines).not.toMatch(/\bDROP\b/i);
    });

    it('不包含 RLS 变更', () => {
      const stmtLines = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
      expect(stmtLines).not.toMatch(/ROW LEVEL SECURITY/i);
      expect(stmtLines).not.toMatch(/USING\s*\(/i);
    });
  });

  describe('安全：SECURITY DEFINER + search_path + auth 身份绑定', () => {
    it('RPC 使用 SECURITY DEFINER', () => {
      expect(sql).toMatch(/SECURITY DEFINER/);
    });

    it('RPC 设置 SET search_path = \'\'', () => {
      expect(sql).toMatch(/SET\s+search_path\s*=\s*''/);
    });

    it('检查 auth.uid() IS NOT NULL', () => {
      expect(sql).toMatch(/auth\.uid\(\)\s+IS\s+NULL/);
    });

    it('检查 public.get_user_role()', () => {
      expect(sql).toMatch(/public\.get_user_role\(\)/);
    });

    it('anon 被禁止执行', () => {
      expect(sql).toMatch(/REVOKE\s+EXECUTE.*FROM.*anon/i);
    });

    it('仅 authenticated 可执行', () => {
      expect(sql).toMatch(/GRANT\s+EXECUTE.*TO\s+authenticated/i);
    });
  });

  describe('Admin / Operator 仓库隔离', () => {
    it('包含 v_role 判别分支', () => {
      expect(sql).toMatch(/v_role\s*=\s*'admin'/);
    });

    it('Operator 分支包含 user_warehouses 过滤', () => {
      expect(sql).toMatch(/user_warehouses/);
    });

    it('Operator 分支使用 auth.uid() 过滤用户仓库', () => {
      expect(sql).toMatch(/uw\.user_id\s*=\s*auth\.uid\(\)/);
    });
  });

  describe('文件元数据', () => {
    it('文件名以 00032 开头', () => {
      expect(MIGRATION_PATH).toMatch(/00032/);
    });

    it('文件非空', () => {
      expect(sql.length).toBeGreaterThan(500);
    });

    it('文件以 .sql 结尾', () => {
      expect(MIGRATION_PATH).toMatch(/\.sql$/);
    });
  });
});

// ─── MockRepository 行为测试 ────────────────────────────────

describe('PERF-D-OVERVIEW — MockRepository.getSyncWarehouseOverview', () => {
  it('Admin 返回全部仓库概览', async () => {
    MockRepository._resetAll();
    const repo = new MockRepository('admin');

    // Inject sync_run data for two warehouses
    repo._injectRunDetail('run-1', {
      warehouseId: 'wh-ph',
      mode: 'dry_run',
      status: 'completed',
      startedAt: new Date('2026-07-01T10:00:00Z'),
      finishedAt: new Date('2026-07-01T10:01:00Z'),
    });
    repo._injectRunDetail('run-2', {
      warehouseId: 'wh-ph',
      mode: 'real_write',
      status: 'completed',
      startedAt: new Date('2026-07-01T10:05:00Z'),
      finishedAt: new Date('2026-07-01T10:06:00Z'),
    });
    repo._injectRunDetail('run-3', {
      warehouseId: 'wh-th',
      mode: 'dry_run',
      status: 'failed',
      errorMessage: '网络超时',
      startedAt: new Date('2026-07-02T09:00:00Z'),
    });

    const result = await repo.getSyncWarehouseOverview();
    expect(result).toHaveLength(2);

    // Alphabetical by country (both XX since mock defaults)
    const ph = result.find((r) => r.warehouseId === 'wh-ph')!;
    expect(ph).toBeDefined();
    expect(ph.latestDryRun).not.toBeNull();
    expect(ph.latestDryRun!.status).toBe('completed');
    expect(ph.latestRealWrite).not.toBeNull();
    expect(ph.latestRealWrite!.status).toBe('completed');
    expect(ph.lastSuccessTime).not.toBeNull();

    const th = result.find((r) => r.warehouseId === 'wh-th')!;
    expect(th).toBeDefined();
    expect(th.latestDryRun!.status).toBe('failed');
    expect(th.lastFailureReason).toBe('网络超时');
  });

  it('Operator 看到截断的失败原因', async () => {
    MockRepository._resetAll();
    const repo = new MockRepository('operator');

    repo._injectRunDetail('run-1', {
      warehouseId: 'wh-vn',
      mode: 'dry_run',
      status: 'failed',
      errorMessage: '这是一条非常长的错误消息'.repeat(10),
      startedAt: new Date('2026-07-01T08:00:00Z'),
    });

    const result = await repo.getSyncWarehouseOverview();
    expect(result).toHaveLength(1);
    expect(result[0].lastFailureReason).not.toBeNull();
    expect(result[0].lastFailureReason!).toMatch(/^同步失败：/);
    expect(result[0].lastFailureReason!.length).toBeLessThanOrEqual(60);
  });

  it('空数据返回空数组', async () => {
    MockRepository._resetAll();
    const repo = new MockRepository('admin');
    const result = await repo.getSyncWarehouseOverview();
    expect(result).toEqual([]);
  });
});

// ─── 客户端组件源码检查 ────────────────────────────────────────

describe('PERF-D-OVERVIEW — sync-page-content 源码检查', () => {
  let source: string;

  beforeAll(() => {
    source = fs.readFileSync(PAGE_CONTENT_PATH, 'utf-8');
  });

  it('不再包含客户端 warehouseOverview useMemo 聚合', () => {
    // 不应该有 const warehouseOverview = useMemo(...) 模式
    expect(source).not.toMatch(/const\s+warehouseOverview\s*=\s*useMemo/);
  });

  it('概览数据来自 prop（由 Server Component 传入）', () => {
    // Props 接口应包含 warehouseOverview
    expect(source).toMatch(/warehouseOverview:\s*SyncWarehouseOverviewItem\[\]/);
    // 函数解构应包含 warehouseOverview
    expect(source).toMatch(/warehouseOverview\s*[,}]/);
  });

  it('客户端组件不直接访问 Supabase', () => {
    // use client 组件不应有 supabase.from( 或 createClient( 或 createServiceClient(
    expect(source).not.toMatch(/supabase\.from\(/);
    expect(source).not.toMatch(/createClient\(/);
    expect(source).not.toMatch(/createServiceClient\(/);
  });
});

// ─── Server Component 源码检查 ─────────────────────────────────

describe('PERF-D-OVERVIEW — sync page.tsx 源码检查', () => {
  let source: string;

  beforeAll(() => {
    source = fs.readFileSync(PAGE_PATH, 'utf-8');
  });

  it('在服务端调用 getSyncWarehouseOverview', () => {
    expect(source).toMatch(/getSyncWarehouseOverview/);
  });

  it('通过 Promise.all 与其他查询并行', () => {
    expect(source).toMatch(/Promise\.all\(\[/);
    expect(source).toMatch(/getSyncWarehouseOverview\(\)/);
  });

  it('概览数据作为 prop 传入 SyncPageContent', () => {
    expect(source).toMatch(/warehouseOverview=\{overview\}/);
  });
});
