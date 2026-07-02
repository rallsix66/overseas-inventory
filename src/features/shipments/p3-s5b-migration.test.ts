// P3-S5B1: Migration 00026 静态契约测试
// 覆盖：
// 1. bigseller_absorbed_at 列定义
// 2. partial_warehouse_shipment RPC 结构
// 3. 权限模型（SECURITY INVOKER + REVOKE/GRANT）
// 4. Admin-only 校验
// 5. 业务规则（FOR UPDATE / 非 warehoused / 仓库 / customs / 超量保护）
// 6. 不写 inventory.quantity
// 7. 原子写入（warehoused_quantity 累加 + status 更新 + tracking_event）
// 8. 返回 JSONB 结构
// 9. 中文错误消息

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readSrc(relativePath: string): string {
  return readFileSync(resolve(relativePath), 'utf-8');
}

const MIGRATION_PATH = 'supabase/migrations/00026_partial_warehouse_shipment.sql';

// ─── 1. 迁移文件顶层结构 ──────────────────────────────────────────────────────

describe('P3-S5B1: Migration 00026 — 文件结构', () => {
  let migration: string;

  beforeAll(() => {
    migration = readSrc(MIGRATION_PATH);
  });

  it('新增 bigseller_absorbed_at 列', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS bigseller_absorbed_at');
    expect(migration).toContain('timestamptz');
  });

  it('bigseller_absorbed_at 默认 NULL', () => {
    expect(migration).toMatch(/bigseller_absorbed_at.*DEFAULT NULL/);
  });

  it('bigseller_absorbed_at 注释说明 BigSeller 吸收确认', () => {
    expect(migration).toContain('BigSeller 已吸收');
  });

  it('包含 partial_warehouse_shipment 函数定义', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.partial_warehouse_shipment',
    );
  });
});

// ─── 2. RPC 权限模型 ─────────────────────────────────────────────────────────

describe('P3-S5B1: Migration 00026 — 权限模型', () => {
  let migration: string;

  beforeAll(() => {
    migration = readSrc(MIGRATION_PATH);
  });

  it('SECURITY INVOKER（不绕过 RLS）', () => {
    // 头注释 + RPC 声明 = 至少 2 处
    const invokerCount = (migration.match(/SECURITY INVOKER/g) || []).length;
    expect(invokerCount).toBeGreaterThanOrEqual(2);
  });

  it('不包含 SECURITY DEFINER', () => {
    expect(migration).not.toContain('SECURITY DEFINER');
  });

  it('SET search_path = \'\'', () => {
    expect(migration).toContain("SET search_path = ''");
  });

  it('REVOKE EXECUTE FROM PUBLIC', () => {
    expect(migration).toContain(
      'REVOKE EXECUTE ON FUNCTION public.partial_warehouse_shipment(uuid, jsonb, text) FROM PUBLIC',
    );
  });

  it('REVOKE EXECUTE FROM anon', () => {
    expect(migration).toContain(
      'REVOKE EXECUTE ON FUNCTION public.partial_warehouse_shipment(uuid, jsonb, text) FROM anon',
    );
  });

  it('GRANT EXECUTE TO authenticated', () => {
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.partial_warehouse_shipment(uuid, jsonb, text) TO authenticated',
    );
  });
});

// ─── 3. Admin-only 校验 ──────────────────────────────────────────────────────

describe('P3-S5B1: Migration 00026 — Admin-only 校验', () => {
  let migration: string;

  beforeAll(() => {
    migration = readSrc(MIGRATION_PATH);
  });

  it('调用 public.get_user_role()', () => {
    expect(migration).toContain('public.get_user_role()');
  });

  it('v_role != admin 拒绝', () => {
    expect(migration).toMatch(/v_role\s*!=\s*'admin'/);
  });

  it('非 admin 抛出无权限中文错误', () => {
    expect(migration).toContain("RAISE EXCEPTION '无权限：需要管理员角色'");
  });

  it('使用 ERRCODE P0001', () => {
    expect(migration).toContain("ERRCODE = 'P0001'");
  });
});

// ─── 4. 参数签名与返回类型 ───────────────────────────────────────────────────

