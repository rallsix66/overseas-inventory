// Sync Feature Module — 类型定义

/** 严格的 JSON 值类型。禁止函数、Symbol、undefined、自定义原型、toJSON 方法。 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ArtifactType = 'input' | 'plan';

export interface PreparedArtifact {
  bytes: Uint8Array;
  hash: string; // SHA-256 hex digest of bytes
  normalizedContent: JsonValue; // JSON.parse(bytes) — round-trip with bytes
}

export interface Artifact {
  runId: string;
  type: ArtifactType;
  content: JsonValue; // JSON.parse(stored bytes), equals PreparedArtifact.normalizedContent
  hash: string; // SHA-256 hex digest of stored bytes
  storedAt: string; // ISO timestamp
}

/** GC 候选条目 — 纯存储层信息，不查询 sync_run */
export interface ArtifactCandidate {
  runId: string;
  type: ArtifactType;
  createdAt: Date;
}

// ─── Sync Runner ──────────────────────────────────────────────────

/** 同步运行器能力声明 */
export interface SyncRunnerCapabilities {
  supportsCancel: boolean;
  supportsTimeout: boolean;
  maxTimeoutMs: number; // 最大超时毫秒数（0 = 无限制）
  supportedModes: Array<'dry_run' | 'real_write'>;
}

/** 同步执行参数 */
export interface SyncExecuteParams {
  runId: string; // sync_run.id，由调用方（SyncService）在 claim 成功后传入
  warehouseId: string;
  mode: 'dry_run' | 'real_write';
  confirmToken: string; // 必须为 'P5-SY3B-PH'
  triggeredBy: string; // 触发者 user.id（审计用）
  signal?: AbortSignal; // 取消/超时信号（若 Runner 支持）
  inputArtifact?: JsonValue; // 输入快照内容（严格 JsonValue）
  boundPlanArtifact?: JsonValue; // 绑定的计划内容（仅 real_write，用于漂移对比）
}

/** 同步执行结果摘要（完整版，仅服务端内部使用，不直接返回客户端） */
export interface SyncExecuteResult {
  success: boolean;
  exitCode: 0 | 1 | 2;
  // 0=成功, 1=RPC/审计失败/参数拒绝, 2=RPC 成功但 sync_log 写入失败
  summary: {
    warehouseId: string;
    warehouseName: string;
    variantsCreated: number;
    variantsSkipped: number;
    inventoryInserted: number;
    inventoryUpdated: number;
    inventoryUnchanged: number;
    warehouseRenamed: boolean;
  };
  syncLog: {
    status: 'success' | 'failed';
    written: boolean;
    fallbackPath?: string; // 仅服务端内部使用，禁止返回客户端
  };
  planDriftCheck: 'PASS' | 'DRIFT_DETECTED';
  planDriftCount: number;
  planDriftDifferences: string[];
  errors: string[]; // 原始技术错误，需脱敏后才返回客户端
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}
