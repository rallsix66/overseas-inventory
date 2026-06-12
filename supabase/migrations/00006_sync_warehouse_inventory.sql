-- ============================================
-- 00006 — 事务型海外库存同步 RPC
-- 单 PostgreSQL 事务内完成 Variant 幂等创建、Inventory 三向写入、
-- Warehouse 改名及全量写后核对。统一快照时间解析与全量一致性校验
-- 在所有业务写入前完成；任一步失败 → RAISE EXCEPTION → 全部回滚。
-- SECURITY INVOKER + SET search_path = '' + public. 限定
-- 仅 service_role 可执行（Python 同步脚本）；浏览器用户无权限
-- ============================================

CREATE OR REPLACE FUNCTION public.sync_warehouse_inventory(
  p_warehouse_id   uuid,
  p_variants       jsonb,   -- [{sku, country, name}], 可空数组
  p_inventory      jsonb,   -- [{sku, country, quantity, last_sync_at}], 必须非空
  p_warehouse_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_wh_country        text;
  v_wh_type           text;
  v_wh_is_active      boolean;
  v_wh_name           text;
  v_dup_keys          jsonb;
  v_variant_count     int;
  v_inv_input_count   int;
  v_item              jsonb;
  v_sku               text;
  v_country           text;
  v_variant_id        uuid;
  v_created           int := 0;
  v_received          int := 0;
  v_inserted          int := 0;
  v_updated           int := 0;
  v_unchanged         int := 0;
  v_current_qty       int;
  v_expected_qty      int;
  v_actual_qty        int;
  v_sync_at           timestamptz;
  v_actual_sync_at    timestamptz;
  v_item_sync_at      timestamptz;
  -- Warehouse 写后核对变量
  v_wh_id_ck          uuid;
  v_wh_country_ck     text;
  v_wh_type_ck        text;
  v_wh_active_ck      boolean;
  v_wh_name_ck        text;
BEGIN
  -- ============================================
  -- 1. 锁定目标 Warehouse 行（串行化同仓并发同步）
  -- ============================================
  SELECT country, type, is_active, name
  INTO v_wh_country, v_wh_type, v_wh_is_active, v_wh_name
  FROM public.warehouse
  WHERE id = p_warehouse_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Warehouse 不存在: %', p_warehouse_id
      USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 2. 校验 Warehouse 属性
  -- ============================================
  IF v_wh_type != 'overseas' THEN
    RAISE EXCEPTION 'Warehouse 类型错误: 期望 overseas, 实际 % (id=%)',
      v_wh_type, p_warehouse_id
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT v_wh_is_active THEN
    RAISE EXCEPTION 'Warehouse 已停用: %', p_warehouse_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Warehouse country 必须为 PH（本任务仅含菲律宾仓；后续仓需对应调整）
  IF v_wh_country != 'PH' THEN
    RAISE EXCEPTION 'Warehouse country 必须为 PH, 实际: %', v_wh_country
      USING ERRCODE = 'P0001';
  END IF;

  -- 当前名称只允许旧名或正式目标名（阻止任意名称写入，杜绝非法改名）
  IF v_wh_name NOT IN ('菲律宾仓', '菲律宾-新创启辰自建仓') THEN
    RAISE EXCEPTION 'Warehouse 名称非法: 当前名=%, 仅允许旧名或正式目标名',
      v_wh_name
      USING ERRCODE = 'P0001';
  END IF;

  -- p_warehouse_name 必须非空且等于正式目标名
  IF p_warehouse_name IS NULL OR p_warehouse_name = '' THEN
    RAISE EXCEPTION 'p_warehouse_name 不能为空' USING ERRCODE = 'P0001';
  END IF;

  IF p_warehouse_name != '菲律宾-新创启辰自建仓' THEN
    RAISE EXCEPTION 'p_warehouse_name 必须为正式目标名, 实际: %', p_warehouse_name
      USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 3. 输入类型校验
  --    p_inventory 为本次来源的完整库存快照（含 unchanged），非仅变化子集
  -- ============================================
  IF p_variants IS NULL OR jsonb_typeof(p_variants) != 'array' THEN
    RAISE EXCEPTION 'p_variants 必须为 JSON 数组' USING ERRCODE = 'P0001';
  END IF;

  IF p_inventory IS NULL OR jsonb_typeof(p_inventory) != 'array' THEN
    RAISE EXCEPTION 'p_inventory 必须为 JSON 数组' USING ERRCODE = 'P0001';
  END IF;

  v_inv_input_count := jsonb_array_length(p_inventory);
  IF v_inv_input_count = 0 THEN
    RAISE EXCEPTION 'p_inventory 不能为空数组（抓取异常或输入错误，不得记录为成功同步）'
      USING ERRCODE = 'P0001';
  END IF;

  v_variant_count := jsonb_array_length(p_variants);

  -- ============================================
  -- 4. 业务键 (sku, country) 去重检测
  --    相同业务键出现两次，无论其他字段是否不同，必须抛错回滚
  --    不使用 jsonb_agg(DISTINCT value)（仅删除整段 JSON 相同记录）
  -- ============================================

  -- 4a. p_variants 按 (sku, country) 检测重复
  IF v_variant_count > 0 THEN
    WITH dup_check AS (
      SELECT
        value->>'sku' AS sku,
        value->>'country' AS country,
        COUNT(*) AS cnt
      FROM jsonb_array_elements(p_variants)
      GROUP BY 1, 2
      HAVING COUNT(*) > 1
    )
    SELECT jsonb_agg(jsonb_build_object(
      'sku', sku, 'country', country, 'count', cnt
    ))
    INTO v_dup_keys
    FROM dup_check;

    IF v_dup_keys IS NOT NULL THEN
      RAISE EXCEPTION 'p_variants 含重复 (sku,country) 业务键: %', v_dup_keys
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 4b. p_inventory 按 (sku, country) 检测重复
  WITH dup_check AS (
    SELECT
      value->>'sku' AS sku,
      value->>'country' AS country,
      COUNT(*) AS cnt
    FROM jsonb_array_elements(p_inventory)
    GROUP BY 1, 2
    HAVING COUNT(*) > 1
  )
  SELECT jsonb_agg(jsonb_build_object(
    'sku', sku, 'country', country, 'count', cnt
  ))
  INTO v_dup_keys
  FROM dup_check;

  IF v_dup_keys IS NOT NULL THEN
    RAISE EXCEPTION 'p_inventory 含重复 (sku,country) 业务键: %', v_dup_keys
      USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 4c. 新 Variant-Inventory 关联完整性校验
  --     每个 p_variants 的 (sku,country) 必须恰好存在于 p_inventory
  --     不要求反向相等：p_inventory 可含已有 Variant 的业务键
  --     任一缺失 → RAISE EXCEPTION 回滚（写入前校验）
  -- ============================================
  IF v_variant_count > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_variants)
    LOOP
      v_sku := v_item->>'sku';
      v_country := v_item->>'country';

      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_inventory) AS inv
        WHERE inv->>'sku' = v_sku AND inv->>'country' = v_country
      ) THEN
        RAISE EXCEPTION '新 Variant 缺少对应 Inventory: sku=%, country=%',
          v_sku, v_country
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END IF;

  -- ============================================
  -- 5. 逐项校验 country 与 Warehouse country 一致 + 字段非空
  --    防止其他国家 Variant/Inventory 被写入 PH Warehouse
  --    任一不符合 → RAISE EXCEPTION 回滚（写入前校验）
  -- ============================================

  -- 5a. p_variants: 逐项校验
  IF v_variant_count > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_variants)
    LOOP
      v_sku := v_item->>'sku';
      v_country := v_item->>'country';

      IF v_sku IS NULL OR v_sku = '' THEN
        RAISE EXCEPTION 'Variant SKU 不能为空' USING ERRCODE = 'P0001';
      END IF;

      IF v_country IS NULL OR v_country = '' THEN
        RAISE EXCEPTION 'Variant country 不能为空 (sku: %)', v_sku
          USING ERRCODE = 'P0001';
      END IF;

      IF v_country != v_wh_country THEN
        RAISE EXCEPTION 'Variant country 必须等于 Warehouse country: variant=%, warehouse=% (sku: %)',
          v_country, v_wh_country, v_sku
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END IF;

  -- 5b. p_inventory: 逐项校验 sku, country, quantity（全部校验在写入前完成）
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_inventory)
  LOOP
    v_sku := v_item->>'sku';
    v_country := v_item->>'country';

    IF v_sku IS NULL OR v_sku = '' THEN
      RAISE EXCEPTION 'Inventory SKU 不能为空' USING ERRCODE = 'P0001';
    END IF;

    IF v_country IS NULL OR v_country = '' THEN
      RAISE EXCEPTION 'Inventory country 不能为空 (sku: %)', v_sku
        USING ERRCODE = 'P0001';
    END IF;

    IF v_country != v_wh_country THEN
      RAISE EXCEPTION 'Inventory country 必须等于 Warehouse country: inventory=%, warehouse=% (sku: %)',
        v_country, v_wh_country, v_sku
        USING ERRCODE = 'P0001';
    END IF;

    -- quantity 严格校验（在任何 Variant/Inventory/Warehouse 写入前完成）
    -- 字段必须存在且非 null、必须为 JSON number、必须为严格整数（拒绝 bool/float/字符串/超大值）、必须 >= 0
    IF v_item->'quantity' IS NULL THEN
      RAISE EXCEPTION 'quantity 不能为 null: sku=%, country=%', v_sku, v_country
        USING ERRCODE = 'P0001';
    END IF;

    IF jsonb_typeof(v_item->'quantity') != 'number' THEN
      RAISE EXCEPTION 'quantity 必须为数字类型（拒绝 %）: sku=%, country=%',
        jsonb_typeof(v_item->'quantity'), v_sku, v_country
        USING ERRCODE = 'P0001';
    END IF;

    BEGIN
      v_expected_qty := (v_item->>'quantity')::int;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'quantity 无法解析为严格整数（拒绝浮点/科学计数/超大值）: sku=%, country=%, 值=%',
        v_sku, v_country, v_item->>'quantity'
        USING ERRCODE = 'P0001';
    END;

    IF v_expected_qty < 0 THEN
      RAISE EXCEPTION 'quantity 不能为负数: sku=%, country=%, quantity=%',
        v_sku, v_country, v_expected_qty
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- ============================================
  -- 6a. 解析统一快照时间（在任何业务写入前完成）
  --     在所有 Variant/Inventory/Warehouse 写入之前，以 p_inventory 首条 last_sync_at
  --     作为本次统一快照时间。后续任一条不同 → RAISE EXCEPTION 回滚（零写入）
  -- ============================================
  BEGIN
    SELECT (value->>'last_sync_at')::timestamptz
    INTO v_sync_at
    FROM jsonb_array_elements(p_inventory)
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION '首条 last_sync_at 无法解析为 timestamptz: %',
      (SELECT value->>'last_sync_at' FROM jsonb_array_elements(p_inventory) LIMIT 1)
      USING ERRCODE = 'P0001';
  END;

  IF v_sync_at IS NULL THEN
    RAISE EXCEPTION '首条 last_sync_at 不能为空' USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 6b. 强制统一快照时间：遍历全部条目校验 last_sync_at 非空、可解析、且等于统一快照时间
  --     在任何 Variant/Inventory/Warehouse 写入前完成全量一致性校验
  --     同一次快照内任一 SKU 的 last_sync_at 与首条不同 → RAISE EXCEPTION 回滚（零写入）
  -- ============================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_inventory)
  LOOP
    BEGIN
      IF v_item->>'last_sync_at' IS NULL OR v_item->>'last_sync_at' = '' THEN
        RAISE EXCEPTION 'last_sync_at 不能为空: sku=%, country=%',
          v_item->>'sku', v_item->>'country'
          USING ERRCODE = 'P0001';
      END IF;

      BEGIN
        v_item_sync_at := (v_item->>'last_sync_at')::timestamptz;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'last_sync_at 无法解析: sku=%, country=%, 值=%',
          v_item->>'sku', v_item->>'country', v_item->>'last_sync_at'
          USING ERRCODE = 'P0001';
      END;

      IF v_item_sync_at != v_sync_at THEN
        RAISE EXCEPTION '同一次快照内 last_sync_at 不一致: sku=%, country=%, 统一时间=%, 本条时间=%',
          v_item->>'sku', v_item->>'country', v_sync_at, v_item_sync_at
          USING ERRCODE = 'P0001';
      END IF;
    END;
  END LOOP;

  -- ============================================
  -- 7. Variant 创建或复用（幂等，仅当有新 Variant 时执行）
  --     统一快照时间已在步骤 6a/6b 完成全量校验，此处可安全写入
  -- ============================================
  IF v_variant_count > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_variants)
    LOOP
      INSERT INTO public.product_variant (sku, country, name, product_id, match_status)
      VALUES (
        v_item->>'sku',
        v_item->>'country',
        v_item->>'name',
        NULL,
        'unmatched'
      )
      ON CONFLICT (sku, country) DO NOTHING;

      IF FOUND THEN
        v_created := v_created + 1;
      END IF;
    END LOOP;
  END IF;

  -- ============================================
  -- 8. 逐 SKU 解析 variant_id + quantity 校验 + 三向分类写入
  --     全部 INSERT / UPDATE / UNCHANGED metadata-only UPDATE 使用统一快照时间 v_sync_at（步骤 6a）
  --     INSERT（新记录）/ UPDATE（quantity 变更）/ UNCHANGED（metadata-only UPDATE 刷新 last_sync_at）
  --     所有 country 已在步骤 5b 中校验
  -- ============================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_inventory)
  LOOP
    v_sku := v_item->>'sku';
    v_country := v_item->>'country';

    -- 事务内解析 variant_id（Variant 创建在步骤 7，此处可见）
    SELECT id INTO v_variant_id
    FROM public.product_variant
    WHERE sku = v_sku AND country = v_country;

    IF NOT FOUND THEN
      RAISE EXCEPTION '无法解析 variant_id: sku=%, country=%', v_sku, v_country
        USING ERRCODE = 'P0001';
    END IF;

    -- quantity 已在步骤 5b 完成严格校验（非 null/数字类型/严格整数/>=0），此处可直接使用
    v_expected_qty := (v_item->>'quantity')::int;

    -- 查询当前 quantity 以判断 INSERT / UPDATE / UNCHANGED
    -- 全部使用统一快照时间 v_sync_at（来自步骤 6a）
    SELECT quantity INTO v_current_qty
    FROM public.inventory
    WHERE variant_id = v_variant_id AND warehouse_id = p_warehouse_id;

    IF NOT FOUND THEN
      -- 新 Inventory 记录
      INSERT INTO public.inventory (variant_id, warehouse_id, quantity, last_sync_at)
      VALUES (v_variant_id, p_warehouse_id, v_expected_qty, v_sync_at);
      v_inserted := v_inserted + 1;
    ELSIF v_current_qty != v_expected_qty THEN
      -- quantity 变更，UPDATE quantity + last_sync_at
      UPDATE public.inventory
      SET quantity = v_expected_qty,
          last_sync_at = v_sync_at
      WHERE variant_id = v_variant_id AND warehouse_id = p_warehouse_id;
      v_updated := v_updated + 1;
    ELSE
      -- quantity 不变，metadata-only UPDATE 刷新 last_sync_at
      -- 仍计入 inventory_unchanged（非 inventory_updated）
      UPDATE public.inventory
      SET last_sync_at = v_sync_at
      WHERE variant_id = v_variant_id AND warehouse_id = p_warehouse_id;
      v_unchanged := v_unchanged + 1;
    END IF;

    v_received := v_received + 1;
  END LOOP;

  -- ============================================
  -- 9. 写入计数核对
  -- ============================================
  IF v_received != v_inv_input_count THEN
    RAISE EXCEPTION 'Inventory 接收数量不匹配: 期望 %, 实际 %',
      v_inv_input_count, v_received
      USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 10. 事务内写后核对：逐 SKU 查询 DB 最终 quantity 和 last_sync_at
  --     使用统一快照时间 v_sync_at（步骤 6a 解析）作为期望 last_sync_at
  --     含 inventory_unchanged 项（确认未被并发修改 + last_sync_at 已刷新）
  --     检测缺失记录、无法解析、quantity 不一致、last_sync_at 不一致
  --     任一差异 → RAISE EXCEPTION 回滚
  -- ============================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_inventory)
  LOOP
    v_sku := v_item->>'sku';
    v_country := v_item->>'country';
    v_expected_qty := (v_item->>'quantity')::int;

    -- 再次解析 variant_id
    SELECT id INTO v_variant_id
    FROM public.product_variant
    WHERE sku = v_sku AND country = v_country;

    IF NOT FOUND THEN
      RAISE EXCEPTION '写后核对: 无法解析 variant_id: sku=%, country=%', v_sku, v_country
        USING ERRCODE = 'P0001';
    END IF;

    -- 查询 Inventory 最终 quantity 和 last_sync_at
    -- 期望 last_sync_at 为统一快照时间 v_sync_at（步骤 6a）
    SELECT quantity, last_sync_at INTO v_actual_qty, v_actual_sync_at
    FROM public.inventory
    WHERE variant_id = v_variant_id AND warehouse_id = p_warehouse_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION '写后核对: 缺失 Inventory 记录: sku=%, country=%, variant_id=%',
        v_sku, v_country, v_variant_id
        USING ERRCODE = 'P0001';
    END IF;

    IF v_actual_qty != v_expected_qty THEN
      RAISE EXCEPTION '写后核对: quantity 不一致: sku=%, country=%, 期望=%, 实际=%',
        v_sku, v_country, v_expected_qty, v_actual_qty
        USING ERRCODE = 'P0001';
    END IF;

    IF v_actual_sync_at IS NULL OR v_actual_sync_at != v_sync_at THEN
      RAISE EXCEPTION '写后核对: last_sync_at 不一致: sku=%, country=%, 期望=%, 实际=%',
        v_sku, v_country, v_sync_at, v_actual_sync_at
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- ============================================
  -- 11. Warehouse 改名（仅当名称不同）
  -- ============================================
  IF v_wh_name != p_warehouse_name THEN
    UPDATE public.warehouse
    SET name = p_warehouse_name
    WHERE id = p_warehouse_id;
  END IF;

  -- ============================================
  -- 12. Warehouse 写后核对：重新核对 id/country/type/is_active/name
  --      任一差异 → RAISE EXCEPTION 回滚
  -- ============================================
  SELECT id, country, type, is_active, name
  INTO v_wh_id_ck, v_wh_country_ck, v_wh_type_ck, v_wh_active_ck, v_wh_name_ck
  FROM public.warehouse
  WHERE id = p_warehouse_id;

  IF v_wh_id_ck IS NULL THEN
    RAISE EXCEPTION '写后核对: Warehouse 记录丢失: %', p_warehouse_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_wh_country_ck != 'PH' THEN
    RAISE EXCEPTION '写后核对: Warehouse country 异常: 期望 PH, 实际 %', v_wh_country_ck
      USING ERRCODE = 'P0001';
  END IF;

  IF v_wh_type_ck != 'overseas' THEN
    RAISE EXCEPTION '写后核对: Warehouse type 异常: 期望 overseas, 实际 %', v_wh_type_ck
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT v_wh_active_ck THEN
    RAISE EXCEPTION '写后核对: Warehouse is_active 异常: 期望 true, 实际 false'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_wh_name_ck != p_warehouse_name THEN
    RAISE EXCEPTION '写后核对: Warehouse name 异常: 期望 %, 实际 %',
      p_warehouse_name, v_wh_name_ck
      USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 13. 返回摘要（含三向分类计数）
  -- ============================================
  RETURN jsonb_build_object(
    'variants_created', v_created,
    'inventory_received', v_received,
    'inventory_inserted', v_inserted,
    'inventory_updated', v_updated,
    'inventory_unchanged', v_unchanged,
    'warehouse_renamed', (v_wh_name != p_warehouse_name)
  );
