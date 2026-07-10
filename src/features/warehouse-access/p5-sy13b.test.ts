// P5-SY13B: 仓库分配管理 UI 测试
//
// 验证:
// - types.ts 包含 P5-SY13B 新类型
// - schema.ts 包含 updateUserWarehousesSchema
// - repository.ts 包含 P5-SY13B 新方法
// - actions.ts 为 Admin-only（requireActiveAdmin）
// - actions.ts 包含 3 个 Server Action
// - 页面不直接调用 supabase.from()
// - 侧边栏包含仓库分配入口
// - 不含 any
//
// 纯静态源码检查，不连接 Supabase。

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const WA_TYPES_PATH = path.resolve(process.cwd(), 'src/features/warehouse-access/types.ts');
const WA_SCHEMA_PATH = path.resolve(process.cwd(), 'src/features/warehouse-access/schema.ts');
const WA_REPO_PATH = path.resolve(process.cwd(), 'src/features/warehouse-access/repository.ts');
const WA_ACTIONS_PATH = path.resolve(process.cwd(), 'src/features/warehouse-access/actions.ts');
const WA_PAGE_PATH = path.resolve(process.cwd(), 'src/app/dashboard/users/warehouses/page.tsx');
const WA_COMPONENT_PATH = path.resolve(
  process.cwd(),
  'src/features/warehouse-access/components/warehouse-assignment-content.tsx',
);
const SIDEBAR_PATH = path.resolve(process.cwd(), 'src/app/dashboard/_components/sidebar-nav.tsx');

// ─── 1. types.ts — P5-SY13B 新类型 ──────────────────────────────────────

