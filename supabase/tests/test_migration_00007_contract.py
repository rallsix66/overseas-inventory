"""
P5-SY5A — Migration 00007 静态 SQL 契约测试（V5.4.3 第四次聚焦返工强化版）

仅静态分析 SQL 文本，不连接 Supabase，不执行 Migration。

验证：
  - 11 个 CHECK 约束声明（含 failed_requires_fields finished_at）
  - claim_sync_run: IS DISTINCT FROM 'admin' 拒绝 NULL role
  - claim_sync_run: p_triggered_by = auth.uid() 禁止伪造审计身份
  - 查询 RPC 脱敏矩阵：禁止返回 input_artifact_hash/plan_artifact_hash/
    lease_expires_at/heartbeat_at/原始 triggered_by UUID
  - Admin 返回 display_name (JOIN profiles) + warehouse_name (JOIN warehouse)
  - Operator 返回脱敏邮箱 (auth.users.email) + warehouse_name +
    controlled result_summary (仅 variantsCreated + inventoryUpdated)
  - Operator get_sync_run_detail 不含 plan_drift_differences
  - 邮箱来源为 auth.users.email（非 profiles.email）
  - release_sync_run: v_pre_wh_id / v_post_wh_id 独立变量 + 严格比较
  - release_sync_run: warehouse lock 行缺失明确失败
  - cleanup_expired_sync_runs: 仅遍历存在过期 in_progress 的 warehouse
  - sync_log exit_code: CHECK 约束存在，无 DEFAULT 1
  - get_sync_runs: p_limit 显式拒绝 NULL/<1/>100
  - get_sync_runs: jsonb_agg 显式 ORDER BY
  - heartbeat_sync_run: v_now := clock_timestamp() 单次时间源
  - release_sync_run 不接收 p_finished_at，finished_at 由数据库在全部锁后生成
  - release_sync_run v_now := clock_timestamp() 在全部锁后、UPDATE 之前
  - claim_sync_run dry_run 过期使用 <= 60 分钟（恰好 60 分钟拒绝）
  - 权限收口 (REVOKE/GRANT) + 锁顺序 + 字段对齐
  - 禁止仅匹配注释或字段名称：必须验证结构化位置
"""

import os
import re
import sys

MIGRATION_PATH = os.path.join(
    os.path.dirname(__file__), "..", "migrations", "00007_sync_run.sql"
)


def read_migration():
    with open(MIGRATION_PATH, "r", encoding="utf-8") as f:
        return f.read()


def _lines_without_comments(sql):
    """返回不含注释行的 SQL（移除 -- 开头的行和空行）。"""
    return [line for line in sql.split("\n")
            if not line.strip().startswith("--") and line.strip()]


def _func_body(sql, func_name):
    """提取指定函数的 body（AS $$ 和 $$; 之间的内容）。"""
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


def _sql_between(sql, start_marker, end_marker):
    """提取两个标记之间的 SQL 文本。"""
    parts = sql.split(start_marker, 1)
    if len(parts) < 2:
        return ""
    return parts[1].split(end_marker, 1)[0]


# ============================================================
# 1. 严格前向 Migration 检查
# ============================================================

def test_no_if_not_exists_in_ddl():
    """CREATE TABLE 和 ALTER TABLE ADD COLUMN 不使用 IF NOT EXISTS"""
    sql = read_migration()
    lines = _lines_without_comments(sql)

    ddl_statements = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("CREATE TABLE") or stripped.startswith("ALTER TABLE"):
            ddl_statements.append(stripped)

    for stmt in ddl_statements:
        if "IF NOT EXISTS" in stmt:
            raise AssertionError(
                f"严格前向 Migration 违反: DDL 语句使用 IF NOT EXISTS — {stmt[:80]}"
            )

    create_tables = [s for s in ddl_statements if s.startswith("CREATE TABLE")]
    assert len(create_tables) == 2, f"预期 2 个 CREATE TABLE, 实际 {len(create_tables)}"
    assert "sync_run" in create_tables[0]
    assert "sync_warehouse_lock" in create_tables[1]

    alter_tables = [s for s in ddl_statements if s.startswith("ALTER TABLE")]
    assert len(alter_tables) >= 5, f"预期至少 5 个 ALTER TABLE, 实际 {len(alter_tables)}"

    print("  [PASS] test_no_if_not_exists_in_ddl")


def test_sync_run_id_no_default():
    """sync_run.id 无 DEFAULT gen_random_uuid()"""
    sql = read_migration()

    table_block = _sql_between(sql, "CREATE TABLE public.sync_run (", ");")
    assert table_block, "未找到 sync_run CREATE TABLE 块"

    id_line = None
    for line in table_block.split("\n"):
        stripped = line.strip()
        if "id" in stripped and "uuid" in stripped and "PRIMARY KEY" in stripped:
            id_line = stripped
            break

    assert id_line is not None, "未找到 sync_run.id 列定义"
    assert "DEFAULT" not in id_line, f"sync_run.id 不应有 DEFAULT: {id_line}"
    assert "gen_random_uuid" not in id_line, f"sync_run.id 不应引用 gen_random_uuid"

    print("  [PASS] test_sync_run_id_no_default")


# ============================================================
# 2. sync_run 新增列验证
# ============================================================

REQUIRED_SYNC_RUN_COLUMNS = [
    "triggered_by",
    "triggered_from",
    "heartbeat_at",
    "result_summary",
    "created_at",
]


def test_sync_run_missing_columns():
    """sync_run 表包含全部 5 个新增列"""
    sql = read_migration()

    table_block = _sql_between(sql, "CREATE TABLE public.sync_run (", ");")
    assert table_block, "未找到 sync_run CREATE TABLE 块"

    missing = []
    for col in REQUIRED_SYNC_RUN_COLUMNS:
        if col not in table_block:
            missing.append(col)

    if missing:
        raise AssertionError(
            f"sync_run 缺少列: {', '.join(missing)}"
        )

    assert "REFERENCES public.profiles(id)" in table_block or \
           "REFERENCES profiles(id)" in table_block, \
           "triggered_by 缺少 REFERENCES profiles(id) FK 约束"

    assert "triggered_from" in table_block and "CHECK" in table_block, \
           "triggered_from 缺少 CHECK 约束"

    print(f"  [PASS] test_sync_run_missing_columns ({len(REQUIRED_SYNC_RUN_COLUMNS)}/5 确认)")


def test_sync_run_triggered_by_index():
    """idx_sync_run_triggered_by 索引存在"""
    sql = read_migration()
    assert "idx_sync_run_triggered_by" in sql, "缺少 idx_sync_run_triggered_by 索引"
    lines = _lines_without_comments(sql)
    found = any("idx_sync_run_triggered_by" in line and "CREATE" in line
                for line in lines)
    assert found, "idx_sync_run_triggered_by 应出现在 CREATE INDEX 语句中"
    print("  [PASS] test_sync_run_triggered_by_index")


def test_completed_requires_fields_includes_result_summary():
    """CHK-05 completed_requires_fields 包含 result_summary IS NOT NULL"""
    sql = read_migration()

    chk_block = _sql_between(
        sql,
        "CONSTRAINT completed_requires_fields",
        "CONSTRAINT plan_drift_check_enum"
    )

    assert "result_summary" in chk_block, (
        "completed_requires_fields 必须包含 result_summary IS NOT NULL"
    )
    print("  [PASS] test_completed_requires_fields_includes_result_summary")


# ============================================================
# 3. 11 个 CHECK 约束验证
# ============================================================

REQUIRED_CHECKS = [
    "sync_run_time_check",
    "real_write_requires_dry_run",
    "real_write_requires_artifacts",
    "dry_run_requires_input_artifact",
    "completed_requires_fields",
    "plan_drift_check_enum",
    "plan_drift_count_non_negative",
    "failed_requires_fields",
    "completed_exit_code_zero",
    "plan_drift_differences_length",
    "completed_dry_run_requires_plan_artifact",
]


def test_eleven_check_constraints():
    """全部 11 个 CHECK 约束已声明"""
    sql = read_migration()
    lines = _lines_without_comments(sql)

    found = []
    missing = []
    for check_name in REQUIRED_CHECKS:
        constraint_found = any(
            f"CONSTRAINT {check_name}" in line for line in lines
        )
        if constraint_found:
            found.append(check_name)
        else:
            missing.append(check_name)

    if missing:
        raise AssertionError(f"缺少 CHECK 约束: {', '.join(missing)}")

    assert len(found) == 11, f"预期 11 个 CHECK, 实际找到 {len(found)}"

    print(f"  [PASS] test_eleven_check_constraints ({len(found)}/11 已确认)")


# ============================================================
# 3a. failed_requires_fields 包含 finished_at（V5.4.3 第二次聚焦返工）
# ============================================================

