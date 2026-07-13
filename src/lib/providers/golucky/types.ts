// 喜运达(golucky)物流轨迹 API 私有类型
//
// 这些类型仅在 src/lib/providers/golucky/ 内使用，不得穿透到业务模块。
// 业务模块通过 Record<string, unknown> 接收原始响应。
//
// 响应结构基于喜运达 OpenAPI + 正式环境实测。

// ─── API 响应结构 ──────────────────────────────────────

/** gettoken 响应 */
export interface GoluckyTokenResponse {
  data?: {
    accessToken?: string;
    expiresIn?: number;
  };
  code?: string;
  message?: string;
}

/** 物流轨迹单节点 */
export interface GoluckyTrackingNode {
  code?: string;
  title?: string;
  enTitle?: string;
  desc?: string;
  enDesc?: string;
  time?: number; // 毫秒时间戳
}

/** tracking/list 响应 */
export interface GoluckyTrackingResponse {
  data?: GoluckyTrackingNode[];
  code?: string;
  message?: string;
}

// ─── 解析后类型 ────────────────────────────────────────

/** 解析后的轨迹事件（供 dry-run 和 sync 使用） */
export interface ParsedGoluckyEvent {
  externalEventId: string;
  externalCategory: string;
  status: string;
  description: string;
  occurredAt: string;
  rawPayload: Record<string, unknown>;
}

/** Dry Run 汇总结果 */
export interface GoluckyDryRunResult {
  waybillNo: string;
  events: ParsedGoluckyEvent[];
  rawResponse: unknown;
  success: boolean;
  message: string;
}

/** 同步汇总结果 */
export interface GoluckySyncResult {
  waybillNo: string;
  eventCount: number;
  success: boolean;
  error?: string;
}

/** 批量同步结果 */
export interface GoluckyBatchSyncResult {
  succeeded: GoluckySyncResult[];
  failed: GoluckySyncResult[];
}

// ─── 错误类型 ────────────────────────────────────────────

export class GoluckyApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'GoluckyApiError';
  }
}

export class GoluckyNetworkError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'GoluckyNetworkError';
  }
}

export class GoluckyValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: unknown,
  ) {
    super(message);
    this.name = 'GoluckyValidationError';
  }
}
