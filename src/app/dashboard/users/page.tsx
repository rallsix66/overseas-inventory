// 团队账号 — 用户列表只读页面（P4-U2）
// Server Component：校验管理员权限 → 获取角色列表 + 用户列表
// 筛选/表格/分页/详情委托给 UsersPageContent（Client Component）
import { getCurrentActiveUser } from '@/lib/auth';
import { listUsers, listRoles } from '@/features/users/actions';
import { UsersPageContent } from './_components/users-page-content';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '用户管理 — DIS 库存看板',
};

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; role?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);

  const user = await getCurrentActiveUser();

  // Operator 不可访问用户管理
  if (!user || user.roleName !== 'admin') {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        仅管理员可访问用户管理
      </div>
    );
  }

  // 获取角色列表（供筛选下拉使用）
  const rolesResult = await listRoles();
  if (!rolesResult.success) {
    throw new Error(rolesResult.error ?? '加载角色列表失败');
  }
  const roles = rolesResult.data ?? [];

  // 构建筛选参数
  const isActive =
    sp.status === 'active' ? true : sp.status === 'disabled' ? false : undefined;
  const roleId = sp.role && sp.role !== 'all' ? sp.role : undefined;

  const result = await listUsers({ roleId, isActive, page, pageSize: 20 });

  if (!result.success) {
    throw new Error(result.error ?? '加载用户列表失败');
  }

  const { data, total, pageSize } = result.data!;

  return (
    <UsersPageContent
      data={data}
      total={total}
      page={page}
      pageSize={pageSize}
      filters={{ status: sp.status ?? '', role: sp.role ?? '' }}
      roles={roles}
    />
  );
}