describe('P3-S5B1: Migration 00026 — 参数签名与返回类型', () => {
  let migration: string;

  beforeAll(() => {
    migration = readSrc(MIGRATION_PATH);
  });

  it('参数 p_shipment_id uuid', () => {
    expect(migration).toMatch(/p_shipment_id\s+uuid/);
  });

  it('参数 p_items jsonb', () => {
    expect(migration).toMatch(/p_items\s+jsonb/);
  });

  it('参数 p_description text DEFAULT NULL', () => {
    expect(migration).toMatch(/p_description\s+text\s+DEFAULT\s+NULL/);
  });

  it('RETURNS jsonb', () => {
    expect(migration).toMatch(/RETURNS\s+jsonb/);
  });

  it('返回 success / all_warehoused / items_updated 三个字段', () => {
    expect(migration).toContain("'success'");
    expect(migration).toContain("'all_warehoused'");
    expect(migration).toContain("'items_updated'");
  });
});

// ─── 5. 业务规则：shipment 校验 ───────────────────────────────────────────────

describe('P3-S5B1: Migration 00026 — shipment 校验', () => {
  let migration: string;

  beforeAll(() => {
    migration = readSrc(MIGRATION_PATH);
  });

  it('SELECT shipment FOR UPDATE（排他锁）', () => {
    expect(migration).toMatch(/FROM public\.shipment[\s\S]*?FOR UPDATE/);
  });

  it('IF NOT FOUND 检测不存在的 shipment', () => {
    expect(migration).toMatch(/IF NOT FOUND THEN/);
  });

  it('不存在的 shipment 抛出中文错误', () => {
    expect(migration).toContain("在途记录不存在或无权访问");
  });

  it('禁止重复入仓：status = warehoused 检测', () => {
    expect(migration).toMatch(/已完成入仓，不可重复操作/);
  });

  it('必须有 warehouse_id', () => {
    expect(migration).toContain('未指定仓库，无法入仓');
  });

  it('仅 customs 允许入仓', () => {
    expect(migration).toContain('仅清关后可确认入仓');
  });
});

// ─── 6. 业务规则：p_items 校验 ───────────────────────────────────────────────

describe('P3-S5B1: Migration 00026 — p_items 校验', () => {
  let migration: string;

  beforeAll(() => {
    migration = readSrc(MIGRATION_PATH);
  });

  it('p_items NULL 或空数组拒绝', () => {
    expect(migration).toContain('入仓明细不能为空');
  });

  it('使用 jsonb_array_length 校验非空', () => {
    expect(migration).toContain('jsonb_array_length');
  });

  it('使用 jsonb_array_elements 遍历 p_items', () => {
    expect(migration).toContain('jsonb_array_elements');
  });

  it('解析 elem->>variant_id 为 uuid', () => {
    expect(migration).toMatch(/variant_id.*::uuid/);
  });

  it('解析 elem->>quantity 为 integer', () => {
    expect(migration).toMatch(/quantity.*::integer/);
  });

  it('quantity <= 0 拒绝（含中文错误）', () => {
    expect(migration).toContain('入仓数量必须大于 0');
  });
});

// ─── 7. 业务规则：shipment_item 校验 ──────────────────────────────────────────

describe('P3-S5B1: Migration 00026 — shipment_item 校验', () => {
  let migration: string;

  beforeAll(() => {
    migration = readSrc(MIGRATION_PATH);
  });

  it('SELECT shipment_item FOR UPDATE（排他锁）', () => {
    expect(migration).toMatch(/FROM public\.shipment_item[\s\S]*?FOR UPDATE/);
  });

  it('variant_id 不存在于 shipment 抛出中文错误', () => {
    expect(migration).toContain('在途记录中未找到 variant_id');
  });

  it('已入仓数量超过总数检测（数据异常）', () => {
    expect(migration).toContain('已入仓数量超过总数');
  });

  it('超量入仓保护：requested > remaining 拒绝', () => {
    expect(migration).toContain('入仓数量');
    expect(migration).toContain('超过在途余量');
  });

  it('使用 remaining = quantity - warehoused_quantity', () => {
    expect(migration).toMatch(/v_remaining\s*:=\s*v_item\.quantity\s*-\s*v_item\.warehoused_quantity/);
  });
});

// ─── 8. 原子写入：warehoused_quantity 累加 ──────────────────────────────────

