-- ============================================
-- Migration 00039: 喜运达物流轨迹 API 接入 — RLS + RPC + 触发器
-- ============================================
-- Stage 1 P0-B
--
-- 变更范围：
--   1. 三张外部表 warehouse 级 SELECT RLS（替换旧宽泛策略）
--   2. 三个 SECURITY DEFINER RPC：import_golucky_refs / bind_external_ref_to_shipment / reactivate_external_ref
--   3. shipment 侧换仓保护触发器 tg_shipment_no_rewarehouse_if_bound
--   4. REVOKE/GRANT 权限收口
--
-- 安全规范（对齐 00024/00025 范式）：
--   - SET search_path = ''；所有表名 public. 限定
--   - REVOKE EXECUTE FROM PUBLIC, anon; GRANT EXECUTE TO authenticated
--   - auth.uid() IS NOT NULL 校验
--   - profiles.is_active = true 校验
--   - operator 仅能操作 user_warehouses 授权仓库
--   - RPC 不接收 user_id 参数，身份取自 auth.uid()

-- ============================================
-- 1. RLS 重写：warehouse 级 SELECT
-- ============================================

-- 1.1 shipment_external_ref — 删除旧宽泛策略，改为 warehouse 限定
DROP POLICY IF EXISTS "authenticated_select_shipment_external_ref" ON public.shipment_external_ref;

CREATE POLICY "operator_select_own_warehouse_shipment_external_ref"
  ON public.shipment_external_ref
  FOR SELECT
  USING (
    get_user_role() = 'admin'
    OR (
      get_user_role() = 'operator'
      AND warehouse_id IS NOT NULL
      AND warehouse_id IN (SELECT public.get_assigned_warehouse_ids())
    )
  );

-- 1.2 shipment_external_item — 经父表仓库过滤
DROP POLICY IF EXISTS "authenticated_select_shipment_external_item" ON public.shipment_external_item;

CREATE POLICY "operator_select_own_warehouse_shipment_external_item"
  ON public.shipment_external_item
  FOR SELECT
  USING (
    get_user_role() = 'admin'
    OR (
      get_user_role() = 'operator'
      AND external_ref_id IN (
        SELECT r.id
        FROM public.shipment_external_ref r
        WHERE r.warehouse_id IS NOT NULL
          AND r.warehouse_id IN (SELECT public.get_assigned_warehouse_ids())
      )
    )
  );

-- 1.3 tracking_event_external — 经父表仓库过滤
DROP POLICY IF EXISTS "authenticated_select_tracking_event_external" ON public.tracking_event_external;

CREATE POLICY "operator_select_own_warehouse_tracking_event_external"
  ON public.tracking_event_external
  FOR SELECT
  USING (
    get_user_role() = 'admin'
    OR (
      get_user_role() = 'operator'
      AND external_ref_id IN (
        SELECT r.id
        FROM public.shipment_external_ref r
        WHERE r.warehouse_id IS NOT NULL
          AND r.warehouse_id IN (SELECT public.get_assigned_warehouse_ids())
      )
    )
  );

-- Operator 无 INSERT/UPDATE/DELETE 策略（写入仅走 RPC）

-- ============================================
-- 2. SECURITY DEFINER RPC：import_golucky_refs
-- ============================================
-- 批量导入喜运达运单。整批原子：参数/授权错误整批回滚，无部分成功不知情。

