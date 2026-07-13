// 喜运达(golucky)响应解析
//
// 1. 过滤标题节点（仅含 title/enTitle、无 code/time）
// 2. time 毫秒 → ISO 8601 timestamptz
// 3. 生成确定性 external_event_id（SHA-256 哈希，幂等去重）
// 4. 归类 external_category

import crypto from 'crypto';
import type { GoluckyTrackingNode, ParsedGoluckyEvent } from './types';

// ─── external_category 映射 ──────────────────────────────

const CATEGORY_PREFIX_MAP: Array<[string, string]> = [
  ['CREATED', 'created'],
  ['CONFIRMED', 'created'],
  ['SHIPPED', 'in_transit'],
  ['MAIN_LINE', 'in_transit'],
  ['DST_PORT', 'customs'],
  ['DELIVERYED', 'delivered'],
  ['DELIVERY', 'delivered'],
  ['RECEIVED', 'delivered'],
  ['LOST', 'exception'],
  ['CANCELED', 'exception'],
  ['RETURNED', 'exception'],
  ['DESTROYED', 'exception'],
  ['FAILED', 'exception'],
];

function classifyCategory(code: string): string {
  const upper = code.toUpperCase();
  for (const [prefix, category] of CATEGORY_PREFIX_MAP) {
    if (upper.startsWith(prefix)) {
      return category;
    }
  }
  return 'unknown';
}

// ─── 哈希生成 ────────────────────────────────────────────

function generateEventId(
  provider: string,
  node: GoluckyTrackingNode,
  occurredAt: string,
): string {
  return crypto
    .createHash('sha256')
    .update(
      [
        provider,
        node.code ?? '',
        node.title ?? '',
        node.desc ?? '',
        occurredAt,
      ].join('|'),
    )
    .digest('hex');
}

// ─── 主解析函数 ──────────────────────────────────────────

/**
 * 解析喜运达轨迹响应。
 *
 * @param nodes — API 返回的 data 数组
 * @param waybillNo — 运单号（用于错误信息）
 * @returns 解析后的轨迹事件（仅含有效节点）
 */
export function parseTrackingResponse(
  nodes: GoluckyTrackingNode[],
  _waybillNo: string,
): ParsedGoluckyEvent[] {
  // 过滤：仅含 title/enTitle 的标题节点
  const validNodes = nodes.filter((node) => node.code);

  return validNodes.map((node) => {
    // 毫秒 → ISO 8601
    const occurredAt = node.time
      ? new Date(node.time).toISOString()
      : new Date().toISOString();

    const externalEventId = generateEventId('golucky', node, occurredAt);
    const externalCategory = classifyCategory(node.code ?? '');
    const status = node.code ?? '';
    const description = node.desc ?? node.title ?? '';

    return {
      externalEventId,
      externalCategory,
      status,
      description,
      occurredAt,
      rawPayload: node as unknown as Record<string, unknown>,
    };
  });
}