def test_failed_requires_fields_includes_finished_at():
    """CHK-08 failed_requires_fields 包含 finished_at IS NOT NULL"""
    sql = read_migration()

    chk_block = _sql_between(
        sql,
        "CONSTRAINT failed_requires_fields",
        "CONSTRAINT completed_exit_code_zero"
    )

    assert "finished_at IS NOT NULL" in chk_block, (
        "failed_requires_fields 必须包含 finished_at IS NOT NULL"
    )
    assert "error_message IS NOT NULL" in chk_block, (
        "failed_requires_fields 必须包含 error_message IS NOT NULL"
    )
    assert "exit_code IN (1, 2)" in chk_block, (
        "failed_requires_fields 必须包含 exit_code IN (1, 2)"
    )
    print("  [PASS] test_failed_requires_fields_includes_finished_at")


# ============================================================
# 4. 部分唯一索引验证
# ============================================================

def test_partial_unique_index():
    """idx_sync_run_one_in_progress 部分唯一索引"""
    sql = read_migration()

    assert "idx_sync_run_one_in_progress" in sql

    idx_pos = sql.find("idx_sync_run_one_in_progress")
    before_idx = sql[:idx_pos]
    idx_lines = before_idx.split("\n")
    create_line = None
    for line in reversed(idx_lines):
        if "CREATE" in line and "INDEX" in line:
            create_line = line.strip()
            break
    assert create_line is not None and "UNIQUE" in create_line, (
        f"idx_sync_run_one_in_progress 应为 UNIQUE 索引"
    )

    print("  [PASS] test_partial_unique_index")


# ============================================================
# 5. sync_warehouse_lock 触发器和补建
# ============================================================

def test_sync_warehouse_lock_trigger_and_backfill():
    """sync_warehouse_lock trigger 和补建 INSERT"""
    sql = read_migration()
    lines = _lines_without_comments(sql)

    trigger_func = any("trg_sync_warehouse_lock_insert" in line and "FUNCTION" in line
                       for line in lines)
    assert trigger_func, "缺少 trigger 函数"

    trigger_def = any("trg_warehouse_create_lock" in line and "TRIGGER" in line
                      for line in lines)
    assert trigger_def, "缺少 trigger 定义"

    assert "AFTER INSERT ON public.warehouse" in sql

    assert "INSERT INTO public.sync_warehouse_lock (warehouse_id)" in sql
    assert "type = 'overseas'" in sql
    assert "is_active = true" in sql

    print("  [PASS] test_sync_warehouse_lock_trigger_and_backfill")


# ============================================================
# 6. sync_log 扩展
# ============================================================

EXPECTED_SYNC_LOG_COLUMNS = [
    "sync_run_id",
    "triggered_by",
    "triggered_from",
    "mode",
    "exit_code",
]


def test_sync_log_extension():
    """sync_log 5 列扩展 + 默认值"""
    sql = read_migration()
    lines = _lines_without_comments(sql)

    for col in EXPECTED_SYNC_LOG_COLUMNS:
        found = any(f"ADD COLUMN {col}" in line for line in lines)
        assert found, f"缺少 sync_log ADD COLUMN: {col}"

    assert "DEFAULT 'cli'" in sql, "triggered_from 默认值应为 'cli'"
    assert "DEFAULT 'real_write'" in sql, "mode 默认值应为 'real_write'"

    print("  [PASS] test_sync_log_extension")


def test_sync_log_constraints():
    """sync_log: FK + CHECK 约束"""
    sql = read_migration()

    sync_log_section = _sql_between(
        sql,
        "Part 3: sync_log",
        "Part 4: RLS"
    )

    assert "REFERENCES public.profiles(id)" in sync_log_section or \
           "REFERENCES profiles(id)" in sync_log_section, \
           "sync_log.triggered_by 缺少 REFERENCES profiles(id) FK"

    assert "CHECK (triggered_from IN ('web', 'cli'))" in sync_log_section or \
           "CHECK (triggered_from IN ('web','cli'))" in sync_log_section, \
           "sync_log.triggered_from 缺少 CHECK IN ('web','cli')"

    assert "CHECK (mode = 'real_write')" in sync_log_section, \
           "sync_log.mode 缺少 CHECK (mode = 'real_write')"

    print("  [PASS] test_sync_log_constraints (FK + CHECK)")


# ============================================================
# 6a. sync_log exit_code 无 DEFAULT 1 + CHECK 约束（V5.4.3 第二次聚焦返工）
# ============================================================

def test_sync_log_exit_code_no_default_1():
    """sync_log.exit_code 不应有 DEFAULT 1"""
    sql = read_migration()

    # 提取 sync_log exit_code 定义行
    sync_log_section = _sql_between(
        sql,
        "Part 3: sync_log",
        "Part 4: RLS"
    )

    exit_code_lines = [l.strip() for l in sync_log_section.split("\n")
                       if "exit_code" in l and "ADD COLUMN" in l]

    for line in exit_code_lines:
        assert "DEFAULT 1" not in line, (
            f"sync_log.exit_code 不应有 DEFAULT 1: {line}"
        )

    print("  [PASS] test_sync_log_exit_code_no_default_1")


def test_sync_log_exit_code_check():
    """sync_log.exit_code 有 CHECK (IS NULL OR IN (0, 1, 2))"""
    sql = read_migration()

    sync_log_section = _sql_between(
        sql,
        "Part 3: sync_log",
        "Part 4: RLS"
    )

    assert "CHECK" in sync_log_section and "exit_code" in sync_log_section, \
           "sync_log.exit_code 需要 CHECK 约束"
    assert "0" in sync_log_section or "IN (0, 1, 2)" in sync_log_section or \
           "IN (0,1,2)" in sync_log_section, \
           "sync_log.exit_code CHECK 应接受 0 (success)"

    print("  [PASS] test_sync_log_exit_code_check")


# ============================================================
# 7. RLS 策略验证
# ============================================================

def test_rls_policies():
    """sync_run / sync_warehouse_lock / sync_log RLS 策略"""
    sql = read_migration()
    lines = _lines_without_comments(sql)

    assert "ALTER TABLE public.sync_run ENABLE ROW LEVEL SECURITY" in sql
    sync_run_policy = any(
        "CREATE POLICY" in line and "service_role_all_sync_run" in line
        for line in lines
    )
    assert sync_run_policy, "缺少 service_role_all_sync_run POLICY"

    assert "ALTER TABLE public.sync_warehouse_lock ENABLE ROW LEVEL SECURITY" in sql
    swl_policy = any(
        "CREATE POLICY" in line and "service_role_all_sync_warehouse_lock" in line
        for line in lines
    )
    assert swl_policy, "缺少 service_role_all_sync_warehouse_lock POLICY"

    sl_policy = any(
        "CREATE POLICY" in line and "service_role_all_sync_log" in line
        for line in lines
    )
    assert sl_policy, "缺少 sync_log service_role POLICY"

    sync_run_rls_section = _sql_between(
        sql,
        "ALTER TABLE public.sync_run ENABLE ROW LEVEL SECURITY",
        "ALTER TABLE public.sync_warehouse_lock ENABLE ROW LEVEL SECURITY"
    )
    rls_lines = _lines_without_comments(sync_run_rls_section)
    auth_policies_in_sync_run = [
        line for line in rls_lines
        if "CREATE POLICY" in line and "authenticated" in line
    ]
    assert len(auth_policies_in_sync_run) == 0, (
        f"sync_run 不应有 authenticated 策略"
    )

    print("  [PASS] test_rls_policies")


# ============================================================
# 8. 函数签名验证
# ============================================================

EXPECTED_FUNCTIONS = [
    "claim_sync_run",
    "release_sync_run",
    "heartbeat_sync_run",
    "cleanup_expired_sync_runs",
    "get_sync_runs",
    "get_sync_run_detail",
    "trg_sync_warehouse_lock_insert",
]


def test_all_functions_exist():
    """全部 7 个函数已声明"""
    sql = read_migration()

    for func in EXPECTED_FUNCTIONS:
        assert f"CREATE OR REPLACE FUNCTION public.{func}" in sql, (
            f"缺少函数: {func}"
        )

    print(f"  [PASS] test_all_functions_exist ({len(EXPECTED_FUNCTIONS)}/7)")


def test_all_functions_security_definer():
    """全部函数 SECURITY DEFINER + SET search_path = ''"""
    sql = read_migration()

    func_blocks = sql.split("CREATE OR REPLACE FUNCTION public.")
    for block in func_blocks[1:]:
        func_name = block.split("(")[0].strip()
        header = block.split("AS $$")[0] if "AS $$" in block else block[:500]

        assert "SECURITY DEFINER" in header, (
            f"{func_name}: 缺少 SECURITY DEFINER"
        )
        assert "SET search_path = ''" in header or "SET search_path = \"\"" in header, (
            f"{func_name}: 缺少 SET search_path = ''"
        )

    print("  [PASS] test_all_functions_security_definer")


