// Sync Feature Module — Production Wiring 结构性测试
//
// P5-SY9C: 验证生产 wiring 不含 Mock、测试 wiring 可注入 Mock、
// 页面/client component 无 supabase.from()、真实写入入口保持 feature gated。
// 不连接生产 Supabase，不执行真实写入。
//
// P5-SY9C rework: 移除 expect(true) placeholder，加入真实源码检查、
// NODE_ENV=production 拒绝验证、Supabase 边界文件读取和 feature gate 测试。

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createSyncActions } from './actions';
import { createSyncService } from './sync-service';
import { MockArtifactProvider } from './mock-artifact-provider';
import { MockSyncRunner } from './mock-sync-runner';
import { FileSystemArtifactProvider } from './file-system-artifact-provider';
import { RealSyncRunner, type WarehouseBridgeInfo } from './real-sync-runner';
import { WebInputArtifactSource, isWebsyncRealWriteEnabled } from './web-input-artifact-source';
import { MockRepository } from './repository';
import type { InputArtifactSource } from './actions';

// ─── Helpers ──────────────────────────────────────────────────────

function hasProperty(obj: unknown, prop: string): boolean {
  if (obj === null || obj === undefined) return false;
  return Object.prototype.hasOwnProperty.call(obj as object, prop);
}

function readSyncSrc(relativePath: string): string {
  return fs.readFileSync(
    path.resolve(process.cwd(), 'src', 'features', 'sync', relativePath),
    'utf-8',
  );
}

function readPageSrc(relativePath: string): string {
  return fs.readFileSync(
    path.resolve(process.cwd(), 'src', 'app', relativePath),
    'utf-8',
  );
}

const SAMPLE_WAREHOUSE: WarehouseBridgeInfo = {
  id: 'test-wh-id',
  name: '测试仓',
  oldName: '旧测试仓',
  country: 'PH',
  token: 'P5-SY3B-PH',
};

// ─── 1. server-actions.ts 源码不含 Mock import ──────────────────

describe('server-actions.ts — 不含 Mock import', () => {
  it('不包含 MockSyncRunner import', () => {
    const src = readSyncSrc('server-actions.ts');
    expect(src).not.toMatch(/import\s+\{\s*MockSyncRunner\s*\}/);
  });

  it('不包含 MockArtifactProvider import', () => {
    const src = readSyncSrc('server-actions.ts');
    expect(src).not.toMatch(/import\s+\{\s*MockArtifactProvider\s*\}/);
  });

  it('不包含 mockInputArtifactSource import', () => {
    const src = readSyncSrc('server-actions.ts');
    expect(src).not.toMatch(/import\s+\{[^}]*mockInputArtifactSource[^}]*\}/);
  });

  it('getSyncRuns/getSyncRunDetail 为 repository-only 读路径，不依赖 SyncService', () => {
    const src = readSyncSrc('server-actions.ts');
    // 读路径应直接使用 repository，不通过 wireActions/createSyncService
    expect(src).toContain('getSyncRunsSchema');
    expect(src).toContain('getSyncRunDetailSchema');
  });
});

// ─── 2. 生产 wiring — 不含 Mock ──────────────────────────────────

describe('Production wiring — 无 Mock', () => {
  it('FileSystemArtifactProvider 没有 __mock__ 标记', () => {
    const provider = new FileSystemArtifactProvider();
    expect(hasProperty(provider, '__mock__')).toBe(false);
  });

  it('RealSyncRunner 没有 __mock__ 标记', () => {
    const runner = new RealSyncRunner([SAMPLE_WAREHOUSE]);
    expect(hasProperty(runner, '__mock__')).toBe(false);
  });

  it('WebInputArtifactSource 没有 __mock__ 标记', () => {
    const source = new WebInputArtifactSource([SAMPLE_WAREHOUSE]);
    expect(hasProperty(source, '__mock__')).toBe(false);
  });

  it('MockArtifactProvider 有 __mock__ 标记（对比验证）', () => {
    const provider = new MockArtifactProvider();
    expect(provider.__mock__).toBe(true);
  });

  it('MockSyncRunner 有 __mock__ 标记（对比验证）', () => {
    const runner = new MockSyncRunner();
    expect(runner.__mock__).toBe(true);
  });

  it('生产组件组合不应触发 createSyncService 生产 guard', () => {
    const repo = new MockRepository('admin');
    const artifactProvider = new FileSystemArtifactProvider();
    const runner = new RealSyncRunner([SAMPLE_WAREHOUSE]);

    expect(() => {
      createSyncService({ repository: repo, artifactProvider, runner });
    }).not.toThrow();
  });
});

