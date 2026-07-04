// P5-SY12: 非回归测试
//
// 验证:
// - 归档功能仍正常（preference_type='archived' 不退化）
// - 关注不影响同步（sync RPC 不变）
// - 关注不影响 inventory 写入
// - 关注不影响别人视图（多用户隔离）
// - variant_follows 表不存在
// - user_variant_preference CHECK 约束已扩展
// - Migration 00014 新增 inventory.daily_sales / estimated_days / warehouse.lead_time_days
// - 不修改已执行 Migration 00012
// - 不读取或输出真实密钥

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATION_0013_PATH = path.resolve(
  process.cwd(),
  'supabase/migrations/00013_extend_user_variant_preference_favorited.sql'
);
const MIGRATION_0012_PATH = path.resolve(
  process.cwd(),
  'supabase/migrations/00012_user_variant_preference.sql'
);

// ─── 归档功能不退化 ────────────────────────────────────────────────────

describe('P5-SY12 — 归档功能不退化', () => {
  it('Migration 00012 未被修改', () => {
    const src = fs.readFileSync(MIGRATION_0012_PATH, 'utf-8');
    // 00012 的 CHECK 约束仍仅限 archived（注释中的"预留 favorited"不算）
    const codeWithoutComments = src.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(codeWithoutComments).toContain("'archived'");
    expect(codeWithoutComments).not.toContain("'favorited'");
  });

  it('variantRepository archive() 仍使用 preference_type=archived', () => {
    const repoPath = path.resolve(process.cwd(), 'src/features/variants/repository.ts');
    const repoSrc = fs.readFileSync(repoPath, 'utf-8');
    expect(repoSrc).toContain("'archived'");
    expect(repoSrc).not.toContain("'favorited'");
  });

  it('inventory repository 归档过滤在 get_low_stock RPC SQL 层完成（LOW-STOCK-PAGINATION）', () => {
    // LOW-STOCK-PAGINATION: 归档过滤已下沉到 Migration 00028 get_low_stock RPC
    const migPath = path.resolve(process.cwd(), 'supabase/migrations/00028_low_stock_rpc.sql');
    const migSrc = fs.readFileSync(migPath, 'utf-8');
    expect(migSrc).toMatch(/preference_type.*archived/);
  });
});

// ─── 不新建 variant_follows 表 ──────────────────────────────────────────

describe('P5-SY12 — 不新建 variant_follows 表', () => {
  it('migration 00013 不包含 CREATE TABLE', () => {
    const src = fs.readFileSync(MIGRATION_0013_PATH, 'utf-8');
    expect(src).not.toMatch(/CREATE TABLE/i);
  });

  it('全项目不含 variant_follows 表定义', () => {
    const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations');
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    for (const f of files) {
      const content = fs.readFileSync(path.join(migrationsDir, f), 'utf-8');
      expect(content).not.toMatch(/variant_follows/);
    }
  });
});

// ─── 不改 sync RPC / Python ────────────────────────────────────────────

describe('P5-SY12 — 不改同步链路', () => {
  it('migration 00013 注释声明同步 RPC 不受影响', () => {
    const src = fs.readFileSync(MIGRATION_0013_PATH, 'utf-8');
    expect(src).toMatch(/sync_warehouse_inventory\s+不受影响/i);
  });

  it('migration 00006 未被修改（sync RPC 不受影响）', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'supabase/migrations/00006_sync_warehouse_inventory.sql'),
      'utf-8'
    );
    // 00006 不含 favorited
    expect(src).not.toContain('favorited');
  });
});

// ─── P5-SY12C: Migration 00014 新增动态告警字段 ────────────────────────────

describe('P5-SY12C — Migration 00014 动态告警字段', () => {
  it('Migration 00014 ADD COLUMN daily_sales on inventory', () => {
    const m14Path = path.resolve(
      process.cwd(),
      'supabase/migrations/00014_dynamic_alert_fields.sql'
    );
    const src = fs.readFileSync(m14Path, 'utf-8');
    expect(src).toMatch(/ALTER TABLE.*inventory[\s\S]*ADD COLUMN[\s\S]*daily_sales/i);
  });

  it('Migration 00014 ADD COLUMN estimated_days on inventory', () => {
    const m14Path = path.resolve(
      process.cwd(),
      'supabase/migrations/00014_dynamic_alert_fields.sql'
    );
    const src = fs.readFileSync(m14Path, 'utf-8');
    expect(src).toMatch(/ALTER TABLE.*inventory[\s\S]*ADD COLUMN[\s\S]*estimated_days/i);
  });

  it('Migration 00014 ADD COLUMN lead_time_days on warehouse', () => {
    const m14Path = path.resolve(
      process.cwd(),
      'supabase/migrations/00014_dynamic_alert_fields.sql'
    );
    const src = fs.readFileSync(m14Path, 'utf-8');
    expect(src).toMatch(/ALTER TABLE.*warehouse[\s\S]*ADD COLUMN[\s\S]*lead_time_days/i);
  });

  it('Migration 00013 不含 ALTER TABLE inventory（阶段 B 不新增字段）', () => {
    const src = fs.readFileSync(MIGRATION_0013_PATH, 'utf-8');
    expect(src).not.toMatch(/ALTER TABLE inventory/i);
  });

  it('Migration 00013 不含 ALTER TABLE warehouse（阶段 B 不新增字段）', () => {
    const src = fs.readFileSync(MIGRATION_0013_PATH, 'utf-8');
    expect(src).not.toMatch(/ALTER TABLE warehouse/i);
  });
});

