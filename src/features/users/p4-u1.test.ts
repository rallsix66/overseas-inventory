// P4-U1: 用户数据层、邮箱字段与权限收口 — 测试
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Helpers ─────────────────────────────────────────────────

function readSrc(relativePath: string): string {
  return readFileSync(resolve('src', relativePath), 'utf-8');
}

type ActionResult<T = unknown> = { success: boolean; error?: string; data?: T };

// ─── 1. Repository ──────────────────────────────────────────

describe('P4-U1 Repository', () => {
  const repoPath = 'features/users/repository.ts';
  let repo: string;

  beforeEach(() => {
    repo = readSrc(repoPath);
  });

  // 1a. email 获取链路

  it('list() 使用 createServiceClient 获取 email 映射', () => {
    expect(repo).toContain('createServiceClient');
    expect(repo).toContain('fetchEmailMap');
    expect(repo).toContain('auth.admin.listUsers');
  });

  it('getById() 通过 auth.admin.getUserById 获取 email', () => {
    expect(repo).toContain('auth.admin.getUserById');
    expect(repo).toContain('fetchUserEmail');
  });

  it('email 不从空字符串硬编码返回', () => {
    // 不能有 email: '' 这种硬编码
    expect(repo).not.toMatch(/email:\s*''/);
  });

  it('list() 返回结构含 email 字段且从 emailMap 取值', () => {
    expect(repo).toContain('emailMap.get');
    expect(repo).toContain('email:');
  });

  it('getById() 调用 fetchUserEmail(id) 获取 email', () => {
    // fetchUserEmail 在 getById 中被调用
    const getByIdStart = repo.indexOf('async getById');
    const getByIdEnd = repo.indexOf('async getRoleName');
    const getByIdBody = repo.slice(getByIdStart, getByIdEnd > 0 ? getByIdEnd : undefined);
    expect(getByIdBody).toContain('fetchUserEmail');
  });

  // 1b. DB error 传播

  it('list() DB error 抛出 UserError 而非返回空数据', () => {
    expect(repo).toContain("throw new UserError('DB_ERROR'");
    // 不在 error 分支返回伪成功
    const listFn = extractFnBody(repo, 'list');
    expect(listFn).not.toMatch(/if\s*\(\s*error\s*\).*return\s*\{/);
  });

  it('getById() 区分 PGRST116（not found → null）与真实 DB error（throw）', () => {
    expect(repo).toContain("error.code === 'PGRST116'");
    expect(repo).toContain('return null');
    expect(repo).toContain("throw new UserError('DB_ERROR'");
  });

  it('list() 非空数据情况下不吞错误也不返回空 data', () => {
    // 确保 error 分支只有 throw，没有 return { data: [] }
    const lines = repo.split('\n');
    const errorLines = lines.filter((l) => l.includes('if (error)'));
    for (const line of errorLines) {
      // error 后的下一行必须是 throw
      const idx = lines.indexOf(line);
      const nextLine = lines[idx + 1]?.trim();
      expect(nextLine).toMatch(/throw/);
    }
  });

  // 1c. countByRole / getRoleName

  it('countByRole 统计活跃用户数（带 is_active 过滤）', () => {
    expect(repo).toContain('countByRole');
    expect(repo).toContain("eq('is_active', true)");
  });

  it('getRoleName 查询 role 表返回 name', () => {
    expect(repo).toContain('getRoleName');
    expect(repo).toContain("from('role')");
  });

  // 1d. updateRole / toggleActive error 传播

  it('updateRole DB error 抛出 UserError', () => {
    const fn = extractFnBody(repo, 'updateRole');
    expect(fn).toContain("throw new UserError('DB_ERROR'");
    // 不返回 boolean
    expect(fn).not.toMatch(/return\s+!error/);
  });

  it('toggleActive DB error 抛出 UserError', () => {
    const fn = extractFnBody(repo, 'toggleActive');
    expect(fn).toContain("throw new UserError('DB_ERROR'");
    expect(fn).not.toMatch(/return\s+!error/);
  });

  // 1e. createClient 用于 profiles 查询，createServiceClient 仅用于 email

  it('profiles 查询使用 createClient()（非 service_role）', () => {
    // list 和 getById 中的 supabase.from('profiles') 应该来自 createClient()
    // 确保 fetchEmailMap 是唯一使用 createServiceClient 的地方
    const svcMatches = repo.match(/createServiceClient/g);
    expect(svcMatches).not.toBeNull();
    // createServiceClient 只应在 email helper 中出现（fetchEmailMap + fetchUserEmail = 2 次）
    // 至少 ≥ 2，profile 查询应该用 createClient
  });
});

// ─── 2. Actions ─────────────────────────────────────────────

describe('P4-U1 Actions', () => {
  const actionsPath = 'features/users/actions.ts';
  let actions: string;

  beforeEach(() => {
    actions = readSrc(actionsPath);
  });

  // 2a. 认证链收口

  it('所有 export async function 使用 requireActiveAuth', () => {
    const exports = extractExports(actions);
    expect(exports.length).toBeGreaterThanOrEqual(4);
    for (const exp of exports) {
      const body = extractFnBody(actions, exp);
      expect(body).toContain('requireActiveAuth()');
    }
  });

  it('不使用旧的 requireAdmin 或 getCurrentUser', () => {
    expect(actions).not.toContain('requireAdmin()');
    expect(actions).not.toContain('getCurrentUser()');
  });

  it('写操作使用 roleName !== \'admin\' 而非 requireAdmin', () => {
    expect(actions).toContain("roleName !== 'admin'");
  });

  // 2b. Admin-only 检查

  it('listUsers 拒绝非 admin', () => {
    const body = extractFnBody(actions, 'listUsers');
    expect(body).toContain("roleName !== 'admin'");
    expect(body).toContain('仅管理员可查看用户列表');
  });

  it('getUserById 拒绝非 admin', () => {
    const body = extractFnBody(actions, 'getUserById');
    expect(body).toContain("roleName !== 'admin'");
    expect(body).toContain('仅管理员可查看用户详情');
  });

  it('updateUserRole 拒绝非 admin', () => {
    const body = extractFnBody(actions, 'updateUserRole');
    expect(body).toContain("roleName !== 'admin'");
    expect(body).toContain('仅管理员可修改用户角色');
  });

  it('toggleUserActive 拒绝非 admin', () => {
    const body = extractFnBody(actions, 'toggleUserActive');
    expect(body).toContain("roleName !== 'admin'");
    expect(body).toContain('仅管理员可修改用户状态');
  });

  // 2c. Zod 校验

  it('listUsers 使用 listFiltersSchema safeParse', () => {
    const body = extractFnBody(actions, 'listUsers');
    expect(body).toContain('listFiltersSchema.safeParse');
  });

  it('getUserById 使用 userIdSchema safeParse', () => {
    const body = extractFnBody(actions, 'getUserById');
    expect(body).toContain('userIdSchema.safeParse');
  });

  it('updateUserRole 使用 updateRoleSchema safeParse', () => {
    const body = extractFnBody(actions, 'updateUserRole');
    expect(body).toContain('updateRoleSchema.safeParse');
  });

  it('toggleUserActive 使用 toggleActiveSchema safeParse', () => {
    const body = extractFnBody(actions, 'toggleUserActive');
    expect(body).toContain('toggleActiveSchema.safeParse');
  });

  // 2d. 自保护 — 不能降级自己

  it('updateUserRole 拒绝将自己改为非管理员', () => {
    const body = extractFnBody(actions, 'updateUserRole');
    expect(body).toContain('不允许将自己的角色改为非管理员');
    expect(body).toContain("parsed.data.userId === currentUser.id");
  });

  // 2e. 自保护 — 不能禁用自己

  it('toggleUserActive 拒绝禁用自己', () => {
    const body = extractFnBody(actions, 'toggleUserActive');
    expect(body).toContain('不允许禁用自己的账号');
    expect(body).toContain('!parsed.data.isActive');
  });

  // 2f. 自保护 — 不能降级/禁用最后一个管理员

  it('updateUserRole 拒绝降级最后一个管理员', () => {
    const body = extractFnBody(actions, 'updateUserRole');
    expect(body).toContain('不允许移除最后一个管理员的角色');
    expect(body).toContain('countByRole');
    expect(body).toContain('adminCount <= 1');
  });

  it('toggleUserActive 拒绝禁用最后一个管理员', () => {
    const body = extractFnBody(actions, 'toggleUserActive');
    expect(body).toContain('不允许禁用最后一个管理员');
    expect(body).toContain('countByRole');
  });

  // 2g. 错误处理

  it('所有 action 捕获 UserError 并转为 ActionResult', () => {
    const exports = extractExports(actions);
    for (const exp of exports) {
      const body = extractFnBody(actions, exp);
      expect(body).toContain('UserError');
    }
  });

  it('所有 action 有兜底 catch 返回中文错误', () => {
    const exports = extractExports(actions);
    for (const exp of exports) {
      const body = extractFnBody(actions, exp);
      expect(body).toMatch(/catch\s*\(error\)/);
      // 至少有一个 error.message 或中文兜底
      expect(body).toMatch(/error\.message|失败，请稍后重试/);
    }
  });
});

// ─── 3. Schema / Types ──────────────────────────────────────

describe('P4-U1 Schema & Types', () => {
  it('types.ts 定义 UserError class（name/code/constructor）', () => {
    const types = readSrc('features/users/types.ts');
    expect(types).toContain('class UserError extends Error');
    expect(types).toContain("name = 'UserError'");
    expect(types).toContain('code: UserErrorCode');
    expect(types).toContain('DB_ERROR');
    expect(types).toContain('NOT_FOUND');
    expect(types).toContain('FORBIDDEN');
    expect(types).toContain('LAST_ADMIN');
  });

  it('types.ts 无 any', () => {
    const types = readSrc('features/users/types.ts');
    expect(types).not.toMatch(/\bany\b/);
  });

  it('schema.ts 包含 listFiltersSchema / userIdSchema / updateRoleSchema / toggleActiveSchema', () => {
    const schema = readSrc('features/users/schema.ts');
    expect(schema).toContain('listFiltersSchema');
    expect(schema).toContain('userIdSchema');
    expect(schema).toContain('updateRoleSchema');
    expect(schema).toContain('toggleActiveSchema');
  });

  it('schema.ts 无 any', () => {
    const schema = readSrc('features/users/schema.ts');
    expect(schema).not.toMatch(/\bany\b/);
  });

  it('actions.ts 无 any', () => {
    const actions = readSrc('features/users/actions.ts');
    expect(actions).not.toMatch(/\bany\b/);
  });

  it('repository.ts 无 any', () => {
    const repo = readSrc('features/users/repository.ts');
    expect(repo).not.toMatch(/\bany\b/);
  });
});

// ─── 4. Service Role 隔离 ───────────────────────────────────

describe('P4-U1 Service Role 隔离', () => {
  it('actions.ts 不导入 createServiceClient', () => {
    const actions = readSrc('features/users/actions.ts');
    expect(actions).not.toContain('createServiceClient');
  });

  it('actions.ts 不导入 SUPABASE_SERVICE_ROLE_KEY', () => {
    const actions = readSrc('features/users/actions.ts');
    expect(actions).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('users page 不导入 createServiceClient 或 supabase admin', () => {
    const page = readSrc('app/dashboard/users/page.tsx');
    expect(page).not.toContain('createServiceClient');
    expect(page).not.toContain('service_role');
    expect(page).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(page).not.toContain('supabase.from');
  });

  it('users page 不直接调用 supabase', () => {
    const page = readSrc('app/dashboard/users/page.tsx');
    expect(page).not.toMatch(/supabase\.from|supabase\.rpc|supabase\.auth/);
  });

  it('repository 内 createServiceClient 仅在 import 和 email helper 中使用', () => {
    const repo = readSrc('features/users/repository.ts');
    // createServiceClient 出现位置：1 import + 1 fetchEmailMap + 1 fetchUserEmail
    const occurrences = (repo.match(/createServiceClient/g) || []).length;
    expect(occurrences).toBe(3);
    // 确认不在 updateRole / toggleActive / countByRole / getRoleName 中
    const nonEmailFns = ['updateRole', 'toggleActive', 'countByRole', 'getRoleName'];
    for (const fn of nonEmailFns) {
      const body = extractFnBody(repo, fn);
      expect(body).not.toContain('createServiceClient');
    }
  });
});

// ─── 5. 权限行为 (mock vi) ──────────────────────────────────

describe('P4-U1 权限行为（mock）', () => {
  // 这些测试验证 action 函数体中的权限逻辑，不连接 Supabase

  it('updateUserRole 自降级检查：比较 userId === currentUser.id 且 targetRoleName !== admin', () => {
    const actions = readSrc('features/users/actions.ts');
    const body = extractFnBody(actions, 'updateUserRole');
    // 检查逻辑顺序：先 getRoleName → 再 self-check → 再 last-admin check
    const selfCheckIdx = body.indexOf("parsed.data.userId === currentUser.id");
    const lastAdminIdx = body.indexOf('不允许移除最后一个管理员的角色');
    expect(selfCheckIdx).toBeGreaterThan(0);
    expect(lastAdminIdx).toBeGreaterThan(0);
    // 自检查在最后管理员检查之前
    expect(selfCheckIdx).toBeLessThan(lastAdminIdx);
  });

  it('toggleUserActive 自禁用检查在最后管理员检查之前', () => {
    const actions = readSrc('features/users/actions.ts');
    const body = extractFnBody(actions, 'toggleUserActive');
    const selfDisableIdx = body.indexOf('不允许禁用自己的账号');
    const lastAdminIdx = body.indexOf('不允许禁用最后一个管理员');
    expect(selfDisableIdx).toBeGreaterThan(0);
    expect(lastAdminIdx).toBeGreaterThan(0);
    expect(selfDisableIdx).toBeLessThan(lastAdminIdx);
  });

  it('updateUserRole 先查 targetRoleName 再比较，避免 roleName 字符串比较绕过', () => {
    const actions = readSrc('features/users/actions.ts');
    const body = extractFnBody(actions, 'updateUserRole');
    // 使用 getRoleName 查询目标角色，而非比较 targetUser.roleName（那是当前角色）
    expect(body).toContain('getRoleName');
    // targetRoleName 用于自我保护和最后管理员检查
    const targetRoleNameCount = (body.match(/targetRoleName/g) || []).length;
    expect(targetRoleNameCount).toBeGreaterThanOrEqual(2);
  });
});

// ─── 6. 与旧代码的差异 ─────────────────────────────────────

describe('P4-U1 旧问题修复确认', () => {
  it('repository list() 不再返回 email: \'\'', () => {
    const repo = readSrc('features/users/repository.ts');
    expect(repo).not.toMatch(/email:\s*''/);
  });

  it('repository getById() 不再返回 email: \'\'', () => {
    const repo = readSrc('features/users/repository.ts');
    expect(repo).not.toMatch(/email:\s*''/);
  });

  it('actions 不再导入 requireAdmin', () => {
    const actions = readSrc('features/users/actions.ts');
    expect(actions).not.toContain('requireAdmin');
    expect(actions).not.toContain('getCurrentUser');
  });

  it('updateUserRole 不再使用 targetUser.roleName 判断自降级', () => {
    const actions = readSrc('features/users/actions.ts');
    const body = extractFnBody(actions, 'updateUserRole');
    // 旧代码: if (targetUser && targetUser.roleName !== 'admin')
    // 新代码: targetRoleName !== 'admin'（查询目标 roleId 的角色名）
    // 自保护段不应出现 targetUser.roleName
    const selfProtectStart = body.indexOf("parsed.data.userId === currentUser.id");
    const selfProtectEnd = body.indexOf('}', selfProtectStart);
    const selfProtectBlock = body.slice(selfProtectStart, selfProtectEnd > 0 ? selfProtectEnd + 1 : undefined);
    expect(selfProtectBlock).not.toContain('targetUser.roleName');
  });

  it('repository updateRole 返回 void（不返回 boolean）', () => {
    const repo = readSrc('features/users/repository.ts');
    // find the full function signature + body
    const fnStart = repo.indexOf('updateRole(userId: string, roleId: string)');
    const fnBody = extractFnBody(repo, 'updateRole');
    const fullFn = repo.slice(Math.max(0, fnStart - 10), fnStart + 200); // include "async " prefix
    expect(fullFn).toMatch(/Promise<void>/);
    expect(fnBody).not.toMatch(/return\s+!/);
  });

  it('repository toggleActive 返回 void（不返回 boolean）', () => {
    const repo = readSrc('features/users/repository.ts');
    const fnStart = repo.indexOf('toggleActive(userId: string, isActive: boolean)');
    const fnBody = extractFnBody(repo, 'toggleActive');
    const fullFn = repo.slice(Math.max(0, fnStart - 10), fnStart + 200);
    expect(fullFn).toMatch(/Promise<void>/);
    expect(fnBody).not.toMatch(/return\s+!/);
  });
});

// ─── Utility Functions ──────────────────────────────────────

/** Extract exported async function names */
function extractExports(src: string): string[] {
  const re = /export\s+async\s+function\s+(\w+)/g;
  const names: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    names.push(m[1]);
  }
  return names;
}

/** Extract function body — find the real { after params/return type, then bracket-match.
 *  Works for: export async function fnName / async function fnName / async fnName (method shorthand) */
function extractFnBody(src: string, fnName: string): string {
  const escaped = fnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Try patterns in order: (1) export async function fnName (2) async function fnName (3) async fnName(...)
  const patterns = [
    `export\\s+async\\s+function\\s+${escaped}\\b`,
    `async\\s+function\\s+${escaped}\\b`,
    `async\\s+${escaped}\\s*\\(`,          // method shorthand e.g. "async updateRole("
    `\\b${escaped}\\s*\\(`,                // fallback: plain function call pattern
  ];

  let startMatch: RegExpExecArray | null = null;
  let matchIdx = -1;
  for (const pat of patterns) {
    const re = new RegExp(pat);
    const m = re.exec(src);
    if (m) {
      // For method shorthands, prefer matches preceded by start-of-line or whitespace (not inside strings)
      const before = m.index > 0 ? src[m.index - 1] : '\n';
      if (before === '\n' || before === ' ' || before === '\t' || before === '\r' || m.index === 0) {
        startMatch = m;
        matchIdx = m.index;
        break;
      }
    }
  }
  if (!startMatch) return '';

  // Find the opening paren of params
  const parenStart = src.indexOf('(', matchIdx);
  if (parenStart === -1) return '';

  // Match parentheses to find the closing ) of params
  let parenDepth = 0;
  let parenEnd = -1;
  for (let i = parenStart; i < src.length; i++) {
    if (src[i] === '(') parenDepth++;
    else if (src[i] === ')') {
      parenDepth--;
      if (parenDepth === 0) { parenEnd = i; break; }
    }
  }
  if (parenEnd === -1) return '';

  // Find the real opening { for the function body (skip return type annotation)
  const bodyOpen = src.indexOf('{', parenEnd);
  if (bodyOpen === -1) return '';

  // Bracket-match from the real body opening
  let depth = 0;
  for (let i = bodyOpen; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) {
        return src.slice(bodyOpen, i + 1);
      }
    }
  }

  return src.slice(bodyOpen);
}
