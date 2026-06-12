// 跨模块共享类型
import type { ReactNode } from 'react';

/** Server Action / API 统一返回格式 */
export interface ActionResult<T = void> {
  success: boolean;
  error?: string;
  data?: T;
}

/** 分页查询结果 */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** 表格列定义（用于 columns.tsx） */
export interface ColumnDef<T> {
  key: string;
  header: string;
  /** 自定义渲染，不传则直接显示 item[key] */
  render?: (item: T) => ReactNode;
  sortable?: boolean;
  className?: string;
}

/** 筛选条件基础类型 */
export interface PaginationParams {
  page?: number;
  pageSize?: number;
}
