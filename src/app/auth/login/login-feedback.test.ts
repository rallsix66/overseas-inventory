// 登录页反馈测试
//
// 验证登录请求不会无限停留在 loading 状态：
// - signInWithPassword 包裹超时保护
// - 超时/网络异常显示中文提示
// - 失败路径恢复 setLoading(false)

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const LOGIN_PAGE_PATH = path.resolve(process.cwd(), 'src/app/auth/login/page.tsx');

describe('LoginPage 登录反馈', () => {
  const src = fs.readFileSync(LOGIN_PAGE_PATH, 'utf-8');

  it('定义登录超时时间，避免无限等待', () => {
    expect(src).toMatch(/const LOGIN_TIMEOUT_MS = 15_000/);
  });

  it('signInWithPassword 使用超时保护包装', () => {
    expect(src).toMatch(/withLoginTimeout\(/);
    expect(src).toMatch(/Promise\.race/);
    expect(src).toMatch(/supabase\.auth\.signInWithPassword/);
  });

  it('超时和网络异常返回明确中文提示', () => {
    expect(src).toContain('登录请求超时，请检查网络或 Supabase 配置后重试');
    expect(src).toContain('登录请求失败，请检查网络或 Supabase 配置后重试');
  });

  it('异常失败路径恢复登录按钮状态', () => {
    const catchBlock = src.match(/catch \(loginError\) \{[\s\S]*?\n    \}/);
    expect(catchBlock).not.toBeNull();
    expect(catchBlock?.[0]).toContain('setLoading(false)');
    expect(catchBlock?.[0]).toContain('return;');
  });
});
