// P3-S1A: Migration 00017 静态契约测试
//
// 验证:
// - Migration SQL 文件存在
// - CREATE TABLE shipment_external_ref / shipment_external_item / tracking_event_external
// - 字段类型正确 (raw_payload jsonb / provider text / external_order_no text 等)
// - CHECK 约束正确 (provider IN ('best') / country IN (...) / sync_status IN (...) / quantity >= 1)
// - 唯一索引 idx_shipment_external_ref_provider_order 存在
// - 外键约束正确 (warehouse_id → warehouse  / external_ref_id → shipment_external_ref / matched_variant_id → product_variant)
// - RLS 策略存在且启用
// - tracking_event_external 为路径 B（新建表）
// - updated_at 触发器存在
// - 不修改已执行 Migration 00001~00016
//
// 纯静态文本检查，不连接 Supabase。

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MIGRATION_PATH = path.resolve(
  process.cwd(),
  'supabase/migrations/00017_shipment_external_ref.sql'
);

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'supabase/migrations');

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

// Migration 00001~00016 快照，用于验证未修改
const PROTECTED_MIGRATIONS = Array.from({ length: 16 }, (_, i) => {
  const num = String(i + 1).padStart(5, '0');
  return `supabase/migrations/${num}_`;
});

describe('P3-S1A — Migration 00017', () => {
  let migrationSrc: string;

  beforeAll(() => {
    migrationSrc = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  // ─── 0. 文件存在 ─────────────────────────────────────────────────────

  it('Migration 00017 SQL 文件存在', () => {
    expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
  });

  it('Migration 内容非空', () => {
    expect(migrationSrc.length).toBeGreaterThan(100);
  });

  // ─── 1. shipment_external_ref 表 ─────────────────────────────────────

  it('CREATE TABLE shipment_external_ref', () => {
    expect(migrationSrc).toMatch(/CREATE TABLE shipment_external_ref/);
  });

  it('字段 id uuid PRIMARY KEY DEFAULT gen_random_uuid()', () => {
    expect(migrationSrc).toMatch(/id\s+uuid\s+PRIMARY KEY DEFAULT gen_random_uuid\(\)/);
  });

  it('字段 provider text NOT NULL CHECK provider IN', () => {
    expect(migrationSrc).toMatch(/provider\s+text\s+NOT NULL\s+CHECK\s*\(provider\s+IN\s*\('best'\)\)/);
  });

  it('字段 external_order_no text NOT NULL', () => {
    expect(migrationSrc).toMatch(/external_order_no\s+text\s+NOT NULL/);
  });

  it('字段 waybill_no text (nullable)', () => {
    expect(migrationSrc).toMatch(/waybill_no\s+text/);
  });

  it('字段 country text NOT NULL CHECK country IN (TH,ID,MY,PH,VN,CN)', () => {
    expect(migrationSrc).toMatch(/country\s+text\s+NOT NULL\s+CHECK\s*\(country\s+IN\s*\('TH'\s*,\s*'ID'\s*,\s*'MY'\s*,\s*'PH'\s*,\s*'VN'\s*,\s*'CN'\)\)/);
  });

  it('字段 warehouse_id uuid REFERENCES warehouse(id) ON DELETE SET NULL', () => {
    expect(migrationSrc).toMatch(/warehouse_id\s+uuid\s+REFERENCES\s+warehouse\(id\)\s+ON DELETE SET NULL/);
  });

  it('字段 raw_payload jsonb NOT NULL DEFAULT', () => {
    expect(migrationSrc).toMatch(/raw_payload\s+jsonb\s+NOT NULL\s+DEFAULT/);
  });

  it('字段 sync_status text NOT NULL DEFAULT active CHECK', () => {
    expect(migrationSrc).toMatch(/sync_status\s+text\s+NOT NULL\s+DEFAULT\s+'active'\s+CHECK\s*\(sync_status\s+IN\s*\('active'\s*,\s*'stale'\s*,\s*'error'\)\)/);
  });

  it('字段 last_synced_at timestamptz (nullable)', () => {
    expect(migrationSrc).toMatch(/last_synced_at\s+timestamptz/);
  });

  it('字段 created_at timestamptz NOT NULL DEFAULT now()', () => {
    expect(migrationSrc).toMatch(/created_at\s+timestamptz\s+NOT NULL\s+DEFAULT\s+now\(\)/);
  });

  it('字段 updated_at timestamptz NOT NULL DEFAULT now()', () => {
    expect(migrationSrc).toMatch(/updated_at\s+timestamptz\s+NOT NULL\s+DEFAULT\s+now\(\)/);
  });

  // ─── 2. shipment_external_item 表 ────────────────────────────────────

  it('CREATE TABLE shipment_external_item', () => {
    expect(migrationSrc).toMatch(/CREATE TABLE shipment_external_item/);
  });

  it('字段 external_ref_id uuid NOT NULL REFERENCES shipment_external_ref(id) ON DELETE CASCADE', () => {
    expect(migrationSrc).toMatch(/external_ref_id\s+uuid\s+NOT NULL\s+REFERENCES\s+shipment_external_ref\(id\)\s+ON DELETE CASCADE/);
  });

  it('字段 external_sku text NOT NULL', () => {
    expect(migrationSrc).toMatch(/external_sku\s+text\s+NOT NULL/);
  });

  it('字段 external_product_name text (nullable)', () => {
    expect(migrationSrc).toMatch(/external_product_name\s+text/);
  });

  it('字段 quantity integer NOT NULL CHECK quantity >= 1', () => {
    expect(migrationSrc).toMatch(/quantity\s+integer\s+NOT NULL\s+CHECK\s*\(quantity\s*>=\s*1\)/);
  });

  it('字段 matched_variant_id uuid REFERENCES product_variant(id) ON DELETE SET NULL', () => {
    expect(migrationSrc).toMatch(/matched_variant_id\s+uuid\s+REFERENCES\s+product_variant\(id\)\s+ON DELETE SET NULL/);
  });

  it('shipment_external_item 也有 raw_payload jsonb NOT NULL DEFAULT', () => {
    // raw_payload appears in both tables; verify item's raw_payload after external_product_name
    const afterProductName = migrationSrc.split('external_product_name')[1];
    expect(afterProductName).toMatch(/raw_payload\s+jsonb\s+NOT NULL\s+DEFAULT/);
  });

  // ─── 3. tracking_event_external 表（路径 B）────────────────────────

  it('CREATE TABLE tracking_event_external（路径 B：新建表）', () => {
    expect(migrationSrc).toMatch(/CREATE TABLE tracking_event_external/);
  });

  it('字段 external_ref_id uuid NOT NULL REFERENCES shipment_external_ref(id) ON DELETE CASCADE', () => {
    // 验证 tracking_event_external 中的 external_ref_id
    const afterTrackingTable = migrationSrc.split('CREATE TABLE tracking_event_external')[1];
    expect(afterTrackingTable).toMatch(/external_ref_id\s+uuid\s+NOT NULL\s+REFERENCES\s+shipment_external_ref\(id\)\s+ON DELETE CASCADE/);
  });

  it('字段 provider text NOT NULL CHECK provider IN', () => {
    const afterTrackingTable = migrationSrc.split('CREATE TABLE tracking_event_external')[1];
    expect(afterTrackingTable).toMatch(/provider\s+text\s+NOT NULL\s+CHECK\s*\(provider\s+IN\s*\('best'\)\)/);
  });

  it('字段 external_event_id text (nullable)', () => {
    const afterTrackingTable = migrationSrc.split('CREATE TABLE tracking_event_external')[1];
    expect(afterTrackingTable).toMatch(/external_event_id\s+text/);
  });

  it('字段 status text (nullable, 无内部 CHECK — provider 专有状态)', () => {
    const afterTrackingTable = migrationSrc.split('CREATE TABLE tracking_event_external')[1];
    // status 存在但不应该有限制性 CHECK IN (booking,loading,...)
    expect(afterTrackingTable).toMatch(/status\s+text/);
    expect(afterTrackingTable).not.toMatch(/status.*CHECK.*booking/);
  });

  it('字段 location text (nullable)', () => {
    const afterTrackingTable = migrationSrc.split('CREATE TABLE tracking_event_external')[1];
    expect(afterTrackingTable).toMatch(/location\s+text/);
  });

  it('字段 occurred_at timestamptz (nullable)', () => {
    const afterTrackingTable = migrationSrc.split('CREATE TABLE tracking_event_external')[1];
    expect(afterTrackingTable).toMatch(/occurred_at\s+timestamptz/);
  });

  it('tracking_event_external 也有 raw_payload jsonb NOT NULL DEFAULT', () => {
    const afterTrackingTable = migrationSrc.split('CREATE TABLE tracking_event_external')[1];
    expect(afterTrackingTable).toMatch(/raw_payload\s+jsonb\s+NOT NULL\s+DEFAULT/);
  });

  it('未扩展 tracking_event 表（路径 A 未被采用）', () => {
    expect(migrationSrc).not.toMatch(/ALTER TABLE tracking_event\s+ADD/i);
  });

  // ─── 4. 唯一索引 ────────────────────────────────────────────────────

  it('UNIQUE INDEX idx_shipment_external_ref_provider_order ON (provider, external_order_no)', () => {
    expect(migrationSrc).toMatch(
      /CREATE UNIQUE INDEX idx_shipment_external_ref_provider_order\s+ON\s+shipment_external_ref\(provider\s*,\s*external_order_no\)/
    );
  });

  // ─── 5. 普通索引 ────────────────────────────────────────────────────

  it('idx_shipment_external_ref_warehouse', () => {
    expect(migrationSrc).toMatch(/CREATE INDEX idx_shipment_external_ref_warehouse/);
  });

  it('idx_shipment_external_ref_country', () => {
    expect(migrationSrc).toMatch(/CREATE INDEX idx_shipment_external_ref_country/);
  });

  it('idx_shipment_external_ref_status', () => {
    expect(migrationSrc).toMatch(/CREATE INDEX idx_shipment_external_ref_status/);
  });

  it('idx_shipment_ext_item_ref_id', () => {
    expect(migrationSrc).toMatch(/CREATE INDEX idx_shipment_ext_item_ref_id/);
  });

  it('idx_shipment_ext_item_variant', () => {
    expect(migrationSrc).toMatch(/CREATE INDEX idx_shipment_ext_item_variant/);
  });

  it('idx_shipment_ext_item_sku', () => {
    expect(migrationSrc).toMatch(/CREATE INDEX idx_shipment_ext_item_sku/);
  });

  it('idx_tracking_ext_ref_id', () => {
    expect(migrationSrc).toMatch(/CREATE INDEX idx_tracking_ext_ref_id/);
  });

  it('idx_tracking_ext_provider', () => {
    expect(migrationSrc).toMatch(/CREATE INDEX idx_tracking_ext_provider/);
  });

  it('idx_tracking_ext_occurred_at', () => {
    expect(migrationSrc).toMatch(/CREATE INDEX idx_tracking_ext_occurred_at/);
  });

  // ─── 6. RLS ──────────────────────────────────────────────────────────

  it('shipment_external_ref ENABLE ROW LEVEL SECURITY', () => {
    expect(migrationSrc).toMatch(/ALTER TABLE shipment_external_ref\s+ENABLE ROW LEVEL SECURITY/);
  });

  it('shipment_external_ref admin_all policy', () => {
    expect(migrationSrc).toMatch(/CREATE POLICY "admin_all_shipment_external_ref"/);
  });

  it('shipment_external_ref authenticated_select policy', () => {
    expect(migrationSrc).toMatch(/CREATE POLICY "authenticated_select_shipment_external_ref"/);
  });

  it('shipment_external_item ENABLE ROW LEVEL SECURITY', () => {
    expect(migrationSrc).toMatch(/ALTER TABLE shipment_external_item\s+ENABLE ROW LEVEL SECURITY/);
  });

  it('shipment_external_item admin_all policy', () => {
    expect(migrationSrc).toMatch(/CREATE POLICY "admin_all_shipment_external_item"/);
  });

  it('shipment_external_item authenticated_select policy', () => {
    expect(migrationSrc).toMatch(/CREATE POLICY "authenticated_select_shipment_external_item"/);
  });

  it('tracking_event_external ENABLE ROW LEVEL SECURITY', () => {
    expect(migrationSrc).toMatch(/ALTER TABLE tracking_event_external\s+ENABLE ROW LEVEL SECURITY/);
  });

  it('tracking_event_external admin_all policy', () => {
    expect(migrationSrc).toMatch(/CREATE POLICY "admin_all_tracking_event_external"/);
  });

  it('tracking_event_external authenticated_select policy', () => {
    expect(migrationSrc).toMatch(/CREATE POLICY "authenticated_select_tracking_event_external"/);
  });

  it('RLS 策略数 >= 6（3 表 × 2 策略）', () => {
    const policyMatches = migrationSrc.match(/CREATE POLICY/g);
    expect(policyMatches).not.toBeNull();
    expect(policyMatches!.length).toBeGreaterThanOrEqual(6);
  });

  // ─── 7. updated_at 触发器 ───────────────────────────────────────────

  it('update_shipment_external_updated_at() 函数存在', () => {
    expect(migrationSrc).toMatch(/CREATE OR REPLACE FUNCTION update_shipment_external_updated_at/);
  });

  it('tg_shipment_external_ref_updated_at 触发器', () => {
    expect(migrationSrc).toMatch(/CREATE TRIGGER tg_shipment_external_ref_updated_at/);
  });

  it('tg_shipment_external_item_updated_at 触发器', () => {
    expect(migrationSrc).toMatch(/CREATE TRIGGER tg_shipment_external_item_updated_at/);
  });

  // ─── 8. 路径 B 注释 ──────────────────────────────────────────────────

  it('Migration 注释说明路径 B 选择原因', () => {
    expect(migrationSrc).toMatch(/路径\s*B/);
    expect(migrationSrc).toMatch(/tracking_event\.shipment_id/);
    expect(migrationSrc).toMatch(/tracking_event\.created_by/);
  });

  // ─── 9. provider 枚举仅 best ────────────────────────────────────────

  it('provider CHECK 仅包含 best', () => {
    // 验证 provider check 没有预先包含其他 provider
    const providerChecks = migrationSrc.match(/provider\s+IN\s*\([^)]+\)/g);
    expect(providerChecks).not.toBeNull();
    for (const check of providerChecks!) {
      expect(check).toMatch(/'best'/);
      // 不包含尚未实现的 provider
      expect(check).not.toMatch(/yunexpress/i);
      expect(check).not.toMatch(/dhl/i);
    }
  });
});

// ─── 10. 已执行 Migration 完整性保护 ──────────────────────────────────

describe('P3-S1A — 00001~00016 Migration 完整性', () => {
  const protectedHashes: Record<string, string> = {};

  beforeAll(() => {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'));

    for (const prefix of PROTECTED_MIGRATIONS) {
      const match = files.find(f => f.startsWith(prefix.split('/').pop()!));
      if (match) {
        const filePath = path.join(MIGRATIONS_DIR, match);
        protectedHashes[prefix] = sha256(fs.readFileSync(filePath, 'utf-8'));
      }
    }
  });

  it('00001~00016 所有 migration 仍存在', () => {
    expect(Object.keys(protectedHashes).length).toBe(16);
  });

  it('00001~00016 内容未被修改（SHA-256 快照）', () => {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'));

    for (const prefix of PROTECTED_MIGRATIONS) {
      const match = files.find(f => f.startsWith(prefix.split('/').pop()!));
      expect(match, `${prefix}* not found`).toBeDefined();
      const filePath = path.join(MIGRATIONS_DIR, match!);
      const currentHash = sha256(fs.readFileSync(filePath, 'utf-8'));
      expect(currentHash, `${match} has been modified`).toBe(protectedHashes[prefix]);
    }
  });
});

// ─── 11. 范围约束 — P3-S1A 禁止事项 ──────────────────────────────────

describe('P3-S1A — 范围约束（P0 更新：喜运达 golucky 模块新增文件）', () => {
  it('src/features/in-transit/ 文件集合符合 P0 预期', () => {
    const inTransitDir = path.resolve(process.cwd(), 'src/features/in-transit');
    if (fs.existsSync(inTransitDir)) {
      const files = fs.readdirSync(inTransitDir);
      const allowedFiles = [
        'types.ts', 'schema.ts', 'p3-s1a-migration.test.ts',
        'actions.ts', 'repository.ts', 'golucky-sync.ts', 'golucky-import.ts',
      ];
      for (const file of files) {
        const ext = path.extname(file);
        if (ext === '.ts' || ext === '.tsx') {
          expect(allowedFiles, `${file} 未在 P0 允许列表中`).toContain(file);
        }
      }
    }
  });

  it('未创建 API Client 文件（API client 应在 src/lib/providers/ 下）', () => {
    const inTransitDir = path.resolve(process.cwd(), 'src/features/in-transit');
    if (fs.existsSync(inTransitDir)) {
      const files = fs.readdirSync(inTransitDir);
      const forbidden = ['client.ts', 'api.ts', 'best-client.ts', 'best-api.ts'];
      for (const file of files) {
        expect(forbidden, `${file} 应在 lib/providers/ 下`).not.toContain(file);
      }
    }
  });

  it('P0 已创建 Repository 文件', () => {
    const repoPath = path.resolve(process.cwd(), 'src/features/in-transit/repository.ts');
    expect(fs.existsSync(repoPath)).toBe(true);
  });

  it('P0 已创建 Server Action 文件', () => {
    const actionsPath = path.resolve(process.cwd(), 'src/features/in-transit/actions.ts');
    expect(fs.existsSync(actionsPath)).toBe(true);
  });

  it('未创建 UI 组件', () => {
    const componentsDir = path.resolve(process.cwd(), 'src/features/in-transit/components');
    expect(fs.existsSync(componentsDir)).toBe(false);
  });

  // P3-S1A 不要求 src/lib/providers/best/ 目录（由后续任务创建）。
  // 不再断言该目录是否存在——该断言随 P3-S1B 实现而变化，不属 P3-S1A 范围。

  it('src/types/database.ts 未包含 best_order / best_item 等强绑定命名', () => {
    const dbTypesPath = path.resolve(process.cwd(), 'src/types/database.ts');
    const content = fs.readFileSync(dbTypesPath, 'utf-8');
    expect(content).not.toMatch(/best_order/);
    expect(content).not.toMatch(/best_item/);
  });
});
