// Phase E: Migration 00031 静态契约测试（返工修正）
//
// 验证:
// - 仅包含 CREATE INDEX IF NOT EXISTS（不包含表结构/RPC/权限变更）
// - 不包含 CREATE TABLE / ALTER TABLE / CREATE OR REPLACE FUNCTION /
//   CREATE POLICY / DROP / REVOKE / GRANT
// - 7 个索引，名称清晰、可重复审查
// - 每个索引目标表与列组合正确
// - 不修改已执行 Migration 00001~00030
// - 不修改 RLS、权限、RPC 行为
//
// 返工修正：
//   - 删除 idx_inventory_variant_id（00001 UNIQUE 已覆盖 variant_id 前导列）
//   - 删除 idx_sync_run_warehouse_status（00007 部分唯一索引已覆盖）
//   - idx_shipment_status_created → idx_shipment_active_created（部分索引）
//
// 纯静态文本检查，不连接 Supabase。

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATION_PATH = path.resolve(
  process.cwd(),
  'supabase/migrations/00031_phase_e_index_optimization.sql',
);

// ─── 索引预期清单 ──────────────────────────────────────────────

const EXPECTED_INDEXES = [
  {
    name: 'idx_sync_run_warehouse_started',
    table: 'public.sync_run',
    columns: ['warehouse_id', 'started_at'],
    query: 'get_sync_runs_paginated / get_sync_runs / getWarehouseHistory',
  },
  {
    name: 'idx_sync_run_status_lease',
    table: 'public.sync_run',
    columns: ['status', 'lease_expires_at'],
    query: 'cleanup_expired_sync_runs — lease_expires_at 之前无索引',
  },
  {
    name: 'idx_shipment_warehouse_status',
    table: 'public.shipment',
    columns: ['warehouse_id', 'status'],
    query: 'getInTransitDetailsByVariantAndWarehouse / get_in_transit_confirmed_aggregate',
  },
  {
    name: 'idx_shipment_active_created',
    table: 'public.shipment',
    columns: ['created_at'],
    query: 'list() / listEligibleForBatchWarehousing() — 部分索引 WHERE status <> \'warehoused\'',
  },
  {
    name: 'idx_shipment_item_shipment_variant',
    table: 'public.shipment_item',
    columns: ['shipment_id', 'variant_id'],
    query: 'getInTransitDetailsByVariantAndWarehouse / in_transit_agg / confirmed_agg',
  },
  {
    name: 'idx_uvp_variant_user_type',
    table: 'public.user_variant_preference',
    columns: ['variant_id', 'user_id', 'preference_type'],
    query: 'get_overseas_inventory / get_low_stock LEFT JOIN 反连接',
  },
  {
    name: 'idx_tracking_event_shipment_occurred',
    table: 'public.tracking_event',
    columns: ['shipment_id', 'occurred_at'],
    query: 'getById() 轨迹时间线排序',
  },
];

// ─── 测试 ──────────────────────────────────────────────────────

