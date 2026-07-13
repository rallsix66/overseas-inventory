-- ============================================
-- Migration 00040: 喜运达物流轨迹 API 接入 — Token 缓存表
-- ============================================
-- Stage 1 P0-C
--
-- 新建 provider_token_cache 表，用于安全缓存第三方 API token。
-- 租约模型（两阶段）：抢租约短事务 → 事务外调外部 API → 写回校验所有权。
-- 安全边界：ENABLE RLS + 无 anon/authenticated 策略 → 普通用户不可读写。
-- 仅 service_role / SECURITY DEFINER 函数可访问此表。
--
-- 安全规则（00040 v2）：
--   - authenticated 和 anon 均不得执行 token RPC
--   - provider / lease_id / 写回所有权全部由服务端控制
--   - 首次缓存通过 INSERT 占位行 + 租约避免并发 gettoken 竞态
--   - store_token_with_lease 仅 UPDATE WHERE lease_owner 匹配，无 unsafe INSERT 回退
--
-- 不改动：
--   - 其他任何表或 RLS
--   - 不影响 P1/P7/首页

-- ============================================
-- 1. provider_token_cache 表
-- ============================================

CREATE TABLE public.provider_token_cache (
  provider      text        NOT NULL PRIMARY KEY,
  access_token  text        NOT NULL,
  expires_at    timestamptz NOT NULL,
  lease_owner   uuid,
  lease_until   timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.provider_token_cache
  IS '第三方 API Token 缓存。仅 service_role / SECURITY DEFINER 可读写；普通用户无访问权限。';

COMMENT ON COLUMN public.provider_token_cache.lease_owner
  IS '当前租约持有者 ID（UUID），用于防止并发刷新竞态。获取 token 前抢租约，写回时校验所有权。';

COMMENT ON COLUMN public.provider_token_cache.lease_until
  IS '租约过期时间。持有者应在租约有效期内完成外部 API 调用并写回新 token。';

-- ============================================
-- 2. RLS：仅 service_role / definer 可读写
-- ============================================

ALTER TABLE public.provider_token_cache ENABLE ROW LEVEL SECURITY;

-- 不创建任何 anon/authenticated 策略 → 普通用户完全不可访问
-- 仅 SECURITY DEFINER 函数和 service_role 有访问权限（通过 RLS bypass）

REVOKE ALL ON public.provider_token_cache FROM anon, authenticated;

-- ============================================
-- 3. Token 租约管理函数（SECURITY DEFINER）
-- ============================================

-- 3.1 抢租约：获取 token 或标记刷新意图
--
-- 行为：
--   - 有缓存行 → FOR UPDATE 锁定后判断：token 有效 + 无活跃租约 → reuse
--   - 有缓存行 → 需刷新 + 无活跃租约 → 抢租约并返回 refresh + 旧 token（降级用）
--   - 无缓存行 → INSERT 占位行并设置租约 → 返回 first_time（调用方随后获取 token 并写回）
--   - 租约被他人持有 → 返回 lease_held_by_other（调用方应等待重试）
--
-- 首次缓存并发保护：
--   INSERT ... ON CONFLICT (provider) DO NOTHING，成功后即持有租约。
--   INSERT 冲突时（并发竞争失败方）→ 回退 FOR UPDATE 读取 → 检查他人租约状态。
CREATE OR REPLACE FUNCTION public.acquire_token_lease(
  p_provider   text,
  p_lease_id   uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
SECURITY DEFINER
AS $$
DECLARE
  v_row           record;
  v_now           timestamptz := now();
  v_needs_refresh boolean := false;
BEGIN
  -- 查现有缓存行并锁定
  SELECT * INTO v_row
  FROM public.provider_token_cache
  WHERE provider = p_provider
  FOR UPDATE;

  IF FOUND THEN
    -- 判断是否需要刷新：expires_at - 5min > now 且无他人活跃租约
    IF v_row.expires_at - interval '5 minutes' > v_now
       AND (v_row.lease_until IS NULL OR v_row.lease_until < v_now)
    THEN
      -- Token 仍有效且无活跃租约 → 直接返回
      RETURN jsonb_build_object(
        'access_token', v_row.access_token,
        'expires_at', v_row.expires_at,
        'action', 'reuse'
      );
    END IF;

    -- Token 需刷新 → 尝试抢租约
    IF v_row.lease_until IS NULL OR v_row.lease_until < v_now THEN
      UPDATE public.provider_token_cache
      SET lease_owner = p_lease_id,
          lease_until = v_now + interval '30 seconds',
          updated_at = v_now
      WHERE provider = p_provider;

      v_needs_refresh := true;
    END IF;

    RETURN jsonb_build_object(
      'access_token', CASE WHEN v_needs_refresh THEN v_row.access_token ELSE NULL END,
      'expires_at', v_row.expires_at,
      'action', CASE WHEN v_needs_refresh THEN 'refresh' ELSE 'lease_held_by_other' END
    );
  ELSE
    -- 无缓存行 → 首次写入：INSERT 占位行并获取租约
    -- 并发保护：ON CONFLICT DO NOTHING，仅一个调用方能成功
    INSERT INTO public.provider_token_cache (provider, access_token, expires_at, lease_owner, lease_until)
    VALUES (p_provider, '__LEASE_PLACEHOLDER__', v_now, p_lease_id, v_now + interval '30 seconds')
    ON CONFLICT (provider) DO NOTHING;

    -- 检查是否拿到租约
    SELECT * INTO v_row
    FROM public.provider_token_cache
    WHERE provider = p_provider
      AND lease_owner = p_lease_id;

    IF FOUND THEN
      -- 成功获取首次租约
      RETURN jsonb_build_object(
        'access_token', NULL,
        'expires_at', NULL,
        'action', 'first_time'
      );
    END IF;

    -- 并发失败方 → 重新读取他人状态
    SELECT * INTO v_row
    FROM public.provider_token_cache
    WHERE provider = p_provider
    FOR UPDATE;

    -- 他人持有活跃租约 → 等待
    IF v_row.lease_until IS NOT NULL AND v_row.lease_until >= v_now THEN
      RETURN jsonb_build_object(
        'access_token', NULL,
        'expires_at', v_row.expires_at,
        'action', 'lease_held_by_other'
      );
    END IF;

    -- 他人租约已过期（异常情况）→ 尝试重新获取
    UPDATE public.provider_token_cache
    SET lease_owner = p_lease_id,
        lease_until = v_now + interval '30 seconds',
        updated_at = v_now
    WHERE provider = p_provider;

    RETURN jsonb_build_object(
      'access_token', v_row.access_token,
      'expires_at', v_row.expires_at,
      'action', 'refresh'
    );
  END IF;
END;
$$;

-- 3.2 写回 token（校验 lease_owner 所有权）
--
-- 仅 UPDATE WHERE lease_owner = p_lease_id（严格所有权校验）。
-- 无 INSERT 回退 — 行必须已由 acquire_token_lease 创建（含占位行）。
-- 更新成功后清除租约信息。
CREATE OR REPLACE FUNCTION public.store_token_with_lease(
  p_provider     text,
  p_access_token text,
  p_expires_at   timestamptz,
  p_lease_id     uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.provider_token_cache
  SET access_token = p_access_token,
      expires_at   = p_expires_at,
      lease_owner  = NULL,
      lease_until  = NULL,
      updated_at   = now()
  WHERE provider = p_provider
    AND lease_owner = p_lease_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Token 写回失败：租约所有权校验不通过（provider=%，lease_id=%）',
      p_provider, p_lease_id
      USING HINT = 'LEASE_OWNERSHIP_LOST';
  END IF;
END;
$$;

-- 3.3 释放租约（刷新失败时调用，不覆盖 token）
CREATE OR REPLACE FUNCTION public.release_token_lease(
  p_provider text,
  p_lease_id uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.provider_token_cache
  SET lease_owner = NULL,
      lease_until = NULL,
      updated_at  = now()
  WHERE provider = p_provider
    AND lease_owner = p_lease_id;
END;
$$;

-- ============================================
-- 4. REVOKE/GRANT 权限收口
-- ============================================
-- 安全：
--   - PUBLIC / anon / authenticated 不得执行 token RPC
--   - 仅 service_role 显式授权执行
--   - SECURITY DEFINER 函数 owner 为 migration 执行者（superuser）
--   - SupabaseTokenCache（服务端 service_role client）调用 RPC + RLS bypass

REVOKE EXECUTE ON FUNCTION public.acquire_token_lease(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_token_lease(text, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.store_token_with_lease(text, text, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_token_with_lease(text, text, timestamptz, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.release_token_lease(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_token_lease(text, uuid) TO service_role;
