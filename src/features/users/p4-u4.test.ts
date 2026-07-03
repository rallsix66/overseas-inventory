// P4-U4: 启用/禁用用户账号 — 测试
// 覆盖：架构合规、权限、UI 交互、错误处理、P4-U1/P4-U2/P4-U3 回归
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

describe('P4-U4 架构合规', () => {
  const pagePath = 'app/dashboard/users/page.tsx';
  const contentPath = 'app/dashboard/users/_components/users-page-content.tsx';
  const sheetPath = 'features/users/components/user-detail-sheet.tsx';
  const dialogPath = 'features/users/components/user-active-toggle-dialog.tsx';
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

  it('user-active-toggle-dialog.tsx 不直接访问 Supabase / service_role', () => {
    expect(dialog).not.toMatch(/supabase\.from\(/);
    expect(dialog).not.toMatch(/supabase\.rpc\(/);
    expect(dialog).not.toContain('createServiceClient');
    expect(dialog).not.toContain('service_role');
  });

  it('user-detail-sheet.tsx 不直接访问 Supabase / service_role', () => {
    expect(sheet).not.toMatch(/supabase\.from\(/);
    expect(sheet).not.toMatch(/supabase\.rpc\(/);
    expect(sheet).not.toContain('createServiceClient');
    expect(sheet).not.toContain('service_role');
  });

  it('page.tsx / users-page-content.tsx 不直接访问 Supabase / service_role', () => {
    for (const src of [page, content]) {
      expect(src).not.toMatch(/supabase\.from\(/);
      expect(src).not.toMatch(/supabase\.rpc\(/);
      expect(src).not.toContain('createServiceClient');
      expect(src).not.toContain('service_role');
    }
  });
});

// ─── 2. 导入校验 ────────────────────────────────────────────

describe('P4-U4 导入控制', () => {
  it('user-active-toggle-dialog.tsx 导入 toggleUserActive', () => {
    const dialog = readSrc('features/users/components/user-active-toggle-dialog.tsx');
    expect(dialog).toContain('toggleUserActive');
    expect(dialog).toContain("from '@/features/users/actions'");
  });

  it('user-active-toggle-dialog.tsx 不导入 updateUserRole', () => {
    const dialog = readSrc('features/users/components/user-active-toggle-dialog.tsx');
    expect(dialog).not.toContain('updateUserRole');
  });

  it('user-detail-sheet.tsx 不直接导入 toggleUserActive（通过 UserActiveToggleDialog 间接调用）', () => {
    const sheet = readSrc('features/users/components/user-detail-sheet.tsx');
    expect(sheet).not.toMatch(/import.*toggleUserActive/);
  });

  it('page.tsx / users-page-content.tsx 不导入 toggleUserActive', () => {
    const page = readSrc('app/dashboard/users/page.tsx');
    const content = readSrc('app/dashboard/users/_components/users-page-content.tsx');
    expect(page).not.toContain('toggleUserActive');
    expect(content).not.toContain('toggleUserActive');
  });
});

// ─── 3. UserActiveToggleDialog 行为 ──────────────────────────

describe('P4-U4 UserActiveToggleDialog', () => {
  let dialog: string;

  beforeAll(() => {
    dialog = readSrc('features/users/components/user-active-toggle-dialog.tsx');
  });

  it('根据 isActive 显示"启用"或"禁用"文案', () => {
    const body = extractFnBody(dialog, 'UserActiveToggleDialog');
    expect(body).toContain("isActive ? '禁用' : '启用'");
    expect(body).toContain('禁用后该用户将无法登录系统');
    expect(body).toContain('启用后该用户将恢复系统访问权限');
  });

  it('提交中显示 pending 状态（Loader2 + disabled）', () => {
    const body = extractFnBody(dialog, 'UserActiveToggleDialog');
    expect(body).toContain('pending');
    expect(body).toContain('setPending(true)');
    expect(body).toContain('setPending(false)');
    expect(body).toContain('Loader2');
    expect(dialog).toContain("import { Loader2 } from 'lucide-react'");
  });

  it('失败时展示 toggleUserActive 返回的错误', () => {
    const body = extractFnBody(dialog, 'UserActiveToggleDialog');
    expect(body).toContain('setError(result.error');
    expect(body).toContain('error &&');
    expect(body).toContain('text-destructive');
  });

  it('成功时调用 onSuccess 回调', () => {
    const body = extractFnBody(dialog, 'UserActiveToggleDialog');
    expect(body).toContain('result.success');
    expect(body).toContain('onSuccess()');
  });

  it('取消按钮使用统一 resetAndClose，不直接 onClick={onClose}', () => {
    const body = extractFnBody(dialog, 'UserActiveToggleDialog');
    expect(body).toContain('onClick={resetAndClose}');
    expect(body).not.toMatch(/onClick=\{onClose\}/);
    expect(body).toContain('const resetAndClose');
  });

  it('关闭时通过 handleOpenChange → resetAndClose 重置 error', () => {
    const body = extractFnBody(dialog, 'UserActiveToggleDialog');
    expect(body).toContain('handleOpenChange');
    expect(body).toContain('resetAndClose()');
    expect(body).toContain('setError(null)');
  });
});

// ─── 4. UserDetailSheet 集成 ─────────────────────────────────

describe('P4-U4 UserDetailSheet 集成', () => {
  let sheet: string;

  beforeAll(() => {
    sheet = readSrc('features/users/components/user-detail-sheet.tsx');
  });

  it('状态行显示启用/禁用操作按钮', () => {
    expect(sheet).toContain('setToggleDialogOpen(true)');
    expect(sheet).toContain('启用/禁用');
  });

  it('按钮文案根据 isActive 切换（启用时显示禁用，禁用时显示启用）', () => {
    const body = extractFnBody(sheet, 'UserDetailSheet');
    expect(body).toContain("user.isActive ? '禁用' : '启用'");
  });

  it('包含 toggleDialogOpen 状态管理', () => {
    expect(sheet).toContain('toggleDialogOpen');
    expect(sheet).toContain('setToggleDialogOpen');
  });

  it('启用/禁用成功后局部刷新用户详情 + 通知父组件刷新列表', () => {
    const body = extractFnBody(sheet, 'UserDetailSheet');
    expect(body).toContain('handleToggleSuccess');
    expect(body).toContain('setToggleDialogOpen(false)');
    // P4-UX: 不再整页刷新
    expect(sheet).not.toMatch(/router\.refresh\(\)/);
    expect(sheet).not.toMatch(/import \{ useRouter \} from 'next\/navigation'/);
    // P4-UX: 通过 getUserById 局部刷新用户详情
    expect(body).toMatch(/getUserById\(userId\)/);
    // P4-UX: 通过 onUserChanged 通知父组件刷新列表
    expect(sheet).toContain('onUserChanged?: () => void');
    expect(body).toContain('onUserChanged?.()');
  });

  it('UserActiveToggleDialog 与 UserRoleChangeDialog 共存', () => {
    expect(sheet).toContain('UserActiveToggleDialog');
    expect(sheet).toContain('UserRoleChangeDialog');
    expect(sheet).toContain('import { UserActiveToggleDialog }');
    expect(sheet).toContain('import { UserRoleChangeDialog }');
  });
});

// ─── 5. 权限控制 ────────────────────────────────────────────

describe('P4-U4 权限控制', () => {
  it('page.tsx 仍校验 roleName !== \'admin\'', () => {
    const page = readSrc('app/dashboard/users/page.tsx');
    expect(page).toContain("roleName !== 'admin'");
    expect(page).toContain('仅管理员可访问用户管理');
  });

  it('actions.ts toggleUserActive 仍校验 Admin-only', () => {
    const actions = readSrc('features/users/actions.ts');
    const body = extractFnBody(actions, 'toggleUserActive');
    expect(body).toContain('requireActiveAuth');
    expect(body).toContain("roleName !== 'admin'");
    expect(body).toContain('仅管理员可修改用户状态');
  });
});

// ─── 6. P4-U1 自保护逻辑回归 ─────────────────────────────────

describe('P4-U4 不破坏 P4-U1 自保护', () => {
  it('toggleUserActive 自禁用保护已收口至 Migration RPC', () => {
    const migration = readSrc('../supabase/migrations/00025_rpc_caller_identity_binding.sql');
    expect(migration).toContain('不允许禁用自己的账号');
  });

  it('toggleUserActive 最后管理员保护已收口至 Migration RPC', () => {
    const migration = readSrc('../supabase/migrations/00025_rpc_caller_identity_binding.sql');
    expect(migration).toContain('不允许禁用最后一个管理员');
  });

  it('repository.ts toggleActive 调用 toggle_user_active_protected RPC（P4-U5 收口）', () => {
    const repo = readSrc('features/users/repository.ts');
    const body = extractFnBody(repo, 'toggleActive');
    expect(body).toContain('toggle_user_active_protected');
  });
});

// ─── 7. P4-U2 只读能力回归 ───────────────────────────────────

describe('P4-U4 不破坏 P4-U2', () => {
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

  it('users-page-content.tsx 仍包含筛选、分页、空数据', () => {
    const content = readSrc('app/dashboard/users/_components/users-page-content.tsx');
    expect(content).toContain('全部状态');
    expect(content).toContain('上一页');
    expect(content).toContain('暂无匹配的用户');
  });
});

// ─── 8. P4-U3 修改角色回归 ───────────────────────────────────

describe('P4-U4 不破坏 P4-U3', () => {
  it('user-detail-sheet.tsx 仍包含"修改角色"按钮', () => {
    const sheet = readSrc('features/users/components/user-detail-sheet.tsx');
    expect(sheet).toContain('修改角色');
    expect(sheet).toContain('setRoleDialogOpen(true)');
  });

  it('user-detail-sheet.tsx 仍包含 roleDialogOpen 状态', () => {
    const sheet = readSrc('features/users/components/user-detail-sheet.tsx');
    expect(sheet).toContain('roleDialogOpen');
    expect(sheet).toContain('setRoleDialogOpen');
  });

  it('UserRoleChangeDialog 仍使用 resetAndClose 模式', () => {
    const dialog = readSrc('features/users/components/user-role-change-dialog.tsx');
    const body = extractFnBody(dialog, 'UserRoleChangeDialog');
    expect(body).toContain('const resetAndClose');
    expect(body).toContain('onClick={resetAndClose}');
  });
});
