// Sync Feature Module — validateJsonValue 运行时验证器 (V5.4.3)
//
// 在 prepare() 调用 JSON.stringify 之前执行，拒绝所有非 JSON 安全的值。
// 验证规则完整覆盖 V5.4.1 / V5.4.2 / V5.4.3 增强项。
//
// 关键约束：返回原始值引用，不使用普通 {} 或 map() 重建对象/数组。
// 这确保 __proto__ 等特殊键不会被丢失或修改原型。

import type { JsonValue } from './types';

/**
 * 递归验证 value 是否为严格的 JsonValue。
 * 返回原始 value 引用（不变），仅做验证，不重建对象/数组。
 * 遇到非法值时抛出带有路径信息的详细错误。
 */
export function validateJsonValue(
  value: unknown,
  path: string = 'root',
  seen: WeakSet<object> = new WeakSet(),
): JsonValue {
  if (value === undefined) {
    throw new Error(`JsonValue 不允许 undefined: ${path}`);
  }

  if (value === null) {
    return value;
  }

  const type = typeof value;

  if (type === 'function') {
    throw new Error(`JsonValue 不允许函数: ${path}`);
  }

  if (type === 'symbol') {
    throw new Error(`JsonValue 不允许 Symbol: ${path}`);
  }

  if (type === 'bigint') {
    throw new Error(`JsonValue 不允许 BigInt: ${path}`);
  }

  if (typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(
        `JsonValue number 必须为有限值，收到 ${
          Number.isNaN(value) ? 'NaN' : 'Infinity'
        }: ${path}`,
      );
    }
    return value as JsonValue;
  }

  // array — 返回原始数组引用，不通过 map() 重建
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new Error(`JsonValue 不允许循环引用: ${path}`);
    }
    seen.add(value);
    try {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new Error(
          `JsonValue 不允许 Array 子类或自定义原型数组: ${path} (prototype: ${
            Object.getPrototypeOf(value)?.constructor?.name || 'null'
          })`,
        );
      }

      if ('toJSON' in value) {
        throw new Error(
          `JsonValue 数组不允许携带 toJSON 方法: ${path}（toJSON 可能导致非确定性序列化）`,
        );
      }

      for (let i = 0; i < value.length; i++) {
        if (!(i in value)) {
          throw new Error(
            `JsonValue 不允许稀疏数组（索引 ${i} 为空洞）: ${path}`,
          );
        }
      }

      const ownKeys = Reflect.ownKeys(value);
      for (const key of ownKeys) {
        if (typeof key === 'symbol') {
          throw new Error(
            `JsonValue 数组不允许 Symbol 键 (${key.toString()}): ${path}`,
          );
        }
        if (key === 'length') continue;
        const index = Number(key);
        if (
          !(
            typeof key === 'string' &&
            String(index) === key &&
            Number.isInteger(index) &&
            index >= 0 &&
            index < value.length
          )
        ) {
          throw new Error(
            `JsonValue 数组不允许非规范索引属性 (${key}): ${path}`,
          );
        }
      }

      for (let i = 0; i < value.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, i);
        if (descriptor && (descriptor.get || descriptor.set)) {
          throw new Error(
            `JsonValue 数组不允许 getter/setter 属性（索引 ${i}）: ${path}`,
          );
        }
      }

      // 递归验证元素但不重建数组
      for (let i = 0; i < value.length; i++) {
        validateJsonValue(value[i], `${path}[${i}]`, seen);
      }
      return value as unknown as JsonValue;
    } finally {
      seen.delete(value);
    }
  }

  // object — 返回原始对象引用，不使用 {} 重建
  if (typeof value === 'object') {
    if (seen.has(value)) {
      throw new Error(`JsonValue 不允许循环引用: ${path}`);
    }
    seen.add(value);
    try {
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new Error(
          `JsonValue 不允许自定义原型对象: ${path} (prototype: ${
            proto?.constructor?.name || 'null'
          })`,
        );
      }

      if ('toJSON' in value) {
        throw new Error(
          `JsonValue 不允许携带 toJSON 方法的对象: ${path}（toJSON 可能导致非确定性序列化）`,
        );
      }

      const ownKeys = Reflect.ownKeys(value as object);
      for (const key of ownKeys) {
        if (typeof key === 'symbol') {
          throw new Error(
            `JsonValue 对象不允许 Symbol 键 (${key.toString()}): ${path}`,
          );
        }

        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor) {
          throw new Error(
            `JsonValue 对象属性缺少 descriptor (${key}): ${path}`,
          );
        }

        if (descriptor.enumerable === false) {
          throw new Error(
            `JsonValue 对象不允许不可枚举属性 (${key}): ${path}`,
          );
        }

        if (descriptor.get || descriptor.set) {
          throw new Error(
            `JsonValue 对象不允许 getter/setter 属性 (${key}): ${path}`,
          );
        }

        const val = descriptor.value;
        if (val === undefined) {
          throw new Error(
            `JsonValue 对象属性值不允许为 undefined（会被 JSON.stringify 静默丢弃）: ${path}.${key}`,
          );
        }
        validateJsonValue(val, `${path}.${key}`, seen);
      }
      return value as unknown as JsonValue;
    } finally {
      seen.delete(value);
    }
  }

  throw new Error(`JsonValue 不支持的类型 ${type}: ${path}`);
}
