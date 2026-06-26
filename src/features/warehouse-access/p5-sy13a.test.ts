// P5-SY13A: 仓库分配权限测试
//
// 验证:
// - warehouseAccessRepository 接口与实现
// - inventoryRepository 按已分配仓库过滤
// - preferencesRepository 关注项按仓库过滤
// - toggleFavoriteAction 仓库权限校验
// - sync status 仓库过滤
// - Migration 00015 未修改已执行 Migration
// - 禁止 any
//
// 纯静态源码检查 + 接口验证，不连接 Supabase。

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATION_PATH = path.resolve(process.cwd(), 'supabase/migrations/00015_user_warehouses.sql');
const WA_REPO_PATH = path.resolve(process.cwd(), 'src/features/warehouse-access/repository.ts');
const WA_TYPES_PATH = path.resolve(process.cwd(), 'src/features/warehouse-access/types.ts');
const INV_REPO_PATH = path.resolve(process.cwd(), 'src/features/inventory/repository.ts');
const PREF_REPO_PATH = path.resolve(process.cwd(), 'src/features/preferences/repository.ts');
const PREF_ACTIONS_PATH = path.resolve(process.cwd(), 'src/features/preferences/actions.ts');
const SYNC_ACTIONS_PATH = path.resolve(process.cwd(), 'src/features/sync/server-actions.ts');
const DASHBOARD_PATH = path.resolve(process.cwd(), 'src/app/dashboard/page.tsx');

// ─── 1. warehouseAccessRepository 接口 ──────────────────────────────────

