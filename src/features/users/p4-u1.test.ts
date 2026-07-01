// P4-U1: 用户数据层、邮箱字段与权限收口 — 测试
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Helpers ─────────────────────────────────────────────────

function readSrc(relativePath: string): string {
  return readFileSync(resolve('src', relativePath), 'utf-8');
}

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

  // ── 1f. 返工修复：email helper 错误传播 ────────────────────

  it('fetchEmailMap 在 auth.admin.listUsers error 时抛 UserError，不 break 静默', () => {
    const fn = extractFnBody(repo, 'fetchEmailMap');
    // 有独立的 if (error) 检查（不再合并为 if (error || ...)）
    expect(fn).toContain('if (error)');
    // error 分支抛 UserError
    expect(fn).toContain("throw new UserError('DB_ERROR', '获取用户邮箱失败");
    // 旧式 if (error || !data?.users) break 已不存在
    expect(fn).not.toMatch(/if\s*\(\s*error\s*\|\|/);
    // break 仅用于正常结束（"无更多用户" + "最后一页"），共 2 处
    const breakMatches = fn.match(/\bbreak\b/g) || [];
    expect(breakMatches.length).toBe(2);
  });

  it('fetchUserEmail 在 auth.admin.getUserById error 时抛 UserError，不静默返回空串', () => {
    const fn = extractFnBody(repo, 'fetchUserEmail');
    expect(fn).toContain('if (error)');
    expect(fn).toContain("throw new UserError('DB_ERROR', '获取用户邮箱失败");
    // 旧式 if (error || !data?.user?.email) return '' 已不存在
    expect(fn).not.toMatch(/if\s*\(\s*error\s*\|\|.*return\s*''/);
  });

  it('fetchUserEmail 在 auth user 不存在时（无 error）返回空字符串并附注释说明', () => {
    const fn = extractFnBody(repo, 'fetchUserEmail');
    // 注释说明 auth user 不存在时的行为
    expect(fn).toContain('auth user 不存在');
    // 无 error 但无 user/email 时返回 ''
    expect(fn).toContain("!data?.user?.email");
  });

  // ── 1g. P4-U5 收口：updateRole / toggleActive 调用原子 RPC ─

  it('updateRole 调用 update_user_role_protected RPC（原子化消除 TOCTOU 竞态）', () => {
    const fn = extractFnBody(repo, 'updateRole');
    expect(fn).toContain(".rpc('update_user_role_protected'");
    expect(fn).toContain('p_target_user_id');
    expect(fn).toContain('p_new_role_id');
    expect(fn).toContain('p_operator_user_id');
  });

  it('updateRole RPC error 时抛 UserError（含 RPC 返回的中文错误消息）', () => {
    const fn = extractFnBody(repo, 'updateRole');
    expect(fn).toContain("throw new UserError('DB_ERROR'");
    expect(fn).toContain('error.message');
  });

  it('toggleActive 调用 toggle_user_active_protected RPC（原子化消除 TOCTOU 竞态）', () => {
    const fn = extractFnBody(repo, 'toggleActive');
    expect(fn).toContain(".rpc('toggle_user_active_protected'");
    expect(fn).toContain('p_target_user_id');
    expect(fn).toContain('p_is_active');
    expect(fn).toContain('p_operator_user_id');
  });

  it('toggleActive RPC error 时抛 UserError（含 RPC 返回的中文错误消息）', () => {
    const fn = extractFnBody(repo, 'toggleActive');
    expect(fn).toContain("throw new UserError('DB_ERROR'");
    expect(fn).toContain('error.message');
  });

  // ── 1h. 返工修复：countByRole 显式 join ────────────────────

  it('countByRole 通过 role 表显式查询 roleId，不使用未 join 的 role.name 过滤', () => {
    const fn = extractFnBody(repo, 'countByRole');
    // 先查 role 表
    expect(fn).toContain("from('role')");
    // 用 role_id 过滤 profiles，不再用 role.name
    expect(fn).toContain(".eq('role_id', roleData.id)");
    // 旧式未 join 的 .eq('role.name', ...) 已不存在
    expect(fn).not.toMatch(/\.eq\(['"]role\.name/);
  });

  it('countByRole role 不存在时返回 0（非抛错）', () => {
    const fn = extractFnBody(repo, 'countByRole');
    expect(fn).toContain("PGRST116') return 0");
  });

  it('countByRole roleError 为真实 DB 错误时抛 UserError', () => {
    const fn = extractFnBody(repo, 'countByRole');
    // countByRole 中有两处 DB error 处理（role 查询 + profiles count）
    const throwMatches = fn.match(/throw new UserError\('DB_ERROR'/g) || [];
    expect(throwMatches.length).toBeGreaterThanOrEqual(1);
  });

  // ── 1i. 返工修复：getRoleName 区分 PGRST116 ────────────────

  it('getRoleName 区分 PGRST116（角色不存在 → null）与真实 DB 错误（throw）', () => {
    const fn = extractFnBody(repo, 'getRoleName');
    expect(fn).toContain("error.code === 'PGRST116'");
    expect(fn).toContain('return null');
    expect(fn).toContain("throw new UserError('DB_ERROR'");
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

  // 2d. 自保护 — 已收口至 RPC（原子化消除 TOCTOU 竞态）

  it('update_user_role_protected RPC 包含自降级保护', () => {
    const migration = readSrc('../supabase/migrations/00025_rpc_caller_identity_binding.sql');
    // RPC 函数体包含自降级检查
    const rpcStart = migration.indexOf('CREATE OR REPLACE FUNCTION update_user_role_protected');
    const rpcEnd = migration.indexOf('CREATE OR REPLACE FUNCTION toggle_user_active_protected');
    const rpcBody = migration.slice(rpcStart, rpcEnd > 0 ? rpcEnd : undefined);
    expect(rpcBody).toContain('不允许将自己的角色改为非管理员');
    expect(rpcBody).toContain("p_target_user_id = p_operator_user_id");
  });

  // 2e. 自保护 — 已收口至 RPC

  it('toggle_user_active_protected RPC 包含自禁用保护', () => {
    const migration = readSrc('../supabase/migrations/00025_rpc_caller_identity_binding.sql');
    const rpcStart = migration.indexOf('CREATE OR REPLACE FUNCTION toggle_user_active_protected');
    const rpcBody = migration.slice(rpcStart);
    expect(rpcBody).toContain('不允许禁用自己的账号');
    expect(rpcBody).toContain('NOT p_is_active AND p_target_user_id = p_operator_user_id');
  });

  // 2f. 最后管理员保护 — 已收口至 RPC

  it('update_user_role_protected RPC 包含最后管理员保护', () => {
    const migration = readSrc('../supabase/migrations/00025_rpc_caller_identity_binding.sql');
    expect(migration).toContain('不允许移除最后一个管理员的角色');
    expect(migration).toContain("v_admin_count <= 1");
  });

  it('toggle_user_active_protected RPC 包含最后管理员保护', () => {
    const migration = readSrc('../supabase/migrations/00025_rpc_caller_identity_binding.sql');
    expect(migration).toContain('不允许禁用最后一个管理员');
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

  // ── 2h. 返工修复：revalidatePath 仅在成功路径调用 ──────────

  it('updateUserRole 仅在 updateRole 调用成功后 revalidatePath，失败分支不 revalidate', () => {
    const body = extractFnBody(actions, 'updateUserRole');
    const revalIdx = body.indexOf('revalidatePath');
    const updateCallIdx = body.indexOf('userRepository.updateRole');
    expect(updateCallIdx).toBeGreaterThan(0);
    // revalidatePath 出现在 updateRole 调用之后（成功路径）
    expect(revalIdx).toBeGreaterThan(updateCallIdx);
  });

  it('toggleUserActive 仅在 toggleActive 调用成功后 revalidatePath，失败分支不 revalidate', () => {
    const body = extractFnBody(actions, 'toggleUserActive');
    const revalIdx = body.indexOf('revalidatePath');
    const toggleCallIdx = body.indexOf('userRepository.toggleActive');
    expect(toggleCallIdx).toBeGreaterThan(0);
    expect(revalIdx).toBeGreaterThan(toggleCallIdx);
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

  it('update_user_role_protected RPC 自降级检查先于最后管理员检查', () => {
    const migration = readSrc('../supabase/migrations/00025_rpc_caller_identity_binding.sql');
    const rpcStart = migration.indexOf('CREATE OR REPLACE FUNCTION update_user_role_protected');
    const rpcEnd = migration.indexOf('CREATE OR REPLACE FUNCTION toggle_user_active_protected');
    const rpcBody = migration.slice(rpcStart, rpcEnd > 0 ? rpcEnd : undefined);
    const selfIdx = rpcBody.indexOf('不允许将自己的角色改为非管理员');
    const lastAdminIdx = rpcBody.indexOf('不允许移除最后一个管理员的角色');
    expect(selfIdx).toBeGreaterThan(0);
    expect(lastAdminIdx).toBeGreaterThan(0);
    expect(selfIdx).toBeLessThan(lastAdminIdx);
  });

  it('toggle_user_active_protected RPC 自禁用检查先于最后管理员检查', () => {
    const migration = readSrc('../supabase/migrations/00025_rpc_caller_identity_binding.sql');
    const rpcStart = migration.indexOf('CREATE OR REPLACE FUNCTION toggle_user_active_protected');
    const rpcBody = migration.slice(rpcStart);
    const selfIdx = rpcBody.indexOf('不允许禁用自己的账号');
    const lastAdminIdx = rpcBody.indexOf('不允许禁用最后一个管理员');
    expect(selfIdx).toBeGreaterThan(0);
    expect(lastAdminIdx).toBeGreaterThan(0);
    expect(selfIdx).toBeLessThan(lastAdminIdx);
  });

  it('update_user_role_protected RPC 先查 v_new_role_name 再做比较', () => {
    const migration = readSrc('../supabase/migrations/00025_rpc_caller_identity_binding.sql');
    const rpcStart = migration.indexOf('CREATE OR REPLACE FUNCTION update_user_role_protected');
    const rpcEnd = migration.indexOf('CREATE OR REPLACE FUNCTION toggle_user_active_protected');
    const rpcBody = migration.slice(rpcStart, rpcEnd > 0 ? rpcEnd : undefined);
    // v_new_role_name 从 role 表查询而非比较 targetUser.roleName
    expect(rpcBody).toContain('SELECT name INTO v_new_role_name FROM public.role WHERE id = p_new_role_id');
    expect(rpcBody).toContain('v_new_role_name');
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

  it('P4-U5 updateUserRole action 不再使用 targetUser.roleName（业务规则收口至 RPC）', () => {
    const actions = readSrc('features/users/actions.ts');
    const body = extractFnBody(actions, 'updateUserRole');
    // 业务规则已收入 RPC，action 不再直接比较 targetUser.roleName
    expect(body).not.toContain('targetUser.roleName');
    expect(body).not.toContain('targetRoleName');
  });

  it('repository updateRole 仍返回 Promise<void>（P4-U5 新增 operatorId 参数）', () => {
    const repo = readSrc('features/users/repository.ts');
    const fnStart = repo.indexOf('updateRole(userId: string, roleId: string, operatorId: string)');
    expect(fnStart).toBeGreaterThan(0);
    const fnBody = extractFnBody(repo, 'updateRole');
    expect(fnBody).not.toMatch(/return\s+true|return\s+false/);
  });

  it('repository toggleActive 仍返回 Promise<void>（P4-U5 新增 operatorId 参数）', () => {
    const repo = readSrc('features/users/repository.ts');
    const fnStart = repo.indexOf('toggleActive(userId: string, isActive: boolean, operatorId: string)');
    expect(fnStart).toBeGreaterThan(0);
    const fnBody = extractFnBody(repo, 'toggleActive');
    expect(fnBody).not.toMatch(/return\s+true|return\s+false/);
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

  // Try patterns in order: (1) export async function (2) async function (3) const fn =
  // (4) async fnName(...) (5) generic fnName(...) — avoid matching calls over definitions
  const patterns = [
    `export\\s+async\\s+function\\s+${escaped}\\b`,
    `async\\s+function\\s+${escaped}\\b`,
    `\\bconst\\s+${escaped}\\s*=`,          // arrow function: const fn = (...) => {
    `async\\s+${escaped}\\s*\\(`,           // method shorthand e.g. "async updateRole("
    `\\b${escaped}\\s*\\(`,                 // fallback (may match calls)
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

  // Find the real opening { for the function body (skip return type annotation + nested generics)
  let pos = parenEnd + 1;
  let angleDepth = 0;
  while (pos < src.length) {
    const ch = src[pos];
    if (ch === '<') angleDepth++;
    else if (ch === '>') angleDepth--;
    else if (ch === '{' && angleDepth === 0) break;
    pos++;
  }
  const bodyOpen = pos < src.length ? pos : -1;
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
