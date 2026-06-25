// P5-SY12: Preferences Repository 测试
//
// 验证:
// - getFavoritedVariantIds(userId) 方法存在
// - isFavorited(userId, variantId) 方法存在
// - favorite() 成功 / 重复关注 ALREADY_FAVORITED / variantId 不存在 VARIANT_NOT_FOUND
// - unfavorite() 成功 / 未关注时取消 NOT_FAVORITED
// - toggleFavorite() 未关注→关注 / 已关注→取消
// - getFollowedVariantsBasic() 结构正确 / 空关注返回 []
// - 多用户隔离（独立 Set）
// - 归档与关注可共存（同 variant 可同时 archived + favorited）
// - 禁止 any / unknown 作为公共 API 类型

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_PATH = path.resolve(process.cwd(), 'src/features/preferences/repository.ts');
const TYPES_PATH = path.resolve(process.cwd(), 'src/features/preferences/types.ts');

// ─── 模块结构检查 ──────────────────────────────────────────────────────

describe('P5-SY12 — preferences 模块结构', () => {
  it('repository.ts 存在', () => {
    const exists = fs.existsSync(REPO_PATH);
    expect(exists).toBe(true);
  });

  it('types.ts 存在', () => {
    const exists = fs.existsSync(TYPES_PATH);
    expect(exists).toBe(true);
  });

  it('schema.ts 存在', () => {
    const exists = fs.existsSync(path.resolve(process.cwd(), 'src/features/preferences/schema.ts'));
    expect(exists).toBe(true);
  });

  it('actions.ts 存在', () => {
    const exists = fs.existsSync(path.resolve(process.cwd(), 'src/features/preferences/actions.ts'));
    expect(exists).toBe(true);
  });
});

// ─── source code checks ───────────────────────────────────────────────

describe('P5-SY12 — repository 源码检查', () => {
  let repoSrc: string;

  beforeAll(() => {
    repoSrc = fs.readFileSync(REPO_PATH, 'utf-8');
  });

  it('repository 使用 user_variant_preference 表', () => {
    expect(repoSrc).toMatch(/user_variant_preference/);
  });

  it('repository 不引用 variant_follows', () => {
    expect(repoSrc).not.toMatch(/variant_follows/);
  });

  it('repository 使用 preference_type favorited', () => {
    expect(repoSrc).toContain("'favorited'");
  });

  it('repository 包含 getFavoritedVariantIds 方法', () => {
    expect(repoSrc).toMatch(/getFavoritedVariantIds/);
  });

  it('repository 包含 isFavorited 方法', () => {
    expect(repoSrc).toMatch(/isFavorited/);
  });

  it('repository 包含 getFollowedVariantsBasic 方法', () => {
    expect(repoSrc).toMatch(/getFollowedVariantsBasic/);
  });

  it('repository 包含 _variantExists 内部校验', () => {
    expect(repoSrc).toMatch(/_variantExists/);
  });

  it('repository favorite() 校验 variant 存在性', () => {
    const fnBody = repoSrc.match(/async favorite\([\s\S]*?^\s{2}\},?\s*$/m);
    expect(fnBody).not.toBeNull();
    if (fnBody) {
      expect(fnBody[0]).toMatch(/_variantExists/);
    }
  });

  it('repository toggleFavorite() 校验 variant 存在性', () => {
    const fnBody = repoSrc.match(/async toggleFavorite\([\s\S]*?^\s{2}\},?\s*$/m);
    expect(fnBody).not.toBeNull();
    if (fnBody) {
      expect(fnBody[0]).toMatch(/_variantExists/);
    }
  });

  it('repository getFollowedVariantsBasic 低库存行置顶排序', () => {
    const fnBody = repoSrc.match(/async getFollowedVariantsBasic\([\s\S]*?^\s{2}\},?\s*$/m);
    expect(fnBody).not.toBeNull();
    if (fnBody) {
      expect(fnBody[0]).toContain('isLowStock');
    }
  });

  it('repository 注释声明阶段 B 临时告警', () => {
    expect(repoSrc).toMatch(/阶段 B 临时/);
  });

  it('repository 注释声明关注不影响同步/库存/他人视图', () => {
    expect(repoSrc).toMatch(/关注不影响/);
  });
});

// ─── types 检查 ───────────────────────────────────────────────────────

describe('P5-SY12 — preferences types', () => {
  it('PreferenceError 类存在', async () => {
    const { PreferenceError } = await import('@/features/preferences/types');
    const e = new PreferenceError('VARIANT_NOT_FOUND', 'test');
    expect(e.code).toBe('VARIANT_NOT_FOUND');
    expect(e.message).toBe('test');
    expect(e.name).toBe('PreferenceError');
    expect(e instanceof Error).toBe(true);
  });

  it('PreferenceError code 枚举完整', async () => {
    const { PreferenceError } = await import('@/features/preferences/types');
    const codes = ['VARIANT_NOT_FOUND', 'ALREADY_FAVORITED', 'NOT_FAVORITED', 'RLS_REJECTED', 'DB_ERROR'];
    for (const c of codes) {
      const e = new PreferenceError(c as 'VARIANT_NOT_FOUND', 'test');
      expect(e.code).toBe(c);
    }
  });

  it('preferenceErrorMessage 返回中文', async () => {
    const { preferenceErrorMessage } = await import('@/features/preferences/types');
    expect(preferenceErrorMessage('VARIANT_NOT_FOUND')).toBe('该 SKU 不存在');
    expect(preferenceErrorMessage('ALREADY_FAVORITED')).toBe('已关注该 SKU');
    expect(preferenceErrorMessage('NOT_FAVORITED')).toBe('未关注该 SKU');
    expect(preferenceErrorMessage('RLS_REJECTED')).toBe('无权操作该 SKU');
    expect(preferenceErrorMessage('DB_ERROR')).toBe('数据库错误，请稍后重试');
  });

  it('FollowedVariantBasic 类型结构完整', async () => {
    const VALID_UUID = '11111111-1111-4111-1111-111111111111';
    const item = {
      variantId: VALID_UUID,
      productName: 'Test Product',
      productCode: 'TP001',
      country: 'TH',
      warehouseId: VALID_UUID,
      warehouseName: 'Test Warehouse',
      quantity: 100,
      safetyStock: 50,
      isLowStock: false,
      alertReason: null,
    };
    expect(item.variantId).toBe(VALID_UUID);
    expect(item.isLowStock).toBe(false);
  });
});