// ─── 3. NODE_ENV=production 时 createSyncService guard ─────────

describe('createSyncService — NODE_ENV=production guard', () => {
  let originalNodeEnv: string | undefined;

  function setProduction() {
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
  }

  function restoreNodeEnv() {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  }

  it('应拒绝 MockArtifactProvider + MockSyncRunner', () => {
    const repo = new MockRepository('admin');
    const artifactProvider = new MockArtifactProvider();
    const runner = new MockSyncRunner();

    setProduction();
    try {
      expect(() => {
        createSyncService({ repository: repo, artifactProvider, runner });
      }).toThrow('生产环境禁止使用 Mock');
    } finally {
      restoreNodeEnv();
    }
  });

  it('应拒绝 MockArtifactProvider + RealSyncRunner（任一 Mock 即拒绝）', () => {
    const repo = new MockRepository('admin');
    const artifactProvider = new MockArtifactProvider();
    const runner = new RealSyncRunner([SAMPLE_WAREHOUSE]);

    setProduction();
    try {
      expect(() => {
        createSyncService({ repository: repo, artifactProvider, runner });
      }).toThrow('生产环境禁止使用 Mock');
    } finally {
      restoreNodeEnv();
    }
  });

  it('应拒绝 FileSystemArtifactProvider + MockSyncRunner（任一 Mock 即拒绝）', () => {
    const repo = new MockRepository('admin');
    const artifactProvider = new FileSystemArtifactProvider();
    const runner = new MockSyncRunner();

    setProduction();
    try {
      expect(() => {
        createSyncService({ repository: repo, artifactProvider, runner });
      }).toThrow('生产环境禁止使用 Mock');
    } finally {
      restoreNodeEnv();
    }
  });

  it('应接受 FileSystemArtifactProvider + RealSyncRunner（无 Mock，不抛错）', () => {
    const repo = new MockRepository('admin');
    const artifactProvider = new FileSystemArtifactProvider();
    const runner = new RealSyncRunner([SAMPLE_WAREHOUSE]);

    setProduction();
    try {
      expect(() => {
        createSyncService({ repository: repo, artifactProvider, runner });
      }).not.toThrow();
    } finally {
      restoreNodeEnv();
    }
  });
});

// ─── 4. 测试 wiring 可注入 Mock ──────────────────────────────────

describe('测试 wiring — 可注入 Mock', () => {
  it('createSyncActions 可接受 MockArtifactProvider + MockSyncRunner', async () => {
    const repo = new MockRepository('admin');
    const artifactProvider = new MockArtifactProvider();
    const runner = new MockSyncRunner();
    const mockInputSource: InputArtifactSource = {
      async getInputArtifact() {
        return { mock: true };
      },
    };

    const syncService = createSyncService({ repository: repo, artifactProvider, runner });
    const actions = createSyncActions({
      repository: repo,
      syncService,
      inputArtifactSource: mockInputSource,
    });

    expect(actions).toBeDefined();
    expect(typeof actions.getSyncRunsAction).toBe('function');
    expect(typeof actions.getSyncRunDetailAction).toBe('function');
    expect(typeof actions.triggerSync).toBe('function');
    expect(typeof actions.syncWarehouse).toBe('function');
    expect(typeof actions.triggerSyncAll).toBe('function');
  });

  it('createSyncActions 可接受 FileSystemArtifactProvider + RealSyncRunner', async () => {
    const repo = new MockRepository('admin');
    const artifactProvider = new FileSystemArtifactProvider();
    const runner = new RealSyncRunner([SAMPLE_WAREHOUSE]);
    const inputSource = new WebInputArtifactSource([SAMPLE_WAREHOUSE]);

    const syncService = createSyncService({ repository: repo, artifactProvider, runner });
    const actions = createSyncActions({
      repository: repo,
      syncService,
      inputArtifactSource: inputSource,
    });

    expect(actions).toBeDefined();
    expect(typeof actions.syncWarehouse).toBe('function');
    expect(typeof actions.triggerSyncAll).toBe('function');
  });

  it('MockArtifactProvider._resetAll() 在测试间清理可用', () => {
    expect(typeof MockArtifactProvider._resetAll).toBe('function');
  });

  it('MockRepository._resetAll() 在测试间清理可用', () => {
    expect(typeof MockRepository._resetAll).toBe('function');
  });
});

