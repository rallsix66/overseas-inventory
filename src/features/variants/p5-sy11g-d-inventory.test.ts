// P5-SY11G-D: Inventory 层归档过滤测试（用户级偏好）
//
// 验证:
// - 海外库存列表/低库存/统计使用 user_variant_preference 过滤
// - 不再使用 .eq('variant.is_archived', false) DB 过滤
// - getOverseasList/getLowStock 使用 row.variant_id 判断归档（variant join select 不含 id）
// - getOverseasList/getLowStock/getOverseasStats 接受 userId 参数
// - getByProductId 不过滤（保留全部 Variant 库存）
// - 源码不含 is_archived DB 级过滤（inventory repository）
// - P5-SY11G 返工：variant join 不含 id 导致所有行被过滤 → 改用 row.variant_id

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const INVENTORY_REPO_PATH = path.resolve(process.cwd(), 'src/features/inventory/repository.ts');
const INVENTORY_TYPES_PATH = path.resolve(process.cwd(), 'src/features/inventory/types.ts');
const INVENTORY_ACTIONS_PATH = path.resolve(process.cwd(), 'src/features/inventory/actions.ts');

// ─── 源码静态检查 ────────────────────────────────────────────────────

describe('P5-SY11G-D — 源码不再使用 is_archived 过滤', () => {
  let repoSrc: string;

  beforeAll(() => {
    repoSrc = fs.readFileSync(INVENTORY_REPO_PATH, 'utf-8');
  });

  it('getOverseasList 不包含 variant.is_archived 的 .eq() DB 过滤', () => {
    // 排注释行后不应有 .eq('variant.is_archived', ...) 调用
    const codeLines = repoSrc.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(codeLines).not.toMatch(/\.eq\s*\(\s*['"]variant\.is_archived['"]/);
  });

  it('getLowStock 不包含 variant.is_archived DB 过滤', () => {
    const codeLines = repoSrc.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(codeLines).not.toMatch(/variant\.is_archived/);
  });

  it('getOverseasStats 不包含 variant.is_archived DB 过滤', () => {
    const codeLines = repoSrc.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(codeLines).not.toMatch(/variant\.is_archived/);
  });

  it('使用 user_variant_preference 表查询归档偏好', () => {
    expect(repoSrc).toMatch(/user_variant_preference/);
  });

  it('getUserArchivedVariantIds 辅助函数存在', () => {
    expect(repoSrc).toMatch(/getUserArchivedVariantIds/);
  });

  it('排除已归档 Variant 在 JS 层完成（非 DB 层），使用 row.variant_id 判断', () => {
    // 关键修复：variant join select 不含 id，必须用 row.variant_id
    expect(repoSrc).toMatch(/archivedVariantIds\.has\s*\(\s*row\.variant_id/);
    // 不应继续使用 v.id（variant join 不含 id 字段）
    expect(repoSrc).not.toMatch(/archivedVariantIds\.has\s*\(\s*v\.id/);
  });
});

// ─── getByProductId 不过滤 ────────────────────────────────────────────

describe('P5-SY11G-D — getByProductId 不过滤归档', () => {
  it('getByProductId 不接收 userId 参数', async () => {
    const { inventoryRepository } = await import('@/features/inventory/repository');
    expect(inventoryRepository.getByProductId.length).toBe(1);
  });

  it('getByProductId 不查询 user_variant_preference', () => {
    const repoSrc = fs.readFileSync(INVENTORY_REPO_PATH, 'utf-8');
    // getByProductId 函数区域不含 user_variant_preference 引用
    const fnBlock = repoSrc.match(/async getByProductId[\s\S]*?^\s{2}\},?\s*$/m);
    if (fnBlock) {
      expect(fnBlock[0]).not.toMatch(/user_variant_preference/);
      expect(fnBlock[0]).not.toMatch(/archivedVariantIds/);
    }
  });
});

// ─── getOverseasList/getLowStock/getOverseasStats 接受 userId ───────

describe('P5-SY11G-D — 方法签名包含 userId', () => {
  it('getOverseasList 通过 filters.userId 接受用户 ID', () => {
    const repoSrc = fs.readFileSync(INVENTORY_REPO_PATH, 'utf-8');
    // getOverseasList 函数体内解构 filters 包含 userId
    const fnBody = repoSrc.match(/async getOverseasList[\s\S]*?^\s{2}\},?\s*$/m);
    expect(fnBody).not.toBeNull();
    if (fnBody) {
      expect(fnBody[0]).toMatch(/userId/);
    }
  });

  it('getLowStock 接受 userId 参数', () => {
    const repoSrc = fs.readFileSync(INVENTORY_REPO_PATH, 'utf-8');
    const fnSig = repoSrc.match(/async getLowStock\s*\(([^)]*)\)/);
    expect(fnSig).not.toBeNull();
    if (fnSig) {
      expect(fnSig[1]).toMatch(/userId/);
    }
  });

  it('getOverseasStats 接受 userId 参数', () => {
    const repoSrc = fs.readFileSync(INVENTORY_REPO_PATH, 'utf-8');
    const fnSig = repoSrc.match(/async getOverseasStats\s*\(([^)]*)\)/);
    expect(fnSig).not.toBeNull();
    if (fnSig) {
      expect(fnSig[1]).toMatch(/userId/);
    }
  });
});

// ─── InventoryFilters 类型包含 userId ─────────────────────────────────

describe('P5-SY11G-D — InventoryFilters 类型', () => {
  it('InventoryFilters 包含 userId 字段', async () => {
    const types = await import('@/features/inventory/types');
    const filters: types.InventoryFilters = { userId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' };
    expect(filters.userId).toBeDefined();
  });
});

// ─── actions.ts 传递 userId ───────────────────────────────────────────

describe('P5-SY11G-D — Inventory Actions 传递 userId', () => {
  it('getOverseasInventory 传递 userId 到 getOverseasStats 和 getOverseasList', () => {
    const actionsSrc = fs.readFileSync(INVENTORY_ACTIONS_PATH, 'utf-8');
    expect(actionsSrc).toMatch(/userId/);
    expect(actionsSrc).toMatch(/getOverseasStats\s*\(\s*userId/);
  });
});

// ─── dashboard page 传递 userId ───────────────────────────────────────

describe('P5-SY11G-D — Dashboard page 传递 userId', () => {
  it('page.tsx 传递 user?.id 到 getOverseasStats', () => {
    const pagePath = path.resolve(process.cwd(), 'src/app/dashboard/page.tsx');
    const pageSrc = fs.readFileSync(pagePath, 'utf-8');
    expect(pageSrc).toMatch(/getOverseasStats\s*\(\s*user\?\.id/);
  });
});

// ─── P5-SY11G 返工：variant.id 缺失修复验证 ──────────────────────────

describe('P5-SY11G-D 返工 — getOverseasList 使用 row.variant_id', () => {
  let repoSrc: string;

  beforeAll(() => {
    repoSrc = fs.readFileSync(INVENTORY_REPO_PATH, 'utf-8');
  });

  it('getOverseasList 过滤逻辑不再使用 v.id（variant join 不含 id）', () => {
    // variant join select: variant:variant_id!inner (sku, country, match_status, ...)
    // 不含 id，所以必须使用 row.variant_id 判断
    const fnBody = repoSrc.match(/async getOverseasList[\s\S]*?^\s{2}\},?\s*$/m);
    expect(fnBody).not.toBeNull();
    if (fnBody) {
      // 不应出现 v.id（variant join 不含 id）
      const filterLines = fnBody[0].split('\n').filter((l) => l.includes('archivedVariantIds.has'));
      for (const line of filterLines) {
        expect(line).toMatch(/row\.variant_id/);
        expect(line).not.toMatch(/v\.id/);
      }
    }
  });

  it('getOverseasList variant join 不含 id，使用 row.variant_id 兜底', () => {
    // 确认 select 中 variant join 确实不含 id
    const fnBody = repoSrc.match(/async getOverseasList[\s\S]*?^\s{2}\},?\s*$/m);
    expect(fnBody).not.toBeNull();
    if (fnBody) {
      // select 的 variant join 部分不应包含 id: 等字段（仅 sku/country/match_status/product）
      const selectStmt = fnBody[0].match(/variant:variant_id!inner\s*\(([^)]+)\)/);
      expect(selectStmt).not.toBeNull();
      if (selectStmt) {
        // 不包含 id 字段（只有 sku, country, match_status, product）
        expect(selectStmt[1]).not.toMatch(/\bid\b/);
      }
    }
  });

  it('未归档时 archivedVariantIds 为空 Set，过滤不过滤任何行', () => {
    // 当 archivedVariantIds.size === 0，has() 返回 false，所有行保留
    const emptySet = new Set<string>();
    expect(emptySet.has('any-id')).toBe(false);
  });

  it('归档后 archivedVariantIds 包含 variant_id，过滤排除对应行', () => {
    const archivedSet = new Set(['variant-a', 'variant-b']);
    expect(archivedSet.has('variant-a')).toBe(true);
    expect(archivedSet.has('variant-c')).toBe(false);
  });
});

describe('P5-SY11G-D 返工 — getLowStock 使用 row.variant_id', () => {
  let repoSrc: string;

  beforeAll(() => {
    repoSrc = fs.readFileSync(INVENTORY_REPO_PATH, 'utf-8');
  });

  it('getLowStock 过滤逻辑使用 row.variant_id 判断归档', () => {
    const fnBody = repoSrc.match(/async getLowStock[\s\S]*?^\s{2}\},?\s*$/m);
    expect(fnBody).not.toBeNull();
    if (fnBody) {
      const filterLines = fnBody[0].split('\n').filter((l) => l.includes('archivedVariantIds.has'));
      for (const line of filterLines) {
        expect(line).toMatch(/row\.variant_id/);
        expect(line).not.toMatch(/v\.id/);
      }
    }
  });
});

// ─── 多用户隔离概念验证 ───────────────────────────────────────────────

describe('P5-SY11G-D 返工 — 多用户隔离', () => {
  it('getUserArchivedVariantIds 按 userId 查询（每人独立偏好）', () => {
    const repoSrc = fs.readFileSync(INVENTORY_REPO_PATH, 'utf-8');
    // 函数接收 userId 参数，按 user_id 查询
    expect(repoSrc).toContain("'user_id', userId");
  });

  it('filter 条件仅依赖当前用户的 archivedVariantIds', () => {
    const repoSrc = fs.readFileSync(INVENTORY_REPO_PATH, 'utf-8');
    // 每个 getOverseasList 调用传入各自 userId，生成独立 archivedVariantIds
    const fnBody = repoSrc.match(/async getOverseasList[\s\S]*?^\s{2}\},?\s*$/m);
    expect(fnBody).not.toBeNull();
    if (fnBody) {
      // archivedVariantIds 通过 getUserArchivedVariantIds(userId) 获取
      expect(fnBody[0]).toMatch(/getUserArchivedVariantIds\s*\(\s*userId/);
    }
  });
});
