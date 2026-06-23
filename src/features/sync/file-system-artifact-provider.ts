// Sync Feature Module — FileSystem ArtifactProvider
//
// 生产级 ArtifactProvider 实现：将 artifact 以 JSON 文件持久化到磁盘。
// 替代 MockArtifactProvider，提供真正的持久化存储。
// 存储路径：tools/bigseller-scraper/runtime/artifacts/{runId}/{type}.json
//
// P5-SY9C: 真实 Provider / InputSource / Production wiring

import { createHash } from 'crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  JsonValue,
  ArtifactType,
  PreparedArtifact,
  Artifact,
  ArtifactCandidate,
} from './types';
import { validateJsonValue } from './validate-json-value';
import type { ArtifactProvider } from './artifact-provider';

// ─── Constants ────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(process.cwd());
const ARTIFACTS_BASE_DIR = path.join(
  PROJECT_ROOT,
  'tools',
  'bigseller-scraper',
  'runtime',
  'artifacts',
);

// ─── Helpers ──────────────────────────────────────────────────────

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function artifactFilePath(runId: string, type: ArtifactType): string {
  return path.join(ARTIFACTS_BASE_DIR, runId, `${type}.json`);
}

/** 磁盘上的 artifact 文件结构 */
interface StoredArtifact {
  content: JsonValue;
  hash: string;
  storedAt: string;
}

// ─── Provider ─────────────────────────────────────────────────────

export class FileSystemArtifactProvider implements ArtifactProvider {
  /** 生产实现 — 无 __mock__ 标记，可通过 createSyncService guard 验证 */

  // ── prepare ───────────────────────────────────────────────────

  prepare(content: JsonValue): PreparedArtifact {
    validateJsonValue(content);
    const json = JSON.stringify(content);
    const bytes = new TextEncoder().encode(json);
    const hash = sha256(bytes);
    const normalizedContent = JSON.parse(json) as JsonValue;
    return { bytes, hash, normalizedContent };
  }

  // ── store ─────────────────────────────────────────────────────

  async store(
    runId: string,
    type: ArtifactType,
    prepared: PreparedArtifact,
  ): Promise<string> {
    // 写入前验证 hash 一致性
    const computed = sha256(prepared.bytes);
    if (computed !== prepared.hash) {
      throw new Error(
        `Artifact hash 不匹配 — 存储时校验失败: ${runId}/${type}`,
      );
    }

    const dir = path.dirname(artifactFilePath(runId, type));
    await fs.mkdir(dir, { recursive: true });

    const stored: StoredArtifact = {
      content: prepared.normalizedContent,
      hash: prepared.hash,
      storedAt: new Date().toISOString(),
    };

    await fs.writeFile(
      artifactFilePath(runId, type),
      JSON.stringify(stored),
      'utf-8',
    );

    return `${runId}:${type}`;
  }

  // ── get ───────────────────────────────────────────────────────

  async get(runId: string, type: ArtifactType): Promise<Artifact> {
    const filePath = artifactFilePath(runId, type);

    let raw: string;
    try {
      raw = await fs.readFile(filePath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Artifact 不存在: ${runId}/${type}`);
      }
      throw new Error(
        `Artifact 读取失败: ${runId}/${type} — ${(err as Error).message}`,
      );
    }

    let stored: StoredArtifact;
    try {
      stored = JSON.parse(raw) as StoredArtifact;
    } catch {
      throw new Error(
        `Artifact 文件 JSON 解析失败: ${runId}/${type}`,
      );
    }

    // 校验 content hash 完整性
    const contentBytes = new TextEncoder().encode(
      JSON.stringify(stored.content),
    );
    const computed = sha256(contentBytes);
    if (computed !== stored.hash) {
      throw new Error(
        `Artifact hash 校验失败（存储字节损坏）: ${runId}/${type}`,
      );
    }

    return {
      runId,
      type,
      content: stored.content,
      hash: stored.hash,
      storedAt: stored.storedAt,
    };
  }

  // ── verify ────────────────────────────────────────────────────

  async verify(
    runId: string,
    type: ArtifactType,
    expectedHash: string,
  ): Promise<boolean> {
    try {
      const artifact = await this.get(runId, type);
      return artifact.hash === expectedHash;
    } catch {
      return false;
    }
  }

  // ── delete ────────────────────────────────────────────────────

  async delete(runId: string, type: ArtifactType): Promise<void> {
    const filePath = artifactFilePath(runId, type);
    try {
      await fs.unlink(filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return; // 幂等：不存在静默成功
      }
      throw err;
    }
  }

  // ── listCandidates ────────────────────────────────────────────

  async listCandidates(olderThan: Date): Promise<ArtifactCandidate[]> {
    const result: ArtifactCandidate[] = [];

    let runDirs: string[];
    try {
      runDirs = await fs.readdir(ARTIFACTS_BASE_DIR);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return []; // artifacts 目录尚未创建
      }
      throw err;
    }

    for (const runId of runDirs) {
      const runDir = path.join(ARTIFACTS_BASE_DIR, runId);

      let stat;
      try {
        stat = await fs.stat(runDir);
      } catch {
        continue; // 跳过无法 stat 的条目
      }

      if (!stat.isDirectory()) continue;

      // 检查该 runId 目录下的 artifact 文件
      for (const type of ['input', 'plan'] as ArtifactType[]) {
        const filePath = artifactFilePath(runId, type);
        try {
          const fileStat = await fs.stat(filePath);
          if (fileStat.mtime < olderThan) {
            result.push({
              runId,
              type,
              createdAt: fileStat.mtime,
            });
          }
        } catch {
          // 文件不存在 — 跳过
        }
      }
    }

    return result;
  }

  // ── deleteMany ────────────────────────────────────────────────

  async deleteMany(
    artifacts: Array<{ runId: string; type: ArtifactType }>,
  ): Promise<number> {
    let count = 0;
    for (const { runId, type } of artifacts) {
      const filePath = artifactFilePath(runId, type);
      try {
        await fs.unlink(filePath);
        count++;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          continue; // 幂等跳过
        }
        throw err;
      }
    }
    return count;
  }
}
