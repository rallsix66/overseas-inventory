// 用户模块类型
import type { Database } from '@/types/database';
import type { PaginationParams } from '@/types/common';

export type ProfileRow = Database['public']['Tables']['profiles']['Row'];
export type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];

/** 用户列表项（含邮箱和角色） */
export interface UserItem {
  id: string;
  email: string;
  displayName: string;
  roleId: string;
  roleName: string;
  isActive: boolean;
  createdAt: string;
}

/** 用户筛选条件 */
export interface UserFilters extends PaginationParams {
  roleId?: string;
  isActive?: boolean;
}

/** 用户角色切换 */
export type UserRoleUpdate = {
  userId: string;
  roleId: string;
};
