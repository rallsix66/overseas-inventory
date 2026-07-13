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
  v_row         record;
  v_now         timestamptz := now();
  v_needs_refresh boolean := false;
BEGIN
  -- 查现有缓存行并锁定
  SELECT * INTO v_row
  FROM public.provider_token_cache
  WHERE provider = p_provider
  FOR UPDATE;

  IF FOUND THEN
    -- 判断是否需要刷新：expires_at - 5min > now 且无他人租约
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
    -- 无缓存行 → 需要首次写入，先不在此处 INSERT（留待写回阶段）
    RETURN jsonb_build_object(
      'access_token', NULL,
      'expires_at', NULL,
      'action', 'first_time'
    );
  END IF;
END;
$$;

-- 3.2 写回 token（校验 lease_owner 所有权）
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
  -- 尝试 UPDATE（需 lease_owner 匹配）
  UPDATE public.provider_token_cache
  SET access_token = p_access_token,
      expires_at   = p_expires_at,
      lease_owner  = NULL,
      lease_until  = NULL,
      updated_at   = now()
  WHERE provider = p_provider
    AND lease_owner = p_lease_id;

  IF NOT FOUND THEN
    -- 没有租约 → 可能已被他人抢占或首次写入 → INSERT ON CONFLICT DO NOTHING
    INSERT INTO public.provider_token_cache (provider, access_token, expires_at)
    VALUES (p_provider, p_access_token, p_expires_at)
    ON CONFLICT (provider) DO NOTHING;
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

REVOKE EXECUTE ON FUNCTION public.acquire_token_lease(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acquire_token_lease(text, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.store_token_with_lease(text, text, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_token_with_lease(text, text, timestamptz, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.release_token_lease(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_token_lease(text, uuid) TO authenticated;
