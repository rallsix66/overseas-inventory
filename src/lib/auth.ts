// 服务端认证工具 — 获取当前用户、角色、权限校验
import { createClient } from '@/lib/supabase/server';
import { unwrapJoin } from '@/lib/supabase/helpers';

export interface CurrentUser {
  id: string;
  email: string | undefined;
  displayName: string;
  roleName: string;
}

/**
 * 获取当前登录用户及角色信息。
 * 用于 Server Component / Server Action 中。
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, role:role_id (name)')
    .eq('id', user.id)
    .single();

  const role = unwrapJoin<{ name: string }>(profile?.role);
  const roleName = role?.name ?? 'operator';

  return {
    id: user.id,
    email: user.email,
    displayName: profile?.display_name ?? user.email?.split('@')[0] ?? '用户',
    roleName,
  };
}

/**
 * 确认当前用户是管理员，否则抛出。
 * 在 Server Action 中调用以保护管理类操作。
 */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error('未登录');
  if (user.roleName !== 'admin') throw new Error('无权限：需要管理员角色');
  return user;
}

/**
 * 确认当前用户已登录，否则抛出。
 */
export async function requireAuth(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error('未登录');
  return user;
}

// ─── Active-user variants (P5-SY5B) ───────────────────────────────

export interface CurrentActiveUser extends CurrentUser {
  isActive: true;
}

/**
 * 获取当前登录且启用的用户。
 * 相比 getCurrentUser()，额外校验 profiles.is_active。
 * 停用用户返回 null（与未登录用户不可区分，调用方按未登录处理）。
 */
export async function getCurrentActiveUser(): Promise<CurrentActiveUser | null> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) return null;

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('display_name, is_active, role:role_id (name)')
    .eq('id', user.id)
    .single();

  if (profileError) throw new Error(`数据库错误：无法获取用户资料`);

  if (!profile || !profile.is_active) return null;

  const role = unwrapJoin<{ name: string }>(profile.role);
  const roleName = role?.name ?? 'operator';

  return {
    id: user.id,
    email: user.email,
    displayName: profile.display_name ?? user.email?.split('@')[0] ?? '用户',
    roleName,
    isActive: true,
  };
}

/**
 * 确认当前用户已登录且启用，否则抛出。
 */
export async function requireActiveAuth(): Promise<CurrentActiveUser> {
  const user = await getCurrentActiveUser();
  if (!user) throw new Error('未登录或账户已停用');
  return user;
}

/**
 * 确认当前用户是已启用的管理员，否则抛出。
 */
export async function requireActiveAdmin(): Promise<CurrentActiveUser> {
  const user = await getCurrentActiveUser();
  if (!user) throw new Error('未登录或账户已停用');
  if (user.roleName !== 'admin') throw new Error('无权限：需要管理员角色');
  return user;
}
