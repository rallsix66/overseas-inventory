// P5-SY11G-A: Migration 00012 静态契约测试
//
// 验证:
// - user_variant_preference 表创建（IF NOT EXISTS）
// - 列：id uuid PK gen_random_uuid() / user_id uuid FK profiles / variant_id uuid FK product_variant / preference_type text CHECK / created_at timestamptz DEFAULT now()
// - UNIQUE (user_id, variant_id, preference_type)
// - 索引：idx_uvp_user_type / idx_uvp_variant
// - RLS 启用 + 4 条策略（user SELECT/INSERT/DELETE + admin ALL）
// - operator_select_variant 恢复为不含 is_archived = false
// - DDL 幂等性（IF NOT EXISTS / DROP POLICY IF EXISTS）
// - 不修改已执行 Migration 00001~00011
//
// 纯静态文本检查，不连接 Supabase。

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATION_PATH = path.resolve(
  process.cwd(),
  'supabase/migrations/00012_user_variant_preference.sql'
);

// ─── 1. user_variant_preference 表创建 ────────────────────────────────

describe('P5-SY11G-A — user_variant_preference 表', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('CREATE TABLE IF NOT EXISTS user_variant_preference', () => {
    expect(migrationSrc).toMatch(
      /CREATE TABLE IF NOT EXISTS user_variant_preference/i
    );
  });
});

// ─── 2. id 列 ────────────────────────────────────────────────────────

describe('P5-SY11G-A — id 列', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('id uuid PRIMARY KEY DEFAULT gen_random_uuid()', () => {
    expect(migrationSrc).toMatch(
      /id\s+uuid\s+PRIMARY KEY\s+DEFAULT\s+gen_random_uuid\s*\(\s*\)/i
    );
  });
});

// ─── 3. user_id 列 ───────────────────────────────────────────────────

describe('P5-SY11G-A — user_id 列', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('user_id uuid NOT NULL', () => {
    expect(migrationSrc).toMatch(/user_id\s+uuid\s+NOT NULL/i);
  });

  it('user_id FK 指向 profiles(id) ON DELETE CASCADE', () => {
    expect(migrationSrc).toMatch(
      /user_id\s+.*REFERENCES\s+profiles\s*\(\s*id\s*\)\s*ON DELETE CASCADE/i
    );
  });
});

// ─── 4. variant_id 列 ────────────────────────────────────────────────

describe('P5-SY11G-A — variant_id 列', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('variant_id uuid NOT NULL', () => {
    expect(migrationSrc).toMatch(/variant_id\s+uuid\s+NOT NULL/i);
  });

  it('variant_id FK 指向 product_variant(id) ON DELETE CASCADE', () => {
    expect(migrationSrc).toMatch(
      /variant_id\s+.*REFERENCES\s+product_variant\s*\(\s*id\s*\)\s*ON DELETE CASCADE/i
    );
  });
});

// ─── 5. preference_type 列 ───────────────────────────────────────────

describe('P5-SY11G-A — preference_type 列', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('preference_type text NOT NULL', () => {
    expect(migrationSrc).toMatch(/preference_type\s+text\s+NOT NULL/i);
  });

  it('preference_type CHECK 约束仅允许 archived', () => {
    expect(migrationSrc).toMatch(
      /CHECK\s*\(\s*preference_type\s+IN\s*\(\s*'archived'\s*\)\s*\)/i
    );
  });

  it('preference_type 不包含 favorited（预留扩展，本次不实现）', () => {
    // CHECK 约束中不应出现 'favorited'（仅 archived）
    const checkMatch = migrationSrc.match(
      /CHECK\s*\([^)]*preference_type\s+IN\s*\(([^)]+)\)/i
    );
    if (checkMatch) {
      expect(checkMatch[1]).not.toMatch(/favorited/);
    }
  });
});

// ─── 6. created_at 列 ────────────────────────────────────────────────

