// 仓库分配权限模块 — 类型定义
// P5-SY13A: Warehouse access types

export interface WarehouseAccessRepository {
  getAccessibleWarehouseIds(userId: string): Promise<Set<string>>;
  canAccessWarehouse(userId: string, warehouseId: string): Promise<boolean>;
  canAccessVariant(userId: string, variantId: string): Promise<boolean>;
}
