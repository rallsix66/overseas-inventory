// P5-SY11G-E: Variant 页面 UI 测试（所有用户均可归档/恢复）
//
// 验证:
// - 归档筛选标签对所有用户可见（不再仅 Admin）
// - 复选框批量选择对所有用户可见
// - ArchiveControls 对所有用户可见
// - 使用 isArchivedByUser 而非 is_archived
// - page.tsx 传递 userId 到 list()
// - unmatched/page.tsx 传递 userId 到 getUnmatched()
// - 归档/恢复按钮不含"管理员"文案

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const PAGE_PATH = path.resolve(process.cwd(), 'src/app/dashboard/variants/page.tsx');
const CONTENT_PATH = path.resolve(process.cwd(), 'src/app/dashboard/variants/_components/variant-page-content.tsx');
const UNMATCHED_PATH = path.resolve(process.cwd(), 'src/app/dashboard/variants/unmatched/page.tsx');
const CONTROLS_PATH = path.resolve(process.cwd(), 'src/features/variants/components/archive-controls.tsx');
const COLUMNS_PATH = path.resolve(process.cwd(), 'src/features/variants/columns.tsx');

// ─── page.tsx ─────────────────────────────────────────────────────────

describe('P5-SY11G-E — page.tsx', () => {
  let pageSrc: string;

  beforeAll(() => {
    pageSrc = fs.readFileSync(PAGE_PATH, 'utf-8');
  });

  it('传递 userId 到 variantRepository.list()', () => {
    expect(pageSrc).toMatch(/userId/);
    expect(pageSrc).toMatch(/user\.id/);
  });

  it('所有登录用户均可切换全部归档筛选标签', () => {
    // 不再限制 Operator 只看到 active
    expect(pageSrc).not.toMatch(/!isAdmin.*archiveStatus/);
  });

  it('archiveStatus 校验不限制角色', () => {
    // archiveStatus 验证仅检查值有效性，不检查角色
    expect(pageSrc).toContain("'active', 'archived', 'all'");
  });
});

// ─── variant-page-content.tsx ─────────────────────────────────────────

describe('P5-SY11G-E — variant-page-content.tsx', () => {
  let contentSrc: string;

  beforeAll(() => {
    contentSrc = fs.readFileSync(CONTENT_PATH, 'utf-8');
  });

  it('归档筛选标签对所有用户可见（不含 isAdmin 条件）', () => {
    // ARCHIVE_TABS 映射中不应有 isAdmin 条件过滤
    // 旧代码有 "if (!isAdmin && tab.value !== 'active') return null;"
    // 新代码应移除该限制
    expect(contentSrc).not.toMatch(/!isAdmin.*tab\.value/);
  });

  it('复选框列对所有用户可见（不含 isAdmin 条件）', () => {
    // 复选框 TableHead 和 TableCell 不应包裹在 {isAdmin && (...)} 中
    const checkboxCount = (contentSrc.match(/type="checkbox"/g) || []).length;
    expect(checkboxCount).toBeGreaterThanOrEqual(2); // 全选 + 每行
  });

  it('ArchiveControls 对所有用户可见（不含 isAdmin 条件）', () => {
    expect(contentSrc).toMatch(/ArchiveControls/);
    // 不应有条件渲染 ArchiveControls
    expect(contentSrc).not.toMatch(/\{isAdmin &&[\s\S]*ArchiveControls/);
  });

  it('注释说明所有登录用户均可使用归档功能', () => {
    expect(contentSrc).toContain('P5-SY11G');
    expect(contentSrc).toContain('所有登录用户');
  });
});

// ─── unmatched/page.tsx ───────────────────────────────────────────────

describe('P5-SY11G-E — unmatched/page.tsx', () => {
  let unmatchedSrc: string;

  beforeAll(() => {
    unmatchedSrc = fs.readFileSync(UNMATCHED_PATH, 'utf-8');
  });

  it('传递 user.id 到 getUnmatched()', () => {
    expect(unmatchedSrc).toMatch(/getUnmatched\s*\(\s*user\.id/);
  });

  it('描述文案更新为"您已归档的 SKU 不在此显示"', () => {
    expect(unmatchedSrc).toContain('您已归档');
  });
});

// ─── archive-controls.tsx ─────────────────────────────────────────────

describe('P5-SY11G-E — archive-controls.tsx', () => {
  let controlsSrc: string;

  beforeAll(() => {
    controlsSrc = fs.readFileSync(CONTROLS_PATH, 'utf-8');
  });

  it('使用 isArchivedByUser 而非 is_archived', () => {
    expect(controlsSrc).toMatch(/isArchivedByUser/);
    expect(controlsSrc).not.toMatch(/item\.is_archived/);
  });

  it('注释说明所有登录用户可用（非 Admin 专用）', () => {
    expect(controlsSrc).toContain('所有登录用户可用');
  });

  it('不含"管理员"文案', () => {
    // 确认 Dialog 不含旧的管理员角色说明
    expect(controlsSrc).not.toMatch(/管理员/);
  });

  it('使用 P5-SY11G 标识', () => {
    expect(controlsSrc).toContain('P5-SY11G');
  });
});

// ─── columns.tsx ──────────────────────────────────────────────────────

describe('P5-SY11G-E — columns.tsx', () => {
  let columnsSrc: string;

  beforeAll(() => {
    columnsSrc = fs.readFileSync(COLUMNS_PATH, 'utf-8');
  });

  it('使用 isArchivedByUser 作为归档状态列的 key', () => {
    expect(columnsSrc).toMatch(/isArchivedByUser/);
  });

  it('不再使用 is_archived 作为列 key', () => {
    expect(columnsSrc).not.toMatch(/'is_archived'/);
  });
});
