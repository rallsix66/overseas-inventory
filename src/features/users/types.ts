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
export interface UserListFilters extends PaginationParams {
  roleId?: string;
  isActive?: boolean;
}

/** 用户角色切换 */
export type UserRoleUpdate = {
  userId: string;
  roleId: string;
};

// ─── 错误类型 ───────────────────────────────────────────────

/** 用户模块错误码 */
export type UserErrorCode = 'DB_ERROR' | 'NOT_FOUND' | 'FORBIDDEN' | 'LAST_ADMIN';

/**
 * 用户模块结构化错误。
 * Repository 抛出此错误，Server Action 捕获后转为中文 ActionResult。
 */
export class UserError extends Error {
  name = 'UserError' as const;
  code: UserErrorCode;

  constructor(code: UserErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
