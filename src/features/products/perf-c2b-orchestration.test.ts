// PERF-C2B: 产品页查询编排优化 — 源码级静态测试
// 覆盖：产品列表页、产品详情页、repository.getById 并行编排
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readSrc(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), 'src', relativePath), 'utf-8');
}

// ─── 1. 产品列表页 — 并行编排 ─────────────────────────────────────

describe('PERF-C2B — 产品列表页并行编排', () => {
  let page: string;

  beforeAll(() => {
    page = readSrc('app/dashboard/products/page.tsx');
  });

  it('getCurrentUser() 与 productRepository.list() 通过 Promise.all 并行', () => {
    expect(page).toContain('Promise.all');
    // 两个调用在同一 Promise.all 数组中
    const promiseAllIdx = page.indexOf('Promise.all([');
    expect(promiseAllIdx).toBeGreaterThan(0);
    const block = page.slice(promiseAllIdx, promiseAllIdx + 300);
    expect(block).toContain('getCurrentUser()');
    expect(block).toContain('productRepository.list');
  });

  it('searchParams 仍先 await 解析', () => {
    // searchParams 解析仍在 Promise.all 之前
    const spIdx = page.indexOf('await searchParams');
    const promiseAllIdx = page.indexOf('Promise.all([');
    expect(spIdx).toBeGreaterThan(0);
    expect(spIdx).toBeLessThan(promiseAllIdx);
  });

  it('isAdmin 从 user?.roleName 计算，语义不变', () => {
    expect(page).toContain("user?.roleName === 'admin'");
  });

  it('传给 ProductsPageContent 的 props 不变', () => {
    expect(page).toContain('<ProductsPageContent');
    expect(page).toContain('data={result.data}');
    expect(page).toContain('total={result.total}');
    expect(page).toContain('isAdmin={isAdmin}');
  });

  it('不直接调用 supabase.from()', () => {
    expect(page).not.toMatch(/supabase\.from\(/);
  });
});

// ─── 2. 产品详情页 — 并行编排 ─────────────────────────────────────

describe('PERF-C2B — 产品详情页并行编排', () => {
  let page: string;

  beforeAll(() => {
    page = readSrc('app/dashboard/products/[id]/page.tsx');
  });

  it('requireActiveAuth() 与 productRepository.getById(id) 通过 Promise.all 并行', () => {
    expect(page).toContain('Promise.all');
    const promiseAllIdx = page.indexOf('Promise.all([');
    expect(promiseAllIdx).toBeGreaterThan(0);
    const block = page.slice(promiseAllIdx, promiseAllIdx + 200);
    expect(block).toContain('requireActiveAuth()');
    expect(block).toContain('productRepository.getById');
  });

  it('params 仍先 await 解析', () => {
    const paramsIdx = page.indexOf('await params');
    const promiseAllIdx = page.indexOf('Promise.all([');
    expect(paramsIdx).toBeGreaterThan(0);
    expect(paramsIdx).toBeLessThan(promiseAllIdx);
  });

  it('notFound() 行为不变', () => {
    expect(page).toContain('notFound()');
  });

  it('传给 ProductDetailClient 的 props 不变', () => {
    expect(page).toContain('<ProductDetailClient');
    expect(page).toContain('product={product}');
    expect(page).toContain('isAdmin={isAdmin}');
  });

  it('不直接调用 supabase.from()', () => {
    expect(page).not.toMatch(/supabase\.from\(/);
  });
});

// ─── 3. repository.getById — 并行编排 ────────────────────────────

describe('PERF-C2B — productRepository.getById 并行编排', () => {
  let repo: string;

  beforeAll(() => {
    repo = readSrc('features/products/repository.ts');
  });

  it('product 主查询仍先执行', () => {
    // 限定 getById 函数体
    const fnStart = repo.indexOf('async getById');
    const fnBody = repo.slice(fnStart);
    const productQueryIdx = fnBody.indexOf(".from('product')");
    const variantsQueryIdx = fnBody.indexOf(".from('product_variant')");
    expect(productQueryIdx).toBeGreaterThan(0);
    expect(variantsQueryIdx).toBeGreaterThan(productQueryIdx);
  });

  it('product 不存在时返回 null，不查询 variants/inventory', () => {
    // 限定 getById 函数体：从 async getById 开始
    const fnStart = repo.indexOf('async getById');
    expect(fnStart).toBeGreaterThan(0);
    const fnBody = repo.slice(fnStart);
    const returnNullIdx = fnBody.indexOf('if (!product) return null');
    const variantsQueryIdx = fnBody.indexOf(".from('product_variant')");
    expect(returnNullIdx).toBeGreaterThan(0);
    expect(returnNullIdx).toBeLessThan(variantsQueryIdx);
  });

  it('variants 与 inventory 通过 Promise.all 并行查询', () => {
    expect(repo).toContain('Promise.all');
    const promiseAllIdx = repo.indexOf('Promise.all([');
    expect(promiseAllIdx).toBeGreaterThan(0);
    const block = repo.slice(promiseAllIdx, promiseAllIdx + 500);
    expect(block).toContain(".from('product_variant')");
    expect(block).toContain(".from('inventory')");
  });

  it('variants 查询失败抛 ProductError("查询产品关联 SKU 失败", "DB_ERROR")', () => {
    expect(repo).toContain("'查询产品关联 SKU 失败'");
    expect(repo).toContain("'DB_ERROR'");
    // vError 检查在 variantsResult 解构之后
    expect(repo).toContain('error: vError');
  });

  it('inventory 查询失败抛 ProductError("查询产品库存失败", "DB_ERROR")', () => {
    expect(repo).toContain("'查询产品库存失败'");
    expect(repo).toContain("'DB_ERROR'");
    expect(repo).toContain('error: iError');
  });

  it('product 查询失败仍抛 ProductError("查询产品详情失败", "DB_ERROR")', () => {
    expect(repo).toContain("'查询产品详情失败'");
    expect(repo).toContain("'DB_ERROR'");
  });

  it('inventory.safetyStock 仍来自 product.safety_stock', () => {
    expect(repo).toContain('safetyStock: product.safety_stock');
  });

  it('getById 不使用 serialize variants/inventory（不破坏错误语义）', () => {
    // 每个子查询失败立即 throw，不返回部分数据
    // 有独立的 vError / iError 检查（非 .catch 静默吞错）
    expect(repo).toContain('vError');
    expect(repo).toContain('iError');
  });
});

// ─── 4. 架构合规 — 页面不直接访问 Supabase ───────────────────────

describe('PERF-C2B — 产品页架构合规', () => {
  it('产品列表页不直接调用 supabase.from()', () => {
    const page = readSrc('app/dashboard/products/page.tsx');
    expect(page).not.toMatch(/supabase\.(from|rpc)\(/);
    expect(page).not.toContain('createClient');
  });

  it('产品详情页不直接调用 supabase.from()', () => {
    const page = readSrc('app/dashboard/products/[id]/page.tsx');
    expect(page).not.toMatch(/supabase\.(from|rpc)\(/);
    expect(page).not.toContain('createClient');
  });
});
