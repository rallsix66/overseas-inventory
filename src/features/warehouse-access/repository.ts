// 仓库分配权限模块 — 数据访问层
// P5-SY13A: 封装 user_warehouses 表查询，提供仓库/变体访问权限检查
//
// Admin 不受仓库分配限制（getUserRole() === 'admin' 时返回全部仓库）。
// Operator 仅可访问 user_warehouses 中分配的仓库。
import { createClient } from '@/lib/supabase/server';
import type { WarehouseAccessRepository } from './types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUUID(id: string): boolean {
  return UUID_RE.test(id);
}

export const warehouseAccessRepository: WarehouseAccessRepository = {
  /**
   * 获取用户可访问的仓库 ID 集合。
   * Admin 返回所有 active overseas warehouse；Operator 返回 user_warehouses 中分配的。
   */
  async getAccessibleWarehouseIds(userId: string): Promise<Set<string>> {
    if (!validateUUID(userId)) return new Set();

    const supabase = await createClient();

    // 先查角色
    const { data: profile } = await supabase
      .from('profiles')
      .select('role:role_id(name)')
      .eq('id', userId)
      .single();

    // Admin → 返回所有 active overseas warehouse
    const roleName = (profile as unknown as { role: { name: string } } | null)?.role?.name;
    if (roleName === 'admin') {
      const { data: allWh } = await supabase
        .from('warehouse')
        .select('id')
        .eq('type', 'overseas')
        .eq('is_active', true);

      return new Set((allWh ?? []).map((w) => w.id));
    }

    // Operator → 返回 user_warehouses 中分配的
    const { data } = await supabase
      .from('user_warehouses')
      .select('warehouse_id')
      .eq('user_id', userId);

    return new Set((data ?? []).map((r) => r.warehouse_id));
  },

  /** 检查用户是否有某个仓库的访问权限 */
  async canAccessWarehouse(userId: string, warehouseId: string): Promise<boolean> {
    const ids = await this.getAccessibleWarehouseIds(userId);
    return ids.has(warehouseId);
  },

  /**
   * 检查用户是否有某个 variant 的访问权限。
   * 判断依据：variant 在用户已分配仓库中是否有 inventory。
   * Admin 始终有权限。
   */
  async canAccessVariant(userId: string, variantId: string): Promise<boolean> {
    if (!validateUUID(userId) || !validateUUID(variantId)) return false;

    const supabase = await createClient();

    // 先查角色
    const { data: profile } = await supabase
      .from('profiles')
      .select('role:role_id(name)')
      .eq('id', userId)
      .single();

    const roleName = (profile as unknown as { role: { name: string } } | null)?.role?.name;
    if (roleName === 'admin') return true;

    // Operator: 检查 variant 在已分配仓库中是否有 inventory
    const accessibleIds = await this.getAccessibleWarehouseIds(userId);
    if (accessibleIds.size === 0) return false;

    const { data } = await supabase
      .from('inventory')
      .select('id')
      .eq('variant_id', variantId)
      .in('warehouse_id', [...accessibleIds])
      .limit(1);

    return (data?.length ?? 0) > 0;
  },
};