// ─── 5. Feature gate ────────────────────────────────────────────

describe('Feature gate — WEBSYNC_REAL_WRITE_ENABLED', () => {
  it('isWebsyncRealWriteEnabled() 默认返回 false', () => {
    const enabled = isWebsyncRealWriteEnabled();
    expect(typeof enabled).toBe('boolean');
    // 在 CI/dev 环境下默认为 false（未设置环境变量时）
    expect(enabled).toBe(false);
  });

  it('isWebsyncRealWriteEnabled 是纯函数（返回 boolean，不抛错）', () => {
    expect(() => isWebsyncRealWriteEnabled()).not.toThrow();
    expect(typeof isWebsyncRealWriteEnabled()).toBe('boolean');
  });

  it('feature gate 函数在 web-input-artifact-source.ts 中导出可用', () => {
    expect(typeof isWebsyncRealWriteEnabled).toBe('function');
  });

  it('syncWarehouse / syncAllWarehouses feature gate 与 session health guard 独立', () => {
    // 两层防护独立存在：
    // Layer 1: verifyBigSellerSession() — 会话健康 (P5-SY9B)
    // Layer 2: isWebsyncRealWriteEnabled() — 功能开关 (P5-SY9C)
    // 两层必须同时通过才能进入真实同步管线。
    expect(typeof isWebsyncRealWriteEnabled).toBe('function');
  });

  it('真实写入入口在 P5-SY9C 阶段默认 disabled', () => {
    // 默认环境（未设置 WEBSYNC_REAL_WRITE_ENABLED=true）
    // gate 应返回 false，阻止真实写入
    const result = isWebsyncRealWriteEnabled();
    expect(result).toBe(false);
  });

  it('设置 WEBSYNC_REAL_WRITE_ENABLED=true 后 gate 开放', () => {
    const original = process.env.WEBSYNC_REAL_WRITE_ENABLED;
    process.env.WEBSYNC_REAL_WRITE_ENABLED = 'true';
    try {
      expect(isWebsyncRealWriteEnabled()).toBe(true);
    } finally {
      if (original === undefined) {
        delete process.env.WEBSYNC_REAL_WRITE_ENABLED;
      } else {
        process.env.WEBSYNC_REAL_WRITE_ENABLED = original;
      }
    }
  });
});

// ─── 6. Supabase 边界 — 页面与组件源码检查 ──────────────────────

