// 百世只读 Dry Run 入口
//
// 拉取数据、解析响应、验证结构、返回结构化结果。
// 不写任何 DIS 数据库表。
//
// 安全约束：Dry Run 结果不包含 secret、签名原文或真实凭证。

import { BestClient, loadConfigFromEnv, type FetchFn } from './client';
import {
  BestValidationError,
  type BestDryRunResult,
  type BestItemSummary,
  type BestTrackingSummary,
  type BestOrderData,
  type BestLogisticsData,
} from './types';
import { bestOrderItemSchema } from './schema';

/**
 * 对单个运单号执行 Dry Run 拉取。
 *
 * 流程:
 * 1. 调用 queryOrderInfoByOrderNo 获取运单信息
 * 2. 调用 queryLogisticsTrace 获取物流轨迹
 * 3. 将原始响应解析为结构化摘要
 *
 * @param client - 已配置的 BestClient
 * @param waybillNo - 运单号
 * @returns Dry Run 汇总结果
 */
export async function dryRunWaybill(
  client: BestClient,
  waybillNo: string,
): Promise<BestDryRunResult> {
  const orderResponse = await client.queryOrderInfoByOrderNo({
    nos: [waybillNo],
  });
  const traceResponse = await client.queryLogisticsTrace({
    nos: [waybillNo],
  });

  const itemSummary = parseItems(orderResponse.data);
  const trackingSummary = parseTracking(traceResponse.data);

  return {
    orderInfo: orderResponse.rawData,
    logisticsTrace: traceResponse.rawData,
    itemSummary,
    trackingSummary,
    success: orderResponse.success && traceResponse.success,
    message: orderResponse.message,
  };
}

/**
 * 对单个订单号执行 Dry Run 拉取。
 */
export async function dryRunOrder(
  client: BestClient,
  orderNo: string,
): Promise<BestDryRunResult> {
  const orderResponse = await client.queryOrderInfoByOrderNo({
    nos: [orderNo],
  });

  // 尝试从运单列表中提取 waybillNo 用于轨迹查询
  let waybillNo: string | null = null;
  const list = orderResponse.data?.list;
  if (list && list.length > 0) {
    const first = list[0] as Record<string, unknown> | null;
    if (first) {
      // 尝试常见字段名
      waybillNo =
        (first.waybillNo as string) ||
        (first.waybill_no as string) ||
        (first.mailNo as string) ||
        (first.mail_no as string) ||
        null;
    }
  }

  let traceResponse;
  if (waybillNo && typeof waybillNo === 'string') {
    traceResponse = await client.queryLogisticsTrace({
      nos: [waybillNo],
    });
  } else {
    traceResponse = null;
  }

  const itemSummary = parseItems(orderResponse.data);
  const trackingSummary = traceResponse
    ? parseTracking(traceResponse.data)
    : [];

  return {
    orderInfo: orderResponse.rawData,
    logisticsTrace: traceResponse?.rawData ?? null,
    itemSummary,
    trackingSummary,
    success: orderResponse.success,
    message: orderResponse.message,
  };
}

/**
 * 从环境变量创建 Dry Run client。
 * 凭证缺失时 fail-fast。
 */
export function createDryRunClient(
  env: typeof process.env,
  fetchImpl?: FetchFn,
): BestClient {
  return new BestClient(loadConfigFromEnv(env), fetchImpl);
}

// ─── 内部解析辅助 ───────────────────────────────────────────────