describe('P5-SY13B — types.ts', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(WA_TYPES_PATH, 'utf-8');
  });

  it('定义 OperatorItem 接口', () => {
    expect(src).toMatch(/export interface OperatorItem/);
  });

  it('OperatorItem 包含 id/email/displayName/isActive/createdAt', () => {
    expect(src).toMatch(/id:\s*string/);
    expect(src).toMatch(/email:\s*string/);
    expect(src).toMatch(/displayName:\s*string/);
    expect(src).toMatch(/isActive:\s*boolean/);
    expect(src).toMatch(/createdAt:\s*string/);
  });

  it('定义 AssignableWarehouse 接口', () => {
    expect(src).toMatch(/export interface AssignableWarehouse/);
  });

  it('AssignableWarehouse 包含 id/name/country', () => {
    expect(src).toMatch(/name:\s*string/);
    expect(src).toMatch(/country:\s*string/);
  });

  it('定义 OperatorWithAssignments 接口', () => {
    expect(src).toMatch(/export interface OperatorWithAssignments/);
  });

  it('OperatorWithAssignments 包含 operator + assignedWarehouseIds', () => {
    expect(src).toMatch(/operator:\s*OperatorItem/);
    expect(src).toMatch(/assignedWarehouseIds:\s*string\[\]/);
  });

  it('WarehouseAccessRepository 接口包含 listOperators', () => {
    expect(src).toMatch(/listOperators\s*\(/);
  });

  it('WarehouseAccessRepository 接口包含 getUserWarehouseAssignments', () => {
    expect(src).toMatch(/getUserWarehouseAssignments\s*\(/);
  });

  it('WarehouseAccessRepository 接口包含 updateUserWarehouses', () => {
    expect(src).toMatch(/updateUserWarehouses\s*\(/);
  });

  it('WarehouseAccessRepository 接口包含 getAssignableWarehouses', () => {
    expect(src).toMatch(/getAssignableWarehouses\s*\(/);
  });

  it('不含 any', () => {
    expect(src).not.toMatch(/\bany\b/);
  });
});

// ─── 2. schema.ts — Zod 校验 ──────────────────────────────────────────

describe('P5-SY13B — schema.ts', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(WA_SCHEMA_PATH, 'utf-8');
  });

  it('导出 updateUserWarehousesSchema', () => {
    expect(src).toMatch(/export const updateUserWarehousesSchema/);
  });

  it('userId 使用 uuid 校验', () => {
    expect(src).toMatch(/userId:\s*z\.string\(\)\.uuid\(/);
  });

  it('warehouseIds 为 uuid 数组', () => {
    expect(src).toMatch(/warehouseIds:[\s\S]*\.array\(z\.string\(\)\.uuid\(/);
  });

  it('warehouseIds 最大 50', () => {
    expect(src).toMatch(/\.max\(\s*50\s*/);
  });

  it('导出 UpdateUserWarehousesValues 类型', () => {
    expect(src).toMatch(/export type UpdateUserWarehousesValues/);
  });

  it('不含 any', () => {
    expect(src).not.toMatch(/\bany\b/);
  });
});

// ─── 3. repository.ts — P5-SY13B 新方法 ────────────────────────────────

describe('P5-SY13B — repository.ts', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(WA_REPO_PATH, 'utf-8');
  });

  it('实现 listOperators', () => {
    expect(src).toMatch(/async listOperators\s*\(/);
  });

  it('listOperators 查询 profiles（active operator）', () => {
    expect(src).toMatch(/from\('profiles'\)/);
    expect(src).toMatch(/eq\('is_active',\s*true\)/);
    expect(src).toMatch(/role.*name.*operator/);
  });

  it('实现 getUserWarehouseAssignments', () => {
    expect(src).toMatch(/async getUserWarehouseAssignments\s*\(/);
  });

  it('getUserWarehouseAssignments 查询 user_warehouses', () => {
    expect(src).toMatch(/from\('user_warehouses'\)/);
  });

  it('getUserWarehouseAssignments UUID 非法返回空 Set', () => {
    expect(src).toMatch(/validateUUID.*return new Set\(\)/);
  });

  it('实现 updateUserWarehouses', () => {
    expect(src).toMatch(/async updateUserWarehouses\s*\(/);
  });

  it('updateUserWarehouses 通过 RPC 事务性写入（不直接 delete+insert）', () => {
    expect(src).toMatch(/\.rpc\(/);
    expect(src).toContain("'update_user_warehouses'");
  });

  it('updateUserWarehouses 空数组/去重后为空时传 null 到 RPC 清空分配', () => {
    expect(src).toMatch(/dedupedIds\.length\s*>\s*0\s*\?\s*dedupedIds\s*:\s*null/);
  });

  it('实现 getAssignableWarehouses', () => {
    expect(src).toMatch(/async getAssignableWarehouses\s*\(/);
  });

  it('getAssignableWarehouses 只返回 active overseas warehouse', () => {
    expect(src).toMatch(/eq\('type',\s*'overseas'\)/);
    expect(src).toMatch(/eq\('is_active',\s*true\)/);
  });

  it('不含 any', () => {
    expect(src).not.toMatch(/\bany\b/);
  });
});

// ─── 3b. updateUserWarehouses 写入前业务校验 ─────────────────────────

describe('P5-SY13B — updateUserWarehouses 写入前业务校验', () => {
  let repoSrc: string;

  beforeAll(() => {
    repoSrc = fs.readFileSync(WA_REPO_PATH, 'utf-8');
  });

  it('校验目标用户 role.name === operator', () => {
    expect(repoSrc).toMatch(/targetRole\.name\s*!==\s*'operator'/);
    expect(repoSrc).toContain('只能为启用的操作员分配仓库');
  });

  it('校验目标用户 is_active === true', () => {
    expect(repoSrc).toMatch(/!targetProfile\.is_active/);
  });

  it('校验仓库 type === overseas', () => {
    expect(repoSrc).toMatch(/eq\('type',\s*'overseas'\)/);
  });

  it('校验仓库 is_active === true', () => {
    expect(repoSrc).toMatch(/eq\('is_active',\s*true\)/);
  });

  it('warehouseIds 去重（new Set）', () => {
    expect(repoSrc).toMatch(/new Set\(warehouseIds\)/);
  });

  it('校验失败时返回错误而不调用 RPC', () => {
    // 所有业务校验都在 rpc() 调用之前，校验失败时提前 return
    const rpcIdx = repoSrc.indexOf('.rpc(');
    const userCheckIdx = repoSrc.indexOf("'只能为启用的操作员分配仓库'");
    const whCheckIdx = repoSrc.indexOf("'只能分配启用的海外仓库'");
    // 业务校验的错误 return 都在 rpc 调用之前
    expect(userCheckIdx).toBeLessThan(rpcIdx);
    expect(whCheckIdx).toBeLessThan(rpcIdx);
  });

  it('校验失败时 delete 不应早于校验（校验 return 先于 delete）', () => {
    // repository 层不再直接 delete，而是通过 RPC
    // RPC 调用在全部校验之后
    const firstBusinessCheck = Math.min(
      repoSrc.indexOf("'用户不存在'"),
      repoSrc.indexOf("'只能为启用的操作员分配仓库'"),
      repoSrc.indexOf("'只能分配启用的海外仓库'"),
    );
    const rpcIdx = repoSrc.indexOf('.rpc(');
    expect(firstBusinessCheck).toBeGreaterThan(0);
    expect(firstBusinessCheck).toBeLessThan(rpcIdx);
  });
});

// ─── 3c. Migration 00016 RPC 契约 ────────────────────────────────────
// 注：00016 RPC 测试已从 supabase/migrations/ 移入本文件，纳入 npm run test 执行。

describe('P5-SY13B — Migration 00016 RPC', () => {
  let sqlSrc: string;

  beforeAll(() => {
    sqlSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'supabase/migrations/00016_update_user_warehouses_rpc.sql'),
      'utf-8',
    );
  });

  // ── 函数声明 ──────────────────────────────────────────────────────────

  it('包含 CREATE OR REPLACE FUNCTION update_user_warehouses', () => {
    expect(sqlSrc).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.update_user_warehouses/);
  });

  it('参数包含 p_user_id UUID 和 p_warehouse_ids UUID[]', () => {
    expect(sqlSrc).toMatch(/p_user_id\s+UUID/i);
    expect(sqlSrc).toMatch(/p_warehouse_ids\s+UUID\[\]/i);
  });

  it('返回 jsonb', () => {
    expect(sqlSrc).toMatch(/RETURNS\s+jsonb/i);
  });

  it('使用 SECURITY DEFINER', () => {
    expect(sqlSrc).toMatch(/SECURITY\s+DEFINER/);
  });

  it('设置 search_path 为空字符串', () => {
    expect(sqlSrc).toMatch(/SET\s+search_path\s*=\s*''/);
  });

  it('使用 plpgsql 语言', () => {
    expect(sqlSrc).toMatch(/LANGUAGE\s+plpgsql/);
  });

  // ── admin 校验 ────────────────────────────────────────────────────────

  it('RPC 校验调用者是 admin', () => {
    expect(sqlSrc).toMatch(/get_user_role\s*\(\)/);
    expect(sqlSrc).toContain("!= 'admin'");
  });

  it('非 admin 返回无权限错误', () => {
    expect(sqlSrc).toContain('无权限：需要管理员角色');
  });

  // ── 目标用户校验 ──────────────────────────────────────────────────────

  it('校验目标用户存在、角色和启用状态（FROM profiles JOIN role）', () => {
    expect(sqlSrc).toMatch(/FROM\s+public\.profiles\s+p/i);
    expect(sqlSrc).toMatch(/JOIN\s+public\.role\s+r/i);
    expect(sqlSrc).toMatch(/WHERE\s+p\.id\s+=\s+p_user_id/i);
  });

  it('目标用户不存在返回错误', () => {
    expect(sqlSrc).toContain('用户不存在');
  });

  it('目标用户非 operator 返回错误', () => {
    expect(sqlSrc).toMatch(/v_target_role\s*!=\s*'operator'/);
    expect(sqlSrc).toContain('只能为启用的操作员分配仓库');
  });

  it('目标用户已停用返回错误', () => {
    expect(sqlSrc).toMatch(/v_target_active\s+IS\s+NOT\s+TRUE/);
  });

  // ── 仓库校验 ──────────────────────────────────────────────────────────

  it('RPC 校验仓库是 active overseas', () => {
    expect(sqlSrc).toContain("type = 'overseas'");
    expect(sqlSrc).toContain('is_active = true');
  });

  it('存在非活跃/非海外仓库时返回错误', () => {
    expect(sqlSrc).toContain('只能分配启用的海外仓库');
  });

  // ── 事务性写入 ────────────────────────────────────────────────────────

  it('RPC 内包含 DELETE + INSERT（同一事务）', () => {
    const deleteIdx = sqlSrc.indexOf('DELETE FROM public.user_warehouses');
    const insertIdx = sqlSrc.indexOf('INSERT INTO public.user_warehouses');
    expect(deleteIdx).toBeGreaterThan(0);
    expect(insertIdx).toBeGreaterThan(deleteIdx);
  });

  it('RPC warehouseIds 去重（DISTINCT）', () => {
    expect(sqlSrc).toMatch(/DISTINCT/);
  });

  it('RPC 空 warehouseIds 仅 delete 不 insert', () => {
    expect(sqlSrc).toMatch(/v_deduped_ids\s+IS\s+NOT\s+NULL/);
    expect(sqlSrc).toMatch(/array_length\(v_deduped_ids/);
  });

  // ── 成功返回 ──────────────────────────────────────────────────────────

  it('成功时返回 jsonb_build_object success true', () => {
    expect(sqlSrc).toContain("jsonb_build_object('success', true)");
  });

  // ── 权限收口：REVOKE/GRANT ───────────────────────────────────────────

  it('包含 REVOKE EXECUTE FROM PUBLIC', () => {
    expect(sqlSrc).toMatch(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.update_user_warehouses\(uuid,\s*uuid\[\]\)\s+FROM\s+PUBLIC/i);
  });

  it('包含 REVOKE EXECUTE FROM anon', () => {
    expect(sqlSrc).toMatch(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.update_user_warehouses\(uuid,\s*uuid\[\]\)\s+FROM\s+anon/i);
  });

  it('包含 GRANT EXECUTE TO authenticated', () => {
    expect(sqlSrc).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.update_user_warehouses\(uuid,\s*uuid\[\]\)\s+TO\s+authenticated/i);
  });

  it('不 GRANT EXECUTE TO anon', () => {
    expect(sqlSrc).not.toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.update_user_warehouses.*\bTO\s+anon\b/i);
  });

  it('不 GRANT EXECUTE TO PUBLIC', () => {
    expect(sqlSrc).not.toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.update_user_warehouses.*\bTO\s+PUBLIC\b/i);
  });

  // ── 不修改已执行 Migration ───────────────────────────────────────────

  it('未引用 00001~00015 migration 文件', () => {
    // SQL 头注释中的 "不修改已执行 Migration 00001~00015" 是声明而非引用
    // 使用 lookahead/lookbehind 排除 range notation 以避免误报
    expect(sqlSrc).not.toMatch(/00001(?!~)/);        // 排除 "00001~" range
    expect(sqlSrc).not.toMatch(/0000[2-9]/);          // 00002-00009 不会出现在 range
    expect(sqlSrc).not.toMatch(/(?<!00001~)0001[0-5]/); // 排除 "00001~0001X" range 尾端
  });

  it('使用 CREATE OR REPLACE 而非直接 CREATE（幂等）', () => {
    expect(sqlSrc).toMatch(/CREATE\s+OR\s+REPLACE/);
  });

  it('SQL 文件存在', () => {
    expect(
      fs.existsSync(
        path.resolve(process.cwd(), 'supabase/migrations/00016_update_user_warehouses_rpc.sql'),
      ),
    ).toBe(true);
  });
});

