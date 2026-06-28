// 百世开放平台只读 API Client（Provider 私有模块）
//
// 本模块禁止向业务模块暴露百世专有字段。
// 业务模块通过 unknown / Record<string, unknown> 接收原始响应。
//
// 请求/响应结构基于官方协议（测试环境已验证）。
// 生产环境 URL 尚未验证。

export { BestClient, createBestClient, loadConfigFromEnv } from './client';
export { sign, stableStringify } from './signature';
export { dryRunWaybill, dryRunOrder, createDryRunClient } from './dry-run';
export {
  BestApiError,
  BestNetworkError,
  BestValidationError,
  type BestQueryResult,
  type BestClientConfig,
  type BestDryRunResult,
  type BestItemSummary,
  type BestTrackingSummary,
  type BestOrderData,
  type BestOrderInfo,
  type BestOrderItem,
  type BestLogisticsData,
  type BestTrackingEvent,
  type QueryOrderInfoParams,
  type QueryLogisticsParams,
} from './types';
export {
  bestOrderResponseSchema,
  bestOrderItemSchema,
  bestLogisticsResponseSchema,
} from './schema';