describe('P5-SY11G-A — created_at 列', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('created_at timestamptz NOT NULL DEFAULT now()', () => {
    expect(migrationSrc).toMatch(
      /created_at\s+timestamptz\s+NOT NULL\s+DEFAULT\s+now\s*\(\s*\)/i
    );
  });
});

// ─── 7. UNIQUE 约束 ──────────────────────────────────────────────────

describe('P5-SY11G-A — UNIQUE 约束', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('UNIQUE (user_id, variant_id, preference_type)', () => {
    expect(migrationSrc).toMatch(
      /UNIQUE\s*\(\s*user_id\s*,\s*variant_id\s*,\s*preference_type\s*\)/i
    );
  });
});

// ─── 8. 索引 ─────────────────────────────────────────────────────────

describe('P5-SY11G-A — 索引', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('idx_uvp_user_type 在 (user_id, preference_type)', () => {
    expect(migrationSrc).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_uvp_user_type/i
    );
    const idxMatch = migrationSrc.match(
      /CREATE INDEX IF NOT EXISTS idx_uvp_user_type[\s\S]*?ON\s+user_variant_preference\s*\(([^)]+)\)/i
    );
    expect(idxMatch).not.toBeNull();
    if (idxMatch) {
      const cols = idxMatch[1].split(',').map((c) => c.trim());
      expect(cols[0]).toBe('user_id');
      expect(cols[1]).toBe('preference_type');
    }
  });

  it('idx_uvp_variant 在 (variant_id, preference_type)', () => {
    expect(migrationSrc).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_uvp_variant/i
    );
    const idxMatch = migrationSrc.match(
      /CREATE INDEX IF NOT EXISTS idx_uvp_variant[\s\S]*?ON\s+user_variant_preference\s*\(([^)]+)\)/i
    );
    expect(idxMatch).not.toBeNull();
    if (idxMatch) {
      const cols = idxMatch[1].split(',').map((c) => c.trim());
      expect(cols[0]).toBe('variant_id');
      expect(cols[1]).toBe('preference_type');
    }
  });
});

// ─── 9. RLS 启用 ─────────────────────────────────────────────────────

describe('P5-SY11G-A — RLS 启用', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('ALTER TABLE user_variant_preference ENABLE ROW LEVEL SECURITY', () => {
    expect(migrationSrc).toMatch(
      /ALTER TABLE user_variant_preference ENABLE ROW LEVEL SECURITY/i
    );
  });
});

// ─── 10. RLS 策略 ────────────────────────────────────────────────────

describe('P5-SY11G-A — RLS 策略', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('user_select_own_preferences — SELECT using auth.uid() = user_id', () => {
    const policyMatch = migrationSrc.match(
      /CREATE POLICY "user_select_own_preferences"[\s\S]*?;/
    );
    expect(policyMatch).not.toBeNull();
    if (policyMatch) {
      expect(policyMatch[0]).toMatch(/auth\.uid\s*\(\s*\)\s*=\s*user_id/);
      expect(policyMatch[0]).toMatch(/FOR SELECT/);
    }
  });

  it('user_insert_own_preferences — INSERT with check auth.uid() = user_id', () => {
    const policyMatch = migrationSrc.match(
      /CREATE POLICY "user_insert_own_preferences"[\s\S]*?;/
    );
    expect(policyMatch).not.toBeNull();
    if (policyMatch) {
      expect(policyMatch[0]).toMatch(/auth\.uid\s*\(\s*\)\s*=\s*user_id/);
      expect(policyMatch[0]).toMatch(/FOR INSERT/);
    }
  });

  it('user_delete_own_preferences — DELETE using auth.uid() = user_id', () => {
    const policyMatch = migrationSrc.match(
      /CREATE POLICY "user_delete_own_preferences"[\s\S]*?;/
    );
    expect(policyMatch).not.toBeNull();
    if (policyMatch) {
      expect(policyMatch[0]).toMatch(/auth\.uid\s*\(\s*\)\s*=\s*user_id/);
      expect(policyMatch[0]).toMatch(/FOR DELETE/);
    }
  });

  it('admin_all_preferences — ALL using get_user_role() = admin', () => {
    const policyMatch = migrationSrc.match(
      /CREATE POLICY "admin_all_preferences"[\s\S]*?;/
    );
    expect(policyMatch).not.toBeNull();
    if (policyMatch) {
      expect(policyMatch[0]).toMatch(/get_user_role\s*\(\s*\)\s*=\s*'admin'/);
      expect(policyMatch[0]).toMatch(/FOR ALL/);
    }
  });

  it('RLS 策略共 4 条（user SELECT + user INSERT + user DELETE + admin ALL）for user_variant_preference', () => {
    const policyMatches = migrationSrc.match(/CREATE POLICY ".*" ON user_variant_preference/g);
    expect(policyMatches).not.toBeNull();
    expect(policyMatches!.length).toBe(4);
  });
});

