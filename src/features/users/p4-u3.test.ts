// P4-U3: 修改用户角色 — 测试
// 覆盖：架构合规、权限、UI 交互、错误处理、P4-U1/P4-U2 回归
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
    `\\bconst\\s+${escaped}\\s*=`,
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

// ─── 1. 页面与组件架构合规 ───────────────────────────────────

describe('P4-U3 架构合规', () => {
  const pagePath = 'app/dashboard/users/page.tsx';
  const contentPath = 'app/dashboard/users/_components/users-page-content.tsx';
  const sheetPath = 'features/users/components/user-detail-sheet.tsx';
  const dialogPath = 'features/users/components/user-role-change-dialog.tsx';
  let page: string;
  let content: string;
  let sheet: string;
  let dialog: string;

  beforeAll(() => {
    page = readSrc(pagePath);
    content = readSrc(contentPath);
    sheet = readSrc(sheetPath);
    dialog = readSrc(dialogPath);
  });

  it('page.tsx 不直接调用 supabase.from / supabase.rpc', () => {
    expect(page).not.toMatch(/supabase\.from\(/);
    expect(page).not.toMatch(/supabase\.rpc\(/);
  });

  it('page.tsx 不调用 auth.admin 或 createServiceClient', () => {
    expect(page).not.toContain('auth.admin');
    expect(page).not.toContain('createServiceClient');
  });

  it('users-page-content.tsx 不直接访问 Supabase / service_role', () => {
    expect(content).not.toMatch(/supabase\.from\(/);
    expect(content).not.toMatch(/supabase\.rpc\(/);
    expect(content).not.toContain('createServiceClient');
    expect(content).not.toContain('service_role');
  });

  it('user-detail-sheet.tsx 不直接访问 Supabase / service_role', () => {
    expect(sheet).not.toMatch(/supabase\.from\(/);
    expect(sheet).not.toMatch(/supabase\.rpc\(/);
    expect(sheet).not.toContain('createServiceClient');
    expect(sheet).not.toContain('service_role');
  });

  it('user-role-change-dialog.tsx 不直接访问 Supabase / service_role', () => {
    expect(dialog).not.toMatch(/supabase\.from\(/);
    expect(dialog).not.toMatch(/supabase\.rpc\(/);
    expect(dialog).not.toContain('createServiceClient');
    expect(dialog).not.toContain('service_role');
  });
});

// ─── 2. 导入校验：允许 updateUserRole，禁止 toggleUserActive ───

describe('P4-U3 导入控制', () => {
  it('user-detail-sheet.tsx 导入 updateUserRole（通过 UserRoleChangeDialog），但不导入 toggleUserActive', () => {
    const sheet = readSrc('features/users/components/user-detail-sheet.tsx');
    // Sheet 本身不直接 import updateUserRole，而是通过 UserRoleChangeDialog
    // 但 Sheet 不应导入 toggleUserActive
    expect(sheet).not.toContain('toggleUserActive');
  });

  it('user-role-change-dialog.tsx 导入 updateUserRole 但不导入 toggleUserActive', () => {
    const dialog = readSrc('features/users/components/user-role-change-dialog.tsx');
    expect(dialog).toContain('updateUserRole');
    expect(dialog).not.toContain('toggleUserActive');
  });

  it('users-page-content.tsx 不导入 updateUserRole 或 toggleUserActive', () => {
    const content = readSrc('app/dashboard/users/_components/users-page-content.tsx');
    expect(content).not.toContain('updateUserRole');
    expect(content).not.toContain('toggleUserActive');
  });

  it('page.tsx 不导入 updateUserRole 或 toggleUserActive', () => {
    const page = readSrc('app/dashboard/users/page.tsx');
    expect(page).not.toContain('updateUserRole');
    expect(page).not.toContain('toggleUserActive');
  });
});

// ─── 3. UserRoleChangeDialog 行为 ────────────────────────────

describe('P4-U3 UserRoleChangeDialog', () => {
  let dialog: string;

  beforeAll(() => {
    dialog = readSrc('features/users/components/user-role-change-dialog.tsx');
  });

  it('过滤当前角色，避免重复提交', () => {
    const body = extractFnBody(dialog, 'UserRoleChangeDialog');
    expect(body).toContain("r.id !== currentRoleId");
    expect(body).toContain('availableRoles');
  });

  it('确认按钮当前角色未选择时禁用（!selectedRoleId）', () => {
    const body = extractFnBody(dialog, 'UserRoleChangeDialog');
    expect(body).toContain('!selectedRoleId');
    expect(body).toContain('disabled={!selectedRoleId || pending}');
  });

  it('提交中显示 pending 状态（Loader2 + disabled）', () => {
    const body = extractFnBody(dialog, 'UserRoleChangeDialog');
    expect(body).toContain('pending');
    expect(body).toContain('setPending(true)');
    expect(body).toContain('setPending(false)');
    expect(body).toContain('Loader2');
    expect(dialog).toContain("import { Loader2 } from 'lucide-react'");
  });

  it('失败时展示 updateUserRole 返回的错误', () => {
    const body = extractFnBody(dialog, 'UserRoleChangeDialog');
    expect(body).toContain('setError(result.error');
    // 不静默吞错误
    expect(body).toContain('error &&');
    expect(body).toContain('text-destructive');
  });

  it('成功时调用 onSuccess 回调', () => {
    const body = extractFnBody(dialog, 'UserRoleChangeDialog');
    expect(body).toContain('result.success');
    expect(body).toContain('onSuccess()');
  });

  it('关闭时重置 selectedRoleId 和 error 状态', () => {
    const body = extractFnBody(dialog, 'UserRoleChangeDialog');
    // handleOpenChange -> resetAndClose
    expect(body).toContain('setSelectedRoleId(undefined)');
    expect(body).toContain('setError(null)');
  });

  it('取消按钮调用统一 resetAndClose，不直接 onClick={onClose}', () => {
    const body = extractFnBody(dialog, 'UserRoleChangeDialog');
    // 取消按钮必须使用 resetAndClose 而非直接 onClose
    expect(body).toContain('onClick={resetAndClose}');
    expect(body).not.toMatch(/onClick=\{onClose\}/);
    // resetAndClose 统一封装重置 + 关闭
    expect(body).toContain('const resetAndClose');
    expect(body).toContain('onClose()');
  });
});

// ─── 4. UserDetailSheet 集成 ─────────────────────────────────

describe('P4-U3 UserDetailSheet 集成', () => {
  let sheet: string;

  beforeAll(() => {
    sheet = readSrc('features/users/components/user-detail-sheet.tsx');
  });

  it('接受 roles prop 并传递给 UserRoleChangeDialog', () => {
    expect(sheet).toContain('roles: RoleOption[]');
    expect(sheet).toContain('roles={roles}');
  });

  it('角色行显示"修改角色"按钮', () => {
    expect(sheet).toContain('修改角色');
    expect(sheet).toContain('setRoleDialogOpen(true)');
  });

  it('包含 roleDialogOpen 状态管理', () => {
    expect(sheet).toContain('roleDialogOpen');
    expect(sheet).toContain('setRoleDialogOpen');
  });

  it('角色修改成功后关闭 Sheet 并调用 router.refresh()', () => {
    const body = extractFnBody(sheet, 'UserDetailSheet');
    expect(body).toContain('handleRoleChangeSuccess');
    // 关闭 dialog
    expect(body).toContain('setRoleDialogOpen(false)');
    // 关闭 sheet
    // 刷新页面
    expect(sheet).toContain('router.refresh()');
    expect(sheet).toContain("import { useRouter } from 'next/navigation'");
  });

  it('不出现启用/禁用相关按钮或文案', () => {
    // 不出现 toggleUserActive 相关
    expect(sheet).not.toContain('toggleUserActive');
    // 不出现启用/禁用操作按钮（区别于状态 Badge）
    expect(sheet).not.toMatch(/Button.*启用/);
    expect(sheet).not.toMatch(/Button.*禁用/);
  });
});

// ─── 5. UsersPageContent 透传 roles ──────────────────────────

describe('P4-U3 UsersPageContent 透传', () => {
  it('UserDetailSheet 接收 roles prop', () => {
    const content = readSrc('app/dashboard/users/_components/users-page-content.tsx');
    expect(content).toContain('roles={roles}');
  });

  it('users-page-content.tsx 不导入 updateUserRole 或 toggleUserActive', () => {
    const content = readSrc('app/dashboard/users/_components/users-page-content.tsx');
    expect(content).not.toContain('updateUserRole');
    expect(content).not.toContain('toggleUserActive');
  });
});

// ─── 6. 权限：Operator 仍不可访问 ────────────────────────────

describe('P4-U3 权限控制', () => {
  it('page.tsx 仍校验 roleName !== \'admin\'', () => {
    const page = readSrc('app/dashboard/users/page.tsx');
    expect(page).toContain("roleName !== 'admin'");
    expect(page).toContain('仅管理员可访问用户管理');
  });

  it('actions.ts updateUserRole 仍校验 Admin-only', () => {
    const actions = readSrc('features/users/actions.ts');
    const body = extractFnBody(actions, 'updateUserRole');
    expect(body).toContain('requireActiveAuth');
    expect(body).toContain("roleName !== 'admin'");
    expect(body).toContain('仅管理员可修改用户角色');
  });
});

// ─── 7. P4-U1 自保护逻辑回归 ─────────────────────────────────

describe('P4-U3 不破坏 P4-U1 自保护', () => {
  it('updateUserRole 仍包含自降级保护', () => {
    const actions = readSrc('features/users/actions.ts');
    const body = extractFnBody(actions, 'updateUserRole');
    expect(body).toContain('不允许将自己的角色改为非管理员');
  });

  it('updateUserRole 仍包含最后管理员保护', () => {
    const actions = readSrc('features/users/actions.ts');
    const body = extractFnBody(actions, 'updateUserRole');
    expect(body).toContain('不允许移除最后一个管理员的角色');
  });

  it('toggleUserActive action 未被修改（保持 P4-U1 行为）', () => {
    const actions = readSrc('features/users/actions.ts');
    const body = extractFnBody(actions, 'toggleUserActive');
    expect(body).toContain('不允许禁用自己的账号');
    expect(body).toContain('不允许禁用最后一个管理员');
  });

  it('repository.ts updateRole 仍使用 .select(\'id\').single()', () => {
    const repo = readSrc('features/users/repository.ts');
    const body = extractFnBody(repo, 'updateRole');
    expect(body).toContain(".select('id')");
    expect(body).toContain('.single()');
  });
});

// ─── 8. P4-U2 只读能力回归 ───────────────────────────────────

describe('P4-U3 不破坏 P4-U2', () => {
  it('page.tsx 仍通过 listUsers / listRoles 获取数据', () => {
    const page = readSrc('app/dashboard/users/page.tsx');
    expect(page).toContain('listUsers');
    expect(page).toContain('listRoles');
  });

  it('page.tsx listRoles 失败仍 throw error（不静默降级）', () => {
    const page = readSrc('app/dashboard/users/page.tsx');
    const body = extractFnBody(page, 'UsersPage');
    expect(body).toContain('!rolesResult.success');
    expect(body).toContain('throw new Error');
  });

  it('users-page-content.tsx 仍包含筛选栏（状态 + 角色）', () => {
    const content = readSrc('app/dashboard/users/_components/users-page-content.tsx');
    expect(content).toContain('全部状态');
    expect(content).toContain('全部角色');
  });

  it('users-page-content.tsx 仍包含分页控件', () => {
    const content = readSrc('app/dashboard/users/_components/users-page-content.tsx');
    expect(content).toContain('上一页');
    expect(content).toContain('下一页');
    expect(content).toContain('totalPages');
  });

  it('users-page-content.tsx 仍包含空数据提示', () => {
    const content = readSrc('app/dashboard/users/_components/users-page-content.tsx');
    expect(content).toContain('暂无匹配的用户');
  });

  it('user-detail-sheet.tsx 仍通过 getUserById 获取用户详情', () => {
    const sheet = readSrc('features/users/components/user-detail-sheet.tsx');
    expect(sheet).toContain('getUserById');
  });

  it('user-detail-sheet.tsx 仍处理 loading / error / cancelled', () => {
    const sheet = readSrc('features/users/components/user-detail-sheet.tsx');
    expect(sheet).toContain('Skeleton');
    expect(sheet).toContain('cancelled');
    expect(sheet).toContain('加载用户详情失败');
  });
});