describe('P3-S5B1: Migration 00026 — 原子写入', () => {
  let migration: string;

  beforeAll(() => {
    migration = readSrc(MIGRATION_PATH);
  });

  it('warehoused_quantity 累加（+= 而非覆盖）', () => {
    expect(migration).toMatch(
      /warehoused_quantity\s*=\s*warehoused_quantity\s*\+/,
    );
  });

  it('全部入仓时更新 shipment.status = warehoused', () => {
    expect(migration).toMatch(/SET status = 'warehoused'/);
  });

  it('all_warehoused 条件判断后更新 status', () => {
    expect(migration).toMatch(/IF v_all_warehoused THEN/);
    expect(migration).toMatch(/UPDATE public\.shipment/);
  });

  it('INSERT tracking_event', () => {
    expect(migration).toContain('INSERT INTO public.tracking_event');
  });

  it('tracking_event 状态区分 warehoused / partial_warehoused', () => {
    expect(migration).toContain("'warehoused'");
    expect(migration).toContain("'partial_warehoused'");
  });

  it('tracking_event 使用 auth.uid()', () => {
    expect(migration).toContain('auth.uid()');
  });

  it('tracking_event 使用 now()', () => {
    expect(migration).toContain('now()');
  });

  it('items_updated 计数器递增', () => {
    expect(migration).toMatch(/v_items_updated\s*:=\s*v_items_updated\s*\+\s*1/);
  });
});

// ─── 9. 不写 inventory ──────────────────────────────────────────────────────

describe('P3-S5B1: Migration 00026 — 不写 inventory', () => {
  let rpcBody: string;

  beforeAll(() => {
    const migration = readSrc(MIGRATION_PATH);
    // 提取 RPC 函数体
    const start = migration.indexOf('CREATE OR REPLACE FUNCTION public.partial_warehouse_shipment');
    const end = migration.indexOf('REVOKE EXECUTE ON FUNCTION public.partial_warehouse_shipment');
    rpcBody = migration.slice(start, end > 0 ? end : undefined);
  });

  it('不含 INSERT INTO public.inventory', () => {
    expect(rpcBody).not.toContain('INSERT INTO public.inventory');
  });

  it('不含 ON CONFLICT（inventory UPSERT）', () => {
    expect(rpcBody).not.toContain('ON CONFLICT');
  });

  it('不含 EXCLUDED.quantity（inventory 累加）', () => {
    expect(rpcBody).not.toContain('EXCLUDED.quantity');
  });

  it('不含 inventory.quantity 引用', () => {
    expect(rpcBody).not.toContain('inventory.quantity');
  });

  it('不含 last_sync_at', () => {
    expect(rpcBody).not.toContain('last_sync_at');
  });
});

// ─── 10. 中文错误消息清单 ────────────────────────────────────────────────────

describe('P3-S5B1: Migration 00026 — 中文错误消息', () => {
  let migration: string;

  beforeAll(() => {
    migration = readSrc(MIGRATION_PATH);
  });

  const expectedErrors = [
    '无权限：需要管理员角色',
    '入仓明细不能为空',
    '在途记录不存在或无权访问',
    '该在途记录已完成入仓，不可重复操作',
    '该在途记录未指定仓库，无法入仓',
    '仅清关后可确认入仓',
    '入仓数量必须大于 0',
    '在途记录中未找到 variant_id',
    '已入仓数量超过总数',
    '超过在途余量',
  ];

  expectedErrors.forEach((msg) => {
    it(`包含中文错误: ${msg}`, () => {
      expect(migration).toContain(msg);
    });
  });

  it('所有 RAISE EXCEPTION 均为中文错误', () => {
    const raises = migration.match(/RAISE EXCEPTION\s+'([^']+)'/g) || [];
    expect(raises.length).toBeGreaterThanOrEqual(10);
    raises.forEach((r) => {
      // 每条错误消息应包含中文字符
      expect(r).toMatch(/[一-鿿]/);
    });
  });
});

// ─── 11. JSONB 返回结构 ──────────────────────────────────────────────────────

describe('P3-S5B1: Migration 00026 — JSONB 返回结构', () => {
  let migration: string;

  beforeAll(() => {
    migration = readSrc(MIGRATION_PATH);
  });

  it('使用 jsonb_build_object 构造返回', () => {
    expect(migration).toContain('jsonb_build_object');
  });

  it('success 返回 true', () => {
    expect(migration).toMatch(/'success',\s*true/);
  });

  it('all_warehoused 来自 NOT v_has_remaining', () => {
    expect(migration).toMatch(/v_all_warehoused\s*:=\s*NOT\s*v_has_remaining/);
  });

  it('items_updated 记录实际处理项数', () => {
    expect(migration).toMatch(/'items_updated',\s*v_items_updated/);
  });
});

