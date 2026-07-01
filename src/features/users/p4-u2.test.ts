// P4-U2: 用户列表只读页面 — 测试
// 覆盖：架构合规、权限、筛选/Zod 链路、UI 状态、组件隔离
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Helpers ─────────────────────────────────────────────────

function readSrc(relativePath: string): string {
  return readFileSync(resolve('src', relativePath), 'utf-8');
}

/** Extract function body — find the real { after params/return type, then bracket-match. */
function extractFnBody(src: string, fnName: string): string {
  const escaped = fnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    `export\\s+async\\s+function\\s+${escaped}\\b`,
    `async\\s+function\\s+${escaped}\\b`,
    `\\bconst\\s+${escaped}\\s*=`,          // arrow function: const fn = (...) => {
    `async\\s+${escaped}\\s*\\(`,
    `\\b${escaped}\\s*\\(`,
  ];

  let matchIdx = -1;
  for (const pat of patterns) {
    const re = new RegExp(pat);
    const m = re.exec(src);
    if (m) {
      const before = m.index > 0 ? src[m.index - 1] : '\n';
      if (before === '\n' || before === ' ' || before === '\t' || before === '\r' || m.index === 0) {
        matchIdx = m.index;
        break;
      }
    }
  }
  if (matchIdx === -1) return '';

  const parenStart = src.indexOf('(', matchIdx);
  if (parenStart === -1) return '';

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

  // Skip return type annotation (including nested generics) to find real body {
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

  let depth = 0;
  for (let i = bodyOpen; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(bodyOpen, i + 1);
    }
  }

  return src.slice(bodyOpen);
}

// ─── 1. 页面架构合规 ─────────────────────────────────────────

