// PERF-F-TURBOPACK: 验证已移除 --webpack，项目使用 Next.js 16 默认 Turbopack
//
// 背景：
//   Next.js 16 默认使用 Turbopack（Rust 增量打包器）。项目原先在
//   package.json 中显式传递 --webpack flag 降级到 webpack。
//   PERF-F 移除该 flag，恢复 Turbopack 默认行为。
//
// 验证：
//   - package.json 不包含 --webpack flag
//   - dev / build 命令使用 Turbopack（不再显式降级到 webpack）
//   - 不要求 next.config.ts 有 turbopack 配置（零配置可用）
//
// 纯静态文本检查，不启动 dev server / build。

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const PKG_PATH = path.resolve(process.cwd(), 'package.json');
const NEXT_CONFIG_PATH = path.resolve(process.cwd(), 'next.config.ts');

describe('PERF-F-TURBOPACK — package.json 已移除 --webpack', () => {
  let pkg: Record<string, unknown>;

  beforeAll(() => {
    const raw = fs.readFileSync(PKG_PATH, 'utf-8');
    pkg = JSON.parse(raw) as Record<string, unknown>;
  });

  it('scripts.dev 不包含 --webpack', () => {
    const scripts = pkg.scripts as Record<string, string>;
    expect(scripts.dev).toBeDefined();
    expect(scripts.dev).not.toMatch(/--webpack/);
  });

  it('scripts.build 不包含 --webpack', () => {
    const scripts = pkg.scripts as Record<string, string>;
    expect(scripts.build).toBeDefined();
    expect(scripts.build).not.toMatch(/--webpack/);
  });

  it('scripts.dev 直接调用 next dev（无额外 flag）', () => {
    const scripts = pkg.scripts as Record<string, string>;
    expect(scripts.dev).toBe('next dev');
  });

  it('scripts.build 直接调用 next build（无额外 flag）', () => {
    const scripts = pkg.scripts as Record<string, string>;
    expect(scripts.build).toBe('next build');
  });

  it('scripts.start 保持不变', () => {
    const scripts = pkg.scripts as Record<string, string>;
    expect(scripts.start).toBe('next start');
  });

  it('package.json 为有效 JSON 且包含 name', () => {
    expect(pkg.name).toBe('inventory-dashboard');
  });

  it('next.config.ts 存在（Turbopack 零配置可用，无需 turbopack 字段）', () => {
    const exists = fs.existsSync(NEXT_CONFIG_PATH);
    expect(exists).toBe(true);
  });
});

describe('PERF-F-TURBOPACK — 源码中无残留 --webpack 引用', () => {
  it('package.json 全文不含 --webpack', () => {
    const raw = fs.readFileSync(PKG_PATH, 'utf-8');
    expect(raw).not.toMatch(/--webpack/);
  });

  it('package.json 全文不含 --webpack 变体', () => {
    const raw = fs.readFileSync(PKG_PATH, 'utf-8');
    // 防止大小写变体或等号变体
    expect(raw).not.toMatch(/--webpack/i);
  });
});
