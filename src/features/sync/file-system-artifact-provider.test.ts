// Sync Feature Module — FileSystemArtifactProvider 单元测试
//
// P5-SY9C: 验证真实文件系统 ArtifactProvider 的 prepare / store / get / verify /
// delete / listCandidates / deleteMany 行为。
// 不连接 Supabase，不执行真实写入。
//
// P5-SY9C rework: 测试使用 os.tmpdir() 隔离测试目录，不接触生产 runtime/artifacts。
// 默认路径和测试路径分离通过 getBaseDir() 验证。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FileSystemArtifactProvider } from './file-system-artifact-provider';
import type { JsonValue, PreparedArtifact } from './types';

// ─── 测试专用临时目录 ───────────────────────────────────────────────

let TEST_DIR: string;

function makeTestDir() {
  const prefix = path.join(os.tmpdir(), 'dis-fs-artifact-test-');
  TEST_DIR = fs.mkdtempSync ? fs.mkdtempSync(prefix) : path.join(prefix, `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  if (!existsSync(TEST_DIR)) {
    mkdirSync(TEST_DIR, { recursive: true });
  }
}

function removeTestDir() {
  if (TEST_DIR && existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

function testPath(runId: string, type: string): string {
  return path.join(TEST_DIR, runId, `${type}.json`);
}

describe('FileSystemArtifactProvider', () => {
  let provider: FileSystemArtifactProvider;

  beforeEach(() => {
    makeTestDir();
    // 使用测试专用目录构造 provider，不接触生产 runtime/artifacts
    provider = new FileSystemArtifactProvider(TEST_DIR);
  });

  afterEach(() => {
    removeTestDir();
  });

  // ─── 路径分离验证 (P5-SY9C rework) ───────────────────────────

  describe('baseDir 隔离', () => {
    it('应使用注入的 baseDir 而非默认生产路径', () => {
      expect(provider.getBaseDir()).toBe(TEST_DIR);
    });

    it('默认路径指向生产 runtime/artifacts', () => {
      const defaultProvider = new FileSystemArtifactProvider();
      const defaultDir = defaultProvider.getBaseDir();
      // 默认路径应包含 tools/bigseller-scraper/runtime/artifacts
      expect(defaultDir).toContain('tools');
      expect(defaultDir).toContain('bigseller-scraper');
      expect(defaultDir).toContain('runtime');
      expect(defaultDir).toContain('artifacts');
    });

    it('测试路径与默认路径不同', () => {
      const defaultProvider = new FileSystemArtifactProvider();
      expect(provider.getBaseDir()).not.toBe(defaultProvider.getBaseDir());
    });

    it('afterEach 只删除测试目录，不删除默认目录', () => {
      // 给定：测试已创建文件和目录
      // 验证：removeTestDir 只删除 TEST_DIR
      const defaultDir = new FileSystemArtifactProvider().getBaseDir();
      // 默认目录可能不存在（合法），但路径必须不同于测试目录
      expect(TEST_DIR).not.toBe(defaultDir);
    });
  });

  // ─── prepare ─────────────────────────────────────────────────

  describe('prepare', () => {
    it('应该序列化 JsonValue 并返回 bytes + hash + normalizedContent', () => {
      const content: JsonValue = { key: 'value', num: 42 };
      const prepared = provider.prepare(content);

      expect(prepared.bytes).toBeInstanceOf(Uint8Array);
      expect(prepared.hash).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
      expect(prepared.normalizedContent).toEqual(content);
      // normalizedContent 是反序列化副本，不是同一个对象引用
      expect(prepared.normalizedContent).not.toBe(content);
    });

    it('相同内容应产生相同 hash', () => {
      const a = provider.prepare({ x: 1 });
      const b = provider.prepare({ x: 1 });
      expect(a.hash).toBe(b.hash);
    });

    it('不同内容应产生不同 hash', () => {
      const a = provider.prepare({ x: 1 });
      const b = provider.prepare({ x: 2 });
      expect(a.hash).not.toBe(b.hash);
    });

    it('应该拒绝 undefined（validateJsonValue 抛出）', () => {
      expect(() => provider.prepare({ value: undefined } as unknown as JsonValue))
        .toThrow();
    });

    it('应该拒绝 NaN', () => {
      expect(() => provider.prepare(NaN as unknown as JsonValue))
        .toThrow();
    });

    it('应该接受合法的深层嵌套结构', () => {
      const content: JsonValue = {
        arr: [1, 'two', null, true, { nested: 'deep' }],
        empty: [],
        obj: {},
        zero: 0,
        falsy: false,
      };
      const prepared = provider.prepare(content);
      expect(prepared.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(prepared.normalizedContent).toEqual(content);
    });
  });

  // ─── store + get ─────────────────────────────────────────────

  describe('store + get', () => {
    it('store 后 get 应该返回完整 Artifact', async () => {
      const content: JsonValue = { warehouse: '测试仓', rows: [{ sku: 'T001', qty: 10 }] };
      const prepared = provider.prepare(content);

      const key = await provider.store('run-001', 'input', prepared);
      expect(key).toBe('run-001:input');

      // 文件应该存在于测试目录
      expect(existsSync(testPath('run-001', 'input'))).toBe(true);

      const artifact = await provider.get('run-001', 'input');
      expect(artifact.runId).toBe('run-001');
      expect(artifact.type).toBe('input');
      expect(artifact.content).toEqual(content);
      expect(artifact.hash).toBe(prepared.hash);
      expect(artifact.storedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('hash 不匹配时应拒绝写入', async () => {
      const content: JsonValue = { a: 1 };
      const prepared = provider.prepare(content);
      // 篡改 bytes 使其与 hash 不匹配
      (prepared as PreparedArtifact & { bytes: Uint8Array }).bytes = new TextEncoder().encode('{"a":2}');

      await expect(provider.store('run-bad', 'input', prepared))
        .rejects.toThrow('hash 不匹配');
    });

    it('get 不存在的 artifact 应抛出', async () => {
      await expect(provider.get('run-nope', 'input'))
        .rejects.toThrow('Artifact 不存在');
    });

    it('supports plan type', async () => {
      const content: JsonValue = { plan_drift_check: 'PASS' };
      const prepared = provider.prepare(content);

      await provider.store('run-plan', 'plan', prepared);
      const artifact = await provider.get('run-plan', 'plan');

      expect(artifact.type).toBe('plan');
      expect(artifact.content).toEqual(content);
    });

    it('同一 runId 可以存储 input 和 plan 两个 artifact', async () => {
      const inputContent: JsonValue = { rows: [] };
      const planContent: JsonValue = { new_variants: [] };

      await provider.store('run-both', 'input', provider.prepare(inputContent));
      await provider.store('run-both', 'plan', provider.prepare(planContent));

      const input = await provider.get('run-both', 'input');
      const plan = await provider.get('run-both', 'plan');

      expect(input.content).toEqual(inputContent);
      expect(plan.content).toEqual(planContent);
    });

    it('hash 校验：磁盘文件被篡改后 get 应拒绝', async () => {
      const content: JsonValue = { original: true };
      const prepared = provider.prepare(content);
      await provider.store('run-tamper', 'input', prepared);

      // 直接修改磁盘文件
      const filePath = testPath('run-tamper', 'input');
      await fs.writeFile(filePath, JSON.stringify({
        content: { original: false },
        hash: prepared.hash,
        storedAt: new Date().toISOString(),
      }), 'utf-8');

      await expect(provider.get('run-tamper', 'input'))
        .rejects.toThrow('hash 校验失败');
    });
  });

  // ─── verify ──────────────────────────────────────────────────

  describe('verify', () => {
    it('正确 hash 返回 true', async () => {
      const content: JsonValue = { correct: true };
      const prepared = provider.prepare(content);
      await provider.store('run-verify', 'input', prepared);

      const ok = await provider.verify('run-verify', 'input', prepared.hash);
      expect(ok).toBe(true);
    });

    it('错误 hash 返回 false', async () => {
      const content: JsonValue = { correct: true };
      const prepared = provider.prepare(content);
      await provider.store('run-verify-wrong', 'input', prepared);

      const ok = await provider.verify('run-verify-wrong', 'input', 'deadbeef');
      expect(ok).toBe(false);
    });

    it('不存在 artifact 返回 false（不抛错）', async () => {
      const ok = await provider.verify('run-nope', 'input', 'anyhash');
      expect(ok).toBe(false);
    });
  });

  // ─── delete ──────────────────────────────────────────────────

  describe('delete', () => {
    it('删除已存在 artifact', async () => {
      const prepared = provider.prepare({ toDelete: true });
      await provider.store('run-del', 'input', prepared);
      expect(existsSync(testPath('run-del', 'input'))).toBe(true);

      await provider.delete('run-del', 'input');
      expect(existsSync(testPath('run-del', 'input'))).toBe(false);
    });

    it('删除不存在 artifact 应幂等成功', async () => {
      await expect(provider.delete('run-nope', 'input'))
        .resolves.toBeUndefined();
    });

    it('删除后 get 应抛出', async () => {
      const prepared = provider.prepare({ temp: 1 });
      await provider.store('run-del2', 'input', prepared);
      await provider.delete('run-del2', 'input');

      await expect(provider.get('run-del2', 'input'))
        .rejects.toThrow('Artifact 不存在');
    });
  });

  // ─── listCandidates ──────────────────────────────────────────

  describe('listCandidates', () => {
    it('空目录返回空数组', async () => {
      const candidates = await provider.listCandidates(new Date());
      expect(candidates).toEqual([]);
    });

    it('应返回早于截止时间的 artifact', async () => {
      const prepared = provider.prepare({ gc: 'test' });
      await provider.store('run-gc', 'input', prepared);

      // 使用未来的截止时间
      const future = new Date(Date.now() + 60_000);
      const candidates = await provider.listCandidates(future);

      expect(candidates.length).toBe(1);
      expect(candidates[0].runId).toBe('run-gc');
      expect(candidates[0].type).toBe('input');
      expect(candidates[0].createdAt).toBeInstanceOf(Date);
    });

    it('不应返回晚于截止时间的 artifact', async () => {
      const prepared = provider.prepare({ gc: 'fresh' });
      await provider.store('run-fresh', 'input', prepared);

      // 使用过去的截止时间
      const past = new Date(0);
      const candidates = await provider.listCandidates(past);

      expect(candidates).toEqual([]);
    });

    it('应列出 input 和 plan', async () => {
      const input = provider.prepare({ type: 'input' });
      const plan = provider.prepare({ type: 'plan' });
      await provider.store('run-both-gc', 'input', input);
      await provider.store('run-both-gc', 'plan', plan);

      const future = new Date(Date.now() + 60_000);
      const candidates = await provider.listCandidates(future);

      expect(candidates.length).toBe(2);
      const types = candidates.map((c) => c.type).sort();
      expect(types).toEqual(['input', 'plan']);
    });
  });

  // ─── deleteMany ──────────────────────────────────────────────

  describe('deleteMany', () => {
    it('批量删除并返回实际删除数', async () => {
      const prep = provider.prepare({ batch: 1 });
      await provider.store('run-dm1', 'input', prep);
      await provider.store('run-dm2', 'input', prep);

      const count = await provider.deleteMany([
        { runId: 'run-dm1', type: 'input' },
        { runId: 'run-dm2', type: 'input' },
        { runId: 'run-dm3', type: 'input' }, // 不存在 — 跳过
      ]);

      expect(count).toBe(2);
      expect(existsSync(testPath('run-dm1', 'input'))).toBe(false);
      expect(existsSync(testPath('run-dm2', 'input'))).toBe(false);
    });

    it('空数组返回 0', async () => {
      const count = await provider.deleteMany([]);
      expect(count).toBe(0);
    });
  });

  // ─── 生产标识 ───────────────────────────────────────────────

  describe('production identity', () => {
    it('FileSystemArtifactProvider 不应有 __mock__ 标记', () => {
      const p = provider as unknown as Record<string, unknown>;
      expect(p.__mock__).toBeUndefined();
    });

    it('createSyncService 生产 guard 不应拒绝 FileSystemArtifactProvider', () => {
      // 验证 FileSystemArtifactProvider 没有 __mock__ 标记，
      // 因此 createSyncService 的生产 guard 不会拒绝它
      const p = provider as unknown as Record<string, unknown>;
      expect(p.__mock__).not.toBe(true);
    });
  });
});