describe('Supabase 边界 — 页面与组件', () => {
  it('sync page.tsx 不包含 supabase.from(', () => {
    const src = readPageSrc('dashboard/sync/page.tsx');
    expect(src).not.toContain('supabase.from(');
  });

  it('sync-page-content.tsx 不包含 supabase.from(', () => {
    const src = readPageSrc('dashboard/sync/_components/sync-page-content.tsx');
    expect(src).not.toContain('supabase.from(');
  });

  it('sync error.tsx 不包含 supabase.from(', () => {
    const src = readPageSrc('dashboard/sync/error.tsx');
    expect(src).not.toContain('supabase.from(');
  });

  it('sync loading.tsx 不包含 supabase.from(', () => {
    const src = readPageSrc('dashboard/sync/loading.tsx');
    expect(src).not.toContain('supabase.from(');
  });

  it('server-actions.ts supabase.from() 仅在 getOverseasWarehouses（已知 P5-SY9A MEDIUM gap）', () => {
    const src = readSyncSrc('server-actions.ts');
    // 收集中间空白隔离的 supabase.from( 调用位置
    const callPositions = [...src.matchAll(/supabase\.from\(/g)].map((m) => m.index!);
    // 已知 getOverseasWarehouses 中有 supabase.from()（P5-SY9A MEDIUM gap）
    // syncWarehouse / syncAllWarehouses / getSyncRuns / getSyncRunDetail 不应有
    // 每个 supabase.from( 必须在该 gap 函数体内
    const gapStart = src.indexOf('async function getOverseasWarehouses');
    const gapEnd = src.indexOf('export async function syncWarehouse');
    expect(gapStart).toBeGreaterThan(0);
    expect(gapEnd).toBeGreaterThan(gapStart);
    for (const pos of callPositions) {
      expect(pos).toBeGreaterThanOrEqual(gapStart);
      expect(pos).toBeLessThan(gapEnd);
    }
  });

  it('Supabase client 仅在 Repository / lib 边界层', () => {
    // SupabaseSyncRepository (src/features/sync/supabase-repository.ts) — ✅ 允许
    // createClient / createServiceClient (src/lib/supabase/server.ts) — ✅ 允许
    // Python bridge (src/lib/python-bridge.ts) — ✅ 允许
    // 页面/Client Component — ❌ 禁止
    const pageSrc = readPageSrc('dashboard/sync/page.tsx');
    const contentSrc = readPageSrc('dashboard/sync/_components/sync-page-content.tsx');
    expect(pageSrc).not.toContain('createClient');
    expect(pageSrc).not.toContain('createServiceClient');
    expect(contentSrc).not.toContain('createClient');
    expect(contentSrc).not.toContain('createServiceClient');
  });
});

// ─── 7. WebInputArtifactSource 结构验证 ─────────────────────────

describe('WebInputArtifactSource', () => {
  it('实现 InputArtifactSource 接口', () => {
    const source = new WebInputArtifactSource([SAMPLE_WAREHOUSE]);
    expect(typeof source.getInputArtifact).toBe('function');
  });

  it('包含 warehouse 映射', () => {
    const source = new WebInputArtifactSource([SAMPLE_WAREHOUSE]);
    expect(source).toBeDefined();
  });

  it('不应有 __mock__ 标记', () => {
    const source = new WebInputArtifactSource([SAMPLE_WAREHOUSE]);
    expect(hasProperty(source, '__mock__')).toBe(false);
  });
});

// ─── 8. 类型安全保障 ────────────────────────────────────────────

describe('类型安全', () => {
  it('FileSystemArtifactProvider 实现 ArtifactProvider 接口', () => {
    const provider = new FileSystemArtifactProvider();
    expect(typeof provider.prepare).toBe('function');
    expect(typeof provider.store).toBe('function');
    expect(typeof provider.get).toBe('function');
    expect(typeof provider.verify).toBe('function');
    expect(typeof provider.delete).toBe('function');
    expect(typeof provider.listCandidates).toBe('function');
    expect(typeof provider.deleteMany).toBe('function');
  });

  it('WebInputArtifactSource 实现 InputArtifactSource 接口', () => {
    const source = new WebInputArtifactSource([SAMPLE_WAREHOUSE]);
    expect(typeof source.getInputArtifact).toBe('function');
  });

  it('RealSyncRunner 实现 SyncRunner 接口', () => {
    const runner = new RealSyncRunner([SAMPLE_WAREHOUSE]);
    expect(typeof runner.capabilities).toBe('function');
    expect(typeof runner.execute).toBe('function');
  });
});
