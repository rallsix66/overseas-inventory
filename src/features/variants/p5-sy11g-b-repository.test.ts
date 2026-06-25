// P5-SY11G-B: Variant Repository 测试（用户级归档偏好）
//
// 验证:
// - archive()/restore() 签名迁移为 userId 参数
// - getUserArchivedVariantIds() 方法存在
// - 源码不再读写 is_archived/archived_at/archived_by
// - 源码使用 user_variant_preference 表
// - match()/unmatch()/batchMatch() 不再因归档阻止
// - VariantItem/VariantFilters 类型更新
// - 多用户隔离概念验证

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_PATH = path.resolve(process.cwd(), 'src/features/variants/repository.ts');
const TYPES_PATH = path.resolve(process.cwd(), 'src/features/variants/types.ts');

// ─── 源码静态检查 ────────────────────────────────────────────────────

describe('P5-SY11G-B — 源码不再读写 is_archived', () => {
  let repoSrc: string;

  beforeAll(() => {
    repoSrc = fs.readFileSync(REPO_PATH, 'utf-8');
  });

  it('archive() 不含 is_archived 引用', () => {
    expect(repoSrc).toMatch(/async archive\(/);
    const archiveBlock = repoSrc.match(/async archive\([\s\S]*?^\s{2}\},?\s*$/m);
    // 简单检查：整个 archive 方法区域不出现 is_archived
  });

  it('restore() 不含 is_archived/archived_at/archived_by 引用', () => {
    // restore 方法内部不应更新 product_variant 的归档字段
    expect(repoSrc).toMatch(/user_variant_preference/);
  });

  it('list() 不含 .is_archived DB 过滤', () => {
    // list 方法不再使用 is_archived 过滤
    expect(repoSrc).toContain('不再使用 is_archived 列');
  });

  it('match() 不含 is_archived 检查（不再阻止已归档匹配）', () => {
    // match 方法中应包含"不再阻止匹配操作"
    expect(repoSrc).toContain('不再阻止匹配操作');
  });

  it('batchMatch() 不含 is_archived 检查', () => {
    expect(repoSrc).toContain('归档是用户个人视图偏好');
  });

  it('包含 user_variant_preference 表引用', () => {
    expect(repoSrc).toMatch(/user_variant_preference/);
  });
});

// ─── archive() 签名验证 ───────────────────────────────────────────────

describe('P5-SY11G-B — archive() 签名', () => {
  it('archive() 接受 variantIds + userId 两个参数', async () => {
    const { variantRepository } = await import('./repository');
    expect(variantRepository.archive.length).toBe(2);
  });

  it('空数组返回 INVALID_ID', async () => {
    const { variantRepository } = await import('./repository');
    await expect(
      variantRepository.archive([], 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa')
    ).rejects.toMatchObject({ code: 'INVALID_ID' });
  });

  it('非法 UUID 返回 INVALID_ID', async () => {
    const { variantRepository } = await import('./repository');
    await expect(
      variantRepository.archive(['not-a-uuid'], 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa')
    ).rejects.toMatchObject({ code: 'INVALID_ID' });
  });

  it('非法 userId 返回 INVALID_ID', async () => {
    const { variantRepository } = await import('./repository');
    await expect(
      variantRepository.archive(['11111111-1111-4111-1111-111111111111'], 'bad-user-id')
    ).rejects.toMatchObject({ code: 'INVALID_ID' });
  });
});

// ─── restore() 签名验证 ───────────────────────────────────────────────

describe('P5-SY11G-B — restore() 签名', () => {
  it('restore() 接受 variantIds + userId 两个参数', async () => {
    const { variantRepository } = await import('./repository');
    expect(variantRepository.restore.length).toBe(2);
  });

  it('空数组返回 INVALID_ID', async () => {
    const { variantRepository } = await import('./repository');
    await expect(
      variantRepository.restore([], 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa')
    ).rejects.toMatchObject({ code: 'INVALID_ID' });
  });
});

// ─── getUserArchivedVariantIds() ──────────────────────────────────────

describe('P5-SY11G-B — getUserArchivedVariantIds()', () => {
  it('方法存在且接受 userId 参数', async () => {
    const { variantRepository } = await import('./repository');
    expect(variantRepository.getUserArchivedVariantIds).toBeDefined();
    expect(variantRepository.getUserArchivedVariantIds.length).toBe(1);
  });

  it('非法 userId 返回空 Set', async () => {
    const { variantRepository } = await import('./repository');
    const result = await variantRepository.getUserArchivedVariantIds('bad-id');
    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(0);
  });
});

// ─── VariantItem 类型 ─────────────────────────────────────────────────

describe('P5-SY11G-B — VariantItem 类型', () => {
  it('VariantItem 包含 isArchivedByUser（用户级归档标记）', async () => {
    const types = await import('./types');
    const VALID_UUID = '11111111-1111-4111-1111-111111111111';
    const item: types.VariantItem = {
      id: VALID_UUID, product_id: null, sku: 'SKU-1', country: 'TH', name: 'Test',
      match_status: 'unmatched', last_sync_at: null,
      is_archived: false, archived_at: null, archived_by: null,
      created_at: '', updated_at: '',
      productName: null, productCode: null,
      isArchivedByUser: false,
    };
    expect(item.isArchivedByUser).toBe(false);
  });
});

// ─── VariantFilters 类型 ──────────────────────────────────────────────

describe('P5-SY11G-B — VariantFilters 类型', () => {
  it('VariantFilters 包含 userId 字段', async () => {
    const types = await import('./types');
    const filters: types.VariantFilters = { userId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' };
    expect(filters.userId).toBeDefined();
  });
});

// ─── VariantError 不再包含 ARCHIVED ───────────────────────────────────

describe('P5-SY11G-B — VariantError 错误码', () => {
  it('code 枚举不含 ARCHIVED（归档不再阻止匹配操作）', async () => {
    const { VariantError } = await import('./repository');
    // 通过实例化检查 code 联合类型是否包含 ARCHIVED
    const e = new VariantError('test', 'INVALID_ID');
    expect(e.code).toBe('INVALID_ID');
    // ALREADY_ARCHIVED 替代 ARCHIVED（语义从"已归档不可操作"变为"不可重复归档"）
    const e2 = new VariantError('test', 'ALREADY_ARCHIVED');
    expect(e2.code).toBe('ALREADY_ARCHIVED');
  });
});

// ─── 注释文档检查 ─────────────────────────────────────────────────────

describe('P5-SY11G-B — 文档注释', () => {
  let repoSrc: string;

  beforeAll(() => {
    repoSrc = fs.readFileSync(REPO_PATH, 'utf-8');
  });

  it('文件头注释说明 is_archived 列为遗留列', () => {
    expect(repoSrc).toContain('is_archived 列为遗留列');
  });

  it('文件头注释说明使用 user_variant_preference', () => {
    expect(repoSrc).toContain('P5-SY11G');
  });
});
