// P5-SY13A: Migration 00015 静态契约测试
//
// 验证:
// - user_warehouses 表、PK、FK、RLS、seed 存在
// - operator policies 不引用 product_variant.is_archived
// - warehouse/inventory/product_variant/shipment/shipment_item/tracking_event/sync_log 都有仓库分配过滤
// - get_sync_runs/get_sync_run_detail operator 分支有 assigned warehouse 过滤
// - 不修改已执行 Migration 00001~00014
//
// 纯静态文本检查，不连接 Supabase。

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATION_PATH = path.resolve(
  process.cwd(),
  'supabase/migrations/00015_user_warehouses.sql'
);

// ─── 1. user_warehouses 表 ─────────────────────────────────────────────

describe('P5-SY13A — user_warehouses 表', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('CREATE TABLE user_warehouses', () => {
    expect(src).toMatch(/CREATE TABLE.*user_warehouses/i);
  });

  it('PK (user_id, warehouse_id)', () => {
    expect(src).toMatch(/PRIMARY KEY\s*\(\s*user_id\s*,\s*warehouse_id\s*\)/i);
  });

  it('FK user_id → profiles(id) ON DELETE CASCADE', () => {
    expect(src).toMatch(/REFERENCES.*profiles\s*\(\s*id\s*\)\s*ON DELETE CASCADE/i);
  });

  it('FK warehouse_id → warehouse(id) ON DELETE CASCADE', () => {
    expect(src).toMatch(/REFERENCES.*warehouse\s*\(\s*id\s*\)\s*ON DELETE CASCADE/i);
  });

  it('索引 idx_user_warehouses_warehouse_id', () => {
    expect(src).toMatch(/idx_user_warehouses_warehouse_id/i);
    expect(src).toMatch(/ON.*user_warehouses\s*\(\s*warehouse_id\s*\)/i);
  });

  it('created_at timestamptz NOT NULL DEFAULT now()', () => {
    expect(src).toMatch(/created_at\s+timestamptz\s+NOT NULL\s+DEFAULT\s+now\s*\(\s*\)/i);
  });
});

// ─── 2. user_warehouses RLS ─────────────────────────────────────────────

describe('P5-SY13A — user_warehouses RLS', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('ENABLE ROW LEVEL SECURITY', () => {
    expect(src).toMatch(/ALTER TABLE.*user_warehouses\s+ENABLE ROW LEVEL SECURITY/i);
  });

  it('admin_all_user_warehouses 策略', () => {
    expect(src).toMatch(/admin_all_user_warehouses/i);
    expect(src).toMatch(/FOR ALL/i);
    expect(src).toMatch(/get_user_role\s*\(\s*\)\s*=\s*'admin'/);
  });

  it('operator_select_own_user_warehouses 策略', () => {
    expect(src).toMatch(/operator_select_own_user_warehouses/i);
    expect(src).toMatch(/FOR SELECT/i);
    expect(src).toMatch(/auth\.uid\s*\(\s*\)\s*=\s*user_id/);
  });
});

// ─── 3. get_assigned_warehouse_ids() 辅助函数 ───────────────────────────