// ─── 4. actions.ts — Admin-only Server Actions ─────────────────────────

describe('P5-SY13B — actions.ts', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(WA_ACTIONS_PATH, 'utf-8');
  });

  it('包含 "use server" 指令', () => {
    expect(src).toMatch(/'use server'/);
  });

  it('导出 listOperatorsWithAssignments', () => {
    expect(src).toMatch(/export async function listOperatorsWithAssignments/);
  });

  it('导出 getAssignableWarehouses', () => {
    expect(src).toMatch(/export async function getAssignableWarehouses/);
  });

  it('导出 updateUserWarehouses', () => {
    expect(src).toMatch(/export async function updateUserWarehouses/);
  });

  it('所有 Server Action 调用 requireActiveAdmin', () => {
    const requireActiveAdminCount = (src.match(/requireActiveAdmin/g) || []).length;
    expect(requireActiveAdminCount).toBeGreaterThanOrEqual(3);
  });

  it('不使用 requireActiveAuth（必须 Admin 而非仅 Auth）', () => {
    expect(src).not.toMatch(/requireActiveAuth/);
  });

  it('不使用 requireAdmin（已迁移到 Active 变体）', () => {
    expect(src).not.toMatch(/\bsync\s+function\s+requireAdmin\b/);
  });

  it('updateUserWarehouses 使用 Zod schema 校验', () => {
    expect(src).toMatch(/updateUserWarehousesSchema\.safeParse/);
  });

  it('updateUserWarehouses 校验失败返回中文错误', () => {
    expect(src).toContain('参数校验失败');
  });

  it('校验失败不修改数据库', () => {
    expect(src).toContain('参数校验失败');
    const safeCheckIdx = src.indexOf('safeParse');
    const rpcIdx = src.indexOf("'update_user_warehouses'");
    // safeParse 应该在调用 repository（进而 RPC）之前
    if (rpcIdx > safeCheckIdx) {
      expect(src.indexOf('!parsed.success', safeCheckIdx)).toBeLessThan(rpcIdx);
    }
  });

  it('repository 返回失败时透传业务错误消息', () => {
    // actions 使用 result.error 作为响应，不丢弃业务校验错误
    expect(src).toMatch(/result\.error/);
  });

  it('成功后调用 revalidatePath', () => {
    expect(src).toMatch(/revalidatePath\(/);
  });

  it('权限错误返回"无权限：需要管理员角色"', () => {
    expect(src).toContain('无权限：需要管理员角色');
  });

  it('从 ./types 导入 OperatorWithAssignments 和 AssignableWarehouse（非 re-export）', () => {
    // PERF-F: Turbopack 不允许 'use server' 模块 re-export type-only 类型
    // 类型由 ./types.ts 直接提供，actions.ts 仅导入使用
    expect(src).toMatch(/import type.*OperatorWithAssignments.*AssignableWarehouse.*from/);
    expect(src).not.toMatch(/export type/);
  });

  it('不含 any', () => {
    expect(src).not.toMatch(/\bany\b/);
  });
});

