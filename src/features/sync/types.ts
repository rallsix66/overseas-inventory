// Sync Feature Module — 类型定义 (P5-SY5C2 V5.8)

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

// ─── SyncExecuteParams — mode 判别联合 ─────────────────────────────

/** Dry Run 分支：禁止 confirmToken / boundPlanArtifact */
export interface SyncExecuteParamsDryRun {
  runId: string;
  warehouseId: string;
  mode: 'dry_run';
  triggeredBy: string;
  signal?: AbortSignal;
  inputArtifact: JsonValue; // Runner 接收 normalizedContent（必需）
  // 禁止: confirmToken, boundPlanArtifact
}

/** Real Write 分支：强制 confirmToken + dryRunRunId + boundPlanArtifact */
export interface SyncExecuteParamsRealWrite {
  runId: string;
  warehouseId: string;
  mode: 'real_write';
  confirmToken: string; // 必须 'P5-SY3B-PH'
  triggeredBy: string;
  dryRunRunId: string; // 绑定 Dry Run ID
  signal?: AbortSignal;
  inputArtifact: JsonValue; // 当前 input normalizedContent（必需）
  boundPlanArtifact: JsonValue; // verified bound plan content（必须）
}

export type SyncExecuteParams = SyncExecuteParamsDryRun | SyncExecuteParamsRealWrite;

// ─── SyncExecuteResult ────────────────────────────────────────────

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
  /** Dry Run 执行完成后 Runner 输出的 Plan Artifact。
   *  仅 dry_run 模式且 exitCode=0 时必须存在。
   *  real_write 模式必须为 undefined（使用绑定的 Dry Run plan）。
   *  结构严格匹配 plan_generator.generate_plan() 输出。 */
  planArtifact?: JsonValue;
}

// ─── SyncServiceInput — mode 判别联合 ─────────────────────────────

export interface SyncServiceInputDryRun {
  warehouseId: string;
  mode: 'dry_run';
  inputArtifact: JsonValue; // 必须；缺失在 claim 前失败
  triggeredBy: string;
  signal?: AbortSignal;
}

export interface SyncServiceInputRealWrite {
  warehouseId: string;
  mode: 'real_write';
  inputArtifact: JsonValue; // 必须（当前 input）
  dryRunRunId: string; // 必须
  confirmToken: string; // 必须
  triggeredBy: string;
  signal?: AbortSignal;
}

export type SyncServiceInput = SyncServiceInputDryRun | SyncServiceInputRealWrite;

// ─── SyncServiceResult — executeSync 返回值 ────────────────────────

export interface SyncServiceResult {
  /** 本次运行 ID（预生成，无论成功失败均存在） */
  runId: string;
  /** 运行终态：completed=审计写入成功, failed=RPC/存储/校验失败, indeterminate=业务成功但审计写入失败 */
  status: 'completed' | 'failed' | 'indeterminate';
  /** Runner 输出。仅在 runner 实际执行后存在；claim 前失败时为 undefined。
   *  status='completed' 时 runnerResult 必须存在且 success=true。
   *  status='indeterminate' 时 runnerResult 存在（业务已成功）但 release 失败。 */
  runnerResult?: SyncExecuteResult;
  /** 失败原因（status='failed' 时存在；status='indeterminate' 时说明 release 失败原因） */
  error?: string;
  /** 仅 status='indeterminate' 时供调用方决策：artifact 保留情况摘要 */
  artifactDisposition?: {
    inputRetained: boolean;
    planRetained: boolean;
    reason: string;
  };
}

// ─── 查询 RPC 精确返回类型 ────────────────────────────────────────

/** Admin 视图 — get_sync_runs 单条记录 */
export interface SyncRunAdminRow {
  id: string;
  warehouse_id: string;
  warehouse_name: string;
  mode: 'dry_run' | 'real_write';
  status: 'in_progress' | 'completed' | 'failed';
  display_name: string;
  triggered_from: 'web' | 'cli';
  started_at: string;
  finished_at: string | null;
  created_at: string;
  exit_code: number | null;
  error_message: string | null;
  result_summary: Record<string, unknown> | null;
  plan_drift_check: 'PASS' | 'DRIFT_DETECTED' | null;
  plan_drift_count: number | null;
  dry_run_run_id: string | null;
}

/** Operator 视图 — get_sync_runs 单条记录（脱敏） */
export interface SyncRunOperatorRow {
  id: string;
  warehouse_id: string;
  warehouse_name: string;
  mode: 'dry_run' | 'real_write';
  status: 'in_progress' | 'completed' | 'failed';
  triggered_by_email: string | null;
  triggered_from: 'web' | 'cli';
  started_at: string;
  finished_at: string | null;
  created_at: string;
  plan_drift_check: 'PASS' | 'DRIFT_DETECTED' | null;
  plan_drift_count: number | null;
  result_summary: { variantsCreated: unknown; inventoryUpdated: unknown } | null;
  failure_summary: string | null;
}

/** get_sync_runs 返回类型 — JSON 数组 */
export type SyncRunsResponse = SyncRunAdminRow[] | SyncRunOperatorRow[];

// ─── Session Health Check (P5-SY9B) ─────────────────────────────

/** BigSeller 登录会话健康状态 */
export type SessionHealthStatus =
  | 'healthy'           // 已登录可用
  | 'need_login'        // 需要登录
  | 'need_verification' // 需要验证码
  | 'profile_unavailable' // profile 不可用
  | 'page_structure_changed' // 页面结构异常
  | 'table_not_loaded'  // 表格未加载
  | 'unknown_error';    // 未知错误

/** 会话健康检查结果 */
export interface SessionHealthResult {
  status: SessionHealthStatus;
  message: string;      // 中文可读描述
  checkedAt: string;    // ISO 时间戳
  details?: Record<string, unknown>;
}

// ─── Detail types ──────────────────────────────────────────────────

/** get_sync_run_detail Admin 视图 — 比列表多 plan_drift_differences */
export interface SyncRunDetailAdmin extends SyncRunAdminRow {
  plan_drift_differences: string[] | null;
}

/** get_sync_run_detail Operator 视图 — 不含 plan_drift_differences */
export type SyncRunDetailOperator = SyncRunOperatorRow;

export type SyncRunDetailResponse = SyncRunDetailAdmin | SyncRunDetailOperator | null;

// ─── P5-SY9D: Dry Run 审核与确认绑定 ──────────────────────────────

/** 单仓 Dry Run 触发返回（含审核摘要） */
export interface TriggerDryRunResult {
  warehouseId: string;
  warehouseName: string;
  success: boolean;
  runId: string;
  status: string;
  error?: string;
  /** Dry Run 审核摘要 */
  summary?: {
    warehouseName: string;
    country: string;
    rawRowCount: number;
    validSkuCount: number;
    invalidSkuCount: number;
    variantsCreated: number;
    inventoryInserted: number;
    inventoryUpdated: number;
    inventoryUnchanged: number;
    warehouseRenamed: boolean;
    planDriftCheck: 'PASS' | 'DRIFT_DETECTED' | null;
    planDriftCount: number;
  };
}

/** 确认 Real Write 返回（绑定 Dry Run） */
export interface ConfirmRealWriteResult {
  warehouseId: string;
  warehouseName: string;
  success: boolean;
  runId: string;
  status: string;
  error?: string;
  dryRunRunId: string;
}