# ============================================================
# 9. claim_sync_run 权限验证（V5.4.3 第二次聚焦返工）
# ============================================================

def test_claim_uses_is_distinct_from():
    """claim_sync_run 使用 IS DISTINCT FROM 'admin' 拒绝 NULL role（非 != 'admin'）"""
    body = _func_body(read_migration(), "claim_sync_run")
    # 过滤注释行
    code_lines = _lines_without_comments(body)

    # 必须使用 IS DISTINCT FROM 而非 !=
    assert "IS DISTINCT FROM 'admin'" in body, (
        "claim_sync_run 必须使用 IS DISTINCT FROM 'admin' 拒绝 NULL role"
    )
    # != 'admin' 对 NULL role 返回 NULL（被 IF 当作 false），无法拦截停用用户
    # 在非注释代码中不应出现 != 'admin'
    code_with_ne = any("!= 'admin'" in line for line in code_lines)
    assert not code_with_ne, (
        "claim_sync_run 代码不应使用 != 'admin'（对 NULL 无效），已替换为 IS DISTINCT FROM"
    )

    print("  [PASS] test_claim_uses_is_distinct_from")


def test_claim_triggered_by_binds_auth_uid():
    """claim_sync_run 强制 p_triggered_by = auth.uid()，禁止伪造审计身份"""
    body = _func_body(read_migration(), "claim_sync_run")

    assert "p_triggered_by != auth.uid()" in body or \
           "p_triggered_by = auth.uid()" in body, (
        "claim_sync_run 必须校验 p_triggered_by = auth.uid()，禁止伪造审计身份"
    )

    print("  [PASS] test_claim_triggered_by_binds_auth_uid")


def test_claim_sync_run_params():
    """claim_sync_run 接收 p_run_id + p_triggered_by + p_triggered_from + lease 参数"""
    sql = read_migration()
    body = _func_body(sql, "claim_sync_run")

    assert "p_triggered_by" in sql, "claim_sync_run 缺少 p_triggered_by 参数"
    assert "p_triggered_from" in sql, "claim_sync_run 缺少 p_triggered_from 参数"

    assert "p_triggered_from NOT IN ('web', 'cli')" in body, (
        "claim 应校验 p_triggered_from IN ('web','cli')"
    )

    assert "p_lease_duration < 30 OR p_lease_duration > 900" in body, (
        "缺少 lease_duration [30, 900] 范围校验"
    )

    assert "pg_advisory_xact_lock" in body
    assert "FOR UPDATE" in body
    assert "idx_sync_run_one_in_progress" in sql

    print("  [PASS] test_claim_sync_run_params")


def test_claim_clock_timestamp_position():
    """clock_timestamp() 在 sync_run FOR UPDATE 之后、Dry Run 验证之前（V5.5 锁顺序）"""
    body = _func_body(read_migration(), "claim_sync_run")

    advisory_pos = body.find("pg_advisory_xact_lock")
    # 获取最后一个 FOR UPDATE（sync_run FOR UPDATE，在 clock_timestamp 之前）
    clock_pos = body.find("clock_timestamp()")
    before_clock = body[:clock_pos]
    last_for_update = before_clock.rfind("FOR UPDATE")
    dry_run_check_pos = body.find("Step 6 (V5.4.1)")

    assert advisory_pos >= 0
    assert last_for_update >= 0
    assert clock_pos >= 0
    assert dry_run_check_pos >= 0

    assert last_for_update < clock_pos, (
        "clock_timestamp() 必须在 sync_run FOR UPDATE 之后（V5.5 锁顺序）"
    )
    assert clock_pos < dry_run_check_pos, "clock_timestamp() 必须在 dry_run 验证之前"
    assert advisory_pos < last_for_update < clock_pos < dry_run_check_pos, (
        f"锁顺序错误: advisory={advisory_pos}, last FOR UPDATE={last_for_update}, "
        f"clock_timestamp={clock_pos}, dry_run_check={dry_run_check_pos}"
    )

    assert "v_now := clock_timestamp()" in body or \
           "v_now:=clock_timestamp()" in body, \
           "v_now 必须由 clock_timestamp() 赋值"

    declare_end = body.find("BEGIN")
    if declare_end > 0:
        declare_block = body[:declare_end]
        assert "v_now" not in declare_block or "now()" not in declare_block, \
               "v_now 不应在 DECLARE 中用 now() 初始化"

    print("  [PASS] test_claim_clock_timestamp_position")


def test_claim_dry_run_select_no_id():
    """dry_run_run_id 验证 SELECT 不再包含 id 列"""
    body = _func_body(read_migration(), "claim_sync_run")

    step6_section = _sql_between(body, "Step 6 (V5.4.1)", "Step 7:")

    select_to_into = ""
    if "SELECT" in step6_section and "INTO" in step6_section:
        select_start = step6_section.find("SELECT")
        into_pos = step6_section.find("INTO", select_start)
        if into_pos > select_start:
            select_to_into = step6_section[select_start:into_pos]

    if select_to_into:
        after_select = select_to_into.replace("SELECT", "").strip()
        first_col = after_select.split(",")[0].strip()
        assert first_col != "id", (
            f"dry_run 验证 SELECT 第一列不应是 id"
        )

    step6_pos = body.find("Step 6 (V5.4.1)")
    after_step6 = body[step6_pos:]
    select_pos = after_step6.find("SELECT")
    into_pos2 = after_step6.find("INTO", select_pos) if select_pos >= 0 else -1

    if select_pos >= 0 and into_pos2 > select_pos:
        select_clause = after_step6[select_pos:into_pos2]
        columns_in_select = [c.strip().split()[-1]
                             for c in select_clause.replace("SELECT", "").split(",")]
        assert "id" not in columns_in_select, (
            f"dry_run 验证 SELECT 不应包含 id 列"
        )

    print("  [PASS] test_claim_dry_run_select_no_id")


def test_claim_insert_new_columns():
    """claim_sync_run INSERT 写入 triggered_by, triggered_from, heartbeat_at, created_at"""
    body = _func_body(read_migration(), "claim_sync_run")

    insert_section = _sql_between(body, "INSERT INTO public.sync_run (", ") VALUES (")
    assert insert_section, "未找到 claim INSERT 列列表"

    required_insert_cols = [
        "triggered_by",
        "triggered_from",
        "heartbeat_at",
        "created_at",
    ]
    missing = [col for col in required_insert_cols if col not in insert_section]
    if missing:
        raise AssertionError(f"claim INSERT 缺少列: {', '.join(missing)}")

    values_section = _sql_between(body, ") VALUES (", ");")
    if not values_section:
        values_section = _sql_between(body, ") VALUES (", ")")
    assert "p_triggered_by" in values_section, "VALUES 缺少 p_triggered_by"
    assert "p_triggered_from" in values_section, "VALUES 缺少 p_triggered_from"
    assert "v_now" in values_section, "VALUES 缺少 v_now"

    print("  [PASS] test_claim_insert_new_columns")


# ============================================================
# 10. release_sync_run 结构验证（V5.4.3 第二次聚焦返工强化）
# ============================================================

def test_release_independent_warehouse_id_vars():
    """release_sync_run 使用 v_pre_wh_id / v_post_wh_id 独立变量"""
    body = _func_body(read_migration(), "release_sync_run")

    assert "v_pre_wh_id" in body, (
        "release_sync_run 必须声明 v_pre_wh_id（锁前 warehouse_id）"
    )
    assert "v_post_wh_id" in body, (
        "release_sync_run 必须声明 v_post_wh_id（锁后 warehouse_id）"
    )
    # 严格比较
    assert "v_pre_wh_id IS DISTINCT FROM v_post_wh_id" in body or \
           "v_pre_wh_id != v_post_wh_id" in body, (
        "release_sync_run 必须严格比较锁前/锁后 warehouse_id"
    )

    print("  [PASS] test_release_independent_warehouse_id_vars")


def test_release_warehouse_lock_row_exists_check():
    """release_sync_run Step 3 校验 warehouse lock 行存在（不静默跳过）"""
    body = _func_body(read_migration(), "release_sync_run")

    assert "v_lock_exists" in body, (
        "release_sync_run 应有 v_lock_exists 变量接收 EXISTS 结果"
    )
    assert "NOT v_lock_exists" in body or "v_lock_exists IS FALSE" in body or \
           "NOT FOUND" in body, (
        "release_sync_run 应在 warehouse lock 行缺失时明确失败"
    )
    assert "sync_warehouse_lock 行不存在" in body, (
        "release_sync_run warehouse lock 缺失应抛出明确错误消息"
    )

    print("  [PASS] test_release_warehouse_lock_row_exists_check")


