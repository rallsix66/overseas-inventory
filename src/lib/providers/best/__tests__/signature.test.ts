// P3-S1B: 百世签名工具 — 单元测试
//
// 所有测试使用假凭证，不访问真实服务。

import { describe, it, expect } from 'vitest';
import { sign, stableStringify } from '../signature';

const FAKE_SECRET = 'test-secret-123';

describe('stableStringify', () => {
  it('空对象 → {}', () => {
    expect(stableStringify({})).toBe('{}');
  });

  it('null → 空字符串', () => {
    expect(stableStringify(null)).toBe('');
  });

  it('undefined → 空字符串', () => {
    expect(stableStringify(undefined)).toBe('');
  });

  it('基本类型序列化', () => {
    expect(stableStringify(42)).toBe('42');
    expect(stableStringify('hello')).toBe('"hello"');
    expect(stableStringify(true)).toBe('true');
  });

  it('对象 key 按字母序排列', () => {
    const input = { zebra: 1, apple: 2, monkey: 3 };
    expect(stableStringify(input)).toBe('{"apple":2,"monkey":3,"zebra":1}');
  });

  it('嵌套对象 key 也按字母序排列', () => {
    const input = { outer: { beta: 1, alpha: 2 } };
    expect(stableStringify(input)).toBe('{"outer":{"alpha":2,"beta":1}}');
  });

  it('数组保持原始顺序（不排序）', () => {
    const input = { items: [3, 1, 2] };
    expect(stableStringify(input)).toBe('{"items":[3,1,2]}');
  });

  it('数组内对象也按 key 排序', () => {
    const input = { list: [{ b: 2, a: 1 }, { d: 4, c: 3 }] };
    expect(stableStringify(input)).toBe(
      '{"list":[{"a":1,"b":2},{"c":3,"d":4}]}',
    );
  });

  it('相同数据不同插入顺序 → 相同序列化结果', () => {
    const a: Record<string, unknown> = {};
    a.name = 'test';
    a.id = 1;

    const b: Record<string, unknown> = {};
    b.id = 1;
    b.name = 'test';

    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it('中文不转义', () => {
    expect(stableStringify({ key: '百世' })).toBe('{"key":"百世"}');
  });

  it('空字符串值保留', () => {
    expect(stableStringify({ key: '' })).toBe('{"key":""}');
  });
});

describe('sign', () => {
  it('返回 32 位 hex 字符串', () => {
    const result = sign('{"nos":["TEST001"]}', FAKE_SECRET);
    expect(result).toHaveLength(32);
    expect(result).toMatch(/^[a-f0-9]{32}$/);
  });

  it('相同输入 → 相同签名', () => {
    const bodyStr = '{"nos":["WB123"]}';
    const r1 = sign(bodyStr, FAKE_SECRET);
    const r2 = sign(bodyStr, FAKE_SECRET);
    expect(r1).toBe(r2);
  });

  it('不同 body → 不同签名', () => {
    const r1 = sign('{"nos":["A"]}', FAKE_SECRET);
    const r2 = sign('{"nos":["B"]}', FAKE_SECRET);
    expect(r1).not.toBe(r2);
  });

  it('不同 secret → 不同签名', () => {
    const bodyStr = '{"nos":["X"]}';
    const r1 = sign(bodyStr, 'secret-a');
    const r2 = sign(bodyStr, 'secret-b');
    expect(r1).not.toBe(r2);
  });

  it('空 body → 签名仍为 32 位 hex', () => {
    const result = sign('', FAKE_SECRET);
    expect(result).toHaveLength(32);
    expect(result).toMatch(/^[a-f0-9]{32}$/);
  });

  it('固定 body + 固定 secret → 固定 MD5 摘要（独立计算期望值）', () => {
    // 期望值由独立脚本计算:
    //   bodyStr = '{"nos":["TEST001"]}'
    //   MD5('{"nos":["TEST001"]}' + 'test-secret-fixed-42')
    //   → 6f837b8ac45e666e0e24c3ee9a8ce097
    const EXPECTED = '6f837b8ac45e666e0e24c3ee9a8ce097';
    const bodyStr = '{"nos":["TEST001"]}';
    const secret = 'test-secret-fixed-42';

    const result = sign(bodyStr, secret);
    expect(result).toBe(EXPECTED);
    expect(result).toHaveLength(32);
    // 确认小写 hex
    expect(result).toBe(EXPECTED.toLowerCase());
  });

  it('签名结果不包含 secret', () => {
    const result = sign('{"nos":["X"]}', FAKE_SECRET);
    expect(result).not.toContain(FAKE_SECRET);
  });
});
