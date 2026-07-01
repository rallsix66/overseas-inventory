// P4-U5 返工: Migration 00025 静态契约测试 + 安全验收
// 覆盖：RPC 结构、auth.uid() 身份绑定、REVOKE/GRANT、
// 原子锁、业务规则、operator trigger、权限模型
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readSrc(relativePath: string): string {
  return readFileSync(resolve(relativePath), 'utf-8');
}

describe('P4-U5 Migration 00025 静态契约', () => {
  let migration: string;

  beforeAll(() => {
    migration = readSrc('supabase/migrations/00025_rpc_caller_identity_binding.sql');
  });

  // ── 1. RPC 存在性 ──────────────────────────────────────────

  it('包含 update_user_role_protected 函数定义', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION update_user_role_protected');
  });

  it('包含 toggle_user_active_protected 函数定义', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION toggle_user_active_protected');
  });

  // ── 2. 权限模型 ───────────────────────────────────────────

  it('所有函数均为 SECURITY INVOKER（不绕过 RLS）', () => {
    // 头注释 + 2 RPC + trigger = 至少 4 处
    const invokerCount = (migration.match(/SECURITY INVOKER/g) || []).length;
    expect(invokerCount).toBeGreaterThanOrEqual(4);
  });

  it('不包含 SECURITY DEFINER（不提升权限）', () => {
    expect(migration).not.toContain('SECURITY DEFINER');
  });

  // ── 3. REVOKE / GRANT 权限加固 ────────────────────────────

  it('REVOKE EXECUTE ON FUNCTION update_user_role_protected FROM PUBLIC, anon', () => {
    expect(migration).toContain('REVOKE EXECUTE ON FUNCTION update_user_role_protected FROM PUBLIC, anon');
  });

  it('REVOKE EXECUTE ON FUNCTION toggle_user_active_protected FROM PUBLIC, anon', () => {
    expect(migration).toContain('REVOKE EXECUTE ON FUNCTION toggle_user_active_protected FROM PUBLIC, anon');
  });

  it('GRANT EXECUTE ON FUNCTION update_user_role_protected TO authenticated', () => {
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION update_user_role_protected TO authenticated');
  });

  it('GRANT EXECUTE ON FUNCTION toggle_user_active_protected TO authenticated', () => {
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION toggle_user_active_protected TO authenticated');
  });

  // ── 4. auth.uid() 身份绑定 — update_user_role_protected ───

  describe('update_user_role_protected auth.uid() 绑定', () => {
    let rpcBody: string;

    beforeAll(() => {
      const start = migration.indexOf('CREATE OR REPLACE FUNCTION update_user_role_protected');
      const end = migration.indexOf('CREATE OR REPLACE FUNCTION toggle_user_active_protected');
      rpcBody = migration.slice(start, end > 0 ? end : undefined);
    });

    it('⑩ auth.uid() IS NOT NULL 检查（未登录拒绝）', () => {
      expect(rpcBody).toContain('auth.uid() IS NULL');
      expect(rpcBody).toContain("RAISE EXCEPTION '未登录，请先登录'");
    });

    it('⑩ auth.uid() = p_operator_user_id 身份一致性校验', () => {
      expect(rpcBody).toContain('auth.uid() != p_operator_user_id');
      expect(rpcBody).toContain("RAISE EXCEPTION '操作者身份校验失败'");
    });

    it('⑩ 调用者必须是活跃 Admin（SELECT profiles JOIN role WHERE id = auth.uid()）', () => {
      expect(rpcBody).toContain('SELECT r.name, p.is_active INTO v_caller_role_name, v_caller_is_active');
      expect(rpcBody).toContain('FROM public.profiles p');
      expect(rpcBody).toContain('JOIN public.role r ON r.id = p.role_id');
      expect(rpcBody).toContain('WHERE p.id = auth.uid()');
    });

    it('⑩ 调用者不存在或未启用时拒绝', () => {
      expect(rpcBody).toContain('NOT FOUND OR v_caller_is_active IS NOT TRUE');
      expect(rpcBody).toContain("RAISE EXCEPTION '账号未启用或不存在，请联系管理员'");
    });

    it('⑩ 调用者非 admin 时拒绝', () => {
      expect(rpcBody).toContain("v_caller_role_name != 'admin'");
      expect(rpcBody).toContain("RAISE EXCEPTION '仅管理员可执行此操作'");
    });

    it('⑩ auth.uid() 身份绑定在 pg_advisory_xact_lock 之前执行', () => {
      const authUidIdx = rpcBody.indexOf("auth.uid() != p_operator_user_id");
      const lockIdx = rpcBody.indexOf('pg_advisory_xact_lock(987654321)');
      expect(authUidIdx).toBeGreaterThan(0);
      expect(lockIdx).toBeGreaterThan(0);
      expect(authUidIdx).toBeLessThan(lockIdx);
    });
  });

  // ── 5. auth.uid() 身份绑定 — toggle_user_active_protected ──

  describe('toggle_user_active_protected auth.uid() 绑定', () => {
    let rpcBody: string;

    beforeAll(() => {
      const start = migration.indexOf('CREATE OR REPLACE FUNCTION toggle_user_active_protected');
      rpcBody = migration.slice(start);
    });

    it('⑩ auth.uid() IS NOT NULL 检查（未登录拒绝）', () => {
      expect(rpcBody).toContain('auth.uid() IS NULL');
      expect(rpcBody).toContain("RAISE EXCEPTION '未登录，请先登录'");
    });

    it('⑩ auth.uid() = p_operator_user_id 身份一致性校验', () => {
      expect(rpcBody).toContain('auth.uid() != p_operator_user_id');
      expect(rpcBody).toContain("RAISE EXCEPTION '操作者身份校验失败'");
    });

    it('⑩ 调用者必须是活跃 Admin（SELECT profiles JOIN role WHERE id = auth.uid()）', () => {
      expect(rpcBody).toContain('SELECT r.name, p.is_active INTO v_caller_role_name, v_caller_is_active');
      expect(rpcBody).toContain('FROM public.profiles p');
      expect(rpcBody).toContain('JOIN public.role r ON r.id = p.role_id');
      expect(rpcBody).toContain('WHERE p.id = auth.uid()');
    });

    it('⑩ 调用者不存在或未启用时拒绝', () => {
      expect(rpcBody).toContain('NOT FOUND OR v_caller_is_active IS NOT TRUE');
      expect(rpcBody).toContain("RAISE EXCEPTION '账号未启用或不存在，请联系管理员'");
    });

    it('⑩ 调用者非 admin 时拒绝', () => {
      expect(rpcBody).toContain("v_caller_role_name != 'admin'");
      expect(rpcBody).toContain("RAISE EXCEPTION '仅管理员可执行此操作'");
    });

    it('⑩ auth.uid() 身份绑定在 pg_advisory_xact_lock 之前执行', () => {
      const authUidIdx = rpcBody.indexOf("auth.uid() != p_operator_user_id");
      const lockIdx = rpcBody.indexOf('pg_advisory_xact_lock(987654321)');
      expect(authUidIdx).toBeGreaterThan(0);
      expect(lockIdx).toBeGreaterThan(0);
      expect(authUidIdx).toBeLessThan(lockIdx);
    });
  });

  // ── 6. 原子锁机制 ─────────────────────────────────────────

  it('两个 RPC 均使用 pg_advisory_xact_lock 序列化 Admin 写操作', () => {
    const lockCount = (migration.match(/pg_advisory_xact_lock\(987654321\)/g) || []).length;
    expect(lockCount).toBe(2);
  });

  it('使用相同 lock ID 确保两个 RPC 互斥', () => {
    const lockIds = migration.match(/pg_advisory_xact_lock\((\d+)\)/g) || [];
    const ids = lockIds.map(m => m.match(/\((\d+)\)/)![1]);
    expect(new Set(ids).size).toBe(1);
  });

  // ── 7. update_user_role_protected 业务规则 ─────────────────

  describe('update_user_role_protected 业务规则', () => {
    let rpcBody: string;

    beforeAll(() => {
      const start = migration.indexOf('CREATE OR REPLACE FUNCTION update_user_role_protected');
      const end = migration.indexOf('CREATE OR REPLACE FUNCTION toggle_user_active_protected');
      rpcBody = migration.slice(start, end > 0 ? end : undefined);
    });

    it('① 校验新角色存在（SELECT name INTO v_new_role_name FROM role）', () => {
      expect(rpcBody).toContain('SELECT name INTO v_new_role_name FROM public.role WHERE id = p_new_role_id');
      expect(rpcBody).toContain('IF NOT FOUND THEN');
      expect(rpcBody).toContain("RAISE EXCEPTION '所选角色不存在'");
    });

    it('② 自降级保护（p_target_user_id = p_operator_user_id AND v_new_role_name != admin）', () => {
      expect(rpcBody).toContain("p_target_user_id = p_operator_user_id AND v_new_role_name != 'admin'");
      expect(rpcBody).toContain("RAISE EXCEPTION '不允许将自己的角色改为非管理员'");
    });

    it('③ 锁定目标用户行（FOR UPDATE）', () => {
      expect(rpcBody).toContain('FOR UPDATE');
    });

    it('③ 目标用户不存在时 RAISE EXCEPTION', () => {
      expect(rpcBody).toContain("RAISE EXCEPTION '用户不存在'");
    });

    it('④ 最后管理员保护（仅降级管理员时检查）', () => {
      expect(rpcBody).toContain("v_new_role_name != 'admin' AND v_old_role_name = 'admin'");
    });

    it('④ 活跃 admin count <= 1 时拒绝', () => {
      expect(rpcBody).toContain('v_admin_count <= 1');
      expect(rpcBody).toContain("RAISE EXCEPTION '不允许移除最后一个管理员的角色'");
    });

    it('④ countByRole 仅统计活跃用户（is_active = true）', () => {
      expect(rpcBody).toContain('is_active = true');
    });

    it('⑤ 原子写入（UPDATE profiles SET role_id）', () => {
      expect(rpcBody).toContain('UPDATE public.profiles SET role_id = p_new_role_id WHERE id = p_target_user_id');
    });

    it('参数签名正确：p_target_user_id / p_new_role_id / p_operator_user_id', () => {
      expect(rpcBody).toContain('p_target_user_id uuid');
      expect(rpcBody).toContain('p_new_role_id uuid');
      expect(rpcBody).toContain('p_operator_user_id uuid');
    });
  });

  // ── 8. toggle_user_active_protected 业务规则 ──────────────

  describe('toggle_user_active_protected 业务规则', () => {
    let rpcBody: string;

    beforeAll(() => {
      const start = migration.indexOf('CREATE OR REPLACE FUNCTION toggle_user_active_protected');
      const end = migration.indexOf('CREATE OR REPLACE FUNCTION check_operator_profile_update');
      rpcBody = migration.slice(start, end > 0 ? end : undefined);
    });

    it('① 自禁用保护（NOT p_is_active AND p_target_user_id = p_operator_user_id）', () => {
      expect(rpcBody).toContain('NOT p_is_active AND p_target_user_id = p_operator_user_id');
      expect(rpcBody).toContain("RAISE EXCEPTION '不允许禁用自己的账号'");
    });

    it('② 锁定目标用户行（FOR UPDATE）', () => {
      expect(rpcBody).toContain('FOR UPDATE');
    });

    it('② 目标用户不存在时 RAISE EXCEPTION', () => {
      expect(rpcBody).toContain("RAISE EXCEPTION '用户不存在'");
    });

    it('③ 最后管理员保护（仅禁用管理员时检查）', () => {
      expect(rpcBody).toContain("NOT p_is_active AND v_target_role_name = 'admin'");
    });

    it('③ 活跃 admin count <= 1 时拒绝', () => {
      expect(rpcBody).toContain('v_admin_count <= 1');
      expect(rpcBody).toContain("RAISE EXCEPTION '不允许禁用最后一个管理员'");
    });

    it('④ 原子写入（UPDATE profiles SET is_active）', () => {
      expect(rpcBody).toContain('UPDATE public.profiles SET is_active = p_is_active WHERE id = p_target_user_id');
    });

    it('参数签名正确：p_target_user_id / p_is_active / p_operator_user_id', () => {
      expect(rpcBody).toContain('p_target_user_id uuid');
      expect(rpcBody).toContain('p_is_active boolean');
      expect(rpcBody).toContain('p_operator_user_id uuid');
    });
  });

  // ── 9. Trigger：收紧 operator_update_own_profile ──────────

  describe('check_operator_profile_update trigger', () => {
    it('包含 check_operator_profile_update 触发器函数定义', () => {
      expect(migration).toContain('CREATE OR REPLACE FUNCTION check_operator_profile_update');
    });

    it('触发器函数为 SECURITY INVOKER', () => {
      const triggerStart = migration.indexOf('CREATE OR REPLACE FUNCTION check_operator_profile_update');
      const triggerBody = migration.slice(triggerStart);
      expect(triggerBody).toContain('SECURITY INVOKER');
    });

    it('仅拦截 operator（get_user_role() = \'operator\'）', () => {
      expect(migration).toContain("get_user_role() = 'operator'");
    });

    it('禁止 operator 修改 role_id（NEW.role_id IS DISTINCT FROM OLD.role_id）', () => {
      expect(migration).toContain('NEW.role_id IS DISTINCT FROM OLD.role_id');
      expect(migration).toContain("RAISE EXCEPTION '不允许修改自己的角色'");
    });

    it('禁止 operator 修改 is_active（NEW.is_active IS DISTINCT FROM OLD.is_active）', () => {
      expect(migration).toContain('NEW.is_active IS DISTINCT FROM OLD.is_active');
      expect(migration).toContain("RAISE EXCEPTION '不允许修改自己的启用状态'");
    });

    it('创建 BEFORE UPDATE 触发器 trg_check_operator_profile_update', () => {
      expect(migration).toContain('DROP TRIGGER IF EXISTS trg_check_operator_profile_update ON profiles');
      expect(migration).toContain('CREATE TRIGGER trg_check_operator_profile_update');
      expect(migration).toContain('BEFORE UPDATE ON profiles');
      expect(migration).toContain('FOR EACH ROW');
    });

    it('admin 不受 trigger 限制（仅 get_user_role() = \'operator\' 触发）', () => {
      // trigger 函数体内有条件判断，admin 直接 RETURN NEW
      const triggerStart = migration.indexOf('CREATE OR REPLACE FUNCTION check_operator_profile_update');
      const triggerEnd = migration.indexOf('DROP TRIGGER IF EXISTS');
      const triggerBody = migration.slice(triggerStart, triggerEnd > 0 ? triggerEnd : undefined);
      // operator 判断在 IF 内 → admin 走正常 RETURN NEW
      expect(triggerBody).toContain('RETURN NEW');
    });
  });

  // ── 10. 中文错误消息覆盖 ─────────────────────────────────

  it('所有 RAISE EXCEPTION 均使用中文错误消息', () => {
    const exceptions = migration.match(/RAISE EXCEPTION\s+'([^']+)'/g) || [];
    // 00025 新增 4 条（未登录 + 身份校验 + 账号未启用 + 仅管理员）+ 原有 6 条 + trigger 2 条 = 12 条
    expect(exceptions.length).toBeGreaterThanOrEqual(10);
    for (const exc of exceptions) {
      expect(exc).toMatch(/[一-鿿]/);
    }
  });

  // ── 11. SQL 质量 ──────────────────────────────────────────

  it('不包含硬编码的 role ID（使用 SELECT FROM role 查询）', () => {
    expect(migration).toContain("SELECT id FROM public.role WHERE name = 'admin'");
  });

  it('migration 不修改已有表结构（仅 CREATE OR REPLACE FUNCTION + REVOKE/GRANT + TRIGGER）', () => {
    expect(migration).not.toMatch(/ALTER\s+TABLE/i);
    expect(migration).not.toMatch(/CREATE\s+TABLE/i);
    expect(migration).not.toMatch(/CREATE\s+POLICY/i);
  });

  it('不修改已执行 Migration 00024（00025 使用 CREATE OR REPLACE 叠加）', () => {
    // 00025 是对 00024 的安全加固层，通过 CREATE OR REPLACE 叠加
    // 不直接修改 00024 文件
    const m24 = readSrc('supabase/migrations/00024_atomic_user_admin_guard.sql');
    // 00024 不含 auth.uid() 检查（那是 00025 新增的）
    expect(m24).not.toContain('auth.uid()');
    expect(m24).not.toContain('REVOKE EXECUTE');
    expect(m24).not.toContain('GRANT EXECUTE');
  });
});
