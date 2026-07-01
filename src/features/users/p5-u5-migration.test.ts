// P4-U5: Migration 00024 静态契约测试 + 安全验收
// 覆盖：RPC 结构、原子锁、业务规则、错误码、权限模型
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readSrc(relativePath: string): string {
  return readFileSync(resolve(relativePath), 'utf-8');
}

describe('P4-U5 Migration 00024 静态契约', () => {
  let migration: string;

  beforeAll(() => {
    migration = readSrc('supabase/migrations/00024_atomic_user_admin_guard.sql');
  });

  // ── 1. RPC 存在性 ──────────────────────────────────────────

  it('包含 update_user_role_protected 函数定义', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION update_user_role_protected');
  });

  it('包含 toggle_user_active_protected 函数定义', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION toggle_user_active_protected');
  });

  // ── 2. 权限模型 ───────────────────────────────────────────

  it('两个 RPC 均为 SECURITY INVOKER（不绕过 RLS）', () => {
    // 统计 SECURITY INVOKER 出现次数（头注释 1 + 每个 RPC 各 1 = 至少 3 次）
    const invokerCount = (migration.match(/SECURITY INVOKER/g) || []).length;
    expect(invokerCount).toBeGreaterThanOrEqual(3);
  });

  it('不包含 SECURITY DEFINER（不提升权限）', () => {
    expect(migration).not.toContain('SECURITY DEFINER');
  });

  // ── 3. 原子锁机制 ─────────────────────────────────────────

  it('两个 RPC 均使用 pg_advisory_xact_lock 序列化 Admin 写操作', () => {
    const lockCount = (migration.match(/pg_advisory_xact_lock\(987654321\)/g) || []).length;
    expect(lockCount).toBe(2);
  });

  it('使用相同 lock ID 确保两个 RPC 互斥', () => {
    // 987654321 在两个 RPC 中一致
    const lockIds = migration.match(/pg_advisory_xact_lock\((\d+)\)/g) || [];
    const ids = lockIds.map(m => m.match(/\((\d+)\)/)![1]);
    expect(new Set(ids).size).toBe(1); // 同一锁 ID
  });

  // ── 4. update_user_role_protected 业务规则 ─────────────────

  describe('update_user_role_protected 规则', () => {
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

  // ── 5. toggle_user_active_protected 业务规则 ──────────────

  describe('toggle_user_active_protected 规则', () => {
    let rpcBody: string;

    beforeAll(() => {
      const start = migration.indexOf('CREATE OR REPLACE FUNCTION toggle_user_active_protected');
      rpcBody = migration.slice(start);
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

  // ── 6. 中文错误消息覆盖 ───────────────────────────────────

  it('所有 RAISE EXCEPTION 均使用中文错误消息', () => {
    const exceptions = migration.match(/RAISE EXCEPTION\s+'([^']+)'/g) || [];
    expect(exceptions.length).toBeGreaterThanOrEqual(6);
    for (const exc of exceptions) {
      // 所有消息应包含中文字符
      expect(exc).toMatch(/[一-鿿]/);
    }
  });

  // ── 7. SQL 质量 ──────────────────────────────────────────

  it('不包含硬编码的 role ID（使用 SELECT FROM role 查询）', () => {
    // count 查询中使用子查询而非硬编码 UUID
    expect(migration).toContain("SELECT id FROM public.role WHERE name = 'admin'");
  });

  it('migration 不修改已有表结构（仅 CREATE OR REPLACE FUNCTION）', () => {
    expect(migration).not.toMatch(/ALTER\s+TABLE/i);
    expect(migration).not.toMatch(/DROP\s+/i);
    expect(migration).not.toMatch(/CREATE\s+TABLE/i);
    expect(migration).not.toMatch(/CREATE\s+POLICY/i);
  });
});
