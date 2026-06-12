// Dashboard 共享布局 — 侧边栏 + 顶栏 + 内容区
// 所有 /dashboard/* 页面由此布局包裹
// middleware 已确保只有已登录用户能进入，此处再取 profile + role
import { createClient } from '@/lib/supabase/server';
import { unwrapJoin } from '@/lib/supabase/helpers';
import { redirect } from 'next/navigation';
import { SidebarNav } from './_components/sidebar-nav';
import { DashboardHeader } from './_components/dashboard-header';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  // 双重保障：若 middleware 未拦截，此处再校验一次
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect('/auth/login');
  }

  // 获取用户 profile 和角色
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, role:role_id (name)')
    .eq('id', user.id)
    .single();

  const displayName = profile?.display_name ?? user.email?.split('@')[0] ?? '用户';
  const role = unwrapJoin<{ name: string }>(profile?.role);
  const roleName: string = role?.name ?? 'operator';

  return (
    <div className="flex h-screen overflow-hidden">
      {/* 侧边栏 */}
      <SidebarNav roleName={roleName} />

      {/* 右侧主区域 */}
      <div className="flex flex-col flex-1 min-w-0">
        <DashboardHeader displayName={displayName} roleName={roleName} />
        <main className="flex-1 overflow-auto bg-gray-50 px-6 py-5">
          {children}
        </main>
      </div>
    </div>
  );
}
