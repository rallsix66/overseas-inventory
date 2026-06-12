// 用户模块数据访问层 — 封装 profiles + role 查询
// 用户邮箱来自 auth.users，需通过 Supabase Admin API 获取
// 当前阶段通过 profiles + auth.users join 获取（使用 service_role）
import { createClient } from '@/lib/supabase/server';
import { unwrapJoin } from '@/lib/supabase/helpers';
import type { UserItem, UserFilters } from './types';
import type { PaginatedResult } from '@/types/common';

const PAGE_SIZE = 20;

export const userRepository = {
  /** 分页列表（profiles + role join） */
  async list(filters: UserFilters = {}): Promise<PaginatedResult<UserItem>> {
    const supabase = await createClient();
    const { roleId, isActive, page = 1, pageSize = PAGE_SIZE } = filters;

    let query = supabase.from('profiles').select(
      `id, display_name, is_active, created_at, role:role_id (id, name)`,
      { count: 'exact' }
    );

    if (roleId) query = query.eq('role_id', roleId);
    if (isActive !== undefined) query = query.eq('is_active', isActive);

    const from = (page - 1) * pageSize;
    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);

    if (error || !data) {
      return { data: [], total: 0, page, pageSize };
    }

    // 批量获取 auth.users email — 需要通过 service_role 客户端
    // 对于 admin 权限的调用，用 service role 查询 auth.users
    // 当前阶段：使用 profile 的 display_name 中的邮箱前缀（handle_new_user 默认值）
    // Phase 4 完善时切换到 service_role 查询 auth.users

    return {
      data: data.map((row) => {
        const role = unwrapJoin<{ id: string; name: string }>(row.role);
        return {
          id: row.id,
          email: '', // Phase 4 从 auth.users 获取
          displayName: row.display_name,
          roleId: role?.id ?? '',
          roleName: role?.name ?? 'operator',
          isActive: row.is_active,
          createdAt: row.created_at,
        };
      }),
      total: count ?? 0,
      page,
      pageSize,
    };
  },

  /** 获取单个用户 */
  async getById(id: string): Promise<UserItem | null> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('profiles')
      .select(`id, display_name, is_active, created_at, role:role_id (id, name)`)
      .eq('id', id)
      .single();

    if (error || !data) return null;

    const role = unwrapJoin<{ id: string; name: string }>(data.role);

    return {
      id: data.id,
      email: '',
      displayName: data.display_name,
      roleId: role?.id ?? '',
      roleName: role?.name ?? 'operator',
      isActive: data.is_active,
      createdAt: data.created_at,
    };
  },

  /** 切换用户角色 */
  async updateRole(userId: string, roleId: string): Promise<boolean> {
    const supabase = await createClient();
    const { error } = await supabase
      .from('profiles')
      .update({ role_id: roleId })
      .eq('id', userId);

    return !error;
  },

  /** 启用/禁用用户 */
  async toggleActive(userId: string, isActive: boolean): Promise<boolean> {
    const supabase = await createClient();
    const { error } = await supabase
      .from('profiles')
      .update({ is_active: isActive })
      .eq('id', userId);

    return !error;
  },
};
