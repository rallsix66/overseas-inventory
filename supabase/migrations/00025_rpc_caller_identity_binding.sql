-- Migration 00025: RPC 调用者身份绑定与权限加固
-- 修复 update_user_role_protected / toggle_user_active_protected
-- 中 p_operator_user_id 未绑定 auth.uid() 的权限缺口。
-- 收紧 operator_update_own_profile 防止 operator 直接修改
-- 自己的 role_id / is_active。
-- SECURITY INVOKER — 所有函数均通过 RLS 保护。

-- ═══════════════════════════════════════════════════════════
-- Part A: REVOKE + GRANT 权限加固
-- 默认 PUBLIC 有 EXECUTE 权限，必须显式收回。
-- ═══════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION update_user_role_protected FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION toggle_user_active_protected FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION update_user_role_protected TO authenticated;
GRANT EXECUTE ON FUNCTION toggle_user_active_protected TO authenticated;

-- ═══════════════════════════════════════════════════════════
-- Part B: CREATE OR REPLACE update_user_role_protected
-- 新增：auth.uid() 身份绑定 + 调用者活跃 Admin 校验
-- 保留：pg_advisory_xact_lock + FOR UPDATE + 全部业务规则
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
  v_caller_role_name text;
  v_caller_is_active boolean;
  v_new_role_name text;
  v_old_role_name text;
  v_admin_count bigint;
BEGIN
  -- ⑩ 调用者身份绑定：必须已登录
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '未登录，请先登录';
  END IF;

  -- ⑩ 调用者身份绑定：auth.uid() 必须与 p_operator_user_id 一致
  IF auth.uid() != p_operator_user_id THEN
    RAISE EXCEPTION '操作者身份校验失败';
  END IF;

  -- ⑩ 调用者必须是活跃 Admin
  SELECT r.name, p.is_active INTO v_caller_role_name, v_caller_is_active
  FROM public.profiles p
  JOIN public.role r ON r.id = p.role_id
  WHERE p.id = auth.uid();

  IF NOT FOUND OR v_caller_is_active IS NOT TRUE THEN
    RAISE EXCEPTION '账号未启用或不存在，请联系管理员';
  END IF;

  IF v_caller_role_name != 'admin' THEN
    RAISE EXCEPTION '仅管理员可执行此操作';
  END IF;

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
-- Part C: CREATE OR REPLACE toggle_user_active_protected
-- 新增：auth.uid() 身份绑定 + 调用者活跃 Admin 校验
-- 保留：pg_advisory_xact_lock + FOR UPDATE + 全部业务规则
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
  v_caller_role_name text;
  v_caller_is_active boolean;
  v_target_role_name text;
  v_admin_count bigint;
BEGIN
  -- ⑩ 调用者身份绑定：必须已登录
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '未登录，请先登录';
  END IF;

  -- ⑩ 调用者身份绑定：auth.uid() 必须与 p_operator_user_id 一致
  IF auth.uid() != p_operator_user_id THEN
    RAISE EXCEPTION '操作者身份校验失败';
  END IF;

  -- ⑩ 调用者必须是活跃 Admin
  SELECT r.name, p.is_active INTO v_caller_role_name, v_caller_is_active
  FROM public.profiles p
  JOIN public.role r ON r.id = p.role_id
  WHERE p.id = auth.uid();

  IF NOT FOUND OR v_caller_is_active IS NOT TRUE THEN
    RAISE EXCEPTION '账号未启用或不存在，请联系管理员';
  END IF;

  IF v_caller_role_name != 'admin' THEN
    RAISE EXCEPTION '仅管理员可执行此操作';
  END IF;

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

-- ═══════════════════════════════════════════════════════════
-- Part D: 收紧 operator_update_own_profile
-- 禁止 operator 通过 UPDATE 直接修改自己的 role_id / is_active。
-- 原有 RLS policy 的 WITH CHECK 中 get_user_role() 读取的是
-- 当前已提交行，无法阻止 operator 在 NEW 行中修改 role_id。
-- 使用 BEFORE UPDATE 触发器逐行比较 OLD vs NEW 解决此问题。
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION check_operator_profile_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  -- 仅拦截 operator；admin 不受限制
  IF get_user_role() = 'operator' THEN
    IF NEW.role_id IS DISTINCT FROM OLD.role_id THEN
      RAISE EXCEPTION '不允许修改自己的角色';
    END IF;
    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      RAISE EXCEPTION '不允许修改自己的启用状态';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_operator_profile_update ON profiles;
CREATE TRIGGER trg_check_operator_profile_update
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION check_operator_profile_update();
