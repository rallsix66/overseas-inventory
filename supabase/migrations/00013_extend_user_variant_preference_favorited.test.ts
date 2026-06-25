// P5-SY12: Migration 00013 静态契约测试
//
// 验证:
// - DROP CONSTRAINT IF EXISTS user_variant_preference_preference_type_check
// - ADD CHECK (preference_type IN ('archived', 'favorited'))
// - 'favorited' 允许插入
// - 非法值（'followed'）拒绝
// - 'archived' 仍允许（不退化）
// - UNIQUE (user_id, variant_id, preference_type) 不变
// - RLS 策略不被删除（复用阶段 A 的 4 条策略）
// - 不新建表、不修改已执行 Migration 00001~00012
//
// 纯静态文本检查，不连接 Supabase。

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATION_PATH = path.resolve(
  process.cwd(),
  'supabase/migrations/00013_extend_user_variant_preference_favorited.sql'
);

// ─── 1. DROP CONSTRAINT IF EXISTS ──────────────────────────────────────

describe('P5-SY12 — DROP CONSTRAINT IF EXISTS', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('DROP CONSTRAINT IF EXISTS user_variant_preference_preference_type_check', () => {
    expect(migrationSrc).toMatch(
      /DROP CONSTRAINT IF EXISTS user_variant_preference_preference_type_check/i
    );
  });
});

// ─── 2. ADD CHECK 约束含 'favorited' ────────────────────────────────────

describe('P5-SY12 — ADD CHECK 约束扩展', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('ADD CHECK (preference_type IN (archived, favorited))', () => {
    expect(migrationSrc).toMatch(
      /ADD CONSTRAINT user_variant_preference_preference_type_check/i
    );
    expect(migrationSrc).toMatch(
      /CHECK\s*\(\s*preference_type\s+IN\s*\(\s*'archived'\s*,\s*'favorited'\s*\)\s*\)/i
    );
  });
});

// ─── 3. 'favorited' 允许 — CHECK 约束中包含 'favorited' ─────────────────

describe('P5-SY12 — favorited 允许', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it("CHECK 约束包含 'favorited'", () => {
    const checkMatch = migrationSrc.match(
      /CHECK\s*\([^)]*preference_type\s+IN\s*\(([^)]+)\)/i
    );
    expect(checkMatch).not.toBeNull();
    if (checkMatch) {
      expect(checkMatch[1]).toMatch(/favorited/);
    }
  });
});

// ─── 4. 'archived' 仍允许（不退化）───────────────────────────────────────

describe('P5-SY12 — archived 仍允许', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it("CHECK 约束仍包含 'archived'", () => {
    const checkMatch = migrationSrc.match(
      /CHECK\s*\([^)]*preference_type\s+IN\s*\(([^)]+)\)/i
    );
    expect(checkMatch).not.toBeNull();
    if (checkMatch) {
      expect(checkMatch[1]).toMatch(/archived/);
    }
  });
});

// ─── 5. 非法值拒绝 — 不包含 'followed' / 'starred' 等非法值 ─────────────

describe('P5-SY12 — 非法值拒绝', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it("CHECK 约束不含 'followed'", () => {
    const checkMatch = migrationSrc.match(
      /CHECK\s*\([^)]*preference_type\s+IN\s*\(([^)]+)\)/i
    );
    expect(checkMatch).not.toBeNull();
    if (checkMatch) {
      expect(checkMatch[1]).not.toMatch(/followed/);
    }
  });

  it("CHECK 约束不含 'starred'", () => {
    const checkMatch = migrationSrc.match(
      /CHECK\s*\([^)]*preference_type\s+IN\s*\(([^)]+)\)/i
    );
    expect(checkMatch).not.toBeNull();
    if (checkMatch) {
      expect(checkMatch[1]).not.toMatch(/starred/);
    }
  });
});

// ─── 6. UNIQUE 约束不变 ────────────────────────────────────────────────

describe('P5-SY12 — UNIQUE 约束不变', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('不包含 ALTER TABLE ... DROP CONSTRAINT 修改 UNIQUE', () => {
    // 仅删除 CHECK 约束，不碰 UNIQUE
    expect(migrationSrc).not.toMatch(/DROP CONSTRAINT.*unique/i);
  });

  it('不包含 ALTER TABLE ... ADD UNIQUE', () => {
    expect(migrationSrc).not.toMatch(/ADD\s+(CONSTRAINT\s+)?UNIQUE/i);
  });
});

// ─── 7. RLS 策略不被删除 ───────────────────────────────────────────────

describe('P5-SY12 — RLS 策略不变', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('不包含 DROP POLICY', () => {
    expect(migrationSrc).not.toMatch(/DROP POLICY/i);
  });

  it('不包含 CREATE POLICY', () => {
    expect(migrationSrc).not.toMatch(/CREATE POLICY/i);
  });

  it('不包含 ALTER TABLE ... ENABLE ROW LEVEL SECURITY', () => {
    expect(migrationSrc).not.toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });
});

// ─── 8. 注释声明不新建表 ────────────────────────────────────────────────

describe('P5-SY12 — 注释声明', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('注释声明不新建表', () => {
    expect(migrationSrc).toMatch(/不新建表/);
  });

  it('注释声明复用 user_variant_preference 表', () => {
    expect(migrationSrc).toMatch(/复用.*user_variant_preference/);
  });

  it('注释声明不修改已执行 Migration 00001~00012', () => {
    expect(migrationSrc).toMatch(/不修改已执行 Migration/);
  });

  it('注释声明同步 RPC 不受影响', () => {
    expect(migrationSrc).toMatch(/同步 RPC\s+sync_warehouse_inventory\s+不受影响/i);
  });

  it('注释声明阶段 B 不新增 daily_sales/est_days/lead_time_days', () => {
    expect(migrationSrc).toMatch(/阶段 B 不新增/);
  });
});