END;
$$;

-- ============================================
-- 权限收口：仅 service_role 可执行
-- 浏览器用户（anon/authenticated）无执行权限
-- service_role key 仅存在于可信服务端或 CLI
-- ============================================
REVOKE EXECUTE ON FUNCTION public.sync_warehouse_inventory(uuid, jsonb, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_warehouse_inventory(uuid, jsonb, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sync_warehouse_inventory(uuid, jsonb, jsonb, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sync_warehouse_inventory(uuid, jsonb, jsonb, text) TO service_role;

-- ============================================
-- SQL 级测试方案（≥17 场景）
-- 以下为注释形式的验证场景，不执行实际 SQL。
-- 可在 Supabase SQL Editor 中逐场景手动验证。
-- ============================================
--
-- 场景 1: 正常成功（INSERT+UPDATE+UNCHANGED 混合，统一快照时间写入）
--   前置: Warehouse wh-ph-001 存在、type='overseas'、is_active=true、country='PH'、name='菲律宾-新创启辰自建仓'
--   前置: 已有 Variant (WM0005, PH)、Inventory qty=1500
--   前置: 已有 Variant (WM0074, PH)、Inventory qty=21289
--   输入:
--     p_warehouse_id = 'wh-ph-001'
--     p_variants = '[{"sku":"ICEWM0039","country":"PH","name":"防晒乳"}]'
--     p_inventory = '[{"sku":"WM0005","country":"PH","quantity":1691,"last_sync_at":"2026-06-12T12:00:00Z"},{"sku":"WM0074","country":"PH","quantity":21289,"last_sync_at":"2026-06-12T12:00:00Z"},{"sku":"ICEWM0039","country":"PH","quantity":2865,"last_sync_at":"2026-06-12T12:00:00Z"}]'
--     p_warehouse_name = '菲律宾-新创启辰自建仓'
--   预期: 返回摘要 variants_created=1, inventory_received=3, inventory_inserted=1, inventory_updated=1, inventory_unchanged=1
--         ICEWM0039 Variant 创建 + INSERT Inventory; WM0005 UPDATE qty 1500→1691; WM0074 UNCHANGED qty 21289 不变
--         全部 last_sync_at = 2026-06-12T12:00:00Z
--
-- 场景 2: Warehouse 不存在
--   输入: p_warehouse_id = '00000000-0000-0000-0000-000000000000'
--   预期: RAISE EXCEPTION 'Warehouse 不存在'
--
-- 场景 3: Warehouse 类型错误（非 overseas）
--   前置: Warehouse 存在但 type='domestic'
--   预期: RAISE EXCEPTION 'Warehouse 类型错误: 期望 overseas'
--
-- 场景 4: Warehouse 已停用
--   前置: Warehouse 存在但 is_active=false
--   预期: RAISE EXCEPTION 'Warehouse 已停用'
--
-- 场景 5: Warehouse country ≠ PH
--   前置: Warehouse 存在但 country='VN'
--   预期: RAISE EXCEPTION 'Warehouse country 必须为 PH'
--
-- 场景 6: Warehouse 名称非法（非旧名/非正式目标名）
--   前置: Warehouse name='菲律宾-未知仓库'
--   预期: RAISE EXCEPTION 'Warehouse 名称非法'
--
-- 场景 7: p_warehouse_name 为空
--   输入: p_warehouse_name = ''
--   预期: RAISE EXCEPTION 'p_warehouse_name 不能为空'
--
-- 场景 8: p_warehouse_name 非正式目标名
--   输入: p_warehouse_name = '菲律宾仓'（旧名，非目标名）
--   预期: RAISE EXCEPTION 'p_warehouse_name 必须为正式目标名'
--
-- 场景 9: p_variants 同 (sku,country) 不同 name
--   输入: p_variants 含两条 sku='WM0005', country='PH'，name 分别为 'A' 和 'B'
--   预期: RAISE EXCEPTION 'p_variants 含重复 (sku,country) 业务键'
--
-- 场景 10: p_inventory 同 (sku,country) 不同 quantity
--   输入: p_inventory 含两条 sku='WM0005', country='PH'，quantity 分别为 100 和 200
--   预期: RAISE EXCEPTION 'p_inventory 含重复 (sku,country) 业务键'
--
-- 场景 11: p_inventory 为空数组
--   输入: p_inventory = '[]'
--   预期: RAISE EXCEPTION 'p_inventory 不能为空数组'
--
-- 场景 12: 新 Variant 缺少对应 Inventory
--   输入: p_variants = '[{"sku":"NEWSKU","country":"PH","name":"新品"}]'
--         p_inventory = '[{"sku":"WM0005","country":"PH","quantity":100,"last_sync_at":"2026-06-12T12:00:00Z"}]'
--   预期: RAISE EXCEPTION '新 Variant 缺少对应 Inventory: sku=NEWSKU, country=PH'
--
-- 场景 13: Variant country ≠ Warehouse country（跨国家输入）
--   输入: p_variants 含 country='VN'
--   预期: RAISE EXCEPTION 'Variant country 必须等于 Warehouse country'
--
-- 场景 14: Inventory country ≠ Warehouse country（跨国家输入）
--   输入: p_inventory 含 country='VN'
--   预期: RAISE EXCEPTION 'Inventory country 必须等于 Warehouse country'
--
-- 场景 15: SKU 无法解析 variant_id
--   输入: p_inventory = '[{"sku":"UNKNOWNSKU","country":"PH","quantity":100,"last_sync_at":"2026-06-12T12:00:00Z"}]'
--   前置: 不存在 sku='UNKNOWNSKU', country='PH' 的 Variant
--   预期: RAISE EXCEPTION '无法解析 variant_id: sku=UNKNOWNSKU, country=PH'
--
-- 场景 16: quantity 负数（步骤 5b，所有写入前校验）
--   输入: p_inventory 含 quantity=-5
--   预期: RAISE EXCEPTION 'quantity 不能为负数'
--
-- 场景 16b: quantity 非严格整数（步骤 5b，所有写入前校验）
--   16b-1: quantity=1.5（float） → RAISE EXCEPTION 'quantity 无法解析为严格整数'
--   16b-2: quantity=true（bool） → RAISE EXCEPTION 'quantity 必须为数字类型'
--   16b-3: quantity="abc"（string） → RAISE EXCEPTION 'quantity 必须为数字类型'
--   16b-4: quantity=9999999999（超出 int 范围） → RAISE EXCEPTION 'quantity 无法解析为严格整数'
--   16b-5: quantity 字段缺失/null → RAISE EXCEPTION 'quantity 不能为 null'
--   预期: 全部在步骤 5b 抛出异常，Variant INSERT（步骤 7）尚未执行，零写入
--
-- 场景 17: last_sync_at 为空
--   输入: p_inventory 含 last_sync_at=null 或 ''
--   预期: RAISE EXCEPTION 'last_sync_at 不能为空'（步骤 6b）
--
-- 场景 18: last_sync_at 无法解析
--   输入: p_inventory 含 last_sync_at='not-a-date'
--   预期: RAISE EXCEPTION 'last_sync_at 无法解析'（步骤 6b）
--
-- 场景 19: 同一快照内 last_sync_at 不一致
--   输入: p_inventory 中 SKU A 的 last_sync_at='2026-06-12T12:00:00Z'，SKU B 的 last_sync_at='2026-06-12T12:01:00Z'
--   预期: RAISE EXCEPTION '同一次快照内 last_sync_at 不一致'（步骤 6b，在任何 Variant/Inventory 写入前校验）
--         Variant INSERT 尚未执行，零写入
--
-- 场景 20: 写后核对缺失 Inventory 记录
--   说明: 模拟极端并发场景（FOR UPDATE 锁已在步骤 1 获取，此场景主要验证核对逻辑完整性）
--   预期: RAISE EXCEPTION '写后核对: 缺失 Inventory 记录'
--
-- 场景 21: 写后核对 quantity 不一致
--   说明: 模拟极端并发修改场景
--   预期: RAISE EXCEPTION '写后核对: quantity 不一致'
--
-- 场景 22: 全部 inventory_unchanged（统一快照时间，quantity 不变、last_sync_at 全部刷新）
--   前置: 已有 Variant (WM0005, PH)、Inventory qty=1691, last_sync_at='2026-06-11T12:00:00Z'
--         已有 Variant (WM0074, PH)、Inventory qty=21289, last_sync_at='2026-06-11T12:00:00Z'
--   输入: p_variants = '[]'
--         p_inventory 含两条，quantity 与 DB 一致，last_sync_at='2026-06-12T12:00:00Z'
--   预期: 返回摘要 inventory_received=2, inventory_unchanged=2, inserted=0, updated=0
--         Inventory quantity 不变（1691, 21289），last_sync_at 全部刷新为 2026-06-12T12:00:00Z
--
-- 场景 23: anon / authenticated 无执行权限
--   说明: 使用 anon key 或 authenticated user 调用 RPC
--   预期: permission denied 错误（REVOKE 生效）
--
-- ============================================
-- Supabase SQL Editor 本地验证步骤
-- ============================================
--
-- 1. 在 Supabase SQL Editor 中执行本 Migration（CREATE OR REPLACE FUNCTION）
-- 2. 逐场景执行以下模式的 SQL，验证返回或错误：
--
--    -- 正常场景模板
--    SELECT public.sync_warehouse_inventory(
--      '<warehouse_id>',
--      '[{"sku":"...","country":"PH","name":"..."}]'::jsonb,
--      '[{"sku":"...","country":"PH","quantity":100,"last_sync_at":"2026-06-12T12:00:00Z"}]'::jsonb,
--      '菲律宾-新创启辰自建仓'
--    );
--
--    -- 错误场景模板（预期抛错）
--    SELECT public.sync_warehouse_inventory(
--      '<warehouse_id>',
--      '[]'::jsonb,
--      '[]'::jsonb,  -- 空数组 → 预期 RAISE EXCEPTION
--      '菲律宾-新创启辰自建仓'
--    );
--
-- 3. 权限验证：
--    -- 使用 service_role key（SQL Editor 默认）→ 可执行
--    -- 使用 anon key（REST API）→ permission denied
--    -- 使用 authenticated user（REST API）→ permission denied
