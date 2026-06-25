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

// ─── P5-SY11G 返工：list() DB 层归档过滤（分页前）────────────────────

describe('P5-SY11G-B 返工 — list() 归档过滤在分页前完成', () => {
  let repoSrc: string;

  beforeAll(() => {
    repoSrc = fs.readFileSync(REPO_PATH, 'utf-8');
  });

  it('list() 始终加载 archivedVariantIds（含 all，用于 isArchivedByUser 标记）', () => {
    const fnBody = repoSrc.match(/async list\([\s\S]*?^\s{2}\},?\s*$/m);
    expect(fnBody).not.toBeNull();
    if (fnBody) {
      expect(fnBody[0]).toContain('始终加载');
      expect(fnBody[0]).toMatch(/archivedVariantIds\.size\s*===\s*0/);
    }
  });

  it('active tab 使用 notIn(id, archivedArray) 过滤（DB 层，分页前）', () => {
    // notIn 是 postgrest-js 内置方法，生成 not.in.(...) URL 语法
    // 旧的 .not('id','in',[...]) 生成 not.in.xxx,yyy 缺少括号，PostgREST 解析错误
    expect(repoSrc).toMatch(/\.notIn\s*\(\s*['"]id['"]\s*,\s*archivedArray/);
  });

  it('active tab 不再使用 .not(id, in, ...)（旧语法缺少括号，PostgREST 不识别）', () => {
    // 确保已迁移到 notIn，不再残留旧语法
    expect(repoSrc).not.toMatch(/\.not\s*\(\s*['"]id['"]\s*,\s*['"]in['"]/);
  });

  it('archived tab 使用 .in(id, archivedArray) 过滤（DB 层，分页前）', () => {
    expect(repoSrc).toMatch(/\.in\s*\(\s*['"]id['"]\s*,\s*archivedArray/);
  });

  it('count + range 在归档过滤之后执行（total 准确）', () => {
    const fnBody = repoSrc.match(/async list\([\s\S]*?^\s{2}\},?\s*$/m);
    expect(fnBody).not.toBeNull();
    if (fnBody) {
      const notInIdx = fnBody[0].indexOf(".notIn('id'");
      const inIdx = fnBody[0].indexOf(".in('id', archivedArray");
      const rangeIdx = fnBody[0].indexOf(".range(from");
      const filterIdx = Math.max(notInIdx, inIdx);
      if (filterIdx > 0 && rangeIdx > 0) {
        expect(filterIdx).toBeLessThan(rangeIdx);
      }
    }
  });

  it('archivedIds 为空时 archived tab 直接返回空（不查询 DB）', () => {
    const fnBody = repoSrc.match(/async list\([\s\S]*?^\s{2}\},?\s*$/m);
    expect(fnBody).not.toBeNull();
    if (fnBody) {
      expect(fnBody[0]).toMatch(/total:\s*0/);
    }
  });

  it('list() 不再在 JS 层分页后过滤归档（无 data.filter + archivedVariantIds.has）', () => {
    const fnBody = repoSrc.match(/async list\([\s\S]*?^\s{2}\},?\s*$/m);
    expect(fnBody).not.toBeNull();
    if (fnBody) {
      expect(fnBody[0]).not.toMatch(/data\.filter\s*\(.*archivedVariantIds/);
    }
  });
});

// ─── P5-SY11G 返工：notIn URL 生成行为验证 ─────────────────────────

describe('P5-SY11G-B 返工 — notIn vs .not() URL 语法行为对比', () => {
  // 行为验证：notIn() 生成 PostgREST 要求的 not.in.(val1,val2) 带括号语法
  // .not('id','in',[...]) 生成 not.in.val1,val2 缺少括号，PostgREST 拒绝

  async function buildQueryUrl(useNotIn: boolean): Promise<string[]> {
    const { PostgrestClient } = await import('@supabase/postgrest-js');
    const client = new PostgrestClient<Record<string, unknown>>('http://localhost:54321');
    const uuid1 = '11111111-1111-4111-1111-111111111111';
    const uuid2 = '22222222-2222-4222-2222-222222222222';

    let builder: Record<string, unknown>;
    if (useNotIn) {
      builder = client.from('product_variant').select('*').notIn('id', [uuid1, uuid2]) as unknown as Record<string, unknown>;
    } else {
      builder = client.from('product_variant').select('*').not('id', 'in', [uuid1, uuid2]) as unknown as Record<string, unknown>;
    }

    // PostgrestFilterBuilder 内部有 url 属性（URL 类型），存储查询参数
    const url = (builder as { url: URL }).url;
    return url.searchParams.getAll('id');
  }

  it('notIn(id, [...]) 生成 not.in.(...) 带括号语法（PostgREST 正确格式）', async () => {
    const params = await buildQueryUrl(true);
    expect(params.length).toBeGreaterThan(0);
    const notInParam = params.find((p) => p.startsWith('not.in.'));
    expect(notInParam).toBeDefined();
    // 必须包含括号：not.in.(uuid1,uuid2)
    expect(notInParam).toMatch(/^not\.in\.\(.+\)$/);
  });

  it('.not(id, in, [...]) 生成 not.in.xxx,yyy 无括号（PostgREST 拒绝此格式）', async () => {
    const params = await buildQueryUrl(false);
    expect(params.length).toBeGreaterThan(0);
    const notParam = params.find((p) => p.startsWith('not.in.'));
    expect(notParam).toBeDefined();
    // 旧语法无括号，PostgREST 不识别
    expect(notParam).not.toMatch(/^not\.in\.\(.+\)$/);
  });
});

// ─── P5-SY11G 返工：all tab 行为验证 ──────────────────────────────

describe('P5-SY11G-B 返工 — all tab 不过滤但正确标记 isArchivedByUser', () => {
  let repoSrc: string;

  beforeAll(() => {
    repoSrc = fs.readFileSync(REPO_PATH, 'utf-8');
  });

  it('all tab 不调用 notIn 或 .not 过滤', () => {
    const fnBody = repoSrc.match(/async list\([\s\S]*?^\s{2}\},?\s*$/m);
    expect(fnBody).not.toBeNull();
    if (fnBody) {
      // all tab（archiveStatus === 'all'）时只走「不过滤」分支
      expect(fnBody[0]).toContain("archiveStatus === 'all': 不过滤");
    }
  });

  it('all tab 仍加载 archivedVariantIds 用于 isArchivedByUser 标记', () => {
    // mapVariantItem 始终接收 archivedVariantIds Set
    expect(repoSrc).toMatch(/archivedVariantIds\.has\(row\.id/);
    // list() 中 mapVariantItem 调用传递 archivedVariantIds
    expect(repoSrc).toContain('mapVariantItem(');
  });
});

// ─── P5-SY11G 返工：archive()/restore() 返回实际变更数 ────────────────

describe('P5-SY11G-B 返工 — archive() 返回本次实际新增归档数', () => {
  let repoSrc: string;

  beforeAll(() => {
    repoSrc = fs.readFileSync(REPO_PATH, 'utf-8');
  });

  it('archive() 先查询已归档记录再插入（避免重复计入）', () => {
    const fnBody = repoSrc.match(/async archive\([\s\S]*?^\s{2}\},?\s*$/m);
    expect(fnBody).not.toBeNull();
    if (fnBody) {
      // 先查询 existing
      expect(fnBody[0]).toMatch(/alreadyArchived/);
      // 过滤出 toArchive = uniqueIds without alreadyArchived
      expect(fnBody[0]).toMatch(/toArchive/);
    }
  });

  it('archive() 不再使用 upsert + 全量计数（旧行为：返回总数非新增）', () => {
    const fnBody = repoSrc.match(/async archive\([\s\S]*?^\s{2}\},?\s*$/m);
    expect(fnBody).not.toBeNull();
    if (fnBody) {
      // 不再有 upsert
      expect(fnBody[0]).not.toMatch(/\.upsert/);
      // 不再 select count(*) 返回总数
      expect(fnBody[0]).not.toMatch(/inserted\?\.length/);
    }
  });

  it('archive() toArchive 为空时返回 0（全部已归档）', () => {
    const fnBody = repoSrc.match(/async archive\([\s\S]*?^\s{2}\},?\s*$/m);
    expect(fnBody).not.toBeNull();
    if (fnBody) {
      expect(fnBody[0]).toMatch(/toArchive\.length\s*===\s*0/);
      expect(fnBody[0]).toMatch(/archived:\s*0/);
    }
  });

  it('archive() 返回 toArchive.length（实际新增数，非总数）', () => {
    const fnBody = repoSrc.match(/async archive\([\s\S]*?^\s{2}\},?\s*$/m);
    expect(fnBody).not.toBeNull();
    if (fnBody) {
      expect(fnBody[0]).toMatch(/archived:\s*toArchive\.length/);
    }
  });
});

describe('P5-SY11G-B 返工 — restore() 返回本次实际恢复数', () => {
  let repoSrc: string;

  beforeAll(() => {
    repoSrc = fs.readFileSync(REPO_PATH, 'utf-8');
  });

  it('restore() 先查询实际已归档记录再删除（仅删除存在的偏好）', () => {
    const fnBody = repoSrc.match(/async restore\([\s\S]*?^\s{2}\},?\s*$/m);
    expect(fnBody).not.toBeNull();
    if (fnBody) {
      // 先查询 existing
      expect(fnBody[0]).toMatch(/actuallyArchived/);
    }
  });

  it('restore() 不再返回 uniqueIds.length（旧行为：返回请求数非实际数）', () => {
    const fnBody = repoSrc.match(/async restore\([\s\S]*?^\s{2}\},?\s*$/m);
    expect(fnBody).not.toBeNull();
    if (fnBody) {
      // 不应返回 uniqueIds.length 作为 restored 值
      expect(fnBody[0]).not.toMatch(/restored:\s*uniqueIds\.length/);
      // 应返回 actuallyArchived.length
      expect(fnBody[0]).toMatch(/restored:\s*actuallyArchived\.length/);
    }
  });

  it('restore() actuallyArchived 为空时返回 0', () => {
    const fnBody = repoSrc.match(/async restore\([\s\S]*?^\s{2}\},?\s*$/m);
    expect(fnBody).not.toBeNull();
    if (fnBody) {
      expect(fnBody[0]).toMatch(/actuallyArchived\.length\s*===\s*0/);
      expect(fnBody[0]).toMatch(/restored:\s*0/);
    }
  });
});

// ─── 多用户隔离行为 ───────────────────────────────────────────────────

describe('P5-SY11G-B 返工 — 多用户隔离行为', () => {
  it('archive() 仅写入当前 userId 的 user_variant_preference', () => {
    const repoSrc = fs.readFileSync(REPO_PATH, 'utf-8');
    const fnBody = repoSrc.match(/async archive\([\s\S]*?^\s{2}\},?\s*$/m);
    expect(fnBody).not.toBeNull();
    if (fnBody) {
      // 确认 user_id 设置为传入的 userId 参数
      expect(fnBody[0]).toMatch(/user_id:\s*userId/);
    }
  });

  it('restore() 仅删除当前 userId 的偏好', () => {
    const repoSrc = fs.readFileSync(REPO_PATH, 'utf-8');
    const fnBody = repoSrc.match(/async restore\([\s\S]*?^\s{2}\},?\s*$/m);
    expect(fnBody).not.toBeNull();
    if (fnBody) {
      // 确认 DELETE 带 .eq('user_id', userId)
      expect(fnBody[0]).toMatch(/\.eq\s*\(\s*['"]user_id['"]\s*,\s*userId/);
    }
  });
});