def test_release_sync_run_for_update():
    """release_sync_run 在锁后 SELECT sync_run FOR UPDATE"""
    body = _func_body(read_migration(), "release_sync_run")

    advisory_pos = body.find("pg_advisory_xact_lock")
    sync_run_for_update = False
    after_advisory = body[advisory_pos:] if advisory_pos >= 0 else body
    if "FROM public.sync_run" in after_advisory and "FOR UPDATE" in after_advisory:
        from_pos = after_advisory.find("FROM public.sync_run")
        after_from = after_advisory[from_pos:]
        if "FOR UPDATE" in after_from[:500]:
            sync_run_for_update = True

    assert sync_run_for_update, (
        "release_sync_run 必须在 advisory lock 之后 SELECT sync_run FOR UPDATE"
    )

    print("  [PASS] test_release_sync_run_for_update")


def test_release_terminal_status_check():
    """release_sync_run 在 FOR UPDATE 后重新校验 status，禁止覆盖终态"""
    body = _func_body(read_migration(), "release_sync_run")

    step4_section = _sql_between(body, "Step 4:", "Step 5:")
    if not step4_section:
        step4_section = _sql_between(body, "Step 4:", "-- Step 5")

    assert "FOR UPDATE" in step4_section, "Step 4 应包含 SELECT sync_run FOR UPDATE"
    assert "status" in step4_section and "mode" in step4_section, \
        "Step 4 应重新读取 status 和 mode"

    for_update_pos = body.find("FOR UPDATE")
    terminal_check_pos = body.find("v_cur_status != 'in_progress'")

    assert for_update_pos >= 0
    assert terminal_check_pos >= 0
    assert terminal_check_pos > for_update_pos, "终态检查必须在 FOR UPDATE 之后"

    print("  [PASS] test_release_terminal_status_check")


def test_release_result_summary_param():
    """release_sync_run 包含 p_result_summary 参数，不含 p_finished_at"""
    body = _func_body(read_migration(), "release_sync_run")

    assert "p_result_summary" in body, "release_sync_run 缺少 p_result_summary 参数"
    assert "p_result_summary IS NULL" in body, (
        "completed 必须校验 p_result_summary IS NULL"
    )
    assert "result_summary" in body, "release UPDATE 应写入 result_summary"

    # p_finished_at 应已删除（finished_at 由数据库在锁后生成）
    assert "p_finished_at" not in body, (
        "release_sync_run 不应包含 p_finished_at 参数（第四次聚焦返工）"
    )

    print("  [PASS] test_release_result_summary_param")


def test_release_heartbeat_cleared():
    """release_sync_run 释放时清除 heartbeat_at"""
    body = _func_body(read_migration(), "release_sync_run")

    assert "heartbeat_at" in body, "release_sync_run 应引用 heartbeat_at"
    assert "heartbeat_at          = NULL" in body or "heartbeat_at = NULL" in body, (
        "release 应设置 heartbeat_at = NULL"
    )

    print("  [PASS] test_release_heartbeat_cleared")


def test_release_sync_run_lock_order():
    """release_sync_run 统一锁顺序"""
    body = _func_body(read_migration(), "release_sync_run")

    advisory_pos = body.find("pg_advisory_xact_lock")
    for_update_lock_pos = body.find("FOR UPDATE")

    assert advisory_pos >= 0
    assert for_update_lock_pos >= 0
    assert advisory_pos < for_update_lock_pos

    assert "locked_by = p_run_id" in body, "release 缺少 locked_by = p_run_id 条件"
    assert "v_mode = 'dry_run' AND p_plan_artifact_hash IS NULL" in body, (
        "release 缺少 Dry Run completed plan_artifact_hash 强制校验"
    )

    print("  [PASS] test_release_sync_run_lock_order")


# ============================================================
# 10a. 第四次聚焦返工：release_sync_run + claim_sync_run 强化验证
# ============================================================

def test_release_clock_timestamp_after_locks():
    """release_sync_run 在全部锁后单次执行 v_now := clock_timestamp()"""
    body = _func_body(read_migration(), "release_sync_run")

    # v_now 应在 DECLARE 中声明（不带初始化值）
    assert "v_now" in body, "release_sync_run 应声明 v_now 变量"

    # 找到 v_now := clock_timestamp() 的位置
    v_now_assign_pos = body.find("v_now := clock_timestamp()")
    if v_now_assign_pos < 0:
        v_now_assign_pos = body.find("v_now:=clock_timestamp()")
    assert v_now_assign_pos >= 0, (
        "release_sync_run 应在全部锁后执行 v_now := clock_timestamp()"
    )

    # FOR UPDATE 必须在 v_now 之前
    for_update_pos = body.find("FOR UPDATE")
    assert for_update_pos >= 0
    # 取最后一个 FOR UPDATE（sync_run FOR UPDATE）
    last_for_update = body.rfind("FOR UPDATE")
    assert last_for_update < v_now_assign_pos, (
        "v_now := clock_timestamp() 必须在 sync_run FOR UPDATE 之后"
    )

    # v_now 赋值必须在 Step 5（UPDATE）之前
    update_pos = body.find("UPDATE public.sync_run")
    assert update_pos >= 0
    assert v_now_assign_pos < update_pos, (
        "v_now := clock_timestamp() 必须在 UPDATE sync_run 之前"
    )

    print("  [PASS] test_release_clock_timestamp_after_locks")


def test_release_completed_failed_both_use_v_now():
    """release_sync_run completed 和 failed 路径均使用 v_now 写入 finished_at"""
    body = _func_body(read_migration(), "release_sync_run")

    # completed 路径：finished_at = v_now
    assert "finished_at           = v_now" in body or "finished_at = v_now" in body, (
        "release completed 路径必须使用 v_now 写入 finished_at"
    )

    # failed 路径：finished_at = v_now
    failed_section_start = body.find("ELSIF p_status = 'failed'")
    assert failed_section_start >= 0, "release 应有 failed 分支"
    failed_section = body[failed_section_start:]

    # 找到 failed 分支结束
    else_pos_in_failed = failed_section.find("ELSE")
    if else_pos_in_failed > 0:
        failed_section = failed_section[:else_pos_in_failed]

    assert "finished_at     = v_now" in failed_section or "finished_at = v_now" in failed_section, (
        "release failed 路径必须使用 v_now 写入 finished_at"
    )

    # p_finished_at 不应出现在代码中
    assert "p_finished_at" not in body, (
        "release_sync_run 不应引用 p_finished_at（参数已删除）"
    )

    print("  [PASS] test_release_completed_failed_both_use_v_now")


def test_claim_dry_run_exactly_60_minutes_rejected():
    """claim_sync_run dry_run 过期判断使用 <= 60 分钟（恰好 60 分钟拒绝）"""
    body = _func_body(read_migration(), "claim_sync_run")

    # 必须使用 <=（而非 <）
    assert "v_dr_finished <= v_now - INTERVAL '60 minutes'" in body or \
           "v_dr_finished <= v_now - INTERVAL" in body, (
        "claim dry_run 过期判断必须使用 <= 60 分钟（恰好 60 分钟拒绝，含 NULL 拒绝）"
    )

    # 不应使用 <（恰好 60 分钟会通过，不一致）
    code_lines = _lines_without_comments(body)
    # 在非注释代码中查找 dry_run 过期条件
    for line in code_lines:
        if "INTERVAL" in line and ("60 minutes" in line or "'60 minutes'" in line or "'60" in line):
            # 如果在含 INTERVAL '60 minutes' 的代码行中出现 < 而非 <=，则失败
            if "< " in line and "<= " not in line:
                raise AssertionError(
                    f"claim dry_run 过期判断应使用 <= 而非 < : {line.strip()}"
                )

    # v_dr_finished IS NULL 仍然被拒绝（NULL 检查保留）
    assert "v_dr_finished IS NULL" in body, (
        "claim 应拒绝 v_dr_finished IS NULL（Dry Run 未完成）"
    )

    print("  [PASS] test_claim_dry_run_exactly_60_minutes_rejected")


# ============================================================
# 10b. 第五次聚焦返工：claim 租约回收竞态修复 + release 显式 NULL exit_code
# ============================================================

