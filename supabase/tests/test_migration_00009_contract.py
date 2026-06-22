"""
P5-SY8B 返工 — Migration 00009 静态 SQL 契约测试

仅静态分析 SQL 文本，不连接 Supabase，不执行 Migration。

验证:
  a) CREATE OR REPLACE FUNCTION public.sync_warehouse_inventory 签名不变
  b) 不再存在硬编码 country='PH' / Warehouse country 必须为 PH 的业务校验
  c) p_variants 每项 country 必须等于锁定 warehouse.country
  d) p_inventory 每项 country 必须等于锁定 warehouse.country
  e) warehouse 必须 FOR UPDATE，type='overseas'，is_active=true，name 非空
  f) p_warehouse_name 非空
  g) 写入前完成重复键、country、quantity、last_sync_at 校验
  h) REVOKE PUBLIC/anon/authenticated + GRANT service_role 保持不变
"""

import os
import re

MIGRATION_PATH = os.path.join(
    os.path.dirname(__file__), "..", "migrations",
    "00009_generalize_sync_warehouse_country.sql"
)


def read_migration():
    with open(MIGRATION_PATH, "r", encoding="utf-8") as f:
        return f.read()


def _func_body(sql, func_name="sync_warehouse_inventory"):
    marker = f"CREATE OR REPLACE FUNCTION public.{func_name}"
    parts = sql.split(marker)
    if len(parts) < 2:
        raise AssertionError(f"未找到函数声明: {func_name}")
    body_and_rest = parts[1]
    as_parts = body_and_rest.split("AS $$", 1)
    if len(as_parts) < 2:
        raise AssertionError(f"{func_name}: 未找到 AS $$ body")
    body = as_parts[1]
    if "$$;" in body:
        body = body.split("$$;")[0]
    elif "$$" in body:
        body = body.split("$$")[0]
    return body


def _extract_step(sql, step_label):
    """Extract text between two '-- =====...' markers."""
    lines = sql.split("\n")
    capturing = False
    captured = []
    for line in lines:
        if step_label in line and "====" in line:
            capturing = True
            continue
        if capturing:
            if "====" in line and "--" in line:
                break
            captured.append(line)
    return "\n".join(captured)


# ============================================================
# (a) 函数签名不变
# ============================================================

def test_a_signature_unchanged():
    sql = read_migration()

    # 函数名与参数（宽松匹配，不依赖精确空白）
    assert "CREATE OR REPLACE FUNCTION public.sync_warehouse_inventory" in sql
    assert "p_warehouse_id" in sql and "uuid" in sql
    assert "p_variants" in sql and "jsonb" in sql
    assert "p_inventory" in sql and "jsonb" in sql
    assert "p_warehouse_name" in sql and "text" in sql
    assert "RETURNS jsonb" in sql

    assert "LANGUAGE plpgsql" in sql
    assert "SECURITY INVOKER" in sql
    assert "SET search_path = ''" in sql
    print("  [PASS] test_a_signature_unchanged")


# ============================================================
# (b) 不再存在硬编码 country='PH' / 必须为 PH 的业务校验
# ============================================================

def test_b_no_hardcoded_ph_country_check():
    sql = read_migration()
    body = _func_body(sql)

    # 移除 SQL 注释行（-- 开头的行），仅检查可执行代码
    non_comment_lines = [
        line for line in body.split("\n")
        if not line.strip().startswith("--")
    ]
    executable_body = "\n".join(non_comment_lines)

    # 不应该在可执行代码中出现硬编码的 country='PH' 业务校验
    forbidden_patterns = [
        "country 必须为 PH",
        "Warehouse country 必须为 PH",
        "Warehouse 国家必须为 PH",
        "country 不是 PH",
    ]
    for pattern in forbidden_patterns:
        if pattern in executable_body:
            raise AssertionError(
                f"Migration 00009 可执行代码不应包含硬编码 PH 校验: {pattern!r}"
            )

    # country='PH' 出现在可执行代码中（非注释）也应拒绝
    if "country='PH'" in executable_body or "country = 'PH'" in executable_body:
        raise AssertionError(
            "Migration 00009 可执行代码不应包含 country='PH' 硬编码"
        )

    print("  [PASS] test_b_no_hardcoded_ph_country_check")


# ============================================================
# (c) p_variants 逐项 country 必须等于 locked warehouse.country
# ============================================================

def test_c_variants_country_must_match_warehouse():
    body = _func_body(read_migration())

    # Step 5a 必须包含: v_country != v_wh_country → RAISE EXCEPTION
    assert "v_country != v_wh_country" in body, (
        "Migration 00009 必须校验 p_variants 每项 country 与 warehouse.country 一致"
    )
    assert "Variant country 必须等于 Warehouse country" in body, (
        "country 不一致时的错误信息必须明确"
    )

    print("  [PASS] test_c_variants_country_must_match_warehouse")