// ─── 12. 类型定义校验 ─────────────────────────────────────────────────────────

describe('P3-S5B1: types.ts — partial warehouse 类型', () => {
  const typesSrc = readSrc('src/features/shipments/types.ts');

  it('定义 PartialWarehouseItem 接口', () => {
    expect(typesSrc).toContain('export interface PartialWarehouseItem');
  });

  it('PartialWarehouseItem 包含 variantId: string', () => {
    expect(typesSrc).toMatch(/variantId:\s*string/);
  });

  it('PartialWarehouseItem 包含 quantity: number', () => {
    expect(typesSrc).toMatch(/quantity:\s*number/);
  });

  it('定义 PartialWarehouseShipmentData 接口', () => {
    expect(typesSrc).toContain('export interface PartialWarehouseShipmentData');
  });

  it('PartialWarehouseShipmentData 包含 items: PartialWarehouseItem[]', () => {
    expect(typesSrc).toMatch(/items:\s*PartialWarehouseItem\[\]/);
  });

  it('定义 PartialWarehouseResult 接口', () => {
    expect(typesSrc).toContain('export interface PartialWarehouseResult');
  });

  it('PartialWarehouseResult 包含 success / allWarehoused / itemsUpdated', () => {
    expect(typesSrc).toContain('success: boolean');
    expect(typesSrc).toContain('allWarehoused: boolean');
    expect(typesSrc).toContain('itemsUpdated: number');
  });
});

// ─── 13. Schema 定义校验 ──────────────────────────────────────────────────────

describe('P3-S5B1: schema.ts — partial warehouse Zod schema', () => {
  const schemaSrc = readSrc('src/features/shipments/schema.ts');

  it('定义 partialWarehouseItemSchema', () => {
    expect(schemaSrc).toContain('export const partialWarehouseItemSchema');
  });

  it('partialWarehouseItemSchema variantId UUID 校验', () => {
    expect(schemaSrc).toMatch(/variantId.*uuid/);
  });

  it('partialWarehouseItemSchema quantity min(1)', () => {
    expect(schemaSrc).toMatch(/quantity.*min\(1/);
  });

  it('定义 partialWarehouseShipmentSchema', () => {
    expect(schemaSrc).toContain('export const partialWarehouseShipmentSchema');
  });

  it('partialWarehouseShipmentSchema items min(1).max(50)', () => {
    expect(schemaSrc).toMatch(/min\(1.*至少指定一项/);
    expect(schemaSrc).toMatch(/max\(50/);
  });

  it('partialWarehouseShipmentSchema 含重复 SKU 检测 refine', () => {
    expect(schemaSrc).toContain('重复 SKU');
  });

  it('定义 PartialWarehouseShipmentValues 类型', () => {
    expect(schemaSrc).toContain('export type PartialWarehouseShipmentValues');
  });
});

// ─── 14. database.ts 类型同步 ─────────────────────────────────────────────────

describe('P3-S5B1: database.ts — 类型同步', () => {
  const dbSrc = readSrc('src/types/database.ts');

  it('shipment.Row 包含 bigseller_absorbed_at', () => {
    const rowSection = dbSrc.match(/shipment:\s*\{[\s\S]*?Row:\s*\{([\s\S]*?)\}\s*Insert:/);
    expect(rowSection?.[1]).toContain('bigseller_absorbed_at');
    expect(rowSection?.[1]).toContain('string | null');
  });

  it('shipment.Insert 包含 bigseller_absorbed_at', () => {
    const insertSection = dbSrc.match(/shipment:\s*\{[\s\S]*?Insert:\s*\{([\s\S]*?)\}\s*Update:/);
    expect(insertSection?.[1]).toContain('bigseller_absorbed_at');
  });

  it('shipment.Update 包含 bigseller_absorbed_at', () => {
    const updateSection = dbSrc.match(/shipment:\s*\{[\s\S]*?Update:\s*\{([\s\S]*?)\}\s*Relationships:/);
    expect(updateSection?.[1]).toContain('bigseller_absorbed_at');
  });

  it('Functions 包含 partial_warehouse_shipment', () => {
    expect(dbSrc).toContain('partial_warehouse_shipment');
    expect(dbSrc).toContain('p_shipment_id');
    expect(dbSrc).toContain('p_items');
  });
});