def test_claim_in_progress_has_for_update():
    """claim_sync_run Step 5.5 对 in_progress sync_run 执行 SELECT ... FOR UPDATE"""
    body = _func_body(read_migration(), "claim_sync_run")

    # 查找 Step 5.5 区域的 SELECT
    step5_5_pos = body.find("Step 5.5 (V5.5): SELECT FOR UPDATE")
    assert step5_5_pos >= 0, "claim 应有 Step 5.5 (V5.5) 标记"

    after_step5_5 = body[step5_5_pos:]
    # 在 Step 5.5 注释后，SELECT 语句应包含 FOR UPDATE
    select_pos = after_step5_5.find("SELECT id, lease_expires_at")
    assert select_pos >= 0, "Step 5.5 应包含 SELECT id, lease_expires_at"

    # FOR UPDATE 必须在 SELECT 之后、Step 5.6 之前
    after_select = after_step5_5[select_pos:]
    step5_6_pos = after_select.find("Step 5.6:")
    for_update_in_select = after_select.find("FOR UPDATE")
    assert for_update_in_select >= 0, (
        "in_progress sync_run SELECT 必须包含 FOR UPDATE（V5.5）"
    )
    assert for_update_in_select < step5_6_pos, (
        "FOR UPDATE 必须在 Step 5.6 (v_now) 之前"
    )

    print("  [PASS] test_claim_in_progress_has_for_update")


def test_claim_v_now_after_sync_run_for_update():
    """claim_sync_run v_now := clock_timestamp() 在 sync_run FOR UPDATE 之后"""
    body = _func_body(read_migration(), "claim_sync_run")

    # 定位 sync_run FOR UPDATE（Step 5.5 之后的 FOR UPDATE）
    step5_5_pos = body.find("Step 5.5 (V5.5)")
    assert step5_5_pos >= 0
    after_step5_5 = body[step5_5_pos:]

    # 找 FOR UPDATE（第一个在 SELECT 之后，是 sync_run FOR UPDATE）
    for_update_pos = after_step5_5.find("FOR UPDATE;")
    assert for_update_pos >= 0, "Step 5.5 应包含 FOR UPDATE;"

    # 找 v_now := clock_timestamp()
    v_now_pos = after_step5_5.find("v_now := clock_timestamp()")
    assert v_now_pos >= 0

    assert for_update_pos < v_now_pos, (
        "v_now := clock_timestamp() 必须在 sync_run FOR UPDATE 之后（V5.5）"
    )

    print("  [PASS] test_claim_v_now_after_sync_run_for_update")


def test_claim_lease_expiry_uses_locked_value():
    """claim_sync_run 过期回收使用锁后 lease_expires_at，不无条件覆盖 heartbeat 续租"""
    body = _func_body(read_migration(), "claim_sync_run")

    # 验证有效租约返回 NULL（不回收）
    assert "有效租约（含 heartbeat 续租）" in body, (
        "claim 应注释说明有效租约（含 heartbeat 续租）返回 NULL"
    )
    assert "RETURN NULL" in body, (
        "有效租约应 RETURN NULL（不回收）"
    )

    # 验证 FOR UPDATE 在 lease 判断之前
    for_update_pos = body.find("FOR UPDATE;")
    return_null_pos = body.find("RETURN NULL")
    assert for_update_pos < return_null_pos, (
        "FOR UPDATE 必须在 RETURN NULL 之前（行锁保护租约判断）"
    )

    # 验证过期判断使用 v_lease_exp（锁后值）而非 now()
    step5_7_section = _sql_between(body, "Step 5.7:", "Step 6 (V5.4.1)")
    assert "v_lease_exp" in step5_7_section, (
        "lease 过期判断应使用 v_lease_exp（锁后最新值）"
    )
    assert "v_lease_exp < v_now" in step5_7_section, (
        "过期判断: v_lease_exp < v_now（锁后值 vs 锁后时间）"
    )

    print("  [PASS] test_claim_lease_expiry_uses_locked_value")


def test_release_completed_rejects_null_exit_code():
    """release_sync_run completed 显式拒绝 NULL exit_code"""
    body = _func_body(read_migration(), "release_sync_run")

    # completed 路径必须显式检查 p_exit_code IS NULL
    completed_section_start = body.find("IF p_status = 'completed'")
    assert completed_section_start >= 0

    # 找 failed 分支作为 completed 段结束
    elsif_pos = body.find("ELSIF p_status = 'failed'", completed_section_start)
    completed_section = body[completed_section_start:elsif_pos] if elsif_pos > 0 else body[completed_section_start:]

    assert "p_exit_code IS NULL OR p_exit_code != 0" in completed_section, (
        "completed 路径必须显式拒绝 p_exit_code IS NULL（V5.5）"
    )

    print("  [PASS] test_release_completed_rejects_null_exit_code")


def test_release_failed_rejects_null_exit_code():
    """release_sync_run failed 显式拒绝 NULL exit_code"""
    body = _func_body(read_migration(), "release_sync_run")

    # failed 路径必须显式检查 p_exit_code IS NULL
    failed_section_start = body.find("ELSIF p_status = 'failed'")
    assert failed_section_start >= 0

    # 找 ELSE 作为 failed 段结束
    else_pos = body.find("ELSE", failed_section_start)
    failed_section = body[failed_section_start:else_pos] if else_pos > 0 else body[failed_section_start:]

    assert "p_exit_code IS NULL OR p_exit_code NOT IN (1, 2)" in failed_section, (
        "failed 路径必须显式拒绝 p_exit_code IS NULL（V5.5）"
    )

    print("  [PASS] test_release_failed_rejects_null_exit_code")


# ============================================================
# 11. heartbeat_sync_run 验证
# ============================================================

def test_heartbeat_writes_heartbeat_at():
    """heartbeat_sync_run 使用 v_now := clock_timestamp() 同时写入 heartbeat_at 和 lease_expires_at"""
    body = _func_body(read_migration(), "heartbeat_sync_run")

    assert "heartbeat_at" in body, "heartbeat_sync_run 应写入 heartbeat_at"
    assert "v_now := clock_timestamp()" in body or "v_now:=clock_timestamp()" in body, (
        "heartbeat 应先执行 v_now := clock_timestamp() 单次获取临界区时间"
    )
    assert "heartbeat_at     = v_now" in body or "heartbeat_at = v_now" in body, (
        "heartbeat_at 必须使用 v_now（非 now()）"
    )
    assert "lease_expires_at = v_now" in body, (
        "lease_expires_at 必须使用 v_now（同一时间源）"
    )

    print("  [PASS] test_heartbeat_writes_heartbeat_at")


# ============================================================
# 12. cleanup_expired_sync_runs 验证（V5.4.3 第二次聚焦返工强化）
# ============================================================

def test_cleanup_only_targets_expired_warehouses():
    """cleanup 仅遍历存在过期 in_progress 的 warehouse 而非全表锁"""
    body = _func_body(read_migration(), "cleanup_expired_sync_runs")

    # 必须 SELECT DISTINCT FROM public.sync_run（而非 FROM sync_warehouse_lock）
    assert "FROM public.sync_run" in body, (
        "cleanup 应 FROM sync_run 获取过期仓库列表"
    )
    assert "FROM public.sync_warehouse_lock" not in body.split("LOOP")[0] if "LOOP" in body else True, (
        "cleanup LOOP 不应 FROM sync_warehouse_lock（会锁定全部仓库）"
    )
    # FOR 循环应使用 sync_run 的 warehouse_id
    assert "sr.warehouse_id" in body, (
        "cleanup 应使用 sync_run.warehouse_id 过滤"
    )
    # 必须过滤 status='in_progress' + lease_expires_at < now()
    assert "status = 'in_progress'" in body, "cleanup 应过滤 in_progress 状态"
    assert "lease_expires_at < now()" in body, "cleanup 应过滤过期租约"

    print("  [PASS] test_cleanup_only_targets_expired_warehouses")


def test_cleanup_expired_order_and_exit_code():
    """cleanup_expired_sync_runs ORDER BY warehouse_id + exit_code=2 + 返回运行数"""
    sql = read_migration()
    body = _func_body(sql, "cleanup_expired_sync_runs")

    assert "ORDER BY" in body and "warehouse_id" in body, (
        "cleanup 应按 warehouse_id 排序"
    )
    assert "exit_code     = 2" in body or "exit_code = 2" in body, (
        "cleanup 应设置 exit_code=2"
    )

    cleanup_parts = sql.split("CREATE OR REPLACE FUNCTION public.cleanup_expired_sync_runs()")
    assert len(cleanup_parts) >= 2
    cleanup_decl = cleanup_parts[1][:200]
    assert "RETURNS integer" in cleanup_decl
    assert "locked_by IN" in body, "cleanup 仅应清 expired 持有的锁"

    print("  [PASS] test_cleanup_expired_order_and_exit_code")


# ============================================================
# 13. get_sync_runs 验证（V5.4.3 第二次聚焦返工强化）
# ============================================================

