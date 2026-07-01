-- Migration 00024: 原子化用户角色变更与状态切换保护
-- 修复 updateUserRole / toggleUserActive 中
-- 「最后活跃管理员保护」的 TOCTOU 竞态条件。
-- 使用 pg_advisory_xact_lock 序列化 Admin 写操作，
-- 将业务规则检查与写入合并为单个原子事务。
-- SECURITY INVOKER — 通过 RLS 保护，仅 Admin 可写。

-- ═══════════════════════════════════════════════════════════
-- RPC 1: update_user_role_protected
-- 原子化角色变更：自降级保护 + 最后管理员保护 + 写入
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_user_role_protected(
  p_target_user_id uuid,
  p_new_role_id uuid,
  p_operator_user_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_new_role_name text;
  v_old_role_name text;
  v_admin_count bigint;
BEGIN
  -- 序列化 Admin 写操作，消除 TOCTOU 竞态窗口
  PERFORM pg_advisory_xact_lock(987654321);

  -- ① 校验新角色存在
  SELECT name INTO v_new_role_name FROM public.role WHERE id = p_new_role_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '所选角色不存在';
  END IF;

  -- ② 自降级保护：不允许将自己的角色改为非管理员
  IF p_target_user_id = p_operator_user_id AND v_new_role_name != 'admin' THEN
    RAISE EXCEPTION '不允许将自己的角色改为非管理员';
  END IF;

  -- ③ 获取目标用户当前角色（锁定行防止并发修改）
  SELECT r.name INTO v_old_role_name
  FROM public.profiles p
  JOIN public.role r ON r.id = p.role_id
  WHERE p.id = p_target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '用户不存在';
  END IF;

  -- ④ 最后管理员保护：仅当降级管理员时检查
  IF v_new_role_name != 'admin' AND v_old_role_name = 'admin' THEN
    SELECT count(*) INTO v_admin_count
    FROM public.profiles
    WHERE role_id = (SELECT id FROM public.role WHERE name = 'admin')
      AND is_active = true;

    IF v_admin_count <= 1 THEN
      RAISE EXCEPTION '不允许移除最后一个管理员的角色';
    END IF;
  END IF;

  -- ⑤ 原子写入
  UPDATE public.profiles SET role_id = p_new_role_id WHERE id = p_target_user_id;
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- RPC 2: toggle_user_active_protected
-- 原子化状态切换：自禁用保护 + 最后管理员保护 + 写入
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION toggle_user_active_protected(
  p_target_user_id uuid,
  p_is_active boolean,
  p_operator_user_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_target_role_name text;
  v_admin_count bigint;
BEGIN
  -- 序列化 Admin 写操作，消除 TOCTOU 竞态窗口
  PERFORM pg_advisory_xact_lock(987654321);

  -- ① 自禁用保护
  IF NOT p_is_active AND p_target_user_id = p_operator_user_id THEN
    RAISE EXCEPTION '不允许禁用自己的账号';
  END IF;

  -- ② 获取目标用户角色（锁定行防止并发修改）
  SELECT r.name INTO v_target_role_name
  FROM public.profiles p
  JOIN public.role r ON r.id = p.role_id
  WHERE p.id = p_target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '用户不存在';
  END IF;

  -- ③ 最后管理员保护：仅当禁用管理员时检查
  IF NOT p_is_active AND v_target_role_name = 'admin' THEN
    SELECT count(*) INTO v_admin_count
    FROM public.profiles
    WHERE role_id = (SELECT id FROM public.role WHERE name = 'admin')
      AND is_active = true;

    IF v_admin_count <= 1 THEN
      RAISE EXCEPTION '不允许禁用最后一个管理员';
    END IF;
  END IF;

  -- ④ 原子写入
  UPDATE public.profiles SET is_active = p_is_active WHERE id = p_target_user_id;
END;
$$;