# ============================================================
# (d) p_inventory 逐项 country 必须等于 locked warehouse.country
# ============================================================

def test_d_inventory_country_must_match_warehouse():
    body = _func_body(read_migration())

    # Step 5b 必须包含: v_country != v_wh_country → RAISE EXCEPTION
    assert "Inventory country 必须等于 Warehouse country" in body, (
        "Migration 00009 必须校验 p_inventory 每项 country 与 warehouse.country 一致"
    )

    print("  [PASS] test_d_inventory_country_must_match_warehouse")


# ============================================================
# (e) Warehouse 必须 FOR UPDATE, type='overseas', is_active=true, name 非空
# ============================================================

def test_e_warehouse_for_update_and_checks():
    body = _func_body(read_migration())

    # FOR UPDATE 行锁
    assert "FOR UPDATE" in body, (
        "Migration 00009 必须使用 FOR UPDATE 锁定 warehouse 行"
    )

    # type 校验
    assert "v_wh_type != 'overseas'" in body, (
        "必须校验 warehouse.type = 'overseas'"
    )

    # is_active 校验
    assert "NOT v_wh_is_active" in body, (
        "必须校验 warehouse.is_active = true"
    )

    # name 非空校验
    assert "v_wh_name IS NULL OR v_wh_name = ''" in body, (
        "必须校验 warehouse.name 非空"
    )

    print("  [PASS] test_e_warehouse_for_update_and_checks")


# ============================================================
# (f) p_warehouse_name 非空
# ============================================================

def test_f_p_warehouse_name_not_empty():
    body = _func_body(read_migration())

    assert "p_warehouse_name IS NULL OR p_warehouse_name = ''" in body, (
        "必须校验 p_warehouse_name 非空"
    )
    assert "p_warehouse_name 不能为空" in body, (
        "p_warehouse_name 为空时的错误信息必须明确"
    )

    print("  [PASS] test_f_p_warehouse_name_not_empty")


# ============================================================
# (g) 写入前完成重复键、country、quantity、last_sync_at 校验
# ============================================================

def test_g1_duplicate_key_checks_before_write():
    body = _func_body(read_migration())

    # 步骤 4a: p_variants 去重
    assert "p_variants 含重复 (sku,country) 业务键" in body, (
        "步骤 4a: 必须检测 p_variants 重复业务键"
    )

    # 步骤 4b: p_inventory 去重
    assert "p_inventory 含重复 (sku,country) 业务键" in body, (
        "步骤 4b: 必须检测 p_inventory 重复业务键"
    )

    # 去重必须发生在 Variant INSERT (步骤 7) 和 Inventory 写入 (步骤 8) 之前
    body_before_step7 = body.split("-- 7. Variant 创建")[0]
    assert "含重复" in body_before_step7, (
        "去重检测必须在 Variant 写入（步骤 7）之前"
    )

    print("  [PASS] test_g1_duplicate_key_checks_before_write")


def test_g2_country_checks_before_write():
    body = _func_body(read_migration())

    # country 校验 (步骤 5a/5b) 必须在 Variant INSERT (步骤 7) 之前
    body_before_step7 = body.split("-- 7. Variant 创建")[0]
    assert "必须等于 Warehouse country" in body_before_step7, (
        "country 校验必须在 Variant 写入（步骤 7）之前"
    )

    print("  [PASS] test_g2_country_checks_before_write")


def test_g3_quantity_checks_before_write():
    body = _func_body(read_migration())

    # quantity 严格校验在步骤 5b
    assert "quantity 不能为 null" in body, "必须校验 quantity 非 null"
    assert "quantity 必须为数字类型" in body, "必须校验 quantity 为 JSON number"
    assert "quantity 无法解析为严格整数" in body, "必须拒绝非严格整数 quantity"
    assert "quantity 不能为负数" in body, "必须拒绝负数 quantity"

    # quantity 校验必须在 Variant INSERT (步骤 7) 之前
    body_before_step7 = body.split("-- 7. Variant 创建")[0]
    assert "quantity" in body_before_step7.lower(), (
        "quantity 校验必须在 Variant 写入（步骤 7）之前"
    )

    print("  [PASS] test_g3_quantity_checks_before_write")