CREATE OR REPLACE FUNCTION public.import_golucky_refs(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
SECURITY DEFINER
AS $$
DECLARE
  v_caller_id       uuid;
  v_caller_role     text;
  v_caller_is_active boolean;
  v_item            jsonb;
  v_waybill_no      text;
  v_external_order_no text;
  v_country          text;
  v_warehouse_id    uuid;
  v_succeeded       integer := 0;
  v_duplicated      integer := 0;
  v_failed          jsonb := '[]'::jsonb;
  v_idx             integer;
  v_item_count      integer;
  v_seen_waybills   text[] := '{}'::text[];
  v_existing_count  integer;
  v_new_id          uuid;
  v_validation_errors jsonb := '[]'::jsonb;
BEGIN
  -- ── 身份校验 ──────────────────────────────────────────
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION '未登录，请先登录后再操作'
      USING HINT = 'AUTH_REQUIRED';
  END IF;

  SELECT p.is_active INTO v_caller_is_active
  FROM public.profiles p
  WHERE p.id = v_caller_id;

  IF NOT FOUND OR v_caller_is_active IS NOT TRUE THEN
    RAISE EXCEPTION '账号已被禁用，无法执行操作'
      USING HINT = 'ACCOUNT_DISABLED';
  END IF;

  v_caller_role := public.get_user_role();

  -- ── 参数格式预检 ───────────────────────────────────────
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION '参数格式错误：p_items 必须为数组';
  END IF;

  v_item_count := jsonb_array_length(p_items);
  IF v_item_count = 0 THEN
    RETURN jsonb_build_object(
      'succeeded', 0,
      'duplicated', 0,
      'failed', '[]'::jsonb
    );
  END IF;

  -- ── 逐项预校验（在写入前完成全量校验） ───────────────────
  FOR v_idx IN 0 .. v_item_count - 1 LOOP
    v_item := p_items -> v_idx;

    -- 字段存在性校验
    IF v_item->>'waybill_no' IS NULL OR trim(v_item->>'waybill_no') = '' THEN
      v_validation_errors := v_validation_errors || jsonb_build_object(
        'index', v_idx,
        'waybill_no', v_item->>'waybill_no',
        'error', '运单号不能为空'
      );
      CONTINUE;
    END IF;

    IF v_item->>'warehouse_id' IS NULL THEN
      v_validation_errors := v_validation_errors || jsonb_build_object(
        'index', v_idx,
        'waybill_no', v_item->>'waybill_no',
        'error', '仓库 ID 不能为空'
      );
      CONTINUE;
    END IF;

    IF v_item->>'country' IS NULL OR trim(v_item->>'country') = '' THEN
      v_validation_errors := v_validation_errors || jsonb_build_object(
        'index', v_idx,
        'waybill_no', v_item->>'waybill_no',
        'error', '国家代码不能为空'
      );
      CONTINUE;
    END IF;

    -- UUID 格式校验
    BEGIN
      v_warehouse_id := (v_item->>'warehouse_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_validation_errors := v_validation_errors || jsonb_build_object(
        'index', v_idx,
        'waybill_no', v_item->>'waybill_no',
        'error', '仓库 ID 格式无效'
      );
      CONTINUE;
    END;

    -- 国家枚举校验
    IF NOT (v_item->>'country' IN ('TH', 'ID', 'MY', 'PH', 'VN', 'CN')) THEN
      v_validation_errors := v_validation_errors || jsonb_build_object(
        'index', v_idx,
        'waybill_no', v_item->>'waybill_no',
        'error', '无效的国家代码：' || (v_item->>'country')
      );
      CONTINUE;
    END IF;

    -- Operator 仓库授权校验
    IF v_caller_role = 'operator' THEN
      IF v_warehouse_id NOT IN (SELECT public.get_assigned_warehouse_ids()) THEN
        v_validation_errors := v_validation_errors || jsonb_build_object(
          'index', v_idx,
          'waybill_no', v_item->>'waybill_no',
          'error', '无权操作此仓库'
        );
        CONTINUE;
      END IF;
    END IF;
  END LOOP;

  -- 有格式/授权错误 → 整批回滚
  IF jsonb_array_length(v_validation_errors) > 0 THEN
    RETURN jsonb_build_object(
      'succeeded', 0,
      'duplicated', 0,
      'failed', v_validation_errors
    );
  END IF;

  -- ── 同批去重 + 写入 ───────────────────────────────────
  FOR v_idx IN 0 .. v_item_count - 1 LOOP
    v_item := p_items -> v_idx;
    v_waybill_no := trim(v_item->>'waybill_no');
    v_external_order_no := NULLIF(trim(v_item->>'external_order_no'), '');
    v_country := v_item->>'country';
    v_warehouse_id := (v_item->>'warehouse_id')::uuid;

    -- 同批内重复
    IF v_waybill_no = ANY(v_seen_waybills) THEN
      v_duplicated := v_duplicated + 1;
      CONTINUE;
    END IF;
    v_seen_waybills := array_append(v_seen_waybills, v_waybill_no);

    -- 写入（ON CONFLICT 处理库内重复）
    SELECT COUNT(*) INTO v_existing_count
    FROM public.shipment_external_ref
    WHERE provider = 'golucky'
      AND waybill_no = v_waybill_no;

    IF v_existing_count > 0 THEN
      -- 已存在：更新 raw_payload，重置异常状态
      UPDATE public.shipment_external_ref
      SET raw_payload = COALESCE(v_item->'raw_payload', '{}'::jsonb),
          sync_status = CASE
            WHEN sync_status IN ('error', 'stale') THEN 'active'
            ELSE sync_status
          END,
          updated_at = now()
      WHERE provider = 'golucky'
        AND waybill_no = v_waybill_no;

      v_duplicated := v_duplicated + 1;
    ELSE
      INSERT INTO public.shipment_external_ref (
        provider,
        external_order_no,
        waybill_no,
        country,
        warehouse_id,
        raw_payload,
        sync_status
      ) VALUES (
        'golucky',
        v_external_order_no,
        v_waybill_no,
        v_country,
        v_warehouse_id,
        COALESCE(v_item->'raw_payload', '{}'::jsonb),
        'active'
      )
      RETURNING id INTO v_new_id;

      v_succeeded := v_succeeded + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'succeeded', v_succeeded,
    'duplicated', v_duplicated,
    'failed', '[]'::jsonb
  );