function parseItems(data: BestOrderData | null): BestItemSummary[] {
  if (data === null || data === undefined) {
    throw new BestValidationError('运单数据为 null', null);
  }
  const list = data.list;
  // list 字段缺失 → 返回空
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) {
    throw new BestValidationError('list 字段不是数组', null);
  }
  if (list.length === 0) return [];

  const summaries: BestItemSummary[] = [];

  for (let orderIdx = 0; orderIdx < list.length; orderIdx++) {
    const orderInfo = list[orderIdx];
    if (orderInfo === null || orderInfo === undefined) {
      throw new BestValidationError(`list[${orderIdx}] 为 null`, null);
    }
    if (typeof orderInfo !== 'object') {
      throw new BestValidationError(`list[${orderIdx}] 不是对象`, null);
    }
    const rec = orderInfo as Record<string, unknown>;
    const goodsList = rec.goodsInfoList;

    // goodsInfoList 字段缺失 → 跳过该运单（可能无商品明细）
    if (goodsList === undefined) continue;
    if (!Array.isArray(goodsList)) {
      throw new BestValidationError(
        `list[${orderIdx}].goodsInfoList 不是数组`,
        null,
      );
    }

    for (let itemIdx = 0; itemIdx < goodsList.length; itemIdx++) {
      const item = goodsList[itemIdx];
      if (item === null || item === undefined) {
        throw new BestValidationError(
          `list[${orderIdx}].goodsInfoList[${itemIdx}] 为 null`,
          null,
        );
      }
      if (typeof item !== 'object') {
        throw new BestValidationError(
          `list[${orderIdx}].goodsInfoList[${itemIdx}] 不是对象`,
          null,
        );
      }
      const result = bestOrderItemSchema.safeParse(item);
      if (!result.success) {
        throw new BestValidationError(
          `list[${orderIdx}].goodsInfoList[${itemIdx}] 校验失败`,
          result.error,
        );
      }
      const i = result.data;
      summaries.push({
        externalSku: i.goodsCode ?? '',
        productName: i.goodsName ?? '',
        quantity: i.goodsQuantity,
      });
    }
  }

  return summaries;
}

function parseTracking(
  data: BestLogisticsData | null,
): BestTrackingSummary[] {
  if (data === null || data === undefined) {
    throw new BestValidationError('轨迹数据为 null', null);
  }
  const items = data.Items;
  if (items === undefined || items === null) return [];
  if (!Array.isArray(items)) {
    throw new BestValidationError('Items 字段不是数组', null);
  }
  if (items.length === 0) return [];

  const summaries: BestTrackingSummary[] = [];

  for (let itemIdx = 0; itemIdx < items.length; itemIdx++) {
    const item = items[itemIdx];
    if (item === null || item === undefined) continue;
    if (typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;

    // 尝试找到嵌套的轨迹事件: Groups → Traces 或直接的 Traces
    const groups = rec.Groups;
    if (Array.isArray(groups)) {
      for (const group of groups) {
        if (group && typeof group === 'object') {
          const traces = (group as Record<string, unknown>).Traces;
          if (Array.isArray(traces)) {
            for (const trace of traces) {
              const s = tryExtractTrackingEvent(trace);
              if (s) summaries.push(s);
            }
          }
        }
      }
    }

    // 也可能 Traces 直接在 item 下
    const traces = rec.Traces;
    if (Array.isArray(traces)) {
      for (const trace of traces) {
        const s = tryExtractTrackingEvent(trace);
        if (s) summaries.push(s);
      }
    }
  }

  return summaries;
}

function tryExtractTrackingEvent(
  raw: unknown,
): BestTrackingSummary | null {
  if (raw === null || raw === undefined || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  // 至少需要 status 或 description 之一
  const status = typeof e.status === 'string' ? e.status : '';
  const description =
    typeof e.description === 'string'
      ? e.description
      : typeof e.desc === 'string'
        ? e.desc
        : '';
  if (!status && !description) return null;

  return {
    status,
    description,
    occurredAt:
      typeof e.occurredAt === 'string'
        ? e.occurredAt
        : typeof e.occurred_at === 'string'
          ? e.occurred_at
          : typeof e.time === 'string'
            ? e.time
            : '',
    location:
      typeof e.location === 'string'
        ? e.location
        : typeof e.loc === 'string'
          ? e.loc
          : '',
  };
}