// ─── 11. operator_select_variant 恢复 ─────────────────────────────────

describe('P5-SY11G-A — operator_select_variant 移除 is_archived 过滤', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('DROP POLICY IF EXISTS "operator_select_variant"', () => {
    expect(migrationSrc).toMatch(
      /DROP POLICY IF EXISTS "operator_select_variant"\s+ON\s+product_variant/i
    );
  });

  it('CREATE POLICY "operator_select_variant" 不含 is_archived = false', () => {
    const createPolicyMatch = migrationSrc.match(
      /CREATE POLICY "operator_select_variant"[\s\S]*?;/
    );
    expect(createPolicyMatch).not.toBeNull();
    if (createPolicyMatch) {
      expect(createPolicyMatch[0]).not.toMatch(/is_archived/);
    }
  });

  it('operator_select_variant 仍要求 get_user_role() = operator', () => {
    const createPolicyMatch = migrationSrc.match(
      /CREATE POLICY "operator_select_variant"[\s\S]*?;/
    );
    expect(createPolicyMatch).not.toBeNull();
    if (createPolicyMatch) {
      expect(createPolicyMatch[0]).toMatch(
        /get_user_role\s*\(\s*\)\s*=\s*'operator'/
      );
    }
  });
});

// ─── 12. 幂等性 ──────────────────────────────────────────────────────

describe('P5-SY11G-A — DDL 幂等性', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('CREATE TABLE 使用 IF NOT EXISTS', () => {
    expect(migrationSrc).toMatch(/CREATE TABLE IF NOT EXISTS/i);
  });

  it('CREATE INDEX 使用 IF NOT EXISTS', () => {
    const createIdxMatches = migrationSrc.match(/CREATE INDEX/g) || [];
    const ifNotExistsIdxMatches = migrationSrc.match(/CREATE INDEX IF NOT EXISTS/gi) || [];
    expect(ifNotExistsIdxMatches.length).toBe(createIdxMatches.length);
  });

  it('DROP POLICY 使用 IF EXISTS', () => {
    expect(migrationSrc).toMatch(/DROP POLICY IF EXISTS/i);
  });
});

// ─── 13. 不修改已执行 Migration ──────────────────────────────────────

describe('P5-SY11G-A — 不修改已执行 Migration', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('注释声明不修改已执行 Migration 00001~00011', () => {
    expect(migrationSrc).toMatch(/不修改已执行 Migration/);
  });

  it('不删除 ProductVariant，不改变模型', () => {
    expect(migrationSrc).toMatch(/不删除 ProductVariant/);
    expect(migrationSrc).toMatch(/Product\s*→\s*ProductVariant\s*→\s*Inventory/);
  });
});

// ─── 14. 同步链路不受影响 ────────────────────────────────────────────

describe('P5-SY11G-A — 同步链路保证', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('注释声明同步 RPC 不受影响', () => {
    expect(migrationSrc).toMatch(/同步 RPC\s+sync_warehouse_inventory\s+不受影响/i);
  });
});

// ─── 15. 预留扩展声明 ────────────────────────────────────────────────

describe('P5-SY11G-A — 预留扩展声明', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('注释声明预留 favorited 扩展', () => {
    expect(migrationSrc).toMatch(/预留.*preference_type.*扩展/i);
  });
});
