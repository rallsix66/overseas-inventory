// Sync Feature Module — ArtifactProvider 接口契约
//
// 定义 artifact 的序列化、存储、检索、校验与删除的抽象接口。
// P5-SY5C 仅定义契约，不实现。Mock/FileSystem 实现在后续任务中提供。

import type {
  JsonValue,
  ArtifactType,
  PreparedArtifact,
  Artifact,
  ArtifactCandidate,
} from './types';

export interface ArtifactProvider {
  /**
   * 准备 artifact：先通过 validateJsonValue 验证 → 序列化 content 为 UTF-8 bytes →
   * 计算 SHA-256 → 反序列化回 JsonValue（normalizedContent）。
   *
   * 这是整个系统中唯一对 content 进行 JSON.stringify 的位置。
   */
  prepare(content: JsonValue): PreparedArtifact;

  /**
   * 存储 artifact 字节。内部验证 SHA-256(bytes) === hash 后持久化。
   * hash 必须由 prepare() 产生，store() 不重新序列化。
   */
  store(
    runId: string,
    type: ArtifactType,
    prepared: PreparedArtifact,
  ): Promise<string>;

  /**
   * 检索 artifact 内容（含 hash 校验）。
   * 读取存储字节 → SHA-256 与存储时 hash 比对 → JSON.parse 返回 content。
   */
  get(runId: string, type: ArtifactType): Promise<Artifact>;

  /**
   * 校验 artifact hash 是否匹配。对存储字节重新计算 SHA-256 与 expectedHash 比对。
   */
  verify(
    runId: string,
    type: ArtifactType,
    expectedHash: string,
  ): Promise<boolean>;

  /**
   * 删除指定 artifact。幂等：不存在时静默成功。
   */
  delete(runId: string, type: ArtifactType): Promise<void>;

  /**
   * 列出早于 olderThan 的所有 artifact 候选。
   * 仅返回存储层元数据，不查询 sync_run，不判断业务引用。
   */
  listCandidates(olderThan: Date): Promise<ArtifactCandidate[]>;

  /**
   * 批量删除指定 artifacts。幂等：不存在的 artifact 静默跳过。
   * 返回实际删除的数量。
   */
  deleteMany(
    artifacts: Array<{ runId: string; type: ArtifactType }>,
  ): Promise<number>;
}
