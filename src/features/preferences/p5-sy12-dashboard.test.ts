// P5-SY12: Dashboard 关注区测试
//
// 验证:
// - Dashboard page 导入 preferencesRepository
// - Dashboard page 调用 getFollowedVariantsBasic
// - Dashboard page 显示空状态
// - Dashboard page 显示关注列表
// - Dashboard page 低库存列置顶（由 repository 排序保证）
// - 关注不影响同步链路
// - 禁止 any

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const DASHBOARD_PATH = path.resolve(process.cwd(), 'src/app/dashboard/page.tsx');
const ACTIONS_PATH = path.resolve(process.cwd(), 'src/features/inventory/actions.ts');

// ─── Dashboard page 源码检查 ──────────────────────────────────────────

describe('P5-SY12 — Dashboard 关注区', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(DASHBOARD_PATH, 'utf-8');
  });

  it('Dashboard 导入 preferencesRepository', () => {
    expect(src).toMatch(/from ['"]@\/features\/preferences\/repository['"]/);
  });

  it('Dashboard 调用 getFollowedVariantsBasic', () => {
    expect(src).toMatch(/getFollowedVariantsBasic/);
  });

  it('Dashboard 显示"关注产品动态"标题', () => {
    expect(src).toContain('关注产品动态');
  });

  it('Dashboard 显示空状态"暂无关注产品"', () => {
    expect(src).toContain('暂无关注产品');
  });

  it('Dashboard 空状态引导"在海外库存列表中点击星标"', () => {
    expect(src).toContain('星标关注');
  });

  it('Dashboard 显示低库存计数', () => {
    expect(src).toMatch(/需关注/);
  });

  it('Dashboard 阶段 B 不显示日销/可售/补货周期列', () => {
    expect(src).not.toMatch(/daily_sales|est_days|lead_time_days|日销|可售|补货周期/);
  });

  it('Dashboard getFollowedVariantsBasic 在 try-catch 中容错', () => {
    expect(src).toMatch(/preferencesRepository\.getFollowedVariantsBasic/);
    // try-catch 保证失败不影响首页渲染
    expect(src).toContain('try {');
  });

  it('Dashboard page 不含 any', () => {
    expect(src).not.toMatch(/\bany\b/);
  });
});

// ─── 阶段 B 告警规则验证 ───────────────────────────────────────────────

describe('P5-SY12 — 阶段 B 告警规则', () => {
  it('repository getFollowedVariantsBasic 注释声明阶段 B 临时告警', () => {
    const repoPath = path.resolve(process.cwd(), 'src/features/preferences/repository.ts');
    const repoSrc = fs.readFileSync(repoPath, 'utf-8');
    expect(repoSrc).toMatch(/阶段 B 临时/);
    expect(repoSrc).toMatch(/safety_stock/);
  });

  it('Dashboard 不包含 est_days < lead_time_days 逻辑', () => {
    const dashboardSrc = fs.readFileSync(DASHBOARD_PATH, 'utf-8');
    expect(dashboardSrc).not.toMatch(/est_days\s*<\s*lead_time_days/);
    expect(dashboardSrc).not.toMatch(/estDays|leadTimeDays/);
  });
});

// ─── 关注不影响同步 ─────────────────────────────────────────────────────

describe('P5-SY12 — 关注不影响同步链路', () => {
  it('inventory/actions.ts 不引用 preferencesRepository 写入方法', () => {
    const actionsSrc = fs.readFileSync(ACTIONS_PATH, 'utf-8');
    // 导入 preferencesRepository 仅用于读取关注状态
    expect(actionsSrc).toMatch(/getFavoritedVariantIds/);
    // 不调用写操作
    expect(actionsSrc).not.toMatch(/toggleFavoriteAction/);
    expect(actionsSrc).not.toMatch(/\.favorite\(|\.unfavorite\(|\.toggleFavorite\(/);
  });
});
