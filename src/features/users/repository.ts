// 用户模块数据访问层 — 封装 profiles + role + email 查询
// email 来自 auth.users，通过 service_role admin API 获取
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { unwrapJoin } from '@/lib/supabase/helpers';
import { UserError } from './types';
import type { UserItem, UserListFilters } from './types';
import type { PaginatedResult } from '@/types/common';

const PAGE_SIZE = 20;

// ─── 内部 helper ─────────────────────────────────────────────

/** 通过 service_role admin API 批量获取 email 映射 */
async function fetchEmailMap(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();

  const serviceClient = createServiceClient();
  const map = new Map<string, string>();

  // auth.admin.listUsers() 默认每页 50，最多 500。循环拉取直到覆盖全部 id。
  let page = 1;
  const perPage = 500; // 单次最大
  const targetIds = new Set(userIds);
  const found = new Set<string>();

  while (found.size < targetIds.size && page <= 10) {
    const { data, error } = await serviceClient.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      throw new UserError('DB_ERROR', '获取用户邮箱失败，请稍后重试');
    }
    if (!data?.users) break; // 无更多用户，正常结束

    for (const u of data.users) {
      if (targetIds.has(u.id) && u.email) {
        map.set(u.id, u.email);
        found.add(u.id);
      }
    }

    if (data.users.length < perPage) break; // 最后一页
    page++;
  }

  return map;
}

/** 通过 service_role admin API 获取单个用户 email */
async function fetchUserEmail(userId: string): Promise<string> {
  const serviceClient = createServiceClient();
  const { data, error } = await serviceClient.auth.admin.getUserById(userId);

  if (error) {
    throw new UserError('DB_ERROR', '获取用户邮箱失败，请稍后重试');
  }
  // auth user 不存在时 data.user 为空，返回空字符串
  if (!data?.user?.email) return '';
  return data.user.email;
}

// ─── Repository ──────────────────────────────────────────────

export const userRepository = {
  /** 分页列表（profiles + role join + auth.users email） */
  async list(filters: UserListFilters = {}): Promise<PaginatedResult<UserItem>> {
    const supabase = await createClient();
    const { roleId, isActive, page = 1, pageSize = PAGE_SIZE } = filters;

    let query = supabase.from('profiles').select(
      `id, display_name, is_active, created_at, role:role_id (id, name)`,
      { count: 'exact' },
    );

    if (roleId) query = query.eq('role_id', roleId);
    if (isActive !== undefined) query = query.eq('is_active', isActive);

    const from = (page - 1) * pageSize;
    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new UserError('DB_ERROR', '查询用户列表失败，请稍后重试');
    }

    if (!data || data.length === 0) {
      return { data: [], total: count ?? 0, page, pageSize };
    }

    // 批量获取 email
    const userIds = data.map((r) => r.id);
    const emailMap = await fetchEmailMap(userIds);

    return {
      data: data.map((row) => {
        const role = unwrapJoin<{ id: string; name: string }>(row.role);
        return {
          id: row.id,
          email: emailMap.get(row.id) ?? '',
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

    if (error) {
      // PGRST116 = 0 行，不是 DB 错误
      if (error.code === 'PGRST116') return null;
      throw new UserError('DB_ERROR', '查询用户信息失败，请稍后重试');
    }

    if (!data) return null;

    const role = unwrapJoin<{ id: string; name: string }>(data.role);
    const email = await fetchUserEmail(id);

    return {
      id: data.id,
      email,
      displayName: data.display_name,
      roleId: role?.id ?? '',
      roleName: role?.name ?? 'operator',
      isActive: data.is_active,
      createdAt: data.created_at,
    };
  },

  /** 查询角色名（按 roleId） */
  async getRoleName(roleId: string): Promise<string | null> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('role')
      .select('name')
      .eq('id', roleId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // 角色不存在
      throw new UserError('DB_ERROR', '查询角色信息失败，请稍后重试');
    }
    return data?.name ?? null;
  },

  /** 统计拥有指定角色名的活跃用户数（先查 roleId，再 count profiles） */
  async countByRole(roleName: string): Promise<number> {
    const supabase = await createClient();

    // 先查角色 ID
    const { data: roleData, error: roleError } = await supabase
      .from('role')
      .select('id')
      .eq('name', roleName)
      .single();

    if (roleError) {
      if (roleError.code === 'PGRST116') return 0; // 角色不存在 → 0 个用户
      throw new UserError('DB_ERROR', '查询角色统计失败，请稍后重试');
    }

    // 再统计该角色的活跃用户数
    const { count, error } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role_id', roleData.id)
      .eq('is_active', true);

    if (error) {
      throw new UserError('DB_ERROR', '查询角色统计失败，请稍后重试');
    }

    return count ?? 0;
  },

  /** 切换用户角色（确认目标存在，0 行 → NOT_FOUND） */
  async updateRole(userId: string, roleId: string): Promise<void> {
    const supabase = await createClient();
    const { error } = await supabase
      .from('profiles')
      .update({ role_id: roleId })
      .eq('id', userId)
      .select('id')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new UserError('NOT_FOUND', '用户不存在');
      }
      throw new UserError('DB_ERROR', '更新角色失败，请稍后重试');
    }
  },

  /** 启用/禁用用户（确认目标存在，0 行 → NOT_FOUND） */
  async toggleActive(userId: string, isActive: boolean): Promise<void> {
    const supabase = await createClient();
    const { error } = await supabase
      .from('profiles')
      .update({ is_active: isActive })
      .eq('id', userId)
      .select('id')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new UserError('NOT_FOUND', '用户不存在');
      }
      throw new UserError('DB_ERROR', '操作失败，请稍后重试');
    }
  },

  /** 列出所有角色（供筛选下拉使用） */
  async listRoles(): Promise<{ id: string; name: string }[]> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('role')
      .select('id, name')
      .order('name');

    if (error) {
      throw new UserError('DB_ERROR', '查询角色列表失败，请稍后重试');
    }

    return data ?? [];
  },
};