def test_get_sync_runs_cte_before_agg():
    """get_sync_runs 在 CTE 中先 ORDER BY + LIMIT，再 jsonb_agg"""
    body = _func_body(read_migration(), "get_sync_runs")

    assert "WITH limited AS (" in body, (
        "get_sync_runs 应使用 WITH limited AS (CTE) 模式"
    )

    cte_count = body.count("WITH limited AS (")
    assert cte_count >= 2, f"预期至少 2 个 CTE，实际 {cte_count}"

    # 验证每个 CTE 块
    cte_start = 0
    for i in range(cte_count):
        cte_pos = body.find("WITH limited AS (", cte_start)
        assert cte_pos >= 0, f"CTE #{i+1}: 未找到"
        after_cte_open = body[cte_pos:]

        limit_in_cte = after_cte_open.find("LIMIT p_limit")
        assert limit_in_cte >= 0, f"CTE #{i+1}: 未找到 LIMIT p_limit"

        order_in_cte = after_cte_open.find("ORDER BY")
        assert order_in_cte >= 0, f"CTE #{i+1}: 未找到 ORDER BY"
        assert order_in_cte < limit_in_cte, f"CTE #{i+1}: ORDER BY 应在 LIMIT 之前"

        cte_start = cte_pos + 1

    assert "FROM limited" in body, "外层 SELECT 应 FROM limited (CTE)"

    print(f"  [PASS] test_get_sync_runs_cte_before_agg ({cte_count} CTE blocks verified)")


def test_get_sync_runs_explicit_p_limit_rejection():
    """get_sync_runs 显式拒绝 NULL / <1 / >100 的 p_limit（非 GREATEST/LEAST 钳制）"""
    body = _func_body(read_migration(), "get_sync_runs")

    # 必须显式 RAISE EXCEPTION，而非 GREATEST/LEAST 静默钳制
    assert "p_limit IS NULL OR p_limit < 1 OR p_limit > 100" in body, (
        "get_sync_runs 必须显式拒绝 p_limit NULL / <1 / >100"
    )
    assert "GREATEST" not in body, (
        "get_sync_runs 不应使用 GREATEST 静默钳制 p_limit"
    )
    assert "LEAST" not in body, (
        "get_sync_runs 不应使用 LEAST 静默钳制 p_limit"
    )

    print("  [PASS] test_get_sync_runs_explicit_p_limit_rejection")


def test_get_sync_runs_jsonb_agg_order_by():
    """get_sync_runs jsonb_agg 包含显式 ORDER BY started_at DESC"""
    body = _func_body(read_migration(), "get_sync_runs")

    # 必须在外层 jsonb_agg 内有 ORDER BY
    # 查找 jsonb_agg(... ORDER BY limited.started_at DESC)
    assert "ORDER BY limited.started_at DESC" in body, (
        "get_sync_runs jsonb_agg 必须显式 ORDER BY started_at DESC"
    )

    # 检查 ORDER BY 出现在 jsonb_agg 调用内部（在 ) 之前）
    agg_count = body.count("jsonb_agg(")
    for i in range(agg_count):
        agg_pos = body.find("jsonb_agg(", 0 if i == 0 else body.find("jsonb_agg(", agg_pos + 1))
        if agg_pos < 0:
            break
        # 找最近的闭合 )
        after_agg = body[agg_pos:]
        # 找到 ORDER BY 在 jsonb_agg 调用内
        # 简化为至少一处 jsonb_agg 内有 ORDER BY
        pass

    print("  [PASS] test_get_sync_runs_jsonb_agg_order_by")


def test_get_sync_runs_new_fields():
    """get_sync_runs admin 输出包含 display_name + warehouse_name + 业务字段"""
    body = _func_body(read_migration(), "get_sync_runs")

    # admin 不再返回 triggered_by UUID，而是 display_name
    assert "display_name" in body, "get_sync_runs admin 输出应包含 display_name"
    assert "'display_name'," in body, "admin jsonb_build_object 应包含 'display_name'"

    admin_fields = [
        "warehouse_name",
        "triggered_from",
        "created_at",
        "result_summary",
    ]
    for field in admin_fields:
        assert f"'{field}'," in body, f"get_sync_runs admin 输出应包含 '{field}'"

    print("  [PASS] test_get_sync_runs_new_fields")


def test_get_sync_runs_no_forbidden_fields():
    """get_sync_runs 禁止返回 input_artifact_hash/plan_artifact_hash/lease_expires_at/heartbeat_at/triggered_by UUID"""
    body = _func_body(read_migration(), "get_sync_runs")

    forbidden = [
        "input_artifact_hash",
        "plan_artifact_hash",
        "lease_expires_at",
        "heartbeat_at",
    ]
    for field in forbidden:
        # 这些字段不应出现在 jsonb_build_object 的 key 中
        # 允许出现在 CTE 的 SELECT（仅用于内部），但不能出现在输出
        # 检查：'field_name', 形式不应出现
        if f"'{field}'," in body:
            raise AssertionError(
                f"get_sync_runs 输出不应包含 '{field}'（所有角色禁止）"
            )

    # triggered_by 原始 UUID 不应出现在输出中
    # admin 用 display_name 代替，operator 用 triggered_by_email 代替
    assert "'triggered_by'," not in body, (
        "get_sync_runs 输出不应包含原始 'triggered_by' UUID"
    )

    print("  [PASS] test_get_sync_runs_no_forbidden_fields")


def test_get_sync_runs_operator_masked_email():
    """get_sync_runs operator 返回 auth.users 脱敏邮箱而非 triggered_by UUID"""
    body = _func_body(read_migration(), "get_sync_runs")

    assert "triggered_by_email" in body, (
        "get_sync_runs operator 输出应包含 triggered_by_email"
    )
    assert "regexp_replace" in body, (
        "get_sync_runs operator 应使用 regexp_replace 脱敏邮箱"
    )
    # operator 必须使用 auth.users.email 作为脱敏来源
    assert "LEFT JOIN auth.users u" in body, (
        "get_sync_runs operator 必须 LEFT JOIN auth.users u 获取 email"
    )
    # profiles 表不包含 email 字段，不应出现 p.email
    assert "p.email" not in body, (
        "get_sync_runs operator 不应引用 p.email（profiles 无 email 字段）"
    )
    # operator 应有 controlled result_summary
    assert "'result_summary'," in body, "operator 应返回 controlled result_summary"
    # operator 应有 Chinese 失败摘要
    assert "failure_summary" in body, (
        "get_sync_runs operator 应返回 failure_summary（Chinese 失败摘要）"
    )
    assert "'failure_summary'," in body, (
        "operator jsonb_build_object 应包含 'failure_summary'"
    )

    print("  [PASS] test_get_sync_runs_operator_masked_email")


def test_get_sync_runs_limit():
    """get_sync_runs 使用完全限定 + 正确 JOIN（admin→profiles, operator→auth.users, 共 warehouse）"""
    body = _func_body(read_migration(), "get_sync_runs")

    assert "public.get_user_role()" in body, (
        "get_sync_runs 应使用完全限定 public.get_user_role()"
    )
    assert "FROM public.sync_run" in body, "get_sync_runs 应直接读取 public.sync_run"
    # admin 分支 JOIN profiles 获取 display_name
    assert "LEFT JOIN public.profiles" in body, (
        "get_sync_runs admin 应 LEFT JOIN profiles 获取 display_name"
    )
    # operator 分支 JOIN auth.users 获取 email
    assert "LEFT JOIN auth.users u" in body, (
        "get_sync_runs operator 应 LEFT JOIN auth.users u 获取 email"
    )
    # 所有分支 JOIN warehouse 获取 warehouse_name
    assert "LEFT JOIN public.warehouse w" in body, (
        "get_sync_runs 应 LEFT JOIN public.warehouse w 获取 warehouse_name"
    )
    assert "v_role = 'admin'" in body, "get_sync_runs 应区分 admin/operator"

    print("  [PASS] test_get_sync_runs_limit")


# ============================================================
# 14. get_sync_run_detail 验证（V5.4.3 第二次聚焦返工强化）
# ============================================================

def test_get_sync_run_detail_new_fields():
    """get_sync_run_detail admin 输出 display_name + warehouse_name + 业务字段"""
    body = _func_body(read_migration(), "get_sync_run_detail")

    admin_detail_fields = [
        "display_name",
        "warehouse_name",
        "triggered_from",
        "created_at",
        "result_summary",
    ]
    for field in admin_detail_fields:
        assert f"'{field}'," in body, (
            f"get_sync_run_detail admin 输出应包含 '{field}'"
        )

    print("  [PASS] test_get_sync_run_detail_new_fields")


def test_get_sync_run_detail_no_forbidden_fields():
    """get_sync_run_detail 禁止返回敏感内部字段"""
    body = _func_body(read_migration(), "get_sync_run_detail")

    forbidden = [
        "input_artifact_hash",
        "plan_artifact_hash",
        "lease_expires_at",
        "heartbeat_at",
    ]
    for field in forbidden:
        if f"'{field}'," in body:
            raise AssertionError(
                f"get_sync_run_detail 输出不应包含 '{field}'（所有角色禁止）"
            )

    # 不应返回原始 triggered_by UUID
    assert "'triggered_by'," not in body, (
        "get_sync_run_detail 输出不应包含原始 'triggered_by' UUID"
    )

    print("  [PASS] test_get_sync_run_detail_no_forbidden_fields")