describe('P5-SY13A — warehouseAccessRepository', () => {
  let typesSrc: string;
  let repoSrc: string;

  beforeAll(() => {
    typesSrc = fs.readFileSync(WA_TYPES_PATH, 'utf-8');
    repoSrc = fs.readFileSync(WA_REPO_PATH, 'utf-8');
  });

  it('types.ts 定义 WarehouseAccessRepository 接口', () => {
    expect(typesSrc).toMatch(/export interface WarehouseAccessRepository/);
  });

  it('接口包含 getAccessibleWarehouseIds', () => {
    expect(typesSrc).toMatch(/getAccessibleWarehouseIds\s*\(/);
  });

  it('接口包含 canAccessWarehouse', () => {
    expect(typesSrc).toMatch(/canAccessWarehouse\s*\(/);
  });

  it('接口包含 canAccessVariant', () => {
    expect(typesSrc).toMatch(/canAccessVariant\s*\(/);
  });

  it('repository.ts 实现 WarehouseAccessRepository 接口', () => {
    expect(repoSrc).toMatch(/WarehouseAccessRepository/);
  });

  it('getAccessibleWarehouseIds admin 返回所有 active overseas warehouse', () => {
    expect(repoSrc).toMatch(/role.*admin/);
    expect(repoSrc).toMatch(/type.*overseas/);
    expect(repoSrc).toMatch(/is_active.*true/);
  });

  it('getAccessibleWarehouseIds operator 从 user_warehouses 查询', () => {
    expect(repoSrc).toMatch(/from\('user_warehouses'\)/);
  });

  it('canAccessVariant admin 直接返回 true', () => {
    expect(repoSrc).toMatch(/roleName === 'admin'.*return true/);
  });

  it('canAccessVariant operator 检查 inventory 在已分配仓库中是否存在', () => {
    expect(repoSrc).toMatch(/canAccessVariant[\s\S]*from\('inventory'\)/);
    expect(repoSrc).toMatch(/\.in\('warehouse_id'/);
  });

  it('不含 any', () => {
    expect(repoSrc).not.toMatch(/\bany\b/);
  });
});

// ─── 2. inventoryRepository 仓库过滤 ────────────────────────────────────

describe('P5-SY13A — inventoryRepository 仓库过滤', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(INV_REPO_PATH, 'utf-8');
  });

  it('导入 warehouseAccessRepository', () => {
    expect(src).toMatch(/from ['"]@\/features\/warehouse-access\/repository['"]/);
  });

  it('getOverseasList 调用 getAccessibleWarehouseIds', () => {
    expect(src).toMatch(/getAccessibleWarehouseIds/);
  });

  it('getOverseasList 按 warehouseId 过滤（空分配→空结果）', () => {
    expect(src).toMatch(/accessibleWhIds\.has\(.*warehouseId\)/);
    // P5-SY13A rework: 禁止 size > 0 守卫模式
    expect(src).not.toMatch(/accessibleWhIds\.size\s*>\s*0\s*&&\s*!accessibleWhIds\.has/);
  });

  it('getLowStock 调用 getAccessibleWarehouseIds', () => {
    // Count occurrences — should appear at least twice (once in getOverseasList, once in getLowStock or getOverseasStats)
    const matches = src.match(/getAccessibleWarehouseIds/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it('getOverseasStats 调用 getAccessibleWarehouseIds + 排除不可访问仓库（空分配→跳过所有行）', () => {
    expect(src).toMatch(/accessibleWhIds.*getAccessibleWarehouseIds/);
    expect(src).toMatch(/!accessibleWhIds\.has\(.*warehouse_id\)/);
    // P5-SY13A rework: 禁止 size > 0 守卫模式
    expect(src).not.toMatch(/accessibleWhIds\.size\s*>\s*0\s*&&/);
  });
});

// ─── 3. preferencesRepository 仓库过滤 ──────────────────────────────────

describe('P5-SY13A — preferencesRepository 仓库过滤', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(PREF_REPO_PATH, 'utf-8');
  });

  it('导入 warehouseAccessRepository', () => {
    expect(src).toMatch(/from ['"]@\/features\/warehouse-access\/repository['"]/);
  });

  it('getFollowedVariantsBasic 获取已分配仓库 ID', () => {
    expect(src).toMatch(/getAccessibleWarehouseIds\(userId\)/);
  });

  it('getFollowedVariantsBasic 跳过不可访问仓库的关注项（空分配→无结果）', () => {
    // P5-SY13A rework: 不再使用 size > 0 作防误放守卫。空分配直接返回空结果。
    expect(src).toMatch(/!accessibleWhIds\.has\(whId\)/);
    // 源码中不可再出现 size > 0 && !accessibleWhIds.has 模式
    expect(src).not.toMatch(/accessibleWhIds\.size\s*>\s*0\s*&&\s*!accessibleWhIds\.has/);
  });
});

// ─── 4. toggleFavoriteAction 仓库权限校验 ─────────────────────────────

describe('P5-SY13A — toggleFavoriteAction 仓库权限', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(PREF_ACTIONS_PATH, 'utf-8');
  });

  it('导入 warehouseAccessRepository', () => {
    expect(src).toMatch(/from ['"]@\/features\/warehouse-access\/repository['"]/);
  });

  it('调用 canAccessVariant 校验权限', () => {
    expect(src).toMatch(/canAccessVariant/);
  });

  it('不可访问时返回"无权操作该仓库 SKU"', () => {
    expect(src).toContain('无权操作该仓库 SKU');
  });
});

// ─── 4b. 空分配集合契约 ────────────────────────────────────────────

describe('P5-SY13A rework — 空分配集合不误放', () => {
  let invSrc: string;
  let prefSrc: string;
  let syncSrc: string;

  beforeAll(() => {
    invSrc = fs.readFileSync(INV_REPO_PATH, 'utf-8');
    prefSrc = fs.readFileSync(PREF_REPO_PATH, 'utf-8');
    syncSrc = fs.readFileSync(SYNC_ACTIONS_PATH, 'utf-8');
  });

  it('inventoryRepository 不存在 accessibleWhIds.size > 0 防误放守卫', () => {
    // size > 0 守卫会导致空分配时返回全量数据
    expect(invSrc).not.toMatch(/accessibleWhIds\.size\s*>\s*0\s*&&\s*!accessibleWhIds\.has/);
    expect(invSrc).not.toMatch(/accessibleWhIds2\.size\s*>\s*0/);
  });

  it('preferencesRepository 不存在 size > 0 防误放守卫', () => {
    expect(prefSrc).not.toMatch(/accessibleWhIds\.size\s*>\s*0\s*&&\s*!accessibleWhIds\.has/);
  });

  it('sync server-actions 不存在 size > 0 防误放守卫', () => {
    expect(syncSrc).not.toMatch(/accessibleWhIds\.size\s*>\s*0\s*&&/);
  });

  it('inventoryRepository getLowStock 空分配时直接 filter（返回空数组）', () => {
    // 验证：userId 存在时必然 filter，无 fallback return
    expect(invSrc).toMatch(/return lowStockItems\.filter/);
    // 不应该存在 accessibleWhIds2.size > 0 守卫（空分配绕过过滤）
    expect(invSrc).not.toMatch(/accessibleWhIds2\.size\s*>\s*0/);
    // 不应该存在两个连续的 return lowStockItems 路径（filtered + unfiltered bypass）
    // unfiltered return lowStockItems; 只应在没有 userId 的 fallback 路径出现
    const getLowStockFn = invSrc.match(/getLowStock[\s\S]*?^  },/m);
    expect(getLowStockFn).not.toBeNull();
    const body = getLowStockFn![0];
    // userId 分支内，return lowStockItems 必须经过 .filter
    const userIdSection = body.match(/if \(userId\)[\s\S]*?^    \}/m);
    if (userIdSection) {
      // userId 分支内的所有 return 都必须经过 .filter
      const returnsInBranch = userIdSection[0].match(/return lowStockItems/g) ?? [];
      for (const r of returnsInBranch) {
        // 每个 return lowStockItems 后必须紧跟 .filter
        const afterReturn = userIdSection[0].substring(
          userIdSection[0].indexOf(r) + r.length
        );
        expect(afterReturn.trimStart().startsWith('.filter')).toBe(true);
      }
    }
  });
});

// ─── 5. Sync status 仓库过滤 ───────────────────────────────────────────

describe('P5-SY13A — sync server-actions 仓库过滤', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(SYNC_ACTIONS_PATH, 'utf-8');
  });

  it('getOverseasWarehouseSyncStatus 调用 requireActiveAuth（返回 user）', () => {
    expect(src).toMatch(/const user = await requireActiveAuth/);
  });

  it('getOverseasWarehouseSyncStatus 导入 warehouseAccessRepository', () => {
    expect(src).toMatch(/warehouse-access\/repository/);
  });

  it('getSyncLogDetail 调用 requireActiveAuth 并捕获 user', () => {
    expect(src).toMatch(/const user = await requireActiveAuth\(\)/);
  });

  it('getSyncLogDetail 调用 canAccessWarehouse 校验仓库权限', () => {
    expect(src).toMatch(/canAccessWarehouse\(user\.id/);
  });

  it('getSyncLogDetail 无权时返回 null', () => {
    // canAccess 为 false 时应返回 null（不返回 sync_log）
    expect(src).toMatch(/if \(!canAccess\) return null/);
  });

  it('getSyncLogDetail 权限检查在 getSyncLog 之后执行', () => {
    // 先查 sync_log（serviceClient），再在应用层校验权限
    const logDetailFn = src.match(/export async function getSyncLogDetail[\s\S]*?^}/m);
    expect(logDetailFn).not.toBeNull();
    const body = logDetailFn![0];
    const getSyncLogIdx = body.indexOf('getSyncLog');
    const canAccessIdx = body.indexOf('canAccessWarehouse');
    expect(getSyncLogIdx).toBeGreaterThan(0);
    expect(canAccessIdx).toBeGreaterThan(getSyncLogIdx);
    expect(body.indexOf('return log') > canAccessIdx).toBe(true);
  });

  it('getOverseasWarehouseSyncStatus 跳过不可访问仓库（空分配→无结果）', () => {
    expect(src).toMatch(/!accessibleWhIds\.has\(run\.warehouse_id\)/);
    // P5-SY13A rework: 禁止 size > 0 守卫模式
    expect(src).not.toMatch(/accessibleWhIds\.size\s*>\s*0\s*&&/);
  });
});