END;
$$;

-- ============================================
-- 3. SECURITY DEFINER RPC：bind_external_ref_to_shipment
-- ============================================

CREATE OR REPLACE FUNCTION public.bind_external_ref_to_shipment(
  p_ref_id       uuid,
  p_shipment_id  uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
SECURITY DEFINER
AS $$
DECLARE
  v_caller_id         uuid;
  v_caller_role       text;
  v_caller_is_active  boolean;
  v_ref               record;
  v_shipment          record;
BEGIN
  -- ── 身份校验 ──────────────────────────────────────────
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION '未登录，请先登录后再操作'
      USING HINT = 'AUTH_REQUIRED';
  END IF;

  SELECT p.is_active INTO v_caller_is_active
  FROM public.profiles p
  WHERE p.id = v_caller_id;

  IF NOT FOUND OR v_caller_is_active IS NOT TRUE THEN
    RAISE EXCEPTION '账号已被禁用，无法执行操作'
      USING HINT = 'ACCOUNT_DISABLED';
  END IF;

  v_caller_role := public.get_user_role();

  -- ── 读取 external_ref（FOR UPDATE 行锁，防止并发绑定） ──
  SELECT * INTO v_ref
  FROM public.shipment_external_ref
  WHERE id = p_ref_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '外部物流记录不存在'
      USING HINT = 'NOT_FOUND';
  END IF;

  -- ── 读取 shipment ──────────────────────────────────────
  SELECT * INTO v_shipment
  FROM public.shipment
  WHERE id = p_shipment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shipment 不存在'
      USING HINT = 'SHIPMENT_NOT_FOUND';
  END IF;

  -- ── 权限校验 ───────────────────────────────────────────
  -- Admin 全量；Operator 仅限已分配仓库
  IF v_caller_role = 'operator' THEN
    IF v_ref.warehouse_id NOT IN (SELECT public.get_assigned_warehouse_ids()) THEN
      RAISE EXCEPTION '无权操作该外部物流记录'
        USING HINT = 'FORBIDDEN_WAREHOUSE';
    END IF;
  END IF;

  -- ── 业务规则校验 ───────────────────────────────────────
  -- 已绑定校验（在行锁保护下判断）
  IF v_ref.shipment_id IS NOT NULL THEN
    RAISE EXCEPTION '该外部物流记录已绑定 Shipment（%），请先解绑后再操作', v_ref.shipment_id
      USING HINT = 'ALREADY_BOUND';
  END IF;

  -- 仓库一致性
  IF v_ref.warehouse_id IS DISTINCT FROM v_shipment.warehouse_id THEN
    RAISE EXCEPTION '外部物流记录仓库与 Shipment 仓库不一致，无法绑定'
      USING HINT = 'WAREHOUSE_MISMATCH';
  END IF;

  -- 国家一致性
  IF v_ref.country IS DISTINCT FROM v_shipment.country THEN
    RAISE EXCEPTION '外部物流记录国家（%）与 Shipment 国家（%）不一致，无法绑定',
      v_ref.country, v_shipment.country
      USING HINT = 'COUNTRY_MISMATCH';
  END IF;

  -- ── 写入绑定（再次校验 shipment_id IS NULL，防止 TOCTOU） ──
  UPDATE public.shipment_external_ref
  SET shipment_id = p_shipment_id,
      warehouse_id = v_shipment.warehouse_id,
      updated_at   = now()
  WHERE id = p_ref_id
    AND shipment_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION '该外部物流记录已被其他操作绑定，无法重复绑定'
      USING HINT = 'CONCURRENT_BINDING';
  END IF;
END;
$$;

-- ============================================
-- 4. SECURITY DEFINER RPC：reactivate_external_ref
-- ============================================

CREATE OR REPLACE FUNCTION public.reactivate_external_ref(p_ref_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
SECURITY DEFINER
AS $$
DECLARE
  v_caller_id         uuid;
  v_caller_role       text;
  v_caller_is_active  boolean;
  v_warehouse_id      uuid;
BEGIN
  -- ── 身份校验 ──────────────────────────────────────────
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION '未登录，请先登录后再操作'
      USING HINT = 'AUTH_REQUIRED';
  END IF;

  SELECT p.is_active INTO v_caller_is_active
  FROM public.profiles p
  WHERE p.id = v_caller_id;

  IF NOT FOUND OR v_caller_is_active IS NOT TRUE THEN
    RAISE EXCEPTION '账号已被禁用，无法执行操作'
      USING HINT = 'ACCOUNT_DISABLED';
  END IF;

  v_caller_role := public.get_user_role();

  -- ── 存在性 + 仓库权限 ──────────────────────────────────
  SELECT warehouse_id INTO v_warehouse_id
  FROM public.shipment_external_ref
  WHERE id = p_ref_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '外部物流记录不存在'
      USING HINT = 'NOT_FOUND';
  END IF;

  IF v_caller_role = 'operator' THEN
    IF v_warehouse_id NOT IN (SELECT public.get_assigned_warehouse_ids()) THEN
      RAISE EXCEPTION '无权操作该外部物流记录'
        USING HINT = 'FORBIDDEN_WAREHOUSE';
    END IF;
  END IF;

  -- ── 重激活：sync_status error/stale → active ─────────────
  UPDATE public.shipment_external_ref
  SET sync_status = 'active',
      updated_at = now()
  WHERE id = p_ref_id
    AND sync_status IN ('error', 'stale');

  IF NOT FOUND THEN
    RAISE EXCEPTION '仅可重激活状态为 error 或 stale 的记录'
      USING HINT = 'INVALID_STATUS';
  END IF;
END;
$$;

-- ============================================
-- 5. REVOKE/GRANT 权限收口
-- ============================================

REVOKE EXECUTE ON FUNCTION public.import_golucky_refs(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_golucky_refs(jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.bind_external_ref_to_shipment(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bind_external_ref_to_shipment(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.reactivate_external_ref(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reactivate_external_ref(uuid) TO authenticated;

-- ============================================
-- 6. Shipment 侧换仓保护触发器
-- ============================================
-- 已绑定 external_ref 的 shipment，禁止修改 warehouse_id。
-- 与 external_ref 侧的仓库锁（00038）构成双保险。

CREATE OR REPLACE FUNCTION public.fn_shipment_no_rewarehouse_if_bound()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.warehouse_id IS DISTINCT FROM NEW.warehouse_id
     AND EXISTS (
       SELECT 1 FROM public.shipment_external_ref
       WHERE shipment_id = NEW.id
     )
  THEN
    RAISE EXCEPTION
      '该 Shipment 已绑定外部物流记录，P0 不支持换仓';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_shipment_no_rewarehouse_if_bound
  ON public.shipment;

CREATE TRIGGER tg_shipment_no_rewarehouse_if_bound
  BEFORE UPDATE OF warehouse_id ON public.shipment
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_shipment_no_rewarehouse_if_bound();