describe('Phase E — Migration 00031 静态契约（返工修正）', () => {
  let sql: string;

  beforeAll(() => {
    sql = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  // ═══════════════════════════════════════════════════════════
  // 分组 1: 仅包含索引变更 — 禁止表结构/RPC/权限变更
  // ═══════════════════════════════════════════════════════════

  describe('仅包含索引变更', () => {
    it('不包含 CREATE TABLE', () => {
      expect(sql).not.toMatch(/CREATE TABLE/i);
    });

    it('不包含 ALTER TABLE', () => {
      expect(sql).not.toMatch(/ALTER TABLE/i);
    });

    it('不包含 CREATE OR REPLACE FUNCTION', () => {
      expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION/i);
    });

    it('不包含 CREATE POLICY', () => {
      expect(sql).not.toMatch(/CREATE POLICY/i);
    });

    it('不包含 DROP', () => {
      expect(sql).not.toMatch(/\bDROP\b/i);
    });

    it('不包含 REVOKE', () => {
      expect(sql).not.toMatch(/REVOKE/i);
    });

    it('不包含 GRANT', () => {
      expect(sql).not.toMatch(/GRANT/i);
    });

    it('不包含 RLS 相关语句', () => {
      const stmtText = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
      expect(stmtText).not.toMatch(/ROW LEVEL SECURITY/i);
      expect(stmtText).not.toMatch(/USING\s*\(/i);
    });

    it('仅包含 CREATE INDEX IF NOT EXISTS', () => {
      // 提取所有 CREATE 语句行（排除注释）
      const creates = sql
        .split('\n')
        .filter((l) => /\bCREATE\b/i.test(l))
        .filter((l) => !/^\s*--/.test(l));
      for (const line of creates) {
        expect(line).toMatch(/CREATE INDEX IF NOT EXISTS/i);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 分组 2: 索引数量与名称
  // ═══════════════════════════════════════════════════════════

  describe('索引数量与命名', () => {
    it('恰好 7 个索引', () => {
      const count = (sql.match(/CREATE INDEX IF NOT EXISTS/gi) || []).length;
      expect(count).toBe(7);
    });

    it.each(EXPECTED_INDEXES.map((idx) => [idx.name]))(
      '索引 %s 存在',
      (name) => {
        expect(sql).toContain(name);
      },
    );

    it('所有索引名称均以 idx_ 开头', () => {
      const matches = sql.match(/CREATE INDEX IF NOT EXISTS (\S+)/gi) || [];
      for (const m of matches) {
        const name = m.replace(/CREATE INDEX IF NOT EXISTS /i, '');
        expect(name).toMatch(/^idx_/);
      }
    });

    it('所有索引名称均包含表名', () => {
      // idx_sync_run_*, idx_shipment_*, idx_shipment_item_*,
      // idx_uvp_* (user_variant_preference), idx_tracking_event_*
      const tableNames = [
        'sync_run',
        'shipment',
        'shipment_item',
        'uvp',
        'tracking_event',
      ];
      const matches = sql.match(/CREATE INDEX IF NOT EXISTS (\S+)/gi) || [];
      for (const m of matches) {
        const name = m.replace(/CREATE INDEX IF NOT EXISTS /i, '');
        const matchesTable = tableNames.some((t) => name.includes(t));
        expect(matchesTable).toBe(true);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 分组 3: 每个索引的目标表与列组合
  // ═══════════════════════════════════════════════════════════

  describe('索引目标表与列', () => {
    it.each(EXPECTED_INDEXES.map((idx) => [idx.name, idx.table, idx.columns]))(
      '%s 在 %s 上且列包含 %s',
      (name, table, columns) => {
        // 查找索引定义（支持跨行：名称一行，ON/WHERE 子句后续行）
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // 匹配 CREATE INDEX IF NOT EXISTS <name> 之后的 ON <table>(<cols>) 部分
        const re = new RegExp(
          `CREATE INDEX IF NOT EXISTS ${escapedName}\\s+ON\\s+([^(]+)\\(([^)]+)\\)`,
          'i',
        );
        const match = sql.match(re);
        expect(match).not.toBeNull();

        const actualTable = match![1].trim();
        const actualCols = match![2].trim();

        expect(actualTable).toBe(table);

        // 每列均应出现
        for (const col of columns as string[]) {
          expect(actualCols).toContain(col);
        }
      },
    );
  });

  // ═══════════════════════════════════════════════════════════
  // 分组 4: 不破坏现有 schema
  // ═══════════════════════════════════════════════════════════

  describe('不破坏现有 schema', () => {
    it('不引用不存在的表', () => {
      // 仅检查非注释行，注释中可能引用表名缩写（如 ON sync_run(...) 不带 public.）
      const stmtText = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
      const knownTables = [
        'public.sync_run',
        'public.sync_log',
        'public.shipment',
        'public.shipment_item',
        'public.tracking_event',
        'public.inventory',
        'public.product_variant',
        'public.product',
        'public.warehouse',
        'public.profiles',
        'public.role',
        'public.user_variant_preference',
        'public.user_warehouses',
        'public.sync_warehouse_lock',
        'public.shipment_external_ref',
        'public.shipment_external_item',
        'public.tracking_event_external',
      ];
      const onMatches = stmtText.match(/ON\s+(\S+)\s*\(/gi) || [];
      for (const m of onMatches) {
        const table = m.replace(/ON\s+/i, '').replace(/\s*\($/, '').trim();
        expect(knownTables).toContain(table);
      }
    });

    it('不修改 product_variant 模型', () => {
      // 仅检查非注释行中的 SQL 语句
      const stmtLines = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
      expect(stmtLines).not.toMatch(/product_variant/i);
    });

    it('不涉及 inventory 表（00001 UNIQUE 已覆盖 variant_id 前导列查询）', () => {
      // 返工修正：idx_inventory_variant_id 已删除，00031 不再触及 inventory
      const stmtText = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
      expect(stmtText).not.toMatch(/public\.inventory/i);
    });

    it('不修改 Product → ProductVariant → Inventory 关系', () => {
      expect(sql).not.toMatch(/FOREIGN KEY/i);
      expect(sql).not.toMatch(/REFERENCES/i);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 分组 5: 幂等性
  // ═══════════════════════════════════════════════════════════

  describe('幂等性', () => {
    it('所有 CREATE INDEX 均使用 IF NOT EXISTS', () => {
      const creates = sql.match(/CREATE INDEX/gi) || [];
      const ifNotExists = sql.match(/CREATE INDEX IF NOT EXISTS/gi) || [];
      expect(ifNotExists.length).toBe(creates.length);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 分组 6: 文件元数据
  // ═══════════════════════════════════════════════════════════

  describe('文件元数据', () => {
    it('文件名以 00031 开头', () => {
      expect(MIGRATION_PATH).toMatch(/00031/);
    });

    it('文件名包含 phase_e', () => {
      expect(MIGRATION_PATH).toMatch(/phase_e/);
    });

    it('文件非空', () => {
      expect(sql.length).toBeGreaterThan(500);
    });

    it('文件以 sql 扩展名结尾', () => {
      expect(MIGRATION_PATH).toMatch(/\.sql$/);
    });
  });
});