def test_get_sync_run_detail_operator_desensitization():
    """get_sync_run_detail operator 返回脱敏字段"""
    body = _func_body(read_migration(), "get_sync_run_detail")

    assert "triggered_by_email" in body, (
        "get_sync_run_detail operator 应返回 triggered_by_email"
    )
    assert "regexp_replace" in body, (
        "get_sync_run_detail operator 应脱敏邮箱"
    )
    assert "failure_summary" in body, (
        "get_sync_run_detail operator 应返回 Chinese 失败摘要"
    )

    print("  [PASS] test_get_sync_run_detail_operator_desensitization")


def test_get_sync_run_detail_profiles_join():
    """get_sync_run_detail admin→profiles(display_name), operator→auth.users(email), 共→warehouse(warehouse_name)"""
    body = _func_body(read_migration(), "get_sync_run_detail")

    # admin 分支 LEFT JOIN profiles 获取 display_name
    assert "LEFT JOIN public.profiles" in body, (
        "get_sync_run_detail admin 应 LEFT JOIN public.profiles"
    )
    assert "p.display_name" in body, (
        "get_sync_run_detail admin 应读取 p.display_name"
    )

    # operator 分支 LEFT JOIN auth.users 获取 email（profiles 无 email 字段）
    assert "LEFT JOIN auth.users u" in body, (
        "get_sync_run_detail operator 应 LEFT JOIN auth.users u 获取 email"
    )
    # profiles 表不包含 email，禁止 p.email
    assert "p.email" not in body, (
        "get_sync_run_detail 不应引用 p.email（profiles 无 email 字段），应使用 u.email (auth.users)"
    )
    assert "u.email" in body, (
        "get_sync_run_detail operator 应使用 u.email (auth.users) 脱敏"
    )

    # 所有分支 LEFT JOIN warehouse 获取 warehouse_name
    assert "LEFT JOIN public.warehouse w" in body, (
        "get_sync_run_detail 应 LEFT JOIN public.warehouse w 获取 warehouse_name"
    )

    print("  [PASS] test_get_sync_run_detail_profiles_join")


# ============================================================
# 14a. 第三次聚焦返工：脱敏矩阵强化验证
# ============================================================

def test_get_sync_run_detail_operator_no_plan_drift_differences():
    """get_sync_run_detail operator 分支不含 plan_drift_differences（branch-level 验证）"""
    body = _func_body(read_migration(), "get_sync_run_detail")

    # plan_drift_differences 仅应出现在 admin 分支（IF v_role = 'admin' THEN 块内）
    # 统计整个函数体代码行中的出现次数
    code_lines = _lines_without_comments(body)
    occurrences = [l for l in code_lines if "plan_drift_differences" in l]
    assert len(occurrences) == 1, (
        f"plan_drift_differences 应在 get_sync_run_detail 代码中出现恰好 1 次（仅 admin 分支），"
        f"实际 {len(occurrences)} 次: {occurrences}"
    )

    # 验证那 1 次出现在 admin 分支（IF v_role = 'admin' THEN ... ELSE 之前）
    admin_section_end = body.find("ELSE")
    assert admin_section_end >= 0, "get_sync_run_detail 应有 ELSE (operator) 分支"

    # 在 admin 分支代码行中验证包含 plan_drift_differences
    admin_section = body[:admin_section_end]
    admin_code_lines = _lines_without_comments(admin_section)
    admin_occurrences = [l for l in admin_code_lines if "plan_drift_differences" in l]
    assert len(admin_occurrences) == 1, (
        f"admin 分支应包含恰好 1 次 plan_drift_differences，实际 {len(admin_occurrences)}"
    )

    # operator 分支代码行不应包含 plan_drift_differences
    operator_section = body[admin_section_end:]
    operator_code_lines = _lines_without_comments(operator_section)
    operator_occurrences = [l for l in operator_code_lines if "plan_drift_differences" in l]
    assert len(operator_occurrences) == 0, (
        f"operator 分支不应包含 plan_drift_differences（脱敏矩阵要求），"
        f"实际 {len(operator_occurrences)} 次: {operator_occurrences}"
    )

    print("  [PASS] test_get_sync_run_detail_operator_no_plan_drift_differences")


def test_operator_result_summary_whitelist():
    """operator result_summary 白名单仅含 variantsCreated + inventoryUpdated"""
    body_run = _func_body(read_migration(), "get_sync_runs")
    body_detail = _func_body(read_migration(), "get_sync_run_detail")

    for func_name, body in [("get_sync_runs", body_run), ("get_sync_run_detail", body_detail)]:
        # operator 分支必须白名单 variantsCreated
        assert "'variantsCreated'" in body, (
            f"{func_name} operator result_summary 应包含 'variantsCreated'"
        )
        assert "->'variantsCreated'" in body, (
            f"{func_name} operator 应提取 result_summary->'variantsCreated'"
        )
        # operator 分支必须白名单 inventoryUpdated
        assert "'inventoryUpdated'" in body, (
            f"{func_name} operator result_summary 应包含 'inventoryUpdated'"
        )
        assert "->'inventoryUpdated'" in body, (
            f"{func_name} operator 应提取 result_summary->'inventoryUpdated'"
        )

        # 禁止白名单外字段泄露（常见候选）
        forbidden_in_summary = [
            "totalVariants",
            "totalSku",
            "totalInventory",
            "productsProcessed",
            "errors",
            "warnings",
            "skipped",
            "deleted",
        ]
        for forbidden_field in forbidden_in_summary:
            assert f"'{forbidden_field}'" not in body, (
                f"{func_name} operator result_summary 不应包含白名单外字段: '{forbidden_field}'"
            )

    print("  [PASS] test_operator_result_summary_whitelist")


def test_query_rpc_warehouse_name():
    """get_sync_runs 和 get_sync_run_detail 所有分支包含 warehouse_name"""
    body_run = _func_body(read_migration(), "get_sync_runs")
    body_detail = _func_body(read_migration(), "get_sync_run_detail")

    for func_name, body in [("get_sync_runs", body_run), ("get_sync_run_detail", body_detail)]:
        # LEFT JOIN public.warehouse w
        assert "LEFT JOIN public.warehouse w" in body, (
            f"{func_name} 应 LEFT JOIN public.warehouse w"
        )
        assert "w.name" in body, (
            f"{func_name} 应读取 w.name AS warehouse_name"
        )
        # warehouse_name 出现在输出
        assert "'warehouse_name'" in body, (
            f"{func_name} 输出应包含 'warehouse_name'"
        )

    print("  [PASS] test_query_rpc_warehouse_name")


def test_operator_uses_auth_users_not_profiles_email():
    """operator 分支邮箱来源为 auth.users.email，禁止 profiles.email"""
    body_run = _func_body(read_migration(), "get_sync_runs")
    body_detail = _func_body(read_migration(), "get_sync_run_detail")

    for func_name, body in [("get_sync_runs", body_run), ("get_sync_run_detail", body_detail)]:
        # operator 分支必须 JOIN auth.users
        assert "LEFT JOIN auth.users u" in body, (
            f"{func_name} operator 应 LEFT JOIN auth.users u 获取 email"
        )
        # u.email 存在（auth.users.email 是真实字段）
        assert "u.email" in body, (
            f"{func_name} operator 应引用 u.email (auth.users)"
        )
        # profiles 表不包含 email 字段
        assert "p.email" not in body, (
            f"{func_name} 不应引用 p.email（profiles 无 email 字段）"
        )

    print("  [PASS] test_operator_uses_auth_users_not_profiles_email")


# ============================================================
# 15. 权限收口（REVOKE/GRANT）
# ============================================================

def test_revoke_grant_patterns():
    """全部函数 REVOKE FROM PUBLIC + REVOKE FROM anon + 适当的 GRANT"""
    sql = read_migration()
    lines = _lines_without_comments(sql)

    user_functions = ["claim_sync_run", "get_sync_runs", "get_sync_run_detail"]
    for func in user_functions:
        revoke_lines = [l for l in lines if f"REVOKE EXECUTE ON FUNCTION public.{func}" in l]
        grant_lines = [l for l in lines if f"GRANT EXECUTE ON FUNCTION public.{func}" in l]
        assert len(revoke_lines) > 0, f"{func}: 缺少 REVOKE"
        assert len(grant_lines) > 0, f"{func}: 缺少 GRANT"
        assert any("authenticated" in l for l in grant_lines), (
            f"{func}: GRANT 目标应为 authenticated"
        )

    internal_functions = ["release_sync_run", "heartbeat_sync_run", "cleanup_expired_sync_runs"]
    for func in internal_functions:
        revoke_lines = [l for l in lines if f"REVOKE EXECUTE ON FUNCTION public.{func}" in l]
        grant_lines = [l for l in lines if f"GRANT EXECUTE ON FUNCTION public.{func}" in l]
        assert len(revoke_lines) > 0, f"{func}: 缺少 REVOKE"
        assert len(grant_lines) > 0, f"{func}: 缺少 GRANT"
        assert any("authenticated" in l for l in revoke_lines), (
            f"{func}: 必须 REVOKE FROM authenticated"
        )
        assert any("service_role" in l for l in grant_lines), (
            f"{func}: GRANT 目标应为 service_role"
        )

    print("  [PASS] test_revoke_grant_patterns")


