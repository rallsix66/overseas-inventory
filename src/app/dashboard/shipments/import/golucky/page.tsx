// P0: 喜运达运单导入页
//
// 支持两种导入方式：
//   1. 文本粘贴 — 运单号一行一个，或以逗号/空格分隔
//   2. CSV 文件上传 — 解析第一列为运单号
//
// P0 不做 Excel (xlsx)，推迟为独立增强项。

import { requireActiveAuth } from '@/lib/auth';
import { GoluckyImportForm } from './_components/golucky-import-form';
import { inventoryRepository } from '@/features/inventory/repository';

export default async function GoluckyImportPage() {
  const user = await requireActiveAuth();

  // 获取海外仓库列表（供选择目标仓库）
  let warehouses: Array<{ id: string; name: string; country: string }> = [];
  try {
    const overseasWarehouses = await inventoryRepository.getOverseasWarehouses();
    warehouses = overseasWarehouses.map((w) => ({
      id: w.id,
      name: w.name,
      country: w.country ?? '',
    }));
  } catch {
    // 仓库加载失败不阻塞页面渲染
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">导入喜运达运单</h1>
        <p className="text-sm text-muted-foreground mt-1">
          粘贴运单号列表或上传 CSV 文件，批量导入喜运达物流轨迹记录。
        </p>
      </div>

      <GoluckyImportForm
        warehouses={warehouses}
        isAdmin={user.roleName === 'admin'}
      />
    </div>
  );
}