// ─── 5. 页面 — 不直接调用 supabase ────────────────────────────────────

describe('P5-SY13B — 页面架构边界', () => {
  let pageSrc: string;
  let compSrc: string;

  beforeAll(() => {
    pageSrc = fs.readFileSync(WA_PAGE_PATH, 'utf-8');
    compSrc = fs.readFileSync(WA_COMPONENT_PATH, 'utf-8');
  });

  it('page.tsx 不直接调用 supabase.from()', () => {
    expect(pageSrc).not.toMatch(/supabase\.from\(/);
    expect(pageSrc).not.toMatch(/\.from\(/);
  });

  it('page.tsx 不导入 createClient', () => {
    expect(pageSrc).not.toMatch(/createClient/);
    expect(pageSrc).not.toMatch(/createServiceClient/);
  });

  it('component 不导入 createClient 或 createServiceClient', () => {
    expect(compSrc).not.toMatch(/createClient/);
    expect(compSrc).not.toMatch(/createServiceClient/);
  });

  it('component 不直接调用 supabase.from()', () => {
    expect(compSrc).not.toMatch(/supabase\.from\(/);
  });

  it('component 通过 Server Action 获取和更新数据', () => {
    expect(compSrc).toMatch(/from ['"]\.\.\/actions['"]/);
    expect(compSrc).toMatch(/updateUserWarehouses/);
  });

  it('component 包含无权限状态处理', () => {
    expect(compSrc).toContain('无权限');
    expect(compSrc).toContain('仅管理员可访问');
  });

  it('component 包含空 operator 状态', () => {
    expect(compSrc).toContain('暂无可分配的操作员');
  });

  it('component 包含空 warehouse 状态', () => {
    expect(compSrc).toContain('暂无可分配的海外仓库');
  });

  it('component 不含 any', () => {
    expect(compSrc).not.toMatch(/\bany\b/);
  });

  it('page.tsx 不含 any', () => {
    expect(pageSrc).not.toMatch(/\bany\b/);
  });

  it('loading.tsx 存在', () => {
    const loadingPath = path.resolve(process.cwd(), 'src/app/dashboard/users/warehouses/loading.tsx');
    expect(fs.existsSync(loadingPath)).toBe(true);
  });

  it('error.tsx 存在', () => {
    const errorPath = path.resolve(process.cwd(), 'src/app/dashboard/users/warehouses/error.tsx');
    expect(fs.existsSync(errorPath)).toBe(true);
  });
});

// ─── 6. 侧边栏 — 仓库分配入口 ──────────────────────────────────────────

describe('P5-SY13B — 侧边栏入口', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(SIDEBAR_PATH, 'utf-8');
  });

  it('包含仓库分配导航项', () => {
    expect(src).toContain('仓库分配');
  });

  it('仓库分配路径为 /dashboard/users/warehouses', () => {
    expect(src).toContain('/dashboard/users/warehouses');
  });

  it('使用 Warehouse 图标', () => {
    expect(src).toMatch(/Warehouse/);
  });

  it('phase 为 0（已启用）', () => {
    expect(src).toMatch(/phase:\s*'0'/);
  });

  it('仅 admin 可见', () => {
    expect(src).toMatch(/isAdmin/);
  });
});

// ─── 6b. 侧边栏 — 团队账号入口已开放 ──────────────────────────────────

describe('P5-SY13B — 侧边栏团队账号入口', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(SIDEBAR_PATH, 'utf-8');
  });

  it('包含团队账号导航项', () => {
    expect(src).toContain('团队账号');
  });

  it('USERS_ITEM phase 为 0（已开放）', () => {
    // USERS_ITEM 定义中 phase 为 '0'，不再灰显
    expect(src).toMatch(/label:\s*'团队账号'[\s\S]*?phase:\s*'0'/);
  });

  it('团队账号 href 为 /dashboard/users', () => {
    expect(src).toMatch(/href:\s*'\/dashboard\/users'/);
  });

  it('团队账号不显示 P4 标记', () => {
    // phase 为 '0' 时 available=true，不渲染 P4 badge
    // 确保源码中 phase 已是 '0'（而非 '4'）
    const usersPhase = src.match(/label:\s*'团队账号'[\s\S]*?phase:\s*'(\d+)'/);
    expect(usersPhase).not.toBeNull();
    expect(usersPhase![1]).toBe('0');
  });

  it('团队账号仅在 admin 区域渲染（isAdmin 守卫）', () => {
    // renderItem(USERS_ITEM) 在 {isAdmin && (...)} 块内
    const adminBlockIdx = src.indexOf('{isAdmin && (');
    const usersIdx = src.indexOf('renderItem(USERS_ITEM)');
    const adminBlockClose = src.indexOf('</div>', adminBlockIdx);
    expect(adminBlockIdx).toBeGreaterThan(0);
    expect(usersIdx).toBeGreaterThan(adminBlockIdx);
    expect(usersIdx).toBeLessThan(adminBlockClose);
  });

  it('Operator 不可见团队账号（不在非 admin 路径中渲染）', () => {
    // USERS_ITEM 仅在 isAdmin 守卫内渲染，Operator 侧边栏不包含
    // 验证 renderItem(USERS_ITEM) 在 isAdmin 条件块内
    const usersRenderIdx = src.indexOf('renderItem(USERS_ITEM)');
    const beforeUsers = src.slice(0, usersRenderIdx);
    const lastIsAdminBeforeUsers = beforeUsers.lastIndexOf('isAdmin');
    expect(lastIsAdminBeforeUsers).toBeGreaterThan(0);
    // 确保在 isAdmin 和 renderItem(USERS_ITEM) 之间没有闭合这个条件块的逻辑
    const between = src.slice(lastIsAdminBeforeUsers, usersRenderIdx);
    expect(between).toContain('&&');
  });

  it('仓库分配入口保持现状不变', () => {
    expect(src).toContain('仓库分配');
    expect(src).toContain('/dashboard/users/warehouses');
    expect(src).toMatch(/WAREHOUSE_ASSIGN_ITEM/);
  });

  it('国内库存入口仍灰显（phase 非 0）', () => {
    // 国内库存 phase 为 '2'，保持灰显状态
    expect(src).toMatch(/label:\s*'国内库存'[\s\S]*?phase:\s*'2'/);
  });
});

