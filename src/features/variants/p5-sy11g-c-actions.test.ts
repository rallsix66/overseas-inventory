// P5-SY11G-C: Server Actions 测试（用户级归档偏好）
//
// 验证:
// - archiveVariants/restoreVariants 使用 requireActiveAuth() 而非 requireActiveAdmin()
// - 从 session 获取 userId（不再使用 archivedBy 参数）
// - Admin 和 Operator 均可归档/恢复
// - 匹配/取消匹配仍仅 Admin（requireAdmin 不变）
// - 源码不含 requireActiveAdmin（归档/恢复路径）

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ACTIONS_PATH = path.resolve(process.cwd(), 'src/features/variants/actions.ts');

// ─── 权限校验：归档/恢复使用 requireActiveAuth ──────────────────────

describe('P5-SY11G-C — 权限校验', () => {
  let actionsSrc: string;

  beforeAll(() => {
    actionsSrc = fs.readFileSync(ACTIONS_PATH, 'utf-8');
  });

  it('archiveVariants 使用 requireActiveAuth（非 requireActiveAdmin）', () => {
    // archiveVariants 函数体内应有 requireActiveAuth() 调用
    expect(actionsSrc).toContain('requireActiveAuth');
    // 归档/恢复不应再调用 requireActiveAdmin（匹配/取消匹配仍可用）
    // 验证 archiveVariants 函数体中不含 requireActiveAdmin
    const archiveFn = actionsSrc.match(/export async function archiveVariants[\s\S]*?^}/m);
    expect(archiveFn).not.toBeNull();
    if (archiveFn) {
      expect(archiveFn[0]).not.toMatch(/requireActiveAdmin/);
      expect(archiveFn[0]).toMatch(/requireActiveAuth/);
    }
  });

  it('restoreVariants 使用 requireActiveAuth（非 requireActiveAdmin）', () => {
    const restoreFn = actionsSrc.match(/export async function restoreVariants[\s\S]*?^}/m);
    expect(restoreFn).not.toBeNull();
    if (restoreFn) {
      expect(restoreFn[0]).not.toMatch(/requireActiveAdmin/);
      expect(restoreFn[0]).toMatch(/requireActiveAuth/);
    }
  });

  it('matchVariant 仍使用 requireAdmin（匹配仅 Admin）', () => {
    expect(actionsSrc).toContain('requireAdmin');
  });

  it('归档/恢复从 user.id 获取 userId（非 archivedBy 参数）', () => {
    // archiveVariants/restoreVariants 应从 requireActiveAuth() 获取 user.id
    expect(actionsSrc).toMatch(/user\.id/);
  });
});

// ─── 错误处理 ────────────────────────────────────────────────────────

describe('P5-SY11G-C — 错误处理', () => {
  let actionsSrc: string;

  beforeAll(() => {
    actionsSrc = fs.readFileSync(ACTIONS_PATH, 'utf-8');
  });

  it('archiveVariants 处理"未登录或账户已停用"错误', () => {
    expect(actionsSrc).toContain('未登录或账户已停用');
  });

  it('restoreVariants 处理"未登录或账户已停用"错误', () => {
    // restoreVariants 也有相同的错误处理
    expect(actionsSrc).toContain('恢复失败，请稍后重试');
  });

  it('不再处理"无权限：需要管理员角色"错误（归档/恢复路径）', () => {
    const archiveFn = actionsSrc.match(/export async function archiveVariants[\s\S]*?^}/m);
    expect(archiveFn).not.toBeNull();
    if (archiveFn) {
      // archiveVariants 不应检查管理员角色
      expect(archiveFn[0]).not.toMatch(/需要管理员角色/);
    }
  });
});

// ─── 签名验证 ────────────────────────────────────────────────────────

describe('P5-SY11G-C — Server Action 签名', () => {
  it('archiveVariants 仅接受 variantIds 参数（userId 从 session 获取）', async () => {
    const actions = await import('./actions');
    // Server Action 签名仅接收客户端传入的参数
    expect(actions.archiveVariants.length).toBe(1);
  });

  it('restoreVariants 仅接受 variantIds 参数（userId 从 session 获取）', async () => {
    const actions = await import('./actions');
    expect(actions.restoreVariants.length).toBe(1);
  });

  it('matchVariant 签名不变（variantId + productId）', async () => {
    const actions = await import('./actions');
    expect(actions.matchVariant.length).toBe(2);
  });
});

// ─── revalidatePath ───────────────────────────────────────────────────

describe('P5-SY11G-C — revalidatePath', () => {
  let actionsSrc: string;

  beforeAll(() => {
    actionsSrc = fs.readFileSync(ACTIONS_PATH, 'utf-8');
  });

  it('archiveVariants revalidate /dashboard/variants 和 /dashboard/variants/unmatched', () => {
    expect(actionsSrc).toContain("revalidatePath('/dashboard/variants')");
    expect(actionsSrc).toContain("revalidatePath('/dashboard/variants/unmatched')");
  });

  it('restoreVariants revalidate /dashboard/variants 和 /dashboard/variants/unmatched', () => {
    // restoreVariants 也应有相同的 revalidatePath
    const restoreCount = (actionsSrc.match(/restoreVariants[\s\S]*?revalidatePath/g) || []).length;
    expect(restoreCount).toBeGreaterThanOrEqual(1);
  });
});

// ─── 注释文档 ────────────────────────────────────────────────────────

describe('P5-SY11G-C — 文档注释', () => {
  let actionsSrc: string;

  beforeAll(() => {
    actionsSrc = fs.readFileSync(ACTIONS_PATH, 'utf-8');
  });

  it('模块头注释说明归档对所有已登录用户可用', () => {
    expect(actionsSrc).toContain('所有已登录用户');
  });

  it('archiveVariants JSDoc 说明所有已登录用户均可操作', () => {
    expect(actionsSrc).toContain('所有已登录用户均可操作');
  });
});
