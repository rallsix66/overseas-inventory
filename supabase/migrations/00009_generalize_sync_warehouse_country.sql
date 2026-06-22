-- ============================================
-- 00009 — 泛化 sync_warehouse_inventory 以支持多仓库国家
-- 移除 00006 中硬编码的 PH-only country/name 校验，
-- 替换为通用 overseas 仓库校验（动态匹配仓库当前国家与名称）。
-- CREATE OR REPLACE 不改变函数签名、返回类型和权限收口。
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

  -- (已移除硬编码 country='PH' 校验 — overseas 类型已足够限定海外仓范围)

  -- 当前名称必须非空（阻止意外写入未初始化仓库）
  IF v_wh_name IS NULL OR v_wh_name = '' THEN
    RAISE EXCEPTION 'Warehouse 名称不能为空: %', p_warehouse_id
      USING ERRCODE = 'P0001';
  END IF;

  -- p_warehouse_name 必须非空
  IF p_warehouse_name IS NULL OR p_warehouse_name = '' THEN
    RAISE EXCEPTION 'p_warehouse_name 不能为空' USING ERRCODE = 'P0001';
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
  --    防止其他国家 Variant/Inventory 被写入错误 Warehouse
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
  --     country 校验使用仓库锁定时的原始 country（v_wh_country），
  --     不再硬编码 'PH'
  --     任一差异 → RAISE EXCEPTION 回滚
  -- ============================================
  SELECT id, country, type, is_active, name
  INTO v_wh_id_ck, v_wh_country_ck, v_wh_type_ck, v_wh_active_ck, v_wh_name_ck
  FROM public.warehouse
  WHERE id = p_warehouse_id;

  IF v_wh_id_ck IS NULL THEN
    RAISE EXCEPTION '写后核对: Warehouse 记录丢失: %', p_warehouse_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_wh_country_ck != v_wh_country THEN
    RAISE EXCEPTION '写后核对: Warehouse country 异常: 期望 %, 实际 %',
      v_wh_country, v_wh_country_ck
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
-- 权限收口：仅 service_role 可执行（与 00006 一致）
-- ============================================
REVOKE EXECUTE ON FUNCTION public.sync_warehouse_inventory(uuid, jsonb, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_warehouse_inventory(uuid, jsonb, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sync_warehouse_inventory(uuid, jsonb, jsonb, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sync_warehouse_inventory(uuid, jsonb, jsonb, text) TO service_role;