// ─── 多用户隔离 ──────────────────────────────────────────────────────

describe('P5-SY12 — 多用户隔离', () => {
  it('repository 关注操作基于 userId 参数，不影响他人', () => {
    const repoSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/features/preferences/repository.ts'),
      'utf-8'
    );
    // 所有写操作都必须带 userId
    expect(repoSrc).toMatch(/\.eq\s*\(\s*['"]user_id['"]\s*,\s*userId/);
  });

  it('RLS 策略不被删除或修改（复用 00012 的 4 条策略）', () => {
    const src = fs.readFileSync(MIGRATION_0013_PATH, 'utf-8');
    expect(src).not.toMatch(/DROP POLICY|CREATE POLICY|ENABLE ROW LEVEL SECURITY/);
  });
});

// ─── 不修改已执行 Migration ──────────────────────────────────────────

describe('P5-SY12 — 不修改已执行 Migration', () => {
  it('Migration 00013 注释声明不修改 00001~00012', () => {
    const src = fs.readFileSync(MIGRATION_0013_PATH, 'utf-8');
    expect(src).toMatch(/不修改已执行 Migration/);
  });

  it('Migration 00013 不包含 ALTER TABLE ... DROP COLUMN is_archived', () => {
    const src = fs.readFileSync(MIGRATION_0013_PATH, 'utf-8');
    expect(src).not.toMatch(/DROP COLUMN/i);
  });
});

// ─── 禁止 any ────────────────────────────────────────────────────────

describe('P5-SY12 — 全模块禁止 any', () => {
  const files = [
    'src/features/preferences/types.ts',
    'src/features/preferences/repository.ts',
    'src/features/preferences/actions.ts',
    'src/features/preferences/schema.ts',
  ];

  for (const f of files) {
    it(`${f} 不含 any`, () => {
      const content = fs.readFileSync(path.resolve(process.cwd(), f), 'utf-8');
      expect(content).not.toMatch(/\bany\b/);
    });
  }
});

// ─── 密钥安全 ────────────────────────────────────────────────────────

describe('P5-SY12 — 密钥安全', () => {
  it('新增文件不含 SUPABASE_SERVICE_ROLE_KEY', () => {
    const src = fs.readFileSync(MIGRATION_0013_PATH, 'utf-8');
    expect(src).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|service_role/);
  });

  it('新增文件不含真实密钥值', () => {
    const src = fs.readFileSync(MIGRATION_0013_PATH, 'utf-8');
    expect(src).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
  });
});

// ─── 归档与关注共存 ──────────────────────────────────────────────────

describe('P5-SY12 — 归档与关注共存', () => {
  it('UNIQUE (user_id, variant_id, preference_type) 允许 archived + favorited 共存', () => {
    // 同一用户同一 variant 可以有两行：preference_type='archived' 和 'favorited'
    // UNIQUE 约束按 tuple (user_id, variant_id, preference_type) 成立
    const migration0012 = fs.readFileSync(MIGRATION_0012_PATH, 'utf-8');
    expect(migration0012).toMatch(/UNIQUE\s*\(\s*user_id\s*,\s*variant_id\s*,\s*preference_type\s*\)/i);
  });

  it('关注区显示包含同时 archived 的 favorited 项', () => {
    const repoSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/features/preferences/repository.ts'),
      'utf-8'
    );
    // getFollowedVariantsBasic 不排除 archived
    const fnBody = repoSrc.match(/async getFollowedVariantsBasic\([\s\S]*?^\s{2}\},?\s*$/m);
    expect(fnBody).not.toBeNull();
    if (fnBody) {
      // 不应有 'archived' 过滤
      expect(fnBody[0]).not.toMatch(/preference_type.*archived/);
    }
  });
});