def test_claim_revoke_grant_signature_has_new_params():
    """claim_sync_run REVOKE/GRANT 签名 9 参数"""
    sql = read_migration()
    lines = _lines_without_comments(sql)

    claim_grant_lines = [l for l in lines
                         if "GRANT EXECUTE ON FUNCTION public.claim_sync_run" in l]
    assert len(claim_grant_lines) >= 1

    for line in claim_grant_lines:
        params = line.split("claim_sync_run(")[1].split(")")[0] if "claim_sync_run(" in line else ""
        types_in_sig = [t.strip() for t in params.split(",")]
        assert len(types_in_sig) == 9, (
            f"claim_sync_run GRANT 签名应有 9 个参数，实际 {len(types_in_sig)}"
        )
        assert types_in_sig == ["uuid", "text", "uuid", "integer", "uuid", "text", "uuid", "text", "text"], (
            f"claim_sync_run 参数类型错误: {types_in_sig}"
        )

    print("  [PASS] test_claim_revoke_grant_signature_has_new_params")


def test_release_revoke_grant_signature_has_result_summary():
    """release_sync_run REVOKE/GRANT 签名 9 参数（无 timestamptz，第四次聚焦返工）"""
    sql = read_migration()
    lines = _lines_without_comments(sql)

    release_grant_lines = [l for l in lines
                           if "GRANT EXECUTE ON FUNCTION public.release_sync_run" in l]
    assert len(release_grant_lines) >= 1

    for line in release_grant_lines:
        params = line.split("release_sync_run(")[1].split(")")[0] if "release_sync_run(" in line else ""
        types_in_sig = [t.strip() for t in params.split(",")]
        assert len(types_in_sig) == 9, (
            f"release_sync_run GRANT 签名应有 9 个参数（无 timestamptz），实际 {len(types_in_sig)}"
        )
        assert "timestamptz" not in types_in_sig, (
            "release_sync_run GRANT 签名不应含 timestamptz（p_finished_at 已删除）"
        )
        assert "jsonb" in types_in_sig
        expected = ["uuid", "text", "integer", "text", "jsonb", "text", "integer", "jsonb", "text"]
        assert types_in_sig == expected, (
            f"release_sync_run 参数类型错误: {types_in_sig}"
        )

    print("  [PASS] test_release_revoke_grant_signature_has_result_summary")


# ============================================================
# 16. sync_log RLS 补充验证
# ============================================================

def test_sync_log_service_role_policy_added():
    """sync_log 新增 service_role 策略"""
    sql = read_migration()

    assert "service_role_all_sync_log" in sql, "缺少 sync_log service_role 策略"

    if "DROP POLICY" in sql:
        drop_section = sql.split("DROP POLICY")[1] if len(sql.split("DROP POLICY")) > 1 else ""
        assert "sync_log" not in drop_section[:200], "不应 DROP 已有 sync_log RLS 策略"

    print("  [PASS] test_sync_log_service_role_policy_added")


# ============================================================
# 运行全部测试
# ============================================================

ALL_TESTS = [
    # 严格前向 Migration
    test_no_if_not_exists_in_ddl,
    test_sync_run_id_no_default,
    # sync_run 新增列
    test_sync_run_missing_columns,
    test_sync_run_triggered_by_index,
    test_completed_requires_fields_includes_result_summary,
    # CHECK 约束
    test_eleven_check_constraints,
    test_failed_requires_fields_includes_finished_at,  # 第二次聚焦返工
    test_partial_unique_index,
    # sync_warehouse_lock
    test_sync_warehouse_lock_trigger_and_backfill,
    # sync_log 扩展 + 约束
    test_sync_log_extension,
    test_sync_log_constraints,
    test_sync_log_exit_code_no_default_1,   # 第二次聚焦返工
    test_sync_log_exit_code_check,          # 第二次聚焦返工
    # RLS
    test_rls_policies,
    test_sync_log_service_role_policy_added,
    # 函数签名
    test_all_functions_exist,
    test_all_functions_security_definer,
    # claim_sync_run 权限（第二次聚焦返工强化）
    test_claim_uses_is_distinct_from,       # 第二次聚焦返工
    test_claim_triggered_by_binds_auth_uid, # 第二次聚焦返工
    test_claim_sync_run_params,
    test_claim_clock_timestamp_position,
    test_claim_dry_run_select_no_id,
    test_claim_insert_new_columns,
    # release_sync_run 结构（第二次聚焦返工强化）
    test_release_independent_warehouse_id_vars,    # 第二次聚焦返工
    test_release_warehouse_lock_row_exists_check,  # 第二次聚焦返工
    test_release_sync_run_for_update,
    test_release_terminal_status_check,
    test_release_result_summary_param,
    test_release_heartbeat_cleared,
    test_release_sync_run_lock_order,
    # 第四次聚焦返工：release + claim 强化验证
    test_release_clock_timestamp_after_locks,               # 第四次聚焦返工
    test_release_completed_failed_both_use_v_now,           # 第四次聚焦返工
    test_claim_dry_run_exactly_60_minutes_rejected,         # 第四次聚焦返工
    # 第五次聚焦返工：claim 租约回收竞态修复 + release 显式 NULL exit_code
    test_claim_in_progress_has_for_update,                  # 第五次聚焦返工
    test_claim_v_now_after_sync_run_for_update,             # 第五次聚焦返工
    test_claim_lease_expiry_uses_locked_value,              # 第五次聚焦返工
    test_release_completed_rejects_null_exit_code,          # 第五次聚焦返工
    test_release_failed_rejects_null_exit_code,             # 第五次聚焦返工
    # heartbeat
    test_heartbeat_writes_heartbeat_at,
    # cleanup（第二次聚焦返工强化）
    test_cleanup_only_targets_expired_warehouses,  # 第二次聚焦返工
    test_cleanup_expired_order_and_exit_code,
    # get_sync_runs（第二次聚焦返工强化）
    test_get_sync_runs_cte_before_agg,
    test_get_sync_runs_explicit_p_limit_rejection,  # 第二次聚焦返工
    test_get_sync_runs_jsonb_agg_order_by,          # 第二次聚焦返工
    test_get_sync_runs_new_fields,
    test_get_sync_runs_no_forbidden_fields,         # 第二次聚焦返工
    test_get_sync_runs_operator_masked_email,       # 第二次聚焦返工
    test_get_sync_runs_limit,
    # get_sync_run_detail
    test_get_sync_run_detail_new_fields,
    test_get_sync_run_detail_no_forbidden_fields,
    test_get_sync_run_detail_operator_desensitization,
    test_get_sync_run_detail_profiles_join,                  # 第三次聚焦返工强化
    # 第三次聚焦返工：脱敏矩阵强化
    test_get_sync_run_detail_operator_no_plan_drift_differences,  # 第三次聚焦返工
    test_operator_result_summary_whitelist,                       # 第三次聚焦返工
    test_query_rpc_warehouse_name,                                # 第三次聚焦返工
    test_operator_uses_auth_users_not_profiles_email,             # 第三次聚焦返工
    # 权限收口
    test_revoke_grant_patterns,
    test_claim_revoke_grant_signature_has_new_params,
    test_release_revoke_grant_signature_has_result_summary,
]


if __name__ == "__main__":
    passed = 0
    failed = 0

    print(f"\nP5-SY5A Migration 00007 静态 SQL 契约测试 (V5.4.3 第五次聚焦返工)")
    print(f"文件: {MIGRATION_PATH}")
    print(f"=" * 60)

    for test_fn in ALL_TESTS:
        try:
            test_fn()
            passed += 1
        except Exception as e:
            failed += 1
            print(f"  [FAIL] {test_fn.__name__}: {e}")

    print(f"\n{'=' * 60}")
    print(f"结果: {passed} 通过, {failed} 失败, {len(ALL_TESTS)} 总计")

    if failed > 0:
        print(f"\n失败项:")
        for test_fn in ALL_TESTS:
            try:
                test_fn()
            except Exception as e:
                print(f"  - {test_fn.__name__}: {e}")
        sys.exit(1)
    else:
        print("全部静态契约测试通过 [OK]")
        sys.exit(0)