def test_g4_last_sync_at_checks_before_write():
    body = _func_body(read_migration())

    # 步骤 6a: 解析统一快照时间
    assert "首条 last_sync_at 不能为空" in body, "步骤 6a: 必须校验首条 last_sync_at 非空"

    # 步骤 6b: 强制统一快照时间
    assert "同一次快照内 last_sync_at 不一致" in body, (
        "步骤 6b: 必须校验所有 last_sync_at 一致"
    )

    # last_sync_at 校验必须在 Variant INSERT (步骤 7) 之前
    body_before_step7 = body.split("-- 7. Variant 创建")[0]
    assert "last_sync_at" in body_before_step7.lower(), (
        "last_sync_at 统一性校验必须在 Variant 写入（步骤 7）之前"
    )

    print("  [PASS] test_g4_last_sync_at_checks_before_write")


def test_g5_variant_inventory_integrity_before_write():
    body = _func_body(read_migration())

    # 步骤 4c: 新 Variant-Inventory 关联完整性
    assert "新 Variant 缺少对应 Inventory" in body, (
        "步骤 4c: 必须校验每个新 Variant 在 Inventory 中存在"
    )

    # 关联完整性校验必须在 Variant INSERT (步骤 7) 之前
    body_before_step7 = body.split("-- 7. Variant 创建")[0]
    assert "缺少对应 Inventory" in body_before_step7, (
        "新 Variant-Inventory 关联完整性校验必须在 Variant 写入（步骤 7）之前"
    )

    print("  [PASS] test_g5_variant_inventory_integrity_before_write")


# ============================================================
# (h) REVOKE PUBLIC/anon/authenticated + GRANT service_role 保持不变
# ============================================================

def test_h_revoke_grant_unchanged():
    sql = read_migration()

    # REVOKE from PUBLIC, anon, authenticated
    assert "REVOKE EXECUTE ON FUNCTION public.sync_warehouse_inventory" in sql
    assert "FROM PUBLIC" in sql, "必须 REVOKE FROM PUBLIC"
    assert "FROM anon" in sql, "必须 REVOKE FROM anon"
    assert "FROM authenticated" in sql, "必须 REVOKE FROM authenticated"

    # GRANT to service_role
    assert "GRANT EXECUTE ON FUNCTION public.sync_warehouse_inventory" in sql
    assert "TO service_role" in sql, "必须 GRANT TO service_role"

    # 确保只 GRANT 给 service_role，不 GRANT 给其他角色
    grant_lines = [
        line for line in sql.split("\n")
        if "GRANT EXECUTE ON FUNCTION public.sync_warehouse_inventory" in line
    ]
    for line in grant_lines:
        if "TO" in line and "service_role" not in line:
            raise AssertionError(
                f"GRANT 只允许 TO service_role，发现非预期行: {line.strip()}"
            )

    print("  [PASS] test_h_revoke_grant_unchanged")


# ============================================================
# 补充: 函数体含 CREATE OR REPLACE（不是 IF NOT EXISTS）
# ============================================================

def test_create_or_replace_not_if_not_exists():
    sql = read_migration()
    assert "CREATE OR REPLACE FUNCTION" in sql

    # 函数声明本身不使用 IF NOT EXISTS（业务逻辑内的 IF NOT EXISTS 是合法的）
    func_declaration = sql.split("AS $$")[0]
    assert "IF NOT EXISTS" not in func_declaration, (
        "Migration 00009 函数声明应使用 CREATE OR REPLACE，不是 IF NOT EXISTS"
    )
    print("  [PASS] test_create_or_replace_not_if_not_exists")


# ============================================================
# 运行
# ============================================================

if __name__ == "__main__":
    PASS = 0
    FAIL = 0
    tests = [
        test_a_signature_unchanged,
        test_b_no_hardcoded_ph_country_check,
        test_c_variants_country_must_match_warehouse,
        test_d_inventory_country_must_match_warehouse,
        test_e_warehouse_for_update_and_checks,
        test_f_p_warehouse_name_not_empty,
        test_g1_duplicate_key_checks_before_write,
        test_g2_country_checks_before_write,
        test_g3_quantity_checks_before_write,
        test_g4_last_sync_at_checks_before_write,
        test_g5_variant_inventory_integrity_before_write,
        test_h_revoke_grant_unchanged,
        test_create_or_replace_not_if_not_exists,
    ]

    print("=" * 60)
    print("Migration 00009 静态 SQL 契约测试")
    print("不连接 Supabase | 不执行 Migration")
    print("=" * 60)
    print()

    for test_fn in tests:
        try:
            test_fn()
            PASS += 1
        except AssertionError as e:
            print(f"  [FAIL] {test_fn.__name__} — {e}")
            FAIL += 1
        except Exception as e:
            print(f"  [ERROR] {test_fn.__name__} — {type(e).__name__}: {e}")
            FAIL += 1

    print()
    print("=" * 60)
    print(f"结果: {PASS} 通过, {FAIL} 失败 (共 {PASS + FAIL} 项)")
    print("=" * 60)

    import sys
    sys.exit(0 if FAIL == 0 else 1)
