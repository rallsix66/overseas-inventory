-- OPT-4 forward repair.
--
-- Production is missing the still-required system claim RPC from historical
-- migration 00010. Staging also retains the obsolete global archive columns
-- from 00011 even though 00012 replaced that model with per-user preferences.
-- This migration converges both environments without replaying either old file.

CREATE OR REPLACE FUNCTION public.claim_sync_run_system(
  p_warehouse_id         uuid,
  p_mode                 text,
  p_run_id               uuid,
  p_lease_duration       integer,
  p_triggered_by         uuid,
  p_triggered_from       text,
  p_input_artifact_hash  text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_wh_type      text;
  v_wh_active    boolean;
  v_in_progress  uuid;
  v_locked_by    uuid;
  v_lease_exp    timestamptz;
  v_now          timestamptz;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.role r ON r.id = p.role_id
    WHERE p.id = p_triggered_by
      AND p.is_active = true
      AND r.name = 'admin'
  ) THEN
    RAISE EXCEPTION '系统触发用户无效：必须是存在的激活管理员 (id=%)', p_triggered_by
      USING ERRCODE = 'P0001';
  END IF;

  IF p_warehouse_id IS NULL THEN
    RAISE EXCEPTION '无效的仓库 ID' USING ERRCODE = 'P0001';
  END IF;

  IF p_mode != 'dry_run' THEN
    RAISE EXCEPTION '系统路径仅允许 dry_run 模式，实际: %', p_mode USING ERRCODE = 'P0001';
  END IF;

  IF p_run_id IS NULL THEN
    RAISE EXCEPTION '无效的运行 ID' USING ERRCODE = 'P0001';
  END IF;

  IF p_lease_duration IS NULL OR p_lease_duration < 30 OR p_lease_duration > 900 THEN
    RAISE EXCEPTION 'lease_duration 必须在 [30, 900] 范围内，收到: %', p_lease_duration
      USING ERRCODE = 'P0001';
  END IF;

  IF p_triggered_from NOT IN ('web', 'cli') THEN
    RAISE EXCEPTION '无效的触发来源: %', p_triggered_from USING ERRCODE = 'P0001';
  END IF;

  SELECT type, is_active
  INTO v_wh_type, v_wh_active
  FROM public.warehouse
  WHERE id = p_warehouse_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Warehouse 不存在: %', p_warehouse_id USING ERRCODE = 'P0001';
  END IF;

  IF v_wh_type != 'overseas' THEN
    RAISE EXCEPTION 'Warehouse 类型必须为 overseas，实际: %', v_wh_type
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT v_wh_active THEN
    RAISE EXCEPTION 'Warehouse 已停用: %', p_warehouse_id USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('sync_run:' || p_warehouse_id));

  SELECT swl.locked_by
  INTO v_locked_by
  FROM public.sync_warehouse_lock swl
  WHERE swl.warehouse_id = p_warehouse_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sync_warehouse_lock 行不存在: %', p_warehouse_id
      USING ERRCODE = 'P0001';
  END IF;

  SELECT id, lease_expires_at
  INTO v_in_progress, v_lease_exp
  FROM public.sync_run
  WHERE warehouse_id = p_warehouse_id
    AND status = 'in_progress'
  FOR UPDATE;

  v_now := clock_timestamp();

  IF FOUND THEN
    IF v_lease_exp IS NOT NULL AND v_lease_exp < v_now THEN
      UPDATE public.sync_run
      SET status          = 'failed',
          exit_code       = 2,
          error_message   = '租约过期，自动清理（被新 claim 回收）',
          finished_at     = v_now
      WHERE id = v_in_progress;

      UPDATE public.sync_warehouse_lock
      SET locked_by = NULL, locked_at = NULL
      WHERE warehouse_id = p_warehouse_id
        AND locked_by = v_in_progress;
    ELSE
      RETURN NULL;
    END IF;
  END IF;

  INSERT INTO public.sync_run (
    id, warehouse_id, mode, status,
    triggered_by, triggered_from,
    started_at, heartbeat_at, created_at,
    dry_run_run_id,
    input_artifact_hash, plan_artifact_hash,
    locked_by, lease_expires_at
  ) VALUES (
    p_run_id, p_warehouse_id, p_mode, 'in_progress',
    p_triggered_by, p_triggered_from,
    v_now, v_now, v_now,
    NULL,
    p_input_artifact_hash, NULL,
    p_run_id, v_now + (p_lease_duration || ' seconds')::interval
  );

  UPDATE public.sync_warehouse_lock
  SET locked_by = p_run_id, locked_at = v_now
  WHERE warehouse_id = p_warehouse_id;

  RETURN p_run_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_sync_run_system(uuid, text, uuid, integer, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_sync_run_system(uuid, text, uuid, integer, uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_sync_run_system(uuid, text, uuid, integer, uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sync_run_system(uuid, text, uuid, integer, uuid, text, text) TO service_role;

DO $$
DECLARE
  v_predicate text;
  v_has_legacy_data boolean;
BEGIN
  SELECT string_agg(
    CASE column_name
      WHEN 'is_archived' THEN format('%I IS TRUE', column_name)
      ELSE format('%I IS NOT NULL', column_name)
    END,
    ' OR '
    ORDER BY column_name
  )
  INTO v_predicate
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'product_variant'
    AND column_name IN ('is_archived', 'archived_at', 'archived_by');

  IF v_predicate IS NOT NULL THEN
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM public.product_variant WHERE %s)',
      v_predicate
    ) INTO v_has_legacy_data;

    IF v_has_legacy_data THEN
      RAISE EXCEPTION
        'OPT-4 refused to drop legacy product_variant archive columns because archive data exists';
    END IF;
  END IF;
END;
$$;

DROP INDEX IF EXISTS public.idx_variant_is_archived;

ALTER TABLE public.product_variant
  DROP CONSTRAINT IF EXISTS product_variant_archived_by_fkey;

ALTER TABLE public.product_variant
  DROP COLUMN IF EXISTS archived_by,
  DROP COLUMN IF EXISTS archived_at,
  DROP COLUMN IF EXISTS is_archived;
