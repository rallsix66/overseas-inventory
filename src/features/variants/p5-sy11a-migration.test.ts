// P5-SY11A: Migration 00011 静态契约测试
//
// 验证:
// - is_archived 列存在，类型 boolean，NOT NULL，DEFAULT false
// - archived_at 列存在，类型 timestamptz
// - archived_by 列存在，uuid，FK REFERENCES profiles(id)
// - idx_variant_is_archived 部分索引仅覆盖 is_archived = true 行
// - operator_select_variant RLS 策略包含 is_archived = false
// - admin_all_variant RLS 策略不变（无 is_archived 条件）
// - DDL 幂等（IF NOT EXISTS / DROP POLICY IF EXISTS）
// - 不修改已执行 Migration 00001~00010
//
// 纯静态文本检查，不连接 Supabase。

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATION_PATH = path.resolve(
  process.cwd(),
  'supabase/migrations/00011_add_variant_soft_archive.sql'
);

const MIGRATION_00001_PATH = path.resolve(
  process.cwd(),
  'supabase/migrations/00001_initial_schema.sql'
);

// ─── 1. is_archived 列 ──────────────────────────────────────────────

describe('P5-SY11A — is_archived 列', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('ADD COLUMN IF NOT EXISTS is_archived，类型 boolean，NOT NULL，DEFAULT false', () => {
    expect(migrationSrc).toMatch(
      /ADD COLUMN IF NOT EXISTS is_archived\s+boolean\s+NOT NULL\s+DEFAULT\s+false/i
    );
  });
});

// ─── 2. archived_at 审计列 ─────────────────────────────────────────

describe('P5-SY11A — archived_at 审计列', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('ADD COLUMN IF NOT EXISTS archived_at，类型 timestamptz', () => {
    expect(migrationSrc).toMatch(
      /ADD COLUMN IF NOT EXISTS archived_at\s+timestamptz/i
    );
  });
});

// ─── 3. archived_by 审计列 ─────────────────────────────────────────

describe('P5-SY11A — archived_by 审计列', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('ADD COLUMN IF NOT EXISTS archived_by，类型 uuid', () => {
    expect(migrationSrc).toMatch(
      /ADD COLUMN IF NOT EXISTS archived_by\s+uuid/i
    );
  });

  it('archived_by FK 指向 profiles(id)', () => {
    expect(migrationSrc).toMatch(
      /archived_by\s+uuid\s+REFERENCES\s+profiles\s*\(\s*id\s*\)/i
    );
  });
});

// ─── 4. 部分索引 ───────────────────────────────────────────────────

describe('P5-SY11A — 部分索引 idx_variant_is_archived', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('CREATE INDEX IF NOT EXISTS idx_variant_is_archived', () => {
    expect(migrationSrc).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_variant_is_archived/i
    );
  });

  it('部分索引仅覆盖 is_archived = true', () => {
    expect(migrationSrc).toMatch(
      /WHERE\s+is_archived\s*=\s*true/i
    );
  });

  it('索引建立在 product_variant 表上', () => {
    expect(migrationSrc).toMatch(
      /ON\s+product_variant/i
    );
  });
});

// ─── 5. operator_select_variant RLS 策略 ────────────────────────────

describe('P5-SY11A — operator_select_variant RLS 收紧', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('DROP POLICY IF EXISTS "operator_select_variant"', () => {
    expect(migrationSrc).toMatch(
      /DROP POLICY IF EXISTS "operator_select_variant"/i
    );
  });

  it('CREATE POLICY "operator_select_variant" 包含 is_archived = false', () => {
    // Match from CREATE POLICY to the next semicolon to capture the full USING clause
    const createPolicyMatch = migrationSrc.match(
      /CREATE POLICY "operator_select_variant"[\s\S]*?;/
    );
    expect(createPolicyMatch).not.toBeNull();
    if (createPolicyMatch) {
      expect(createPolicyMatch[0]).toMatch(/is_archived\s*=\s*false/);
    }
  });

  it('operator_select_variant 仍要求 get_user_role() = \'operator\'', () => {
    const createPolicyMatch = migrationSrc.match(
      /CREATE POLICY "operator_select_variant"[\s\S]*?;/
    );
    expect(createPolicyMatch).not.toBeNull();
    if (createPolicyMatch) {
      expect(createPolicyMatch[0]).toMatch(/get_user_role\s*\(\s*\)\s*=\s*'operator'/);
    }
  });
});

// ─── 6. admin_all_variant 策略不变 ──────────────────────────────────

describe('P5-SY11A — admin_all_variant 策略不变', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('Migration 00011 不修改 admin_all_variant（无 DROP/CREATE）', () => {
    // Exclude comment lines — admin_all_variant is only mentioned in comments
    const codeLines = migrationSrc
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    expect(codeLines).not.toMatch(/admin_all_variant/);
  });
});

// ─── 7. Migration 00001 中 admin_all_variant 仍无 is_archived 过滤 ──

describe('P5-SY11A — Migration 00001 admin_all_variant 原始策略', () => {
  let m01Src: string;

  beforeAll(() => {
    m01Src = fs.readFileSync(MIGRATION_00001_PATH, 'utf-8');
  });

  it('admin_all_variant 不含 is_archived 条件（Admin 全权限）', () => {
    const adminPolicyMatch = m01Src.match(
      /CREATE POLICY "admin_all_variant"[\s\S]*?USING\s*\([\s\S]*?\)/
    );
    expect(adminPolicyMatch).not.toBeNull();
    if (adminPolicyMatch) {
      expect(adminPolicyMatch[0]).not.toMatch(/is_archived/);
    }
  });
});

// ─── 8. 幂等性 ─────────────────────────────────────────────────────

describe('P5-SY11A — DDL 幂等性', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('ADD COLUMN 均使用 IF NOT EXISTS', () => {
    const addColumnMatches = migrationSrc.match(/ADD COLUMN/g) || [];
    const ifNotExistsMatches = migrationSrc.match(/ADD COLUMN IF NOT EXISTS/gi) || [];
    expect(ifNotExistsMatches.length).toBe(addColumnMatches.length);
  });

  it('CREATE INDEX 使用 IF NOT EXISTS', () => {
    expect(migrationSrc).toMatch(/CREATE INDEX IF NOT EXISTS/i);
  });

  it('RLS 策略使用 DROP POLICY IF EXISTS 后 CREATE', () => {
    expect(migrationSrc).toMatch(/DROP POLICY IF EXISTS/i);
  });
});

// ─── 9. 不修改已执行 Migration ─────────────────────────────────────

describe('P5-SY11A — 不修改已执行 Migration', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('注释声明不修改已执行 Migration 00001~00010', () => {
    expect(migrationSrc).toMatch(/不修改已执行 Migration/);
  });

  it('不删除 ProductVariant，不改变模型', () => {
    expect(migrationSrc).toMatch(/不删除 ProductVariant/);
    expect(migrationSrc).toMatch(/Product\s*→\s*ProductVariant\s*→\s*Inventory/);
  });
});

// ─── 10. 同步链路不受影响 ──────────────────────────────────────────

describe('P5-SY11A — 同步链路保证', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('注释声明同步 RPC 不受影响', () => {
    expect(migrationSrc).toMatch(/同步 RPC.*不受影响|同步.*INSERT ON CONFLICT/i);
  });
});
