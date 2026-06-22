// Sync Feature Module — MockArtifactProvider 测试 (P5-SY5C2 V5.8)

import { describe, it, expect, beforeEach } from 'vitest';
import { MockArtifactProvider } from './mock-artifact-provider';

describe('MockArtifactProvider', () => {
  let provider: MockArtifactProvider;

  beforeEach(() => {
    MockArtifactProvider._resetAll();
    provider = new MockArtifactProvider();
  });

  it('prepare hash 一致性（same input → same hash）', () => {
    const a = provider.prepare({ key: 'value' });
    const b = provider.prepare({ key: 'value' });
    expect(a.hash).toBe(b.hash);
  });

  it('prepare 产生 normalizedContent（round-trip）', () => {
    const input = { arr: [1, 2, 3], nested: { v: null } };
    const prepared = provider.prepare(input);
    expect(prepared.normalizedContent).toEqual(input);
    expect(prepared.hash).toBeDefined();
    expect(prepared.bytes).toBeInstanceOf(Uint8Array);
  });

  it('store → get 完整流程', async () => {
    const prepared = provider.prepare({ sku: 'WM0001', qty: 100 });
    await provider.store('run-1', 'input', prepared);
    const artifact = await provider.get('run-1', 'input');
    expect(artifact.runId).toBe('run-1');
    expect(artifact.type).toBe('input');
    expect(artifact.content).toEqual({ sku: 'WM0001', qty: 100 });
  });

  it('get() 返回的 hash 与 prepare() 一致', async () => {
    const prepared = provider.prepare({ data: 'test' });
    await provider.store('run-1', 'input', prepared);
    const artifact = await provider.get('run-1', 'input');
    expect(artifact.hash).toBe(prepared.hash);
  });

  it('store hash 不匹配抛错', async () => {
    const prepared = provider.prepare({ data: 'test' });
    // Tamper with hash
    const tampered = { ...prepared, hash: 'badhash' };
    await expect(
      provider.store('run-1', 'input', tampered),
    ).rejects.toThrow('hash 不匹配');
  });

  it('get 不存在抛错', async () => {
    await expect(
      provider.get('nonexistent', 'input'),
    ).rejects.toThrow('不存在');
  });

  it('verify 正确 hash 返回 true', async () => {
    const prepared = provider.prepare({ x: 1 });
    await provider.store('run-1', 'input', prepared);
    const result = await provider.verify('run-1', 'input', prepared.hash);
    expect(result).toBe(true);
  });

  it('verify 错误 hash 返回 false', async () => {
    const prepared = provider.prepare({ x: 1 });
    await provider.store('run-1', 'input', prepared);
    const result = await provider.verify('run-1', 'input', 'wrong-hash');
    expect(result).toBe(false);
  });

  it('verify 不存在返回 false', async () => {
    const result = await provider.verify('nonexistent', 'input', 'any-hash');
    expect(result).toBe(false);
  });

  it('delete 幂等（不存在不抛错）', async () => {
    await expect(
      provider.delete('nonexistent', 'input'),
    ).resolves.toBeUndefined();
  });

  it('delete → get 抛错', async () => {
    const prepared = provider.prepare({ x: 1 });
    await provider.store('run-1', 'input', prepared);
    await provider.delete('run-1', 'input');
    await expect(
      provider.get('run-1', 'input'),
    ).rejects.toThrow('不存在');
  });

  it('listCandidates 按时间过滤', async () => {
    const prepared = provider.prepare({ x: 1 });
    await provider.store('run-1', 'input', prepared);
    await provider.store('run-2', 'plan', prepared);

    // All should be older than far future
    const future = new Date('2100-01-01');
    const all = await provider.listCandidates(future);
    expect(all.length).toBe(2);

    // None should be older than far past
    const past = new Date('2000-01-01');
    const none = await provider.listCandidates(past);
    expect(none.length).toBe(0);
  });

  it('deleteMany 返回删除数量', async () => {
    const prepared = provider.prepare({ x: 1 });
    await provider.store('run-1', 'input', prepared);
    await provider.store('run-2', 'input', prepared);
    await provider.store('run-3', 'plan', prepared);

    const count = await provider.deleteMany([
      { runId: 'run-1', type: 'input' },
      { runId: 'run-2', type: 'input' },
      { runId: 'nonexistent', type: 'input' },
    ]);
    expect(count).toBe(2);

    // Verify remaining
    await expect(provider.get('run-3', 'plan')).resolves.toBeDefined();
    await expect(provider.get('run-1', 'input')).rejects.toThrow();
  });

  it('__mock__ 标记存在', () => {
    expect(provider.__mock__).toBe(true);
  });
});