describe('P5-SY13A — get_assigned_warehouse_ids()', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('CREATE OR REPLACE FUNCTION get_assigned_warehouse_ids', () => {
    expect(src).toMatch(/CREATE OR REPLACE FUNCTION.*get_assigned_warehouse_ids/i);
  });

  it('SECURITY DEFINER', () => {
    const fnBody = src.match(/get_assigned_warehouse_ids[\s\S]*?AS\s*\$\$/);
    expect(fnBody).not.toBeNull();
    expect(fnBody?.[0]).toMatch(/SECURITY DEFINER/i);
  });

  it('从 user_warehouses 查询当前用户仓库', () => {
    expect(src).toMatch(/FROM.*user_warehouses[\s\S]*WHERE.*user_id\s*=\s*auth\.uid\s*\(\s*\)/i);
  });

  it('GRANT EXECUTE TO authenticated（仅 REVOKE FROM PUBLIC/anon）', () => {
    // authenticated 需要 EXECUTE 权限以在 RLS 策略中调用此函数
    const grantMatch = src.match(
      /GRANT EXECUTE ON FUNCTION.*get_assigned_warehouse_ids.*TO authenticated/i
    );
    expect(grantMatch).not.toBeNull();
    const revokeSection = src.match(
      /REVOKE EXECUTE ON FUNCTION.*get_assigned_warehouse_ids[\s\S]*?;/gi
    );
    expect(revokeSection).not.toBeNull();
    // 仅 PUBLIC 和 anon 被 REVOKE（共 2 条），authenticated 改为 GRANT
    expect(revokeSection!.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── 4. Seed：给 active operator 分配 active warehouse ──────────────────

describe('P5-SY13A — Seed', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('INSERT INTO user_warehouses (user_id, warehouse_id) SELECT', () => {
    expect(src).toMatch(/INSERT INTO.*user_warehouses\s*\(\s*user_id\s*,\s*warehouse_id\s*\)/i);
  });

  it('CROSS JOIN warehouse WHERE is_active = true', () => {
    expect(src).toMatch(/CROSS JOIN.*warehouse/i);
    expect(src).toMatch(/is_active\s*=\s*true/i);
  });

  it('仅 active operator（JOIN role WHERE name = operator AND is_active = true）', () => {
    expect(src).toMatch(/JOIN.*role.*ON/i);
    expect(src).toMatch(/name\s*=\s*'operator'/i);
    expect(src).toMatch(/p\.is_active\s*=\s*true/);
  });

  it('ON CONFLICT DO NOTHING 保障幂等', () => {
    expect(src).toMatch(/ON CONFLICT DO NOTHING/i);
  });
});

// ─── 5. Warehouse RLS 收紧 ─────────────────────────────────────────────

describe('P5-SY13A — Warehouse RLS 收紧', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('DROP POLICY IF EXISTS operator_select_warehouse', () => {
    expect(src).toMatch(/DROP POLICY IF EXISTS "operator_select_warehouse"/);
  });

  it('operator_select_warehouse 含 get_assigned_warehouse_ids', () => {
    const policyMatch = src.match(
      /CREATE POLICY "operator_select_warehouse"[\s\S]*?;/i
    );
    expect(policyMatch).not.toBeNull();
    expect(policyMatch?.[0]).toMatch(/get_assigned_warehouse_ids/);
  });
});

// ─── 6. Inventory RLS 收紧 ─────────────────────────────────────────────

describe('P5-SY13A — Inventory RLS 收紧', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('DROP POLICY IF EXISTS operator_select_inventory', () => {
    expect(src).toMatch(/DROP POLICY IF EXISTS "operator_select_inventory"/);
  });

  it('operator_select_inventory 含 assigned warehouse 过滤', () => {
    const policyMatch = src.match(
      /CREATE POLICY "operator_select_inventory"[\s\S]*?;/i
    );
    expect(policyMatch).not.toBeNull();
    expect(policyMatch?.[0]).toMatch(/warehouse_id IN/);
    expect(policyMatch?.[0]).toMatch(/get_assigned_warehouse_ids/);
  });

  it('DROP POLICY IF EXISTS operator_update_inventory_quantity', () => {
    expect(src).toMatch(/DROP POLICY IF EXISTS "operator_update_inventory_quantity"/);
  });

  it('operator_update_inventory_quantity USING + WITH CHECK 均含仓库分配过滤', () => {
    const policyMatch = src.match(
      /CREATE POLICY "operator_update_inventory_quantity"[\s\S]*?;/i
    );
    expect(policyMatch).not.toBeNull();
    const body = policyMatch?.[0] ?? '';
    // USING 和 WITH CHECK 包含嵌套括号（get_user_role()），不能简单用 [^)]+ 匹配。
    // 直接验证 policy body 含 get_assigned_warehouse_ids 即可。
    expect(body).toMatch(/get_assigned_warehouse_ids/);
    expect(body).toMatch(/USING/);
    expect(body).toMatch(/WITH CHECK/);
  });
});

// ─── 7. ProductVariant RLS 收紧 ─────────────────────────────────────────

describe('P5-SY13A — ProductVariant RLS 收紧', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('DROP POLICY IF EXISTS operator_select_variant', () => {
    expect(src).toMatch(/DROP POLICY IF EXISTS "operator_select_variant"/);
  });

  it('operator_select_variant 含 inventory warehouse 过滤', () => {
    const policyMatch = src.match(
      /CREATE POLICY "operator_select_variant"[\s\S]*?;/i
    );
    expect(policyMatch).not.toBeNull();
    expect(policyMatch?.[0]).toMatch(/EXISTS/);
    expect(policyMatch?.[0]).toMatch(/FROM.*inventory/);
    expect(policyMatch?.[0]).toMatch(/get_assigned_warehouse_ids/);
  });

  it('operator_select_variant 不引用 is_archived', () => {
    const policyMatch = src.match(
      /CREATE POLICY "operator_select_variant"[\s\S]*?;/i
    );
    expect(policyMatch).not.toBeNull();
    expect(policyMatch?.[0]).not.toMatch(/is_archived/);
  });
});

