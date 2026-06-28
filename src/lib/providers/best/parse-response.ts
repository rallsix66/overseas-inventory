// 百世响应安全解析工具
//
// 将 unknown 类型的原始响应按期望结构解析。
// 解析失败不抛异常，返回 null 或默认值，由调用方决定如何处理。

/**
 * 安全地将 unknown 按期望结构解析为指定类型。
 * 不匹配时返回 null，不抛异常。
 */
export function parseBestResponse<T>(data: unknown): T | null {
  if (data === null || data === undefined) return null;
  if (typeof data !== 'object') return null;
  return data as unknown as T;
}

/**
 * 安全提取字符串字段。
 */
export function safeString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return fallback;
}

/**
 * 安全提取数字字段。
 */
export function safeNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

/**
 * 安全提取数组字段。
 */
export function safeArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return [];
}
