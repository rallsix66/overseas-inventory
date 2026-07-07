// PERF-D-CACHE: 验证 server-actions.ts 已移除进程级缓存
//
// 背景：
//   server-actions.ts 原有模块级 `let _overseasWhCache` +
//   `getCachedOverseasWarehouses()` 进程级缓存，会在仓库增删改名后
//   stale。PERF-D-CACHE 将其移除，改为每次直接调用
//   `getOverseasWarehouses()`。
//
// 验证：
//   - 源码中不存在 `_overseasWhCache` 或类似模块级缓存声明
//   - 源码中不存在 `getCachedOverseasWarehouses` 函数定义
//   - `getOverseasWarehouses` 仍存在（是实际的查询函数）
//   - `getOverseasWarehouseOptions` 仍导出（是公共入口）
//
// 纯静态文本检查，不连接 Supabase。

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SERVER_ACTIONS_PATH = path.resolve(
  process.cwd(),
  'src/features/sync/server-actions.ts',
);

describe('PERF-D-CACHE — 进程级缓存已移除', () => {
  let source: string;

  beforeAll(() => {
    source = fs.readFileSync(SERVER_ACTIONS_PATH, 'utf-8');
  });

  // ═══════════════════════════════════════════════════════════
  // 分组 1: 缓存变量已删除
  // ═══════════════════════════════════════════════════════════

  describe('缓存变量与函数已删除', () => {
    it('不存在 _overseasWhCache 模块级缓存变量', () => {
      expect(source).not.toMatch(/_overseasWhCache/);
    });

    it('不存在 getCachedOverseasWarehouses 缓存函数', () => {
      expect(source).not.toMatch(/getCachedOverseasWarehouses/);
    });

    it('不存在任何模块级 let ... Cache 声明', () => {
      // 匹配 let <name> 后面紧跟 Cache 的模式，防止未来重新引入类似缓存
      const nonCommentLines = source
        .split('\n')
        .filter((l) => !/^\s*\/\//.test(l) && !/^\s*--/.test(l));
      const cacheDeclarations = nonCommentLines.filter(
        (l) => /\blet\s+\w*[Cc]ache\b/.test(l) || /\bconst\s+\w*[Cc]ache\b.*=/.test(l),
      );
      expect(cacheDeclarations).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 分组 2: 正确函数仍存在
  // ═══════════════════════════════════════════════════════════

  describe('正确函数未受影响', () => {
    it('getOverseasWarehouses 仍存在（实际查询函数）', () => {
      expect(source).toMatch(/async function getOverseasWarehouses/);
    });

    it('getOverseasWarehouseOptions 仍导出', () => {
      expect(source).toMatch(/export async function getOverseasWarehouseOptions/);
    });

    it('getOverseasWarehouses 被直接调用（不经缓存包装）', () => {
      // getOverseasWarehouseOptions 内部应直接 await getOverseasWarehouses()
      const exportIdx = source.indexOf('export async function getOverseasWarehouseOptions');
      expect(exportIdx).toBeGreaterThan(0);
      const fnBody = source.slice(exportIdx, exportIdx + 500);
      expect(fnBody).toMatch(/await getOverseasWarehouses\(\)/);
      expect(fnBody).not.toMatch(/getCachedOverseasWarehouses/);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 分组 3: 文件元数据
  // ═══════════════════════════════════════════════════════════

  describe('文件元数据', () => {
    it('server-actions.ts 文件存在', () => {
      expect(source.length).toBeGreaterThan(500);
    });

    it('文件仍为 TypeScript', () => {
      expect(SERVER_ACTIONS_PATH).toMatch(/\.ts$/);
    });
  });
});
