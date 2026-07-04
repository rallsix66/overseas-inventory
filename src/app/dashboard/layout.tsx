// Dashboard 共享布局 — 侧边栏 + 顶栏 + 内容区
// 所有 /dashboard/* 页面由此布局包裹
// middleware 已确保只有已登录用户能进入，此处通过共享 auth helper 取 profile + role
// （复用 cachedGetAuthProfile，与子页面/Server Actions 共享请求级缓存）
import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { SidebarNav } from './_components/sidebar-nav';
import { DashboardHeader } from './_components/dashboard-header';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  // 双重保障：若 middleware 未拦截，此处再校验一次
  if (!user) {
    redirect('/auth/login');
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* 侧边栏 */}
      <SidebarNav roleName={user.roleName} />

      {/* 右侧主区域 */}
      <div className="flex flex-col flex-1 min-w-0">
        <DashboardHeader displayName={user.displayName} roleName={user.roleName} />
        <main className="flex-1 overflow-auto bg-gray-50 px-6 py-5">
          {children}
        </main>
      </div>
    </div>
  );
}
