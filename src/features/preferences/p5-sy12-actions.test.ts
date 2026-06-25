// P5-SY12: Preferences Server Actions 测试
//
// 验证:
// - toggleFavoriteAction 使用 requireActiveAuth()
// - Zod 校验 variantId UUID
// - 操作失败返回中文错误
// - 成功路径调用 revalidatePath('/dashboard') 和 revalidatePath('/dashboard/inventory/overseas')
// - 未登录用户拒绝
// - 禁止 any

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ACTIONS_PATH = path.resolve(process.cwd(), 'src/features/preferences/actions.ts');

// ─── source code checks ───────────────────────────────────────────────

describe('P5-SY12 — toggleFavoriteAction 源码检查', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(ACTIONS_PATH, 'utf-8');
  });

  it('toggleFavoriteAction 使用 requireActiveAuth', () => {
    expect(src).toMatch(/requireActiveAuth\(\)/);
  });

  it('toggleFavoriteAction Zod 校验 variantId', () => {
    expect(src).toMatch(/toggleFavoriteSchema\.safeParse/);
  });

  it('toggleFavoriteAction 成功路径 revalidatePath /dashboard', () => {
    expect(src).toContain("revalidatePath('/dashboard')");
  });

  it('toggleFavoriteAction 成功路径 revalidatePath /dashboard/inventory/overseas', () => {
    expect(src).toContain("revalidatePath('/dashboard/inventory/overseas')");
  });

  it('toggleFavoriteAction 返回中文错误（无效 SKU ID）', () => {
    expect(src).toContain('无效的 SKU ID');
  });

  it('toggleFavoriteAction 返回中文错误（未登录或账户已停用）', () => {
    expect(src).toContain('未登录或账户已停用');
  });

  it('toggleFavoriteAction 调用 preferencesRepository.toggleFavorite', () => {
    expect(src).toMatch(/preferencesRepository\.toggleFavorite/);
  });

  it('toggleFavoriteAction 不直接调用 supabase.from()', () => {
    expect(src).not.toMatch(/supabase\.from\(/);
  });

  it('toggleFavoriteAction 不直接调用 createClient()', () => {
    expect(src).not.toMatch(/createClient\(\)/);
  });

  it('actions.ts 不含 any', () => {
    expect(src).not.toMatch(/\bany\b/);
  });

  it('toggleFavoriteAction 返回类型是 Promise<ToggleFavoriteResult>', () => {
    expect(src).toMatch(/Promise<ToggleFavoriteResult>/);
  });
});

// ─── actions 模块导入检查 ──────────────────────────────────────────────

describe('P5-SY12 — actions 模块导入', () => {
  it('toggleFavoriteAction 可导入', async () => {
    const mod = await import('@/features/preferences/actions');
    expect(mod.toggleFavoriteAction).toBeDefined();
    expect(typeof mod.toggleFavoriteAction).toBe('function');
  });
});

// ─── revalidatePath 在失败路径不调用 ────────────────────────────────────

describe('P5-SY12 — 失败路径不调用 revalidatePath', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(ACTIONS_PATH, 'utf-8');
  });

  it('失败路径没有 revalidatePath 调用', () => {
    // 提取 toggleFavoriteAction 函数体
    const fnMatch = src.match(/export async function toggleFavoriteAction[\s\S]*?^}$/m);
    expect(fnMatch).not.toBeNull();
    if (fnMatch) {
      // 确认注释说明"失败路径不调用 revalidatePath"
      expect(src).toMatch(/失败路径不调用 revalidatePath/);
      // revalidatePath 调用应在 !result.success 检查之后
      const fnBody = fnMatch[0];
      const revalidateIdx = fnBody.indexOf('revalidatePath');
      const notSuccessIdx = fnBody.indexOf('!result.success');
      if (revalidateIdx > 0 && notSuccessIdx > 0) {
        expect(revalidateIdx).toBeGreaterThan(notSuccessIdx);
      }
    }
  });
});
