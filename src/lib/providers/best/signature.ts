// 百世开放平台签名工具
//
// 签名规范: MD5(HTTP body 原文 + secret)
// body 只序列化一次，序列化后的字符串同时用于签名和 HTTP 请求体。
//
// 安全约束：本模块不得记录 secret 或签名原文到日志/错误/测试快照。

import crypto from 'node:crypto';

/**
 * 将任意 JS 值稳定序列化为 JSON 字符串（sorted keys, no whitespace）。
 * 确保相同数据生成相同的 body 字符串。
 */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return JSON.stringify(value, sortedKeysReplacer);
}

/**
 * JSON.stringify replacer: 对象 key 按字母序输出。
 * 数组保持原始顺序。
 */
function sortedKeysReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = (value as Record<string, unknown>)[k];
        return acc;
      }, {});
  }
  return value;
}

/**
 * 按百世规范生成签名: MD5(bodyStr + secret)
 *
 * bodyStr 必须是已序列化的 HTTP body 原文。
 * 调用方负责先序列化 body，再将同一字符串传入 sign() 和 fetch body。
 *
 * @param bodyStr - 已序列化的 HTTP body 原文
 * @param secret - 百世开放平台密钥
 * @returns 32 位小写 MD5 十六进制字符串
 */
export function sign(bodyStr: string, secret: string): string {
  const raw = bodyStr + secret;
  return crypto.createHash('md5').update(raw, 'utf8').digest('hex');
}