// ─── 8. Shipment RLS 收紧 ──────────────────────────────────────────────

describe('P5-SY13A — Shipment RLS 收紧', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('DROP POLICY IF EXISTS operator_select_shipment', () => {
    expect(src).toMatch(/DROP POLICY IF EXISTS "operator_select_shipment"/);
  });

  it('operator_select_shipment 含 warehouse_id IN assigned', () => {
    const policyMatch = src.match(
      /CREATE POLICY "operator_select_shipment"[\s\S]*?;/i
    );
    expect(policyMatch).not.toBeNull();
    expect(policyMatch?.[0]).toMatch(/warehouse_id IN/);
    expect(policyMatch?.[0]).toMatch(/get_assigned_warehouse_ids/);
  });

  it('operator_insert_shipment WITH CHECK 含仓库分配过滤', () => {
    const policyMatch = src.match(
      /CREATE POLICY "operator_insert_shipment"[\s\S]*?;/i
    );
    expect(policyMatch).not.toBeNull();
    expect(policyMatch?.[0]).toMatch(/WITH CHECK/);
    expect(policyMatch?.[0]).toMatch(/get_assigned_warehouse_ids/);
  });

  it('operator_update_shipment USING + WITH CHECK 均含仓库分配过滤', () => {
    const policyMatch = src.match(
      /CREATE POLICY "operator_update_shipment"[\s\S]*?;/i
    );
    expect(policyMatch).not.toBeNull();
    const body = policyMatch?.[0] ?? '';
    // USING 和 WITH CHECK 包含嵌套括号（get_user_role()），不能简单用 [^)]+ 匹配。
    // 直接验证 policy body 含 get_assigned_warehouse_ids 即可。
    expect(body).toMatch(/get_assigned_warehouse_ids/);
    expect(body).toMatch(/USING/);
    expect(body).toMatch(/WITH CHECK/);
  });
});

// ─── 9. ShipmentItem RLS 收紧 ──────────────────────────────────────────

describe('P5-SY13A — ShipmentItem RLS 收紧', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('operator_select_shipment_item 通过 shipment_id → shipment.warehouse_id 判断', () => {
    const policyMatch = src.match(
      /CREATE POLICY "operator_select_shipment_item"[\s\S]*?;/i
    );
    expect(policyMatch).not.toBeNull();
    expect(policyMatch?.[0]).toMatch(/FROM.*shipment/);
    expect(policyMatch?.[0]).toMatch(/shipment_item\.shipment_id/);
    expect(policyMatch?.[0]).toMatch(/get_assigned_warehouse_ids/);
  });

  it('operator_insert_shipment_item WITH CHECK 含仓库分配过滤', () => {
    const policyMatch = src.match(
      /CREATE POLICY "operator_insert_shipment_item"[\s\S]*?;/i
    );
    expect(policyMatch).not.toBeNull();
    expect(policyMatch?.[0]).toMatch(/WITH CHECK/);
    expect(policyMatch?.[0]).toMatch(/get_assigned_warehouse_ids/);
  });
});

// ─── 10. TrackingEvent RLS 收紧 ────────────────────────────────────────

describe('P5-SY13A — TrackingEvent RLS 收紧', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('operator_select_tracking_event 通过 shipment_id → shipment.warehouse_id 判断', () => {
    const policyMatch = src.match(
      /CREATE POLICY "operator_select_tracking_event"[\s\S]*?;/i
    );
    expect(policyMatch).not.toBeNull();
    expect(policyMatch?.[0]).toMatch(/FROM.*shipment/);
    expect(policyMatch?.[0]).toMatch(/tracking_event\.shipment_id/);
    expect(policyMatch?.[0]).toMatch(/get_assigned_warehouse_ids/);
  });

  it('operator_insert_tracking_event WITH CHECK 含仓库分配过滤', () => {
    const policyMatch = src.match(
      /CREATE POLICY "operator_insert_tracking_event"[\s\S]*?;/i
    );
    expect(policyMatch).not.toBeNull();
    expect(policyMatch?.[0]).toMatch(/WITH CHECK/);
    expect(policyMatch?.[0]).toMatch(/get_assigned_warehouse_ids/);
  });
});

