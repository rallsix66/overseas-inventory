// 仓库分配权限模块 — 类型定义
// P5-SY13A: Warehouse access types
// P5-SY13B: Warehouse assignment management types

export interface WarehouseAccessRepository {
  getAccessibleWarehouseIds(userId: string): Promise<Set<string>>;
  canAccessWarehouse(userId: string, warehouseId: string): Promise<boolean>;
  canAccessVariant(userId: string, variantId: string): Promise<boolean>;
  /** P5-SY13B: 获取所有活跃 operator 用户 */
  listOperators(): Promise<OperatorItem[]>;
  /** P5-SY13B: 获取某用户的已分配仓库 ID 集合 */
  getUserWarehouseAssignments(userId: string): Promise<Set<string>>;
  /** P5-SY13B: 替换某用户的仓库分配。返回 { success, error? } */
  updateUserWarehouses(userId: string, warehouseIds: string[]): Promise<{ success: boolean; error?: string }>;
  /** P5-SY13B: 获取可分配的活跃海外仓库列表 */
  getAssignableWarehouses(): Promise<AssignableWarehouse[]>;
}

/** P5-SY13B: Operator 用户信息 */
export interface OperatorItem {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  createdAt: string;
}

/** P5-SY13B: 可分配的海外仓库 */
export interface AssignableWarehouse {
  id: string;
  name: string;
  country: string;
}

/** P5-SY13B: Operator 及其当前仓库分配 */
export interface OperatorWithAssignments {
  operator: OperatorItem;
  assignedWarehouseIds: string[];
}
