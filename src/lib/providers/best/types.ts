// 百世开放平台 API 私有类型
//
// 这些类型仅在 src/lib/providers/best/ 内使用，不得穿透到业务模块。
// 业务模块通过 unknown / Record<string, unknown> 接收原始响应。
//
// 请求/响应结构基于官方协议（测试环境已验证）。
// 生产环境 URL 尚未验证。

/** 百世 API 查询通用返回结构 */
export interface BestQueryResult<T = unknown> {
  /** 业务成功标识 */
  success: boolean;
  /** 响应消息 */
  message: string;
  /** Zod 校验后的类型化数据（仅通用字段，provider 专有字段不在此） */
  data: T;
  /** API 响应中未经变换的原始数据（保留所有 provider 专有字段，供 raw_payload 写入） */
  rawData: unknown;
}

/** queryOrderInfoByOrderNo 的 bizData 参数 */
export interface QueryOrderInfoParams {
  /** 订单号或运单号列表 */
  nos: string[];
  /** 页码，从 1 开始 */
  currentPage?: number;
  /** 每页条数 */
  pageSize?: number;
}

/** queryOrderInfoByOrderNo 返回的 data 字段 */
export interface BestOrderData {
  pageSize?: number;
  currentPage?: number;
  total?: number;
  list?: BestOrderInfo[];
}

/** 运单信息（list 中每条记录） */
export interface BestOrderInfo {
  goodsInfoList?: BestOrderItem[];
  [key: string]: unknown;
}

/** 运单中的商品明细（goodsInfoList 元素） */
export interface BestOrderItem {
  goodsCode?: string;
  goodsName?: string;
  goodsQuantity?: number;
}

/** queryLogisticsTrace 的 bizData 参数 */
export interface QueryLogisticsParams {
  /** 运单号列表 */
  nos: string[];
}

/** queryLogisticsTrace 返回的 Data 字段 */
export interface BestLogisticsData {
  Items?: unknown[];
}

/** 百世物流轨迹事件（结构待真实响应确认） */
export interface BestTrackingEvent {
  status?: string;
  description?: string;
  occurredAt?: string;
  location?: string;
}

/** Dry Run 汇总结果 */
export interface BestDryRunResult {
  /** 查询的 order info 原始数据 */
  orderInfo: unknown;
  /** 物流轨迹原始数据 */
  logisticsTrace: unknown;
  /** 解析后的商品明细摘要 */
  itemSummary: BestItemSummary[];
  /** 解析后的轨迹摘要 */
  trackingSummary: BestTrackingSummary[];
  /** 业务成功标识 */
  success: boolean;
  /** 响应消息 */
  message: string;
}

/** Dry Run 商品摘要（脱敏后对外可展示） */
export interface BestItemSummary {
  externalSku: string;
  productName: string;
  quantity: number;
}

/** Dry Run 轨迹摘要（脱敏后对外可展示） */
export interface BestTrackingSummary {
  status: string;
  description: string;
  occurredAt: string;
  location: string;
}

/** 百世 API Client 配置 */
export interface BestClientConfig {
  baseUrl: string;
  partnerId: string;
  secret: string;
  /** 请求超时 ms，默认 30000 */
  timeoutMs?: number;
}

/** 百世业务错误 */
export class BestApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'BestApiError';
  }
}

/** 网络/超时错误 */
export class BestNetworkError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'BestNetworkError';
  }
}

/** Zod 校验错误（envelope / data / item 校验失败） */
export class BestValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: unknown,
  ) {
    super(message);
    this.name = 'BestValidationError';
  }
}