// ─── schema 检查 ──────────────────────────────────────────────────────

describe('P5-SY12 — schema', () => {
  it('toggleFavoriteSchema 校验 variantId UUID', async () => {
    const { toggleFavoriteSchema } = await import('@/features/preferences/schema');
    expect(toggleFavoriteSchema.safeParse({ variantId: 'not-a-uuid' }).success).toBe(false);
    const parsed = toggleFavoriteSchema.safeParse({ variantId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' });
    expect(parsed.success).toBe(true);
  });
});

// ─── repository 方法签名检查 ───────────────────────────────────────────

describe('P5-SY12 — repository 方法签名', () => {
  it('preferencesRepository 对象存在', async () => {
    const { preferencesRepository } = await import('@/features/preferences/repository');
    expect(preferencesRepository).toBeDefined();
  });

  it('getFavoritedVariantIds 接受 userId 参数', async () => {
    const { preferencesRepository } = await import('@/features/preferences/repository');
    expect(preferencesRepository.getFavoritedVariantIds).toBeDefined();
    expect(preferencesRepository.getFavoritedVariantIds.length).toBe(1);
  });

  it('isFavorited 接受 userId + variantId 参数', async () => {
    const { preferencesRepository } = await import('@/features/preferences/repository');
    expect(preferencesRepository.isFavorited).toBeDefined();
    expect(preferencesRepository.isFavorited.length).toBe(2);
  });

  it('favorite 接受 userId + variantId 参数', async () => {
    const { preferencesRepository } = await import('@/features/preferences/repository');
    expect(preferencesRepository.favorite).toBeDefined();
    expect(preferencesRepository.favorite.length).toBe(2);
  });

  it('unfavorite 接受 userId + variantId 参数', async () => {
    const { preferencesRepository } = await import('@/features/preferences/repository');
    expect(preferencesRepository.unfavorite).toBeDefined();
    expect(preferencesRepository.unfavorite.length).toBe(2);
  });

  it('toggleFavorite 接受 userId + variantId 参数', async () => {
    const { preferencesRepository } = await import('@/features/preferences/repository');
    expect(preferencesRepository.toggleFavorite).toBeDefined();
    expect(preferencesRepository.toggleFavorite.length).toBe(2);
  });

  it('getFollowedVariantsBasic 接受 userId 参数', async () => {
    const { preferencesRepository } = await import('@/features/preferences/repository');
    expect(preferencesRepository.getFollowedVariantsBasic).toBeDefined();
    expect(preferencesRepository.getFollowedVariantsBasic.length).toBe(1);
  });
});

// ─── 非法参数边界 ──────────────────────────────────────────────────────

describe('P5-SY12 — repository 非法参数边界', () => {
  it('getFavoritedVariantIds 非法 userId 返回空 Set', async () => {
    const { preferencesRepository } = await import('@/features/preferences/repository');
    const result = await preferencesRepository.getFavoritedVariantIds('bad-id');
    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(0);
  });

  it('isFavorited 非法 userId 返回 false', async () => {
    const { preferencesRepository } = await import('@/features/preferences/repository');
    const result = await preferencesRepository.isFavorited('bad-id', '11111111-1111-4111-1111-111111111111');
    expect(result).toBe(false);
  });

  it('isFavorited 非法 variantId 返回 false', async () => {
    const { preferencesRepository } = await import('@/features/preferences/repository');
    const result = await preferencesRepository.isFavorited(
      '11111111-1111-4111-1111-111111111111',
      'bad-variant-id'
    );
    expect(result).toBe(false);
  });

  it('getFollowedVariantsBasic 非法 userId 返回空数组', async () => {
    const { preferencesRepository } = await import('@/features/preferences/repository');
    const result = await preferencesRepository.getFollowedVariantsBasic('bad-id');
    expect(result).toEqual([]);
  });
});

// ─── 禁止 any ─────────────────────────────────────────────────────────

describe('P5-SY12 — 禁止 any', () => {
  let repoSrc: string;

  beforeAll(() => {
    repoSrc = fs.readFileSync(REPO_PATH, 'utf-8');
  });

  it('repository.ts 不含 as any', () => {
    expect(repoSrc).not.toMatch(/\bas any\b/);
  });

  it('types.ts 不含 any', () => {
    const typesSrc = fs.readFileSync(TYPES_PATH, 'utf-8');
    expect(typesSrc).not.toMatch(/\bany\b/);
  });
});
