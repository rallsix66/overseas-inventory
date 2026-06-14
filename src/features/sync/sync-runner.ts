// Sync Feature Module — SyncRunner 接口
//
// 同步运行器的抽象接口。具体运行环境（child_process / 消息队列 / 外部调度器）
// 留待 P5-SY6 评估与实现。

import type {
  SyncRunnerCapabilities,
  SyncExecuteParams,
  SyncExecuteResult,
} from './types';

/** 同步运行器接口 */
export interface SyncRunner {
  /** 返回此 Runner 的能力声明 */
  capabilities(): Promise<SyncRunnerCapabilities>;

  /** 执行同步，返回完整结果摘要（服务端内部） */
  execute(params: SyncExecuteParams): Promise<SyncExecuteResult>;
}
