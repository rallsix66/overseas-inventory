// 服务端认证工具 — 获取当前用户、角色、权限校验
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { unwrapJoin } from '@/lib/supabase/helpers';

export interface CurrentUser {
  id: string;
  email: string | undefined;
  displayName: string;
  roleName: string;
}

// ─── Request-scope cached auth + profile helper ───────────────────
// 使用 React cache() 确保同一请求内 getCurrentUser() 与
// getCurrentActiveUser() 共享同一次 auth.getUser() + profiles 查询。

interface CachedAuthProfile {
  authUser: { id: string; email?: string } | null;
  /** Raw profile row (role is the nested Supabase join; callers use unwrapJoin). */
  profile: { display_name: string | null; is_active: boolean; role: unknown } | null;
  /** Non-null only when the profiles query itself returned a real DB error. */
  profileError: string | null;
}

const cachedGetAuthProfile = cache(async (): Promise<CachedAuthProfile> => {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return { authUser: null, profile: null, profileError: null };
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('display_name, is_active, role:role_id (name)')
    .eq('id', user.id)
    .single();

  // PGRST116 = row not found — profile may genuinely not exist yet (e.g. trigger
  // hasn't created it). Treat as absent profile rather than a hard error.
  if (profileError && profileError.code !== 'PGRST116') {
    return {
      authUser: { id: user.id, email: user.email },
      profile: null,
      profileError: '数据库错误：无法获取用户资料',
    };
  }

  return {
    authUser: { id: user.id, email: user.email },
    profile: profile as CachedAuthProfile['profile'] | null,
    profileError: null,
  };
});

/**
 * 获取当前登录用户及角色信息。
 * 用于 Server Component / Server Action 中。
 * 复用 cachedGetAuthProfile，与 getCurrentActiveUser() 共享请求级缓存。
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const { authUser, profile } = await cachedGetAuthProfile();
  if (!authUser) return null;

  const role = unwrapJoin<{ name: string }>(profile?.role);
  const roleName = role?.name ?? 'operator';

  return {
    id: authUser.id,
    email: authUser.email,
    displayName: profile?.display_name ?? authUser.email?.split('@')[0] ?? '用户',
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
 * 复用 cachedGetAuthProfile，与 getCurrentUser() 共享请求级缓存。
 */
export async function getCurrentActiveUser(): Promise<CurrentActiveUser | null> {
  const { authUser, profile, profileError } = await cachedGetAuthProfile();
  if (!authUser) return null;

  if (profileError) throw new Error(profileError);

  if (!profile || !profile.is_active) return null;

  const role = unwrapJoin<{ name: string }>(profile.role);
  const roleName = role?.name ?? 'operator';

  return {
    id: authUser.id,
    email: authUser.email,
    displayName: profile.display_name ?? authUser.email?.split('@')[0] ?? '用户',
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
