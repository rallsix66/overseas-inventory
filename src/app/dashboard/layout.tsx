// Dashboard 共享布局 — 侧边栏 + 顶栏 + 内容区
// 所有 /dashboard/* 页面由此布局包裹
// proxy 已确保只有已登录用户能进入，此处通过共享 auth helper 取 profile + role
// （复用 cachedGetAuthProfile，与子页面/Server Actions 共享请求级缓存）
//
// TEAM-ACCOUNTS-INACTIVE-SESSION-GUARD:
// getCurrentActiveUser() 额外校验 profiles.is_active。
// getCurrentUser() 与 getCurrentActiveUser() 共享 React cache()，同一请求内仅 1 次 DB 查询。
// - 未登录 → redirect('/auth/login')
// - 已登录但 is_active=false → InactiveAccountPage 阻断，不渲染 Sidebar/Header/children
// - 活跃用户 → 正常渲染 Dashboard
import { getCurrentUser, getCurrentActiveUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { SidebarNav } from './_components/sidebar-nav';
import { DashboardHeader } from './_components/dashboard-header';
import { InactiveAccountPage } from './_components/inactive-account-page';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  // 未登录：跳转登录页
  if (!user) {
    redirect('/auth/login');
  }

  // 已登录但账号停用：阻断页，不渲染业务内容
  // getCurrentActiveUser 与 getCurrentUser 共享 cachedGetAuthProfile，无额外 DB 查询
  const activeUser = await getCurrentActiveUser();
  if (!activeUser) {
    return <InactiveAccountPage />;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* 侧边栏 */}
      <SidebarNav roleName={activeUser.roleName} />

      {/* 右侧主区域 */}
      <div className="flex flex-col flex-1 min-w-0">
        <DashboardHeader displayName={activeUser.displayName} roleName={activeUser.roleName} />
        <main className="flex-1 overflow-auto bg-gray-50 px-6 py-5">
          {children}
        </main>
      </div>
    </div>
  );
}