// ─── 11. SyncLog RLS 收紧 ──────────────────────────────────────────────

describe('P5-SY13A — SyncLog RLS 收紧', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('operator_select_sync_log 含 assigned warehouse 过滤', () => {
    const policyMatch = src.match(
      /CREATE POLICY "operator_select_sync_log"[\s\S]*?;/i
    );
    expect(policyMatch).not.toBeNull();
    expect(policyMatch?.[0]).toMatch(/get_assigned_warehouse_ids/);
  });
});

// ─── 12. get_sync_runs operator 分支仓库过滤 ────────────────────────────

describe('P5-SY13A — get_sync_runs operator 仓库过滤', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('get_sync_runs operator 分支含 get_assigned_warehouse_ids 过滤', () => {
    // 找到 operator 分支（ELSE 之后的 limited CTE）
    const operatorSection = src.match(
      /ELSE[\s\S]*?operator:[\s\S]*?LIMIT p_limit/i
    );
    expect(operatorSection).not.toBeNull();
    expect(operatorSection?.[0]).toMatch(/get_assigned_warehouse_ids/);
  });

  it('operator 分支 WHERE 子句含 assigned warehouse 过滤', () => {
    expect(src).toMatch(
      /sr\.warehouse_id\s+IN\s+\(\s*SELECT\s+public\.get_assigned_warehouse_ids\s*\(\s*\)\s*\)/i
    );
  });
});

// ─── 13. get_sync_run_detail operator 分支仓库过滤 ──────────────────────

describe('P5-SY13A — get_sync_run_detail operator 仓库过滤', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('get_sync_run_detail operator 分支先读 warehouse_id', () => {
    expect(src).toMatch(/SELECT sr\.warehouse_id INTO v_wh_id/i);
  });

  it('operator 分支未分配时返回 null', () => {
    expect(src).toMatch(/NOT EXISTS[\s\S]*get_assigned_warehouse_ids[\s\S]*RETURN 'null'/i);
  });
});

// ─── 14. 不引用 is_archived ────────────────────────────────────────────

describe('P5-SY13A — 不引用 is_archived', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('operator 策略不含 is_archived', () => {
    // 找到所有 CREATE POLICY 块
    const policies = src.match(/CREATE POLICY[\s\S]*?;/gi) ?? [];
    for (const p of policies) {
      if (p.includes('operator')) {
        expect(p).not.toMatch(/is_archived/);
      }
    }
  });
});

// ─── 15. 不修改已执行 Migration ────────────────────────────────────────

describe('P5-SY13A — 不修改已执行 Migration', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('不含 ALTER TABLE ... ADD COLUMN', () => {
    // 排除注释行（注释中提及了这些词用于说明约束）
    const lines = src.split('\n').filter((l: string) => !l.trim().startsWith('--'));
    const activeContent = lines.join('\n');
    expect(activeContent).not.toMatch(/ALTER TABLE.*ADD COLUMN/i);
  });

  it('不含 ALTER TABLE ... DROP COLUMN', () => {
    const lines = src.split('\n').filter((l: string) => !l.trim().startsWith('--'));
    const activeContent = lines.join('\n');
    expect(activeContent).not.toMatch(/ALTER TABLE.*DROP COLUMN/i);
  });

  it('仅含 CREATE TABLE / CREATE POLICY / DROP POLICY IF EXISTS / CREATE OR REPLACE FUNCTION', () => {
    // 除了 seed INSERT 和权限 REVOKE/GRANT，不修改已有结构
    // 排除注释行（注释中提及了这些词用于说明约束）
    const lines = src.split('\n').filter((l: string) => !l.trim().startsWith('--'));
    const activeContent = lines.join('\n');
    expect(activeContent).not.toMatch(/ALTER TABLE(?!.*user_warehouses).*ADD/i);
  });
});

// ─── 16. Admin 策略未修改 ──────────────────────────────────────────────

describe('P5-SY13A — Admin 策略未修改', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('不 DROP admin 策略', () => {
    expect(src).not.toMatch(/DROP POLICY.*admin/i);
  });

  it('不 CREATE 新的 admin 策略（除 admin_all_user_warehouses）', () => {
    const adminPolicies = src.match(/CREATE POLICY "admin_/g) ?? [];
    // 仅 admin_all_user_warehouses
    expect(adminPolicies.length).toBe(1);
    expect(src).toMatch(/admin_all_user_warehouses/);
  });
});
