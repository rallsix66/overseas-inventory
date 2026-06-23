// Sync Feature Module — WebInputArtifactSource
//
// 生产级 InputArtifactSource 实现。
// 通过 Python 桥接调用 BigSeller 抓取器获取真实库存数据。
// 替代 mockInputArtifactSource 的硬编码假数据。
//
// P5-SY9C: 真实 Provider / InputSource / Production wiring

import type { InputArtifactSource } from './actions';
import type { JsonValue } from './types';
import { callPythonBridge } from '@/lib/python-bridge';
import type { WarehouseBridgeInfo } from './real-sync-runner';

// ─── Feature Gate ─────────────────────────────────────────────────

/** Web 同步真实写入功能开关。
 *  仅在显式设置 WEBSYNC_REAL_WRITE_ENABLED=true 时启用。
 *  在此之前 syncWarehouse/syncAllWarehouses 在 Server Action 层
 *  被 session health guard 阻断；此 feature gate 作为额外防御层。
 *
 *  P5-SY9C 阶段保持 disabled。P5-SY9E heartbeat/timeout 完成且
 *  P5-SY9I 独立验收通过后才允许启用。 */
export function isWebsyncRealWriteEnabled(): boolean {
  return process.env.WEBSYNC_REAL_WRITE_ENABLED === 'true';
}

// ─── Implementation ──────────────────────────────────────────────

export class WebInputArtifactSource implements InputArtifactSource {
  private warehouseMap: Map<string, WarehouseBridgeInfo>;

  constructor(warehouses: WarehouseBridgeInfo[]) {
    this.warehouseMap = new Map(warehouses.map((w) => [w.id, w]));
  }

  async getInputArtifact(
    warehouseId: string,
    _mode: 'dry_run' | 'real_write',
  ): Promise<JsonValue> {
    const wh = this.warehouseMap.get(warehouseId);
    if (!wh) {
      throw new Error(`未知仓库: ${warehouseId}`);
    }

    // 通过 Python 桥接调用 BigSeller 抓取器获取真实库存数据。
    // 注意：当前 RealSyncRunner.execute() 也会独立调用 callPythonBridge
    // 执行完整 pipeline（抓取 + 计划 + 写入）。这意味着同一次同步会调用
    // Python 两次。这是过渡期设计 — P5-SY9D 将优化为单次调用，由
    // InputArtifactSource 产出抓取数据，Runner 仅负责执行计划。
    const bridgeResult = await callPythonBridge({
      warehouseId: wh.id,
      warehouseName: wh.name,
      oldName: wh.oldName,
      country: wh.country,
      token: wh.token,
      mode: _mode,
    });

    if (!bridgeResult.success) {
      throw new Error(
        `BigSeller 抓取失败: ${bridgeResult.errors.join('; ') || '未知错误'}`,
      );
    }

    // 返回抓取结果作为 input artifact。
    // 结构对齐 Python 桥接返回的原始数据。
    return {
      warehouse: wh.name,
      warehouseId: wh.id,
      country: wh.country,
      timestamp: new Date().toISOString(),
      summary: bridgeResult.summary,
      errors: bridgeResult.errors,
    } as JsonValue;
  }
}