// ─── 6. Dashboard 数据链路不变 ─────────────────────────────────────────

describe('P5-SY13A — Dashboard 数据链路', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(DASHBOARD_PATH, 'utf-8');
  });

  it('Dashboard 导入 preferencesRepository', () => {
    expect(src).toMatch(/from ['"]@\/features\/preferences\/repository['"]/);
  });

  it('Dashboard 调用 getFollowedVariantsBasic', () => {
    expect(src).toMatch(/getFollowedVariantsBasic/);
  });

  it('Dashboard 直接渲染 FollowedProductsSection', () => {
    expect(src).toMatch(/FollowedProductsSection/);
  });
});

// ─── 7. Migration 00015 不修改已执行 Migration ─────────────────────────

describe('P5-SY13A — Migration 00015 结构完整性', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(MIGRATION_PATH, 'utf-8');
  });

  it('不含 ALTER TABLE ... ADD/DROP COLUMN（不修改已有表结构）', () => {
    // 00015 不新增或删除任何列 — 仅 CREATE TABLE + DROP/CREATE POLICY + CREATE OR REPLACE FUNCTION
    // 移除注释行后再检查（注释中提及了这些词用于说明约束）
    const lines = src.split('\n').filter((l: string) => !l.trim().startsWith('--'));
    const activeContent = lines.join('\n');
    expect(activeContent).not.toMatch(/\bADD COLUMN\b/i);
    expect(activeContent).not.toMatch(/\bDROP COLUMN\b/i);
  });

  it('注释声明不修改已执行 Migration 00001~00014', () => {
    expect(src).toMatch(/不修改已执行 Migration 00001~00014/);
  });

  it('注释声明不做管理 UI', () => {
    expect(src).toMatch(/不做管理 UI/);
  });
});

// ─── 8. 禁止 any ──────────────────────────────────────────────────────

describe('P5-SY13A — 禁止 any', () => {
  it('warehouseAccessRepository 不含 any', () => {
    const src = fs.readFileSync(WA_REPO_PATH, 'utf-8');
    expect(src).not.toMatch(/\bany\b/);
  });

  it('warehouseAccessRepository types 不含 any', () => {
    const src = fs.readFileSync(WA_TYPES_PATH, 'utf-8');
    expect(src).not.toMatch(/\bany\b/);
  });

  it('preferences/actions.ts toggleFavoriteAction 不含 any', () => {
    const src = fs.readFileSync(PREF_ACTIONS_PATH, 'utf-8');
    // Check toggleFavoriteAction function specifically
    const fnMatch = src.match(/export async function toggleFavoriteAction[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch?.[0]).not.toMatch(/\bany\b/);
  });
});
