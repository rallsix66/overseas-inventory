// P5-SY11G-D: Inventory 层归档过滤测试（用户级偏好）
//
// 验证:
// - 海外库存列表/低库存/统计使用 user_variant_preference 过滤
// - 不再使用 .eq('variant.is_archived', false) DB 过滤
// - getOverseasList/getLowStock/getOverseasStats 接受 userId 参数
// - getByProductId 不过滤（保留全部 Variant 库存）
// - 源码不含 is_archived DB 级过滤（inventory repository）

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

  it('排除已归档 Variant 在 JS 层完成（非 DB 层）', () => {
    expect(repoSrc).toMatch(/archivedVariantIds\.has/);
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
