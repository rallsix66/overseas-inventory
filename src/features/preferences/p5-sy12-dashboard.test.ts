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

  it('Dashboard 查询失败显示错误状态而非空列表', () => {
    expect(src).toMatch(/preferencesRepository\.getFollowedVariantsBasic/);
    // 失败时显示"关注产品加载失败"，不伪装成"暂无关注产品"
    expect(src).toContain('关注产品加载失败');
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

// ─── Dashboard 关注区查询路径 ──────────────────────────────────────────

describe('P5-SY12 — Dashboard 关注区查询路径', () => {
  const repoPath = path.resolve(process.cwd(), 'src/features/preferences/repository.ts');
  const repoSrc = fs.readFileSync(repoPath, 'utf-8');

  it('先读取 favorited variant_id，再从 inventory 正向查询库存行', () => {
    expect(repoSrc).toMatch(/getFavoritedVariantIds\(userId\)/);
    expect(repoSrc).toMatch(/\.from\('inventory'\)/);
    expect(repoSrc).toMatch(/\.in\('variant_id'/);
  });

  it('Dashboard 查询不依赖 user_variant_preference 反向嵌套 inventory', () => {
    const fnMatch = repoSrc.match(/async getFollowedVariantsBasic[\s\S]*?^\s{2}\},/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch?.[0]).not.toMatch(/from\('user_variant_preference'\)[\s\S]*inventory:inventory/);
  });

  it('getFollowedVariantsBasic warehouse 使用 !inner join 确保类型安全，同时 null warehouse 兜底处理', () => {
    const fnMatch = repoSrc.match(/async getFollowedVariantsBasic[\s\S]*?^\s{2}\},/m);
    expect(fnMatch).not.toBeNull();
    // warehouse join 使用 !inner 保证 TypeScript 类型推断正确
    expect(fnMatch?.[0]).toMatch(/warehouse:warehouse_id!inner/);
  });

  it('getFollowedVariantsBasic 防御式处理 warehouse 为空，使用 wh?.name ?? 未知仓库 兜底', () => {
    const fnMatch = repoSrc.match(/async getFollowedVariantsBasic[\s\S]*?^\s{2}\},/m);
    expect(fnMatch).not.toBeNull();
    // 防御式 null 处理：即使 !inner 理论上不返回 null，unwrapJoin 仍可能返回 null
    expect(fnMatch?.[0]).toContain("wh?.name ?? '未知仓库'");
    expect(fnMatch?.[0]).toContain("'未知仓库'");
  });
});

// ─── 关注不影响同步 ─────────────────────────────────────────────────────

describe('P5-SY12 — 关注不影响同步链路', () => {
  it('inventory/actions.ts 不引用 preferencesRepository 写方法，getOverseasList 内部处理关注标记', () => {
    const actionsSrc = fs.readFileSync(ACTIONS_PATH, 'utf-8');
    // getOverseasList 内部已完成归档过滤 + 关注标记 + 排序 + 分页
    // inventory actions 层不再重复导入 preferencesRepository
    expect(actionsSrc).not.toMatch(/from ['"]@\/features\/preferences\/repository['"]/);
    // 不调用写操作
    expect(actionsSrc).not.toMatch(/toggleFavoriteAction/);
    expect(actionsSrc).not.toMatch(/\.favorite\(|\.unfavorite\(|\.toggleFavorite\(/);
  });
});

// ─── 海外库存关注排序 ─────────────────────────────────────────────────

describe('P5-SY12 — 海外库存关注排序', () => {
  const invRepoPath = path.resolve(process.cwd(), 'src/features/inventory/repository.ts');
  const invRepoSrc = fs.readFileSync(invRepoPath, 'utf-8');

  it('getOverseasList 排序指令在分页前执行（isFavorited 置顶 → quantity 升序 → slice 分页）', () => {
    const fnBodyMatch = invRepoSrc.match(/async getOverseasList\([\s\S]*?^\s{2}\},?\s*$/m);
    expect(fnBodyMatch).not.toBeNull();
    const fnBody = fnBodyMatch![0];
    // sort 必须在 slice/page 之前
    const sortIdx = fnBody.indexOf('items.sort');
    const sliceIdx = fnBody.indexOf('items.slice');
    expect(sortIdx).toBeGreaterThan(0);
    expect(sliceIdx).toBeGreaterThan(0);
    expect(sortIdx).toBeLessThan(sliceIdx);
  });

  it('getOverseasList 关注项排在最前（Number(b.isFavorited) - Number(a.isFavorited)）', () => {
    expect(invRepoSrc).toMatch(/items\.sort\([\s\S]*isFavorited[\s\S]*quantity/);
  });

  it('getOverseasList 归档过滤在排序前完成，关注与归档可共存', () => {
    const fnBodyMatch = invRepoSrc.match(/async getOverseasList\([\s\S]*?^\s{2}\},?\s*$/m);
    expect(fnBodyMatch).not.toBeNull();
    const fnBody = fnBodyMatch![0];
    // 归档过滤（!archivedVariantIds.has）在映射（isFavorited = favoritedVariantIds.has）之前
    const archivedFilterIdx = fnBody.indexOf('!archivedVariantIds.has');
    const favoritedMarkIdx = fnBody.indexOf('isFavorited: favoritedVariantIds.has');
    expect(archivedFilterIdx).toBeGreaterThan(0);
    expect(favoritedMarkIdx).toBeGreaterThan(0);
    expect(archivedFilterIdx).toBeLessThan(favoritedMarkIdx);
  });
});

// ─── Dashboard 动态渲染（防缓存回归）──────────────────────────────────

describe('P5-SY12 — Dashboard 动态渲染', () => {
  it('Dashboard 使用 force-dynamic 防止静态预渲染缓存', () => {
    const dashboardSrc = fs.readFileSync(DASHBOARD_PATH, 'utf-8');
    expect(dashboardSrc).toMatch(/export const dynamic = 'force-dynamic'/);
  });

  it('Dashboard 错误状态显示具体错误信息而非硬编码文本', () => {
    const dashboardSrc = fs.readFileSync(DASHBOARD_PATH, 'utf-8');
    // followedError 现在是 string | null，错误时显示具体消息
    expect(dashboardSrc).toMatch(/followedError: string \| null/);
    expect(dashboardSrc).toMatch(/\{followedError\}/);
  });
});

// ─── getFollowedVariantsBasic 诊断错误 ──────────────────────────────

describe('P5-SY12 — getFollowedVariantsBasic 诊断', () => {
  const repoPath = path.resolve(process.cwd(), 'src/features/preferences/repository.ts');
  const repoSrc = fs.readFileSync(repoPath, 'utf-8');

  it('查询使用可变链 .eq(warehouse.type, overseas) 与 getOverseasList 一致', () => {
    expect(repoSrc).toMatch(/\.eq\('warehouse\.type', 'overseas'\)/);
  });

  it('favorited 非空但 inventory 返回空时抛出 EMPTY_RESULT 而非静默返回 []', () => {
    expect(repoSrc).toMatch(/'EMPTY_RESULT'/);
    expect(repoSrc).toMatch(/已关注.*个 SKU 但未找到对应库存记录/);
  });

  it('EMPTY_RESULT 已加入 PreferenceErrorCode 联合类型', () => {
    const typesPath = path.resolve(process.cwd(), 'src/features/preferences/types.ts');
    const typesSrc = fs.readFileSync(typesPath, 'utf-8');
    expect(typesSrc).toMatch(/'EMPTY_RESULT'/);
  });
});
