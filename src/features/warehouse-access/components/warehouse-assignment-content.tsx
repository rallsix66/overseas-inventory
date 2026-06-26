'use client';

// 仓库分配管理 — 客户端交互组件
// P5-SY13B: Admin 可查看 operator 列表并勾选分配海外仓库
import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { updateUserWarehouses } from '../actions';
import type { ActionResult } from '@/types/common';
import type { OperatorWithAssignments, AssignableWarehouse } from '../types';

interface Props {
  operatorsResult: ActionResult<OperatorWithAssignments[]>;
  warehousesResult: ActionResult<AssignableWarehouse[]>;
  isAdmin: boolean;
}

export function WarehouseAssignmentContent({
  operatorsResult,
  warehousesResult,
  isAdmin,
}: Props) {
  if (!isAdmin) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">仓库分配</h1>
          <p className="text-sm text-gray-500 mt-1">管理运营人员可访问的海外仓库</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <p className="text-sm text-gray-500">无权限：仅管理员可访问仓库分配管理</p>
        </div>
      </div>
    );
  }

  if (!operatorsResult.success || !warehousesResult.success) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">仓库分配</h1>
          <p className="text-sm text-gray-500 mt-1">管理运营人员可访问的海外仓库</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <p className="text-sm text-gray-500">
            {operatorsResult.error || warehousesResult.error || '加载失败，请刷新重试'}
          </p>
        </div>
      </div>
    );
  }

  const operators = operatorsResult.data ?? [];
  const warehouses = warehousesResult.data ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">仓库分配</h1>
        <p className="text-sm text-gray-500 mt-1">
          管理运营人员可访问的海外仓库。勾选后保存，取消勾选并保存即清空分配。
        </p>
      </div>

      {operators.length === 0 ? (
        <EmptyOperators />
      ) : warehouses.length === 0 ? (
        <EmptyWarehouses />
      ) : (
        <div className="space-y-4">
          {operators.map((op) => (
            <OperatorCard
              key={op.operator.id}
              operatorWithAssignments={op}
              warehouses={warehouses}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** 无 operator 时的空状态 */
function EmptyOperators() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
      <p className="text-sm text-gray-500 mb-3">暂无可分配的操作员</p>
      <p className="text-xs text-gray-400">
        当前系统中没有活跃的运营人员账号。新注册的运营人员将自动显示在此处。
      </p>
    </div>
  );
}

/** 无仓库时的空状态 */
function EmptyWarehouses() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
      <p className="text-sm text-gray-500 mb-3">暂无可分配的海外仓库</p>
      <p className="text-xs text-gray-400">
        当前系统中没有活跃的海外仓库。请先确保海外仓库已配置并启用。
      </p>
    </div>
  );
}

/** 单个 Operator 的仓库分配卡片 */
function OperatorCard({
  operatorWithAssignments,
  warehouses,
}: {
  operatorWithAssignments: OperatorWithAssignments;
  warehouses: AssignableWarehouse[];
}) {
  const { operator, assignedWarehouseIds } = operatorWithAssignments;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(assignedWarehouseIds),
  );
  const [saving, setSaving] = useState(false);

  const handleToggle = useCallback((warehouseId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(warehouseId)) {
        next.delete(warehouseId);
      } else {
        next.add(warehouseId);
      }
      return next;
    });
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const result = await updateUserWarehouses(
        operator.id,
        [...selectedIds],
      );
      if (result.success) {
        toast.success(`已更新「${operator.displayName || operator.email || '操作员'}」的仓库分配`);
      } else {
        toast.error(result.error || '保存失败，请稍后重试');
      }
    } catch {
      toast.error('保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  }, [operator.id, operator.displayName, operator.email, selectedIds]);

  const hasChanges =
    new Set(assignedWarehouseIds).size !== selectedIds.size ||
    ![...assignedWarehouseIds].every((id) => selectedIds.has(id));

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      {/* Operator 信息行 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-900">
            {operator.displayName || '未命名'}
          </span>
          {operator.email && (
            <span className="text-xs text-gray-400">{operator.email}</span>
          )}
          <Badge variant="secondary" className="text-xs">
            运营
          </Badge>
        </div>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving || !hasChanges}
        >
          {saving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
          保存
        </Button>
      </div>

      {/* 仓库勾选网格 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {warehouses.map((wh) => {
          const checked = selectedIds.has(wh.id);
          return (
            <label
              key={wh.id}
              className={`flex items-center gap-2 px-3 py-2 rounded-md border text-sm cursor-pointer transition-colors ${
                checked
                  ? 'border-blue-300 bg-blue-50 text-blue-800'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              <input
                type="checkbox"
                className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                checked={checked}
                onChange={() => handleToggle(wh.id)}
                disabled={saving}
              />
              <span className="truncate">{wh.name}</span>
              <span className="text-xs text-gray-400 ml-auto shrink-0">
                {wh.country}
              </span>
            </label>
          );
        })}
      </div>

      {/* 已选数量提示 */}
      <p className="text-xs text-gray-400 mt-3">
        已分配 {selectedIds.size} / {warehouses.length} 个海外仓库
        {hasChanges && (
          <span className="text-amber-600 ml-2">（未保存）</span>
        )}
      </p>
    </div>
  );
}