describe('P4-U2 页面架构合规', () => {
  const pagePath = 'app/dashboard/users/page.tsx';
  const contentPath = 'app/dashboard/users/_components/users-page-content.tsx';
  let page: string;
  let content: string;

  beforeAll(() => {
    page = readSrc(pagePath);
    content = readSrc(contentPath);
  });

  it('page.tsx 不直接调用 supabase.from / supabase.rpc', () => {
    expect(page).not.toMatch(/supabase\.from\(/);
    expect(page).not.toMatch(/supabase\.rpc\(/);
  });

  it('page.tsx 不调用 auth.admin', () => {
    expect(page).not.toContain('auth.admin');
  });

  it('page.tsx 不导入 createServiceClient', () => {
    expect(page).not.toContain('createServiceClient');
  });

  it('page.tsx 通过 listUsers Server Action 获取用户列表', () => {
    expect(page).toContain('listUsers');
    expect(page).toContain("from '@/features/users/actions'");
  });

  it('page.tsx 通过 listRoles Server Action 获取角色列表', () => {
    expect(page).toContain('listRoles');
  });

  it('page.tsx 获取当前用户进行权限校验（getCurrentActiveUser）', () => {
    expect(page).toContain('getCurrentActiveUser');
    expect(page).toContain("from '@/lib/auth'");
  });

  it('users-page-content.tsx 不直接调用 supabase / service_role / auth.admin', () => {
    expect(content).not.toMatch(/supabase\.from\(/);
    expect(content).not.toMatch(/supabase\.rpc\(/);
    expect(content).not.toContain('createServiceClient');
    expect(content).not.toContain('auth.admin');
    expect(content).not.toContain('service_role');
  });

  it('users-page-content.tsx 不导入 actions（数据由 page 层传入）', () => {
    // Content 组件接收 props，不自行调用 Server Actions
    expect(content).not.toContain("from '@/features/users/actions'");
  });
});

// ─── 2. 权限控制 ─────────────────────────────────────────────

describe('P4-U2 权限控制', () => {
  const pagePath = 'app/dashboard/users/page.tsx';
  let page: string;

  beforeAll(() => {
    page = readSrc(pagePath);
  });

  it('page.tsx 检查 roleName !== \'admin\' 并显示无权限', () => {
    expect(page).toContain("roleName !== 'admin'");
    expect(page).toContain('仅管理员可访问用户管理');
  });

  it('page.tsx 在非 admin 时返回无权限提示，不调用 listUsers', () => {
    const body = extractFnBody(page, 'UsersPage');
    // 先权限检查 → 再调用 listUsers
    const roleCheckIdx = body.indexOf("roleName !== 'admin'");
    const listUsersIdx = body.indexOf('listUsers');
    expect(roleCheckIdx).toBeGreaterThan(0);
    expect(listUsersIdx).toBeGreaterThan(roleCheckIdx);
  });
});

// ─── 3. 只读：无写操作泄露 ───────────────────────────────────

describe('P4-U2 只读保证', () => {
  it('page.tsx 不导入 updateUserRole / toggleUserActive', () => {
    const page = readSrc('app/dashboard/users/page.tsx');
    expect(page).not.toContain('updateUserRole');
    expect(page).not.toContain('toggleUserActive');
  });

  it('users-page-content.tsx 不导入 updateUserRole / toggleUserActive', () => {
    const content = readSrc('app/dashboard/users/_components/users-page-content.tsx');
    expect(content).not.toContain('updateUserRole');
    expect(content).not.toContain('toggleUserActive');
  });

  it('user-detail-sheet.tsx 只使用 getUserById，不使用写操作', () => {
    const sheet = readSrc('features/users/components/user-detail-sheet.tsx');
    expect(sheet).toContain('getUserById');
    expect(sheet).not.toContain('updateUserRole');
    expect(sheet).not.toContain('toggleUserActive');
  });

  it('user-detail-sheet.tsx 不出现写操作按钮（角色变更/账号启停）', () => {
    const sheet = readSrc('features/users/components/user-detail-sheet.tsx');
    // 无角色切换按钮文案
    expect(sheet).not.toContain('切换角色');
    // 无启用/禁用操作按钮（区别于状态 Badge 的纯文本展示）
    expect(sheet).not.toMatch(/Button.*启用/);
    expect(sheet).not.toMatch(/Button.*禁用/);
  });

  it('user-detail-sheet.tsx 不导入 supabase 或 service_role', () => {
    const sheet = readSrc('features/users/components/user-detail-sheet.tsx');
    expect(sheet).not.toMatch(/supabase\.from\(/);
    expect(sheet).not.toContain('createServiceClient');
    expect(sheet).not.toContain('service_role');
  });
});

// ─── 4. 筛选与 Zod 链路 ──────────────────────────────────────

describe('P4-U2 筛选与 Zod 链路', () => {
  let page: string;

  beforeAll(() => {
    page = readSrc('app/dashboard/users/page.tsx');
  });

  it('page.tsx 从 searchParams 读取 status/role/page 参数', () => {
    const body = extractFnBody(page, 'UsersPage');
    expect(body).toContain('searchParams');
    expect(body).toContain('sp.status');
    expect(body).toContain('sp.role');
    expect(body).toContain('sp.page');
  });

  it('page.tsx 将 status 映射为 isActive boolean 传给 listUsers', () => {
    const body = extractFnBody(page, 'UsersPage');
    // sp.status === 'active' → true, 'disabled' → false, 其他 → undefined
    expect(body).toContain("sp.status === 'active'");
    expect(body).toContain("sp.status === 'disabled'");
    expect(body).toContain('isActive');
  });

  it('page.tsx 将 role 搜参数转为 roleId 传给 listUsers', () => {
    const body = extractFnBody(page, 'UsersPage');
    // role !== 'all' → roleId, 否则 undefined
    expect(body).toContain("sp.role !== 'all'");
    expect(body).toContain('roleId');
  });

  it('page.tsx 调用 listUsers 时传入 pageSize: 20', () => {
    const body = extractFnBody(page, 'UsersPage');
    expect(body).toContain('pageSize: 20');
  });

  it('actions.ts 中 listUsers 使用 listFiltersSchema.safeParse', () => {
    const actions = readSrc('features/users/actions.ts');
    const body = extractFnBody(actions, 'listUsers');
    expect(body).toContain('listFiltersSchema.safeParse');
  });

  it('listFiltersSchema 支持 page/pageSize 默认值 (schema 覆盖)', () => {
    const schema = readSrc('features/users/schema.ts');
    expect(schema).toContain('listFiltersSchema');
    expect(schema).toContain('page');
    expect(schema).toContain('pageSize');
    expect(schema).toContain('.default(1)');
    expect(schema).toContain('.default(20)');
  });
});

// ─── 5. UI 状态覆盖 ──────────────────────────────────────────

describe('P4-U2 UI 状态', () => {
  let content: string;

  beforeAll(() => {
    content = readSrc('app/dashboard/users/_components/users-page-content.tsx');
  });

  it('空数据时显示提示信息', () => {
    expect(content).toContain('暂无匹配的用户');
    // data.length === 0 分支
    expect(content).toContain('data.length === 0');
  });

  it('包含分页控件：上一页 / 下一页 + 总条数 + 当前页信息', () => {
    expect(content).toContain('上一页');
    expect(content).toContain('下一页');
    expect(content).toContain('共');
    expect(content).toContain('条');
    expect(content).toContain('totalPages');
  });

  it('分页按钮在首页/末页正确禁用', () => {
    expect(content).toContain('page <= 1');
    expect(content).toContain('page >= totalPages');
  });

  it('筛选条件变更时重置页码（delete page param）', () => {
    // updateFilter 是 UsersPageContent 内部的 const 箭头函数，
    // extractFnBody 可能因外层组件嵌套的影响而匹配失败，直接检查源文件
    const idx = content.indexOf('const updateFilter');
    expect(idx).toBeGreaterThan(0);
    const snippet = content.slice(idx, idx + 500);
    expect(snippet).toContain("key !== 'page'");
    expect(snippet).toContain("delete('page')");
  });

  it('表格列包含：邮箱、显示名、角色、状态、创建时间、用户 ID', () => {
    expect(content).toContain('邮箱');
    expect(content).toContain('显示名');
    expect(content).toContain('角色');
    expect(content).toContain('状态');
    expect(content).toContain('创建时间');
    expect(content).toContain('用户 ID');
  });

  it('角色使用 Badge 显示（管理员 / 运营）', () => {
    expect(content).toContain('ROLE_LABELS');
    expect(content).toContain("'管理员'");
    expect(content).toContain("'运营'");
  });

  it('启用/禁用状态使用不同 Badge 样式', () => {
    expect(content).toContain('启用');
    expect(content).toContain('禁用');
    expect(content).toContain('green');
    expect(content).toContain('destructive');
  });
});

// ─── 6. 详情 Sheet 隔离 ──────────────────────────────────────

describe('P4-U2 详情 Sheet', () => {
  let sheet: string;

  beforeAll(() => {
    sheet = readSrc('features/users/components/user-detail-sheet.tsx');
  });

  it('Sheet 通过 getUserById Server Action 获取数据', () => {
    expect(sheet).toContain('getUserById');
    expect(sheet).toContain("from '@/features/users/actions'");
  });

  it('Sheet 处理加载状态（Skeleton）', () => {
    expect(sheet).toContain('loading');
    expect(sheet).toContain('Skeleton');
  });

  it('Sheet 处理错误状态', () => {
    expect(sheet).toContain('error');
    expect(sheet).toContain('加载用户详情失败');
  });

  it('Sheet 显示字段：邮箱、显示名、角色、状态、创建时间、用户 ID', () => {
    expect(sheet).toContain('邮箱');
    expect(sheet).toContain('显示名');
    expect(sheet).toContain('用户 ID');
  });

  it('Sheet 使用 cleanup 避免内存泄漏（cancelled flag）', () => {
    expect(sheet).toContain('cancelled');
    expect(sheet).toContain('return ()');
  });
});

// ─── 7. listRoles Action ─────────────────────────────────────

describe('P4-U2 listRoles 新增', () => {
  it('repository.ts 包含 listRoles 方法', () => {
    const repo = readSrc('features/users/repository.ts');
    expect(repo).toContain('listRoles');
    expect(repo).toContain("from('role')");
    expect(repo).toContain('.order(\'name\')');
  });

  it('listRoles DB error 时抛 UserError', () => {
    const repo = readSrc('features/users/repository.ts');
    const body = extractFnBody(repo, 'listRoles');
    expect(body).toContain("throw new UserError('DB_ERROR'");
  });

  it('actions.ts 包含 listRoles Server Action（Admin-only）', () => {
    const actions = readSrc('features/users/actions.ts');
    const body = extractFnBody(actions, 'listRoles');
    expect(body).toContain('requireActiveAuth');
    expect(body).toContain("roleName !== 'admin'");
    expect(body).toContain('仅管理员可查看角色列表');
    expect(body).toContain('userRepository.listRoles');
  });
});

// ─── 8. P4-U1 回归 — 已有测试继续通过 ─────────────────────────

describe('P4-U2 不破坏 P4-U1', () => {
  it('repository.ts 仍包含 P4-U1 所有方法', () => {
    const repo = readSrc('features/users/repository.ts');
    expect(repo).toContain('fetchEmailMap');
    expect(repo).toContain('fetchUserEmail');
    expect(repo).toContain('getRoleName');
    expect(repo).toContain('countByRole');
    expect(repo).toContain('async updateRole');
    expect(repo).toContain('async toggleActive');
    expect(repo).toContain('async list');
    expect(repo).toContain('async getById');
  });

  it('actions.ts 仍包含 P4-U1 所有 Server Actions', () => {
    const actions = readSrc('features/users/actions.ts');
    expect(actions).toContain('export async function listUsers');
    expect(actions).toContain('export async function getUserById');
    expect(actions).toContain('export async function updateUserRole');
    expect(actions).toContain('export async function toggleUserActive');
  });

  it('P4-U1 关键修复未被回退：fetchEmailMap error 抛 UserError', () => {
    const repo = readSrc('features/users/repository.ts');
    const body = extractFnBody(repo, 'fetchEmailMap');
    expect(body).toContain("throw new UserError('DB_ERROR'");
    // 旧式 if (error || !data?.users) break 不存在
    expect(body).not.toMatch(/if\s*\(\s*error\s*\|\|/);
  });

  it('P4-U1 关键修复未被回退：updateRole 使用 .select(\'id\').single()', () => {
    const repo = readSrc('features/users/repository.ts');
    const body = extractFnBody(repo, 'updateRole');
    expect(body).toContain(".select('id')");
    expect(body).toContain('.single()');
  });

  it('P4-U1 关键修复未被回退：countByRole 两步查询', () => {
    const repo = readSrc('features/users/repository.ts');
    const body = extractFnBody(repo, 'countByRole');
    expect(body).toContain("from('role')");
    expect(body).not.toMatch(/\.eq\(['"]role\.name/);
  });
});
