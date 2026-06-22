// Sync Feature Module — Mock ArtifactProvider (P5-SY5C2 V5.8)
//
// 纯内存实现，供测试和开发环境使用。
// 生产环境由 createSyncService 拒绝（通过 __mock__ 标记检测）。

import { createHash } from 'crypto';
import type {
  JsonValue,
  ArtifactType,
  PreparedArtifact,
  Artifact,
  ArtifactCandidate,
} from './types';
import { validateJsonValue } from './validate-json-value';
import type { ArtifactProvider } from './artifact-provider';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export class MockArtifactProvider implements ArtifactProvider {
  /** 生产环境拒绝标记 */
  readonly __mock__ = true;

  private static store_ = new Map<string, { bytes: Uint8Array; hash: string; createdAt: Date }>();

  prepare(content: JsonValue): PreparedArtifact {
    validateJsonValue(content);
    const json = JSON.stringify(content);
    const bytes = new TextEncoder().encode(json);
    const hash = sha256(bytes);
    const normalizedContent = JSON.parse(json) as JsonValue;
    return { bytes, hash, normalizedContent };
  }

  async store(
    runId: string,
    type: ArtifactType,
    prepared: PreparedArtifact,
  ): Promise<string> {
    // Verify consistency
    const computed = sha256(prepared.bytes);
    if (computed !== prepared.hash) {
      throw new Error(
        `Artifact hash 不匹配 — 存储时校验失败: ${runId}/${type}`,
      );
    }
    const key = `${runId}:${type}`;
    MockArtifactProvider.store_.set(key, {
      bytes: prepared.bytes,
      hash: prepared.hash,
      createdAt: new Date(),
    });
    return key;
  }

  async get(runId: string, type: ArtifactType): Promise<Artifact> {
    const key = `${runId}:${type}`;
    const entry = MockArtifactProvider.store_.get(key);
    if (!entry) {
      throw new Error(`Artifact 不存在: ${runId}/${type}`);
    }

    // Verify stored bytes integrity
    const computed = sha256(entry.bytes);
    if (computed !== entry.hash) {
      throw new Error(
        `Artifact hash 校验失败（存储字节损坏）: ${runId}/${type}`,
      );
    }

    const content = JSON.parse(new TextDecoder().decode(entry.bytes)) as JsonValue;
    return {
      runId,
      type,
      content,
      hash: entry.hash,
      storedAt: entry.createdAt.toISOString(),
    };
  }

  async verify(
    runId: string,
    type: ArtifactType,
    expectedHash: string,
  ): Promise<boolean> {
    const key = `${runId}:${type}`;
    const entry = MockArtifactProvider.store_.get(key);
    if (!entry) return false;
    return entry.hash === expectedHash;
  }

  async delete(runId: string, type: ArtifactType): Promise<void> {
    const key = `${runId}:${type}`;
    MockArtifactProvider.store_.delete(key);
  }

  async listCandidates(olderThan: Date): Promise<ArtifactCandidate[]> {
    const result: ArtifactCandidate[] = [];
    for (const [key, entry] of MockArtifactProvider.store_.entries()) {
      if (entry.createdAt < olderThan) {
        const [runId, type] = key.split(':') as [string, ArtifactType];
        result.push({ runId, type, createdAt: entry.createdAt });
      }
    }
    return result;
  }

  async deleteMany(
    artifacts: Array<{ runId: string; type: ArtifactType }>,
  ): Promise<number> {
    let count = 0;
    for (const { runId, type } of artifacts) {
      const key = `${runId}:${type}`;
      if (MockArtifactProvider.store_.has(key)) {
        MockArtifactProvider.store_.delete(key);
        count++;
      }
    }
    return count;
  }

  /** 仅测试用 — 清空存储 */
  _reset(): void {
    MockArtifactProvider.store_.clear();
  }

  /** 仅测试用 — 清空所有共享存储（与 _reset() 等价，对称 MockRepository._resetAll()） */
  static _resetAll(): void {
    MockArtifactProvider.store_.clear();
  }
}