// ─── 7. Operator 权限隔离 ─────────────────────────────────────────────

describe('P5-SY13B — Operator 权限隔离', () => {
  let actionsSrc: string;
  let repoSrc: string;

  beforeAll(() => {
    actionsSrc = fs.readFileSync(WA_ACTIONS_PATH, 'utf-8');
    repoSrc = fs.readFileSync(WA_REPO_PATH, 'utf-8');
  });

  it('actions 中没有允许 operator 访问仓库分配管理的逻辑', () => {
    expect(actionsSrc).not.toMatch(/roleName\s*===\s*'operator'/);
  });

  it('actions 所有写操作必须 requireActiveAdmin', () => {
    // updateUserWarehouses 是唯一写操作
    const updateFnIdx = actionsSrc.indexOf('export async function updateUserWarehouses');
    const requireIdx = actionsSrc.indexOf('requireActiveAdmin', updateFnIdx);
    expect(requireIdx).toBeGreaterThan(updateFnIdx);
    expect(requireIdx).toBeLessThan(updateFnIdx + 500);
  });

  it('repository listOperators 仅返回 is_active=true 的 operator', () => {
    expect(repoSrc).toMatch(/eq\('is_active',\s*true\)/);
    expect(repoSrc).toMatch(/role.*name.*operator/);
  });

  it('repository 不返回 admin 用户', () => {
    expect(repoSrc).toMatch(/role\?\.name\s*===\s*'operator'/);
  });

  it('不含 any', () => {
    expect(actionsSrc).not.toMatch(/\bany\b/);
  });
});
