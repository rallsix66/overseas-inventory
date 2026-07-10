'use client';

// 账号停用阻断页 — 已登录但 is_active=false 的用户到达 /dashboard/* 时显示
// 不渲染 SidebarNav / DashboardHeader / children 业务内容
// 提供退出登录按钮清除 Supabase session
import { LogoutButton } from './logout-button';

export function InactiveAccountPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md rounded-lg border bg-white p-8 shadow-sm text-center">
        <h1 className="text-lg font-semibold text-gray-900 mb-2">账号已停用</h1>
        <p className="text-sm text-muted-foreground mb-6">
          您的账号已被管理员停用，如需恢复访问权限，请联系管理员。
        </p>
        <span aria-label="退出登录">
          <LogoutButton />
        </span>
      </div>
    </div>
  );
}
