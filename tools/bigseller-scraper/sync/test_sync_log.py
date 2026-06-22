"""P5-SY4D SyncLog 失败模式测试 — Mock 覆盖 24 场景。

不依赖 Supabase 连接或写入。每个场景验证：
  (a) RPC 调用状态  (b) 审计状态  (c) SyncLog 内容
  (d) Fallback 条件  (e) CLI 退出码

所有场景均通过 cli_execute.main() 严格验证退出码。
"""
import sys
import os
import json
from contextlib import ExitStack
from unittest.mock import patch, mock_open

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 在 mock 设置前预导入所有包含 _load_env 的模块，
# 确保它们的 _load_env() 使用真实 open() 读取 .env.local
import sync.executor  # noqa: F401
import sync.cli_execute  # noqa: F401
import sync.input_validator  # noqa: F401
import sync.supabase_gateway  # noqa: F401
import sync.plan_generator  # noqa: F401
import sync.verifier  # noqa: F401
import sync.config  # noqa: F401

PASS = 0
FAIL = 0


def test(name):
    def decorator(fn):
        def wrapper():
            global PASS, FAIL
            try:
                fn()
                print(f'  PASS: {name}')
                PASS += 1
            except AssertionError as e:
                print(f'  FAIL: {name} — {e}')
                FAIL += 1
            except Exception as e:
                print(f'  ERROR: {name} — {type(e).__name__}: {e}')
                FAIL += 1
        return wrapper
    return decorator


# =========================================================================
# 测试数据
# =========================================================================

WH_ID = 'adc5ec45-cd98-42a8-a1d1-26600e80d481'
SYNC_AT = '2026-06-13T12:00:00+08:00'

SIMPLE_PLAN = {
    'warehouse_rename_required': {
        'warehouse_id': WH_ID,
        'target_name': '菲律宾-新创启辰自建仓',
    },
    'new_variants': [
        {'sku': 'NEW001', 'name': '产品A', 'country': 'PH',
         'product_id': None, 'match_status': 'unmatched', 'target_quantity': 100},
    ],
    'inventory_updates': [
        {'sku': 'WM0005', 'warehouse_id': WH_ID, 'country': 'PH', 'new_quantity': 1500},
    ],
    'inventory_inserts': [],
    'inventory_after_variant_create': [
        {'sku': 'NEW001', 'warehouse_id': WH_ID, 'country': 'PH', 'new_quantity': 100},
    ],
    'inventory_unchanged': [
        {'sku': 'WM0074', 'warehouse_id': WH_ID, 'country': 'PH', 'quantity': 21289},
    ],
}

# s21: 新 Variant 缺少对应 Inventory
PLAN_ORPHAN_VARIANT = {
    'warehouse_rename_required': {
        'warehouse_id': WH_ID,
        'target_name': '菲律宾-新创启辰自建仓',
    },
    'new_variants': [
        {'sku': 'ORPHAN', 'name': '孤儿产品', 'country': 'PH'},
    ],
    'inventory_updates': [],
    'inventory_inserts': [],
    'inventory_after_variant_create': [],
    'inventory_unchanged': [
        {'sku': 'WM0074', 'warehouse_id': WH_ID, 'country': 'PH', 'quantity': 21289},
    ],
}

# s22: p_inventory 为空数组
PLAN_EMPTY_INVENTORY = {
    'warehouse_rename_required': {
        'warehouse_id': WH_ID,
        'target_name': '菲律宾-新创启辰自建仓',
    },
    'new_variants': [],
    'inventory_updates': [],
    'inventory_inserts': [],
    'inventory_after_variant_create': [],
    'inventory_unchanged': [],
}

MOCK_RPC_RESULT = {
    'variants_created': 1,
    'inventory_received': 3,
    'inventory_inserted': 1,
    'inventory_updated': 1,
    'inventory_unchanged': 1,
    'warehouse_renamed': True,
}

MOCK_RPC_ALL_UNCHANGED = {
    'variants_created': 0,
    'inventory_received': 3,
    'inventory_inserted': 0,
    'inventory_updated': 0,
    'inventory_unchanged': 3,
    'warehouse_renamed': False,
}

MOCK_VARIANT_LIST = [
    {'id': 'v-001', 'sku': 'WM0005', 'country': 'PH'},
    {'id': 'v-002', 'sku': 'WM0074', 'country': 'PH'},
    {'id': 'v-003', 'sku': 'NEW001', 'country': 'PH'},
]

MOCK_INVENTORY_LIST = [
    {'id': 'inv-1', 'variant_id': 'v-001', 'warehouse_id': WH_ID, 'quantity': 1500},
    {'id': 'inv-2', 'variant_id': 'v-002', 'warehouse_id': WH_ID, 'quantity': 21289},
    {'id': 'inv-3', 'variant_id': 'v-003', 'warehouse_id': WH_ID, 'quantity': 100},
]

MOCK_WAREHOUSE = {
    'id': WH_ID, 'name': '菲律宾-新创启辰自建仓',
    'country': 'PH', 'type': 'overseas', 'is_active': True,
}

MOCK_SYNC_LOG_SUCCESS = {
    'id': 'sl-001', 'status': 'success', 'warehouse_id': WH_ID,
}

MOCK_SYNC_LOG_FAILED = {
    'id': 'sl-002', 'status': 'failed', 'warehouse_id': WH_ID,
}

# CLI json.load 两阶段返回数据
MOCK_INPUT_DATA = {
    'warehouse': '菲律宾-新创启辰自建仓',
    'row_count': 98,
    'data': [],
}

MOCK_DRY_RUN_REPORT = {
    'counts': {
        'input_rows': 98,
        'new_variants': 1,
        'inventory_after_variant_create': 1,
        'total_inventory_actions': 2,  # inserted(1) + updated(1) = MOCK_RPC_RESULT
    },
}

# s20 使用: 全部 unchanged → write_actions=0
MOCK_DRY_RUN_REPORT_ALL_UNCHANGED = {
    'counts': {
        'input_rows': 98,
        'new_variants': 1,
        'inventory_after_variant_create': 1,
        'total_inventory_actions': 0,  # inserted(0) + updated(0)
    },
}

MOCK_ROWS = [{'sku': 'WM0005', 'quantity': 1500, 'warehouse_name': '菲律宾-新创启辰自建仓'}]

# Dry Run CLI execute_plan 返回结果（s18 使用）
MOCK_EXECUTE_RESULT_DRY_RUN = {
    'started_at': SYNC_AT,
    'finished_at': SYNC_AT,
    'warehouse_id': WH_ID,
    'warehouse_name_before': '菲律宾-新创启辰自建仓',
    'warehouse_name_after': '菲律宾-新创启辰自建仓',
    'warehouse_renamed': False,
    'variants_before': 97,
    'variants_created': 0,
    'variants_skipped': 1,
    'variants_total': 97,
    'inventory_before': 98,
    'inventory_inserted': 0,
    'inventory_updated': 0,
    'inventory_total': 98,
    'inventory_write_actions': 0,
    'errors': [],
}

# =========================================================================
# CLI 参数模板
# =========================================================================

CLI_ARGS_NO_DRY_RUN = [
    'cli_execute.py',
    '--input-json', '/fake/input.json',
    '--dry-run-report', '/fake/report.json',
    '--execute', '--confirm', 'P5-SY3B-PH',
    '--no-dry-run',
]

CLI_ARGS_DRY_RUN = [
    'cli_execute.py',
    '--input-json', '/fake/input.json',
    '--dry-run-report', '/fake/report.json',
    '--execute', '--confirm', 'P5-SY3B-PH',
    '--no-sync-log',
]

CLI_ARGS_REJECT = [
    'cli_execute.py',
    '--input-json', '/fake/input.json',
    '--dry-run-report', '/fake/report.json',
    '--execute', '--confirm', 'P5-SY3B-PH',
    '--no-dry-run', '--no-sync-log',
]


# =========================================================================
# Mock 工具
# =========================================================================

def _setup_get_side_effect(mock_get):
    """配置 _get mock 返回适当的 mock 数据。"""
    def _side_effect(path):
        if 'inventory' in path and 'variant_id' in path:
            return MOCK_INVENTORY_LIST
        if 'product_variant' in path:
            return MOCK_VARIANT_LIST
        if 'warehouse' in path:
            return [MOCK_WAREHOUSE]
        return []
    mock_get.side_effect = _side_effect


def _start_cli_non_dry_run_mocks(*,
    rpc_side_effect=None,
    rpc_return=None,
    log_return=None,
    log_side_effect=None,
    fb_return=None,
    fb_side_effect=None,
    verify_inv_return=None,
    verify_wh_return=None,
    plan=None,
    dry_run_report=None,
):
    """为 cli_execute.main() 在 --no-dry-run 模式下设置完整 mock 链。

    返回 (ExitStack, mocks_dict)。调用方必须使用 `with stack:` 管理生命周期。
    """
    stack = ExitStack()
    m = {}

    m['argv'] = stack.enter_context(patch('sys.argv', CLI_ARGS_NO_DRY_RUN))
    m['isfile'] = stack.enter_context(patch('os.path.isfile', return_value=True))
    m['open'] = stack.enter_context(patch('builtins.open', mock_open()))
    # 阻止 _load_env() 因缺少 .env.local 而失败（模块已加载，但 main() 内
    # from .executor import 会重新触发模块级代码执行检查）
    m['supabase_url'] = stack.enter_context(
        patch('sync.executor._SUPABASE_URL', 'https://fake.supabase.co'))
    m['service_key'] = stack.enter_context(
        patch('sync.executor._SERVICE_KEY', 'fake-service-key'))
    m['json_load'] = stack.enter_context(patch('json.load',
        side_effect=[MOCK_INPUT_DATA,
                     dry_run_report if dry_run_report is not None
                     else MOCK_DRY_RUN_REPORT]))
    m['json_dump'] = stack.enter_context(patch('json.dump'))
    m['validate'] = stack.enter_context(
        patch('sync.input_validator.validate_json', return_value=MOCK_ROWS))
    m['fetch_wh'] = stack.enter_context(
        patch('sync.supabase_gateway.fetch_warehouse', return_value=MOCK_WAREHOUSE))
    m['fetch_var'] = stack.enter_context(
        patch('sync.supabase_gateway.fetch_variants', return_value=[]))
    m['fetch_inv'] = stack.enter_context(
        patch('sync.supabase_gateway.fetch_inventory_by_warehouse', return_value=[]))
    m['gen_plan'] = stack.enter_context(
        patch('sync.plan_generator.generate_plan',
              return_value=plan if plan is not None else SIMPLE_PLAN))
    m['compare'] = stack.enter_context(
        patch('sync.verifier.compare_plans', return_value=[]))

    if rpc_side_effect is not None:
        m['rpc'] = stack.enter_context(
            patch('sync.executor._call_sync_rpc', side_effect=rpc_side_effect))
    elif rpc_return is not None:
        m['rpc'] = stack.enter_context(
            patch('sync.executor._call_sync_rpc', return_value=rpc_return))
    else:
        m['rpc'] = stack.enter_context(patch('sync.executor._call_sync_rpc'))

    if log_side_effect is not None:
        m['log'] = stack.enter_context(
            patch('sync.executor._write_sync_log', side_effect=log_side_effect))
    elif log_return is not None:
        m['log'] = stack.enter_context(
            patch('sync.executor._write_sync_log', return_value=log_return))
    else:
        m['log'] = stack.enter_context(patch('sync.executor._write_sync_log'))

    if fb_side_effect is not None:
        m['fb'] = stack.enter_context(
            patch('sync.executor._save_fallback_log', side_effect=fb_side_effect))
    elif fb_return is not None:
        m['fb'] = stack.enter_context(
            patch('sync.executor._save_fallback_log', return_value=fb_return))
    else:
        m['fb'] = stack.enter_context(patch('sync.executor._save_fallback_log'))

    m['get'] = stack.enter_context(patch('sync.executor._get'))
    _setup_get_side_effect(m['get'])

    m['verify_inv'] = stack.enter_context(
        patch('sync.executor.verify_inventory_post_write',
              return_value=[] if verify_inv_return is None else verify_inv_return))
    m['verify_wh'] = stack.enter_context(
        patch('sync.executor.verify_warehouse_final_state',
              return_value=[] if verify_wh_return is None else verify_wh_return))

    m['wh_country'] = stack.enter_context(
        patch('sync.config.WAREHOUSE_COUNTRY', 'PH'))

    return stack, m


def _start_cli_dry_run_mocks():
    """为 cli_execute.main() 在 dry-run 模式下设置完整 mock 链（s18）。

    返回 (ExitStack, mocks_dict)。调用方必须使用 `with stack:` 管理生命周期。
    """
    stack = ExitStack()
    m = {}

    m['argv'] = stack.enter_context(patch('sys.argv', CLI_ARGS_DRY_RUN))
    m['isfile'] = stack.enter_context(patch('os.path.isfile', return_value=True))
    m['open'] = stack.enter_context(patch('builtins.open', mock_open()))
    m['supabase_url'] = stack.enter_context(
        patch('sync.executor._SUPABASE_URL', 'https://fake.supabase.co'))
    m['service_key'] = stack.enter_context(
        patch('sync.executor._SERVICE_KEY', 'fake-service-key'))
    m['json_load'] = stack.enter_context(patch('json.load',
        side_effect=[MOCK_INPUT_DATA, MOCK_DRY_RUN_REPORT]))
    m['json_dump'] = stack.enter_context(patch('json.dump'))
    m['validate'] = stack.enter_context(
        patch('sync.input_validator.validate_json', return_value=MOCK_ROWS))
    m['fetch_wh'] = stack.enter_context(
        patch('sync.supabase_gateway.fetch_warehouse', return_value=MOCK_WAREHOUSE))
    m['fetch_var'] = stack.enter_context(
        patch('sync.supabase_gateway.fetch_variants', return_value=[]))
    m['fetch_inv'] = stack.enter_context(
        patch('sync.supabase_gateway.fetch_inventory_by_warehouse', return_value=[]))
    m['gen_plan'] = stack.enter_context(
        patch('sync.plan_generator.generate_plan', return_value=SIMPLE_PLAN))
    m['compare'] = stack.enter_context(
        patch('sync.verifier.compare_plans', return_value=[]))
    m['execute_plan'] = stack.enter_context(
        patch('sync.executor.execute_plan', return_value=MOCK_EXECUTE_RESULT_DRY_RUN))
    m['rpc'] = stack.enter_context(patch('sync.executor._call_sync_rpc'))
    m['log'] = stack.enter_context(patch('sync.executor._write_sync_log'))
    m['fb'] = stack.enter_context(patch('sync.executor._save_fallback_log'))
    m['verify_inv'] = stack.enter_context(patch('sync.executor.verify_inventory_post_write'))
    m['verify_wh'] = stack.enter_context(patch('sync.executor.verify_warehouse_final_state'))
    m['get'] = stack.enter_context(patch('sync.executor._get'))
    m['wh_country'] = stack.enter_context(
        patch('sync.config.WAREHOUSE_COUNTRY', 'PH'))

    return stack, m


# =========================================================================
# 场景 1: 全部成功（混合 INSERT+UPDATE+UNCHANGED）
# =========================================================================

@test("场景01: 全部成功 → sync_log.success, exit 0")
def test_s01_all_success():
    stack, m = _start_cli_non_dry_run_mocks(
        rpc_return=MOCK_RPC_RESULT,
        log_return=MOCK_SYNC_LOG_SUCCESS,
    )
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(0)'
        except SystemExit as e:
            assert e.code == 0, f'退出码应为 0，实际: {e.code}'

        # (a) RPC 调用 1 次
        m['rpc'].assert_called_once()
        # (b) Phase G/I 审计已执行并通过
        assert m['get'].call_count >= 3, \
            f'Phase G/I 应查询数据库，实际 _get 调用 {m["get"].call_count} 次'
        m['verify_inv'].assert_called_once()
        m['verify_wh'].assert_called_once()
        # (c) SyncLog success
        m['log'].assert_called_once()
        assert m['log'].call_args[1]['status'] == 'success', \
            'sync_log status 应为 success'
        assert m['log'].call_args[1]['error_message'] is None, \
            'error_message 应为 None'
        # (d) Fallback 未调用
        m['fb'].assert_not_called()
        # (e) exit 0 已在上面验证


# =========================================================================
# 场景 2: RPC — SKU 无法解析 variant_id
# =========================================================================

@test("场景02: SKU 无法解析 variant_id → sync_log.failed, exit 1")
def test_s02_rpc_variant_id_resolve_fail():
    rpc_error = '无法解析 variant_id: sku=BAD001, country=PH'
    stack, m = _start_cli_non_dry_run_mocks(
        rpc_side_effect=RuntimeError(rpc_error),
        log_return=MOCK_SYNC_LOG_FAILED,
    )
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(1)'
        except SystemExit as e:
            assert e.code == 1, f'退出码应为 1，实际: {e.code}'

        # (a) RPC 恰好一次
        m['rpc'].assert_called_once()
        # (b) Phase G/I 审计未调用
        m['verify_inv'].assert_not_called()
        m['verify_wh'].assert_not_called()
        # (c) failed SyncLog
        m['log'].assert_called_once()
        assert m['log'].call_args[1]['status'] == 'failed'
        assert '无法解析 variant_id' in str(
            m['log'].call_args[1].get('error_message', ''))
        # (d) Fallback 未调用
        m['fb'].assert_not_called()
        # (e) exit 1 已验证


# =========================================================================
# 场景 3: p_variants 同 (sku,country) 去重错误
# =========================================================================

@test("场景03: p_variants 重复业务键 → sync_log.failed, exit 1")
def test_s03_p_variants_dup_key():
    rpc_error = 'p_variants 含重复 (sku,country) 业务键: sku=DUP, country=PH'
    stack, m = _start_cli_non_dry_run_mocks(
        rpc_side_effect=RuntimeError(rpc_error),
        log_return=MOCK_SYNC_LOG_FAILED,
    )
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(1)'
        except SystemExit as e:
            assert e.code == 1, f'退出码应为 1，实际: {e.code}'

        m['rpc'].assert_called_once()
        m['verify_inv'].assert_not_called()
        m['verify_wh'].assert_not_called()
        m['log'].assert_called_once()
        assert m['log'].call_args[1]['status'] == 'failed'
        assert '重复' in str(m['log'].call_args[1].get('error_message', ''))
        m['fb'].assert_not_called()


# =========================================================================
# 场景 4: p_inventory 同 (sku,country) 去重错误
# =========================================================================

@test("场景04: p_inventory 重复业务键 → sync_log.failed, exit 1")
def test_s04_p_inventory_dup_key():
    rpc_error = 'p_inventory 含重复 (sku,country) 业务键: sku=DUP, country=PH'
    stack, m = _start_cli_non_dry_run_mocks(
        rpc_side_effect=RuntimeError(rpc_error),
        log_return=MOCK_SYNC_LOG_FAILED,
    )
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(1)'
        except SystemExit as e:
            assert e.code == 1, f'退出码应为 1，实际: {e.code}'

        m['rpc'].assert_called_once()
        m['verify_inv'].assert_not_called()
        m['verify_wh'].assert_not_called()
        m['log'].assert_called_once()
        assert m['log'].call_args[1]['status'] == 'failed'
        assert '重复' in str(m['log'].call_args[1].get('error_message', ''))
        m['fb'].assert_not_called()


# =========================================================================
# 场景 5: quantity 负数
# =========================================================================

@test("场景05: quantity 负数 → sync_log.failed, exit 1")
def test_s05_quantity_negative():
    rpc_error = 'quantity 不能为负数: sku=WM0005, quantity=-1'
    stack, m = _start_cli_non_dry_run_mocks(
        rpc_side_effect=RuntimeError(rpc_error),
        log_return=MOCK_SYNC_LOG_FAILED,
    )
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(1)'
        except SystemExit as e:
            assert e.code == 1, f'退出码应为 1，实际: {e.code}'

        m['rpc'].assert_called_once()
        m['verify_inv'].assert_not_called()
        m['verify_wh'].assert_not_called()
        m['log'].assert_called_once()
        assert m['log'].call_args[1]['status'] == 'failed'
        assert '负数' in str(m['log'].call_args[1].get('error_message', ''))
        m['fb'].assert_not_called()


# =========================================================================
# 场景 6: Warehouse 不存在/非 overseas/已停用
# =========================================================================

@test("场景06: Warehouse 不存在/非 overseas/已停用 → sync_log.failed, exit 1")
def test_s06_warehouse_invalid():
    rpc_error = f'Warehouse 已停用: {WH_ID}'
    stack, m = _start_cli_non_dry_run_mocks(
        rpc_side_effect=RuntimeError(rpc_error),
        log_return=MOCK_SYNC_LOG_FAILED,
    )
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(1)'
        except SystemExit as e:
            assert e.code == 1, f'退出码应为 1，实际: {e.code}'

        m['rpc'].assert_called_once()
        m['verify_inv'].assert_not_called()
        m['verify_wh'].assert_not_called()
        m['log'].assert_called_once()
        assert m['log'].call_args[1]['status'] == 'failed'
        assert 'Warehouse' in str(m['log'].call_args[1].get('error_message', ''))
        m['fb'].assert_not_called()


# =========================================================================
# 场景 7: inventory/variant country 与 warehouse.country 不一致
# =========================================================================

@test("场景07: inventory/variant country 与 warehouse.country 不一致 → sync_log.failed, exit 1")
def test_s07_country_mismatch():
    rpc_error = 'Inventory country 必须等于 Warehouse country: inventory=TH, warehouse=PH (sku: WM0005)'
    stack, m = _start_cli_non_dry_run_mocks(
        rpc_side_effect=RuntimeError(rpc_error),
        log_return=MOCK_SYNC_LOG_FAILED,
    )
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(1)'
        except SystemExit as e:
            assert e.code == 1, f'退出码应为 1，实际: {e.code}'

        m['rpc'].assert_called_once()
        m['verify_inv'].assert_not_called()
        m['verify_wh'].assert_not_called()
        m['log'].assert_called_once()
        assert m['log'].call_args[1]['status'] == 'failed'
        error_msg = str(m['log'].call_args[1].get('error_message', ''))
        assert 'Warehouse country' in error_msg or '必须等于' in error_msg, \
            f'error_message 应包含 country 不一致提示: {error_msg[:200]}'
        m['fb'].assert_not_called()


# =========================================================================
# 场景 8: Warehouse 名称非法
# =========================================================================

@test("场景08: Warehouse 名称非法 → sync_log.failed, exit 1")
def test_s08_warehouse_name_illegal():
    rpc_error = 'Warehouse 名称非法: 当前名=异常仓库名'
    stack, m = _start_cli_non_dry_run_mocks(
        rpc_side_effect=RuntimeError(rpc_error),
        log_return=MOCK_SYNC_LOG_FAILED,
    )
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(1)'
        except SystemExit as e:
            assert e.code == 1, f'退出码应为 1，实际: {e.code}'

        m['rpc'].assert_called_once()
        m['verify_inv'].assert_not_called()
        m['verify_wh'].assert_not_called()
        m['log'].assert_called_once()
        assert m['log'].call_args[1]['status'] == 'failed'
        assert '名称' in str(m['log'].call_args[1].get('error_message', ''))
        m['fb'].assert_not_called()


# =========================================================================
# 场景 9: p_warehouse_name 为空或非正式目标名
# =========================================================================

@test("场景09: p_warehouse_name 非法 → sync_log.failed, exit 1")
def test_s09_p_warehouse_name_invalid():
    rpc_error = 'p_warehouse_name 必须为正式目标名, 实际: 错误名称'
    stack, m = _start_cli_non_dry_run_mocks(
        rpc_side_effect=RuntimeError(rpc_error),
        log_return=MOCK_SYNC_LOG_FAILED,
    )
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(1)'
        except SystemExit as e:
            assert e.code == 1, f'退出码应为 1，实际: {e.code}'

        m['rpc'].assert_called_once()
        m['verify_inv'].assert_not_called()
        m['verify_wh'].assert_not_called()
        m['log'].assert_called_once()
        assert m['log'].call_args[1]['status'] == 'failed'
        assert 'p_warehouse_name' in str(m['log'].call_args[1].get('error_message', ''))
        m['fb'].assert_not_called()


# =========================================================================
# 场景 10: Variant/Inventory country ≠ Warehouse country
# =========================================================================

@test("场景10: 跨国家输入 → sync_log.failed, exit 1")
def test_s10_cross_country():
    rpc_error = (
        'Inventory country 必须等于 Warehouse country: '
        'inventory=TH, warehouse=PH (sku: WM0005)'
    )
    stack, m = _start_cli_non_dry_run_mocks(
        rpc_side_effect=RuntimeError(rpc_error),
        log_return=MOCK_SYNC_LOG_FAILED,
    )
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(1)'
        except SystemExit as e:
            assert e.code == 1, f'退出码应为 1，实际: {e.code}'

        m['rpc'].assert_called_once()
        m['verify_inv'].assert_not_called()
        m['verify_wh'].assert_not_called()
        m['log'].assert_called_once()
        assert m['log'].call_args[1]['status'] == 'failed'
        assert 'country' in str(m['log'].call_args[1].get('error_message', '')).lower()
        m['fb'].assert_not_called()


# =========================================================================
# 场景 11: 事务内写后核对 — 缺失 Inventory 记录
# =========================================================================

@test("场景11: 写后核对缺失 Inventory → sync_log.failed, exit 1")
def test_s11_post_write_missing_inventory():
    rpc_error = '写后核对: 缺失 Inventory 记录: sku=WM0005, country=PH'
    stack, m = _start_cli_non_dry_run_mocks(
        rpc_side_effect=RuntimeError(rpc_error),
        log_return=MOCK_SYNC_LOG_FAILED,
    )
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(1)'
        except SystemExit as e:
            assert e.code == 1, f'退出码应为 1，实际: {e.code}'

        m['rpc'].assert_called_once()
        m['verify_inv'].assert_not_called()
        m['verify_wh'].assert_not_called()
        m['log'].assert_called_once()
        assert m['log'].call_args[1]['status'] == 'failed'
        assert '缺失 Inventory' in str(m['log'].call_args[1].get('error_message', ''))
        m['fb'].assert_not_called()


# =========================================================================
# 场景 12: 事务内写后核对 — quantity 不一致
# =========================================================================

@test("场景12: 写后核对 quantity 不一致 → sync_log.failed, exit 1")
def test_s12_post_write_quantity_mismatch():
    rpc_error = '写后核对: quantity 不一致: sku=WM0005, 期望=1500, 实际=9999'
    stack, m = _start_cli_non_dry_run_mocks(
        rpc_side_effect=RuntimeError(rpc_error),
        log_return=MOCK_SYNC_LOG_FAILED,
    )
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(1)'
        except SystemExit as e:
            assert e.code == 1, f'退出码应为 1，实际: {e.code}'

        m['rpc'].assert_called_once()
        m['verify_inv'].assert_not_called()
        m['verify_wh'].assert_not_called()
        m['log'].assert_called_once()
        assert m['log'].call_args[1]['status'] == 'failed'
        assert 'quantity' in str(m['log'].call_args[1].get('error_message', '')).lower()
        m['fb'].assert_not_called()


# =========================================================================
# 场景 13: post-commit 审计失败
# =========================================================================

@test("场景13: 二次审计发现差异 → sync_log.failed, exit 1")
def test_s13_post_commit_audit_fail():
    audit_diffs = ['SKU WM0005: expected 1500, got 9999']
    stack, m = _start_cli_non_dry_run_mocks(
        rpc_return=MOCK_RPC_RESULT,
        log_return=MOCK_SYNC_LOG_FAILED,
        verify_inv_return=audit_diffs,
    )
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(1)'
        except SystemExit as e:
            assert e.code == 1, f'退出码应为 1，实际: {e.code}'

        # (a) RPC 恰好一次
        m['rpc'].assert_called_once()
        # (b) Phase G 审计执行但失败，Phase I 未执行（Phase G 失败后终止）
        m['verify_inv'].assert_called_once()
        m['verify_wh'].assert_not_called()
        # (c) failed SyncLog，含审计失败信息
        m['log'].assert_called_once()
        assert m['log'].call_args[1]['status'] == 'failed'
        error_msg = str(m['log'].call_args[1].get('error_message', ''))
        assert 'post-commit audit failed' in error_msg.lower(), \
            f'error_message 应包含 post-commit audit failed: {error_msg[:200]}'
        assert 'WM0005' in error_msg, \
            f'error_message 应包含差异 SKU: {error_msg[:200]}'
        # (d) Fallback 未调用
        m['fb'].assert_not_called()
        # (e) exit 1 已验证


# =========================================================================
# 场景 14: sync_log.success 写入失败 → fallback + exit 2
# =========================================================================

@test("场景14: sync_log.success 写入失败 → fallback + exit 2")
def test_s14_sync_log_success_write_fail():
    fb_path = '/fake/fallback/fallback-sync-log-20260613-120000.json'
    stack, m = _start_cli_non_dry_run_mocks(
        rpc_return=MOCK_RPC_RESULT,
        log_side_effect=RuntimeError('sync_log 写入失败（重试 1 次后仍失败）'),
        fb_return=fb_path,
    )
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(2)'
        except SystemExit as e:
            assert e.code == 2, f'退出码应为 2，实际: {e.code}'

        # (a) RPC 恰好一次且成功
        m['rpc'].assert_called_once()
        # (b) Phase G/I 审计执行并通过
        m['verify_inv'].assert_called_once()
        m['verify_wh'].assert_called_once()
        # (c) SyncLog 尝试写入但失败
        m['log'].assert_called()
        assert m['log'].call_args[1]['status'] == 'success'
        # (d) Fallback 已调用
        m['fb'].assert_called_once()
        # (e) exit 2 已验证


# =========================================================================
# 场景 15: sync_log.failed 写入失败 → fallback + exit 1
# =========================================================================

@test("场景15: sync_log.failed 写入失败 → fallback + exit 1")
def test_s15_sync_log_failed_write_fail():
    rpc_error = 'quantity 不能为负数: sku=BAD, quantity=-5'
    fb_path = '/fake/fallback/fallback-sync-log-20260613-120000.json'
    stack, m = _start_cli_non_dry_run_mocks(
        rpc_side_effect=RuntimeError(rpc_error),
        log_side_effect=RuntimeError('sync_log 写入失败'),
        fb_return=fb_path,
    )
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(1)'
        except SystemExit as e:
            assert e.code == 1, f'退出码应为 1，实际: {e.code}'

        # (a) RPC 恰好一次（失败）
        m['rpc'].assert_called_once()
        # (b) Phase G/I 审计未调用
        m['verify_inv'].assert_not_called()
        m['verify_wh'].assert_not_called()
        # (c) SyncLog 尝试写入但失败
        m['log'].assert_called()
        assert m['log'].call_args[1]['status'] == 'failed'
        # (d) Fallback 已调用
        m['fb'].assert_called_once()
        fallback_data = m['fb'].call_args[0][0]
        assert fallback_data['status'] == 'failed', \
            'fallback 数据 status 应为 failed'
        # (e) exit 1 已验证


# =========================================================================
# 场景 16: 网络超时（结果未知）
# =========================================================================

@test("场景16: 网络超时 → network_timeout_unknown + exit 1")
def test_s16_network_timeout():
    rpc_error = (
        'network_timeout_unknown: RPC 网络错误（未重试，仅发送一次请求）\n'
        '原始错误: connection refused\n'
        '分类: network_timeout_unknown'
    )
    stack, m = _start_cli_non_dry_run_mocks(
        rpc_side_effect=RuntimeError(rpc_error),
        log_return=MOCK_SYNC_LOG_FAILED,
    )
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(1)'
        except SystemExit as e:
            assert e.code == 1, f'退出码应为 1，实际: {e.code}'

        # (a) RPC 恰好一次（不重试）
        m['rpc'].assert_called_once()
        # (b) Phase G/I 审计未调用
        m['verify_inv'].assert_not_called()
        m['verify_wh'].assert_not_called()
        # (c) failed SyncLog 含 network_timeout_unknown
        m['log'].assert_called_once()
        assert m['log'].call_args[1]['status'] == 'failed'
        error_msg = str(m['log'].call_args[1].get('error_message', ''))
        assert 'network_timeout_unknown' in error_msg.lower(), \
            f'error_message 应包含 network_timeout_unknown: {error_msg[:200]}'
        # (d) Fallback 未调用
        m['fb'].assert_not_called()
        # (e) exit 1 已验证


# =========================================================================
# 场景 17: --no-dry-run --no-sync-log CLI 拒绝
# =========================================================================

@test("场景17: --no-dry-run --no-sync-log CLI 拒绝 → exit 1")
def test_s17_cli_reject_no_sync_log():
    """完整 Mock 链验证：--no-dry-run --no-sync-log 在参数解析后立即拒绝，
    不触及文件加载、Supabase 查询、RPC 调用或审计。"""
    import io as _io
    stdout_buf = _io.StringIO()
    _m_open = mock_open()

    with patch('sys.argv', CLI_ARGS_REJECT), \
         patch('sync.config.WAREHOUSE_COUNTRY', 'PH'), \
         patch('os.path.isfile', return_value=True) as mock_isfile, \
         patch('builtins.open', _m_open) as mock_file, \
         patch('json.load') as mock_json_load, \
         patch('sys.stdout', stdout_buf), \
         patch('sync.supabase_gateway.fetch_warehouse') as mock_fetch_wh, \
         patch('sync.supabase_gateway.fetch_variants') as mock_fetch_var, \
         patch('sync.supabase_gateway.fetch_inventory_by_warehouse') as mock_fetch_inv, \
         patch('sync.executor._call_sync_rpc') as mock_rpc, \
         patch('sync.executor._write_sync_log') as mock_log, \
         patch('sync.executor._save_fallback_log') as mock_fb, \
         patch('sync.executor.verify_inventory_post_write') as mock_verify_inv, \
         patch('sync.executor.verify_warehouse_final_state') as mock_verify_wh, \
         patch('sync.executor._get') as mock_get:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(1)'
        except SystemExit as e:
            assert e.code == 1, f'退出码应为 1，实际: {e.code}'

        stdout_text = stdout_buf.getvalue()
        assert '非 Dry Run 模式禁止使用 --no-sync-log' in stdout_text, \
            f'stdout 应包含拒绝消息，实际: {stdout_text!r}'

        # 文件 I/O 未调用（拒绝发生在参数解析后，文件加载前）
        mock_isfile.assert_not_called()
        mock_file.assert_not_called()
        mock_json_load.assert_not_called()

        # Supabase 查询未调用
        mock_fetch_wh.assert_not_called()
        mock_fetch_var.assert_not_called()
        mock_fetch_inv.assert_not_called()

        # RPC、审计、SyncLog、fallback 未调用
        mock_rpc.assert_not_called()
        mock_log.assert_not_called()
        mock_fb.assert_not_called()
        mock_verify_inv.assert_not_called()
        mock_verify_wh.assert_not_called()
        mock_get.assert_not_called()


# =========================================================================
# 场景 18: --dry-run --no-sync-log CLI 接受 → exit 0
# =========================================================================

@test("场景18: --dry-run --no-sync-log CLI 接受 → exit 0")
def test_s18_cli_accept_dry_run_no_sync_log():
    """完整 Mock Dry Run CLI 流程，严格断言 SystemExit.code == 0。"""
    stack, m = _start_cli_dry_run_mocks()
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(0)'
        except SystemExit as e:
            assert e.code == 0, f'退出码应为 0，实际: {e.code}'

        # 验证 execute_plan（旧版 dry-run 执行器）被调用
        m['execute_plan'].assert_called_once()
        exec_call = m['execute_plan'].call_args
        assert exec_call[1]['dry_run'] is True, \
            'dry_run 参数应为 True'
        assert exec_call[1]['confirm'] == 'P5-SY3B-PH', \
            'confirm 令牌应为 P5-SY3B-PH'

        # RPC、Phase G/I 审计、SyncLog、fallback 均未调用
        m['rpc'].assert_not_called()
        m['log'].assert_not_called()
        m['fb'].assert_not_called()
        m['verify_inv'].assert_not_called()
        m['verify_wh'].assert_not_called()
        m['get'].assert_not_called()


# =========================================================================
# 场景 19: 非 service_role 调用 RPC
# =========================================================================

@test("场景19: 非 service_role 权限 → permission denied + exit 1")
def test_s19_permission_denied():
    rpc_error = (
        'Supabase RPC 错误 (401): permission denied for function '
        'sync_warehouse_inventory'
    )
    stack, m = _start_cli_non_dry_run_mocks(
        rpc_side_effect=RuntimeError(rpc_error),
        log_return=MOCK_SYNC_LOG_FAILED,
    )
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(1)'
        except SystemExit as e:
            assert e.code == 1, f'退出码应为 1，实际: {e.code}'

        m['rpc'].assert_called_once()
        m['verify_inv'].assert_not_called()
        m['verify_wh'].assert_not_called()
        m['log'].assert_called_once()
        assert m['log'].call_args[1]['status'] == 'failed'
        error_msg = str(m['log'].call_args[1].get('error_message', ''))
        assert 'permission' in error_msg.lower() or '401' in error_msg.lower(), \
            f'应包含 permission denied: {error_msg[:200]}'
        m['fb'].assert_not_called()


# =========================================================================
# 场景 20: 全部库存不变（last_sync_at 刷新）
# =========================================================================

@test("场景20: 全部库存不变 → sync_log.success, exit 0")
def test_s20_all_unchanged():
    stack, m = _start_cli_non_dry_run_mocks(
        rpc_return=MOCK_RPC_ALL_UNCHANGED,
        log_return=MOCK_SYNC_LOG_SUCCESS,
        dry_run_report=MOCK_DRY_RUN_REPORT_ALL_UNCHANGED,
    )
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(0)'
        except SystemExit as e:
            assert e.code == 0, f'退出码应为 0，实际: {e.code}'

        # (a) RPC 恰好一次
        m['rpc'].assert_called_once()
        # (b) Phase G/I 审计已执行
        m['verify_inv'].assert_called_once()
        m['verify_wh'].assert_called_once()
        # (c) SyncLog success
        m['log'].assert_called_once()
        assert m['log'].call_args[1]['status'] == 'success'
        assert m['log'].call_args[1]['error_message'] is None
        # (d) Fallback 未调用
        m['fb'].assert_not_called()
        # (e) exit 0 已验证


# =========================================================================
# 场景 21: 新 Variant 缺少对应 Inventory
# =========================================================================

@test("场景21: 新 Variant 缺少 Inventory → 全部未调用 + exit 1")
def test_s21_new_variant_no_inventory():
    """_build_rpc_payload 校验失败 → RPC/审计/SyncLog/Fallback 均不调用。"""
    stack, m = _start_cli_non_dry_run_mocks(
        plan=PLAN_ORPHAN_VARIANT,
        # RPC/log/fb 保持默认 mock（不应被调用）
    )
    # 移除 rpc_return/rpc_side_effect，让真实 _call_sync_rpc 保持为 MagicMock
    #   — 若被调用会通过 assert_not_called 捕获
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(1)'
        except SystemExit as e:
            assert e.code == 1, f'退出码应为 1，实际: {e.code}'

        # (a) RPC 未调用
        m['rpc'].assert_not_called()
        # (b) Phase G/I 审计未调用
        m['verify_inv'].assert_not_called()
        m['verify_wh'].assert_not_called()
        # _get 仅被 CLI 步骤 3（查询 Supabase 状态）调用，不被 executor 审计调用
        # (c) SyncLog 未调用
        m['log'].assert_not_called()
        # (d) Fallback 未调用
        m['fb'].assert_not_called()
        # (e) exit 1 已验证


# =========================================================================
# 场景 22: p_inventory 为空数组
# =========================================================================

@test("场景22: p_inventory 为空 → 全部未调用 + exit 1")
def test_s22_empty_inventory():
    """空库存快照被 _build_rpc_payload 拒绝。"""
    stack, m = _start_cli_non_dry_run_mocks(
        plan=PLAN_EMPTY_INVENTORY,
    )
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(1)'
        except SystemExit as e:
            assert e.code == 1, f'退出码应为 1，实际: {e.code}'

        # (a) RPC 未调用
        m['rpc'].assert_not_called()
        # (b) Phase G/I 审计未调用
        m['verify_inv'].assert_not_called()
        m['verify_wh'].assert_not_called()
        # (c) SyncLog 未调用
        m['log'].assert_not_called()
        # (d) Fallback 未调用
        m['fb'].assert_not_called()
        # (e) exit 1 已验证


# =========================================================================
# 场景 23: last_sync_at 为空或无法解析
# =========================================================================

@test("场景23: last_sync_at 为空/无法解析 → RPC 错误 + sync_log.failed, exit 1")
def test_s23_last_sync_at_invalid():
    rpc_error = 'last_sync_at 不能为空: sku=WM0005, country=PH'
    stack, m = _start_cli_non_dry_run_mocks(
        rpc_side_effect=RuntimeError(rpc_error),
        log_return=MOCK_SYNC_LOG_FAILED,
    )
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(1)'
        except SystemExit as e:
            assert e.code == 1, f'退出码应为 1，实际: {e.code}'

        m['rpc'].assert_called_once()
        m['verify_inv'].assert_not_called()
        m['verify_wh'].assert_not_called()
        m['log'].assert_called_once()
        assert m['log'].call_args[1]['status'] == 'failed'
        error_msg = str(m['log'].call_args[1].get('error_message', ''))
        assert 'last_sync_at' in error_msg.lower(), \
            f'error_message 应含 last_sync_at: {error_msg[:200]}'
        m['fb'].assert_not_called()


# =========================================================================
# 场景 24: 同一快照 last_sync_at 不一致
# =========================================================================

@test("场景24: 同一快照 last_sync_at 不一致 → RPC 错误 + sync_log.failed, exit 1")
def test_s24_last_sync_at_inconsistent():
    rpc_error = (
        '同一次快照内 last_sync_at 不一致: sku=WM0005, country=PH, '
        '统一时间=2026-06-13T12:00:00+08:00, 本条时间=2026-06-13T12:01:00+08:00'
    )
    stack, m = _start_cli_non_dry_run_mocks(
        rpc_side_effect=RuntimeError(rpc_error),
        log_return=MOCK_SYNC_LOG_FAILED,
    )
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(1)'
        except SystemExit as e:
            assert e.code == 1, f'退出码应为 1，实际: {e.code}'

        m['rpc'].assert_called_once()
        m['verify_inv'].assert_not_called()
        m['verify_wh'].assert_not_called()
        m['log'].assert_called_once()
        assert m['log'].call_args[1]['status'] == 'failed'
        error_msg = str(m['log'].call_args[1].get('error_message', ''))
        assert ('不一致' in error_msg or 'last_sync_at' in error_msg.lower()), \
            f'error_message 应含 last_sync_at 不一致: {error_msg[:200]}'
        m['fb'].assert_not_called()


# =========================================================================
# 补充: RPC 摘要校验失败（RPC 返回不可用数据）
# =========================================================================

@test("补充: RPC 返回摘要校验失败 → sync_log.failed, exit 1")
def test_s_extra_rpc_summary_validation_fail():
    """RPC HTTP 200 但摘要缺少必需字段 → sync_log.failed via CLI exit 1。"""
    bad_rpc_result = {'variants_created': 0}  # 缺 inventory_received 等
    stack, m = _start_cli_non_dry_run_mocks(
        rpc_return=bad_rpc_result,
        log_return=MOCK_SYNC_LOG_FAILED,
    )
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(1)'
        except SystemExit as e:
            assert e.code == 1, f'退出码应为 1，实际: {e.code}'

        m['rpc'].assert_called_once()
        m['verify_inv'].assert_not_called()
        m['verify_wh'].assert_not_called()
        m['log'].assert_called_once()
        assert m['log'].call_args[1]['status'] == 'failed'
        error_msg = str(m['log'].call_args[1].get('error_message', ''))
        assert 'RPC 返回摘要校验失败' in error_msg, \
            f'应包含 RPC 返回摘要校验失败: {error_msg[:200]}'
        m['fb'].assert_not_called()


# =========================================================================
# 补充: sync_log 写入失败且 fallback 也失败（双失败 stderr 输出）
# =========================================================================

@test("补充: RPC 成功 + sync_log 失败 + fallback 失败 → stderr 警告 + exit 2")
def test_s_extra_rpc_success_double_fail():
    import io as _io
    stderr_buf = _io.StringIO()

    stack, m = _start_cli_non_dry_run_mocks(
        rpc_return=MOCK_RPC_RESULT,
        log_side_effect=RuntimeError('sync_log 写入失败'),
        fb_side_effect=OSError('磁盘空间不足'),
    )
    with patch('sys.stderr', stderr_buf):
        with stack:
            try:
                from sync.cli_execute import main
                main()
                assert False, '应调用 sys.exit(2)'
            except SystemExit as e:
                assert e.code == 2, f'退出码应为 2，实际: {e.code}'

            m['rpc'].assert_called_once()
            m['verify_inv'].assert_called_once()
            m['verify_wh'].assert_called_once()
            m['log'].assert_called()
            m['fb'].assert_called_once()

            stderr_text = stderr_buf.getvalue()
            assert ('sync_log 写入失败且 fallback 保存失败' in stderr_text), \
                f'stderr 应包含双失败警告: {stderr_text!r}'


# =========================================================================
# 补充: sync_log_enabled=False 跳过所有 sync_log 操作
# =========================================================================

@test("补充: sync_log_enabled=False → sync_log 不调用 + RPC 仍执行")
def test_s_extra_sync_log_disabled():
    """sync_log_enabled=False 时 CLI 仍可通过（dry-run 模式跳过 sync_log）。
    此处直接测试 execute_plan_v2 以精确验证 sync_log_enabled 参数行为。"""
    import sync.executor as ex
    with patch('sync.executor._call_sync_rpc') as mock_rpc, \
         patch('sync.executor._get') as mock_get, \
         patch('sync.executor.verify_inventory_post_write') as mock_verify_inv, \
         patch('sync.executor.verify_warehouse_final_state') as mock_verify_wh, \
         patch('sync.executor._write_sync_log') as mock_log:
        mock_rpc.return_value = MOCK_RPC_RESULT
        _setup_get_side_effect(mock_get)
        mock_verify_inv.return_value = []
        mock_verify_wh.return_value = []

        result = ex.execute_plan_v2(SIMPLE_PLAN, sync_log_enabled=False,
                                    last_sync_at=SYNC_AT)

        assert result['rpc_summary'] is not None, 'RPC 应执行'
        mock_rpc.assert_called_once()
        assert not mock_log.called, 'sync_log 不应被调用'
        assert result['sync_log_written'] is False
        assert result['phase_g_verified'] is True
        assert result['phase_i_verified'] is True


# =========================================================================
# 补充: P5-SY8B-VN 令牌
# =========================================================================

VN_NO_DRY_RUN_ARGS = [
    'cli_execute.py',
    '--input-json', '/fake/input-vn.json',
    '--dry-run-report', '/fake/report-vn.json',
    '--execute', '--confirm', 'P5-SY8B-VN',
    '--no-dry-run',
]


@test("补充: P5-SY8B-VN 令牌 --no-dry-run 全部成功 → exit 0")
def test_s_extra_vn_token_no_dry_run_success():
    """P5-SY8B-VN token + --no-dry-run: full success path, synced_count correct."""
    stack = ExitStack()
    m = {}
    m['argv'] = stack.enter_context(patch('sys.argv', VN_NO_DRY_RUN_ARGS))
    m['wh_country'] = stack.enter_context(
        patch('sync.config.WAREHOUSE_COUNTRY', 'VN'))
    m['isfile'] = stack.enter_context(patch('os.path.isfile', return_value=True))
    m['open'] = stack.enter_context(patch('builtins.open', mock_open()))
    m['supabase_url'] = stack.enter_context(
        patch('sync.executor._SUPABASE_URL', 'https://fake.supabase.co'))
    m['service_key'] = stack.enter_context(
        patch('sync.executor._SERVICE_KEY', 'fake-service-key'))
    m['json_load'] = stack.enter_context(patch('json.load',
        side_effect=[MOCK_INPUT_DATA, MOCK_DRY_RUN_REPORT]))
    m['json_dump'] = stack.enter_context(patch('json.dump'))
    m['validate'] = stack.enter_context(
        patch('sync.input_validator.validate_json', return_value=MOCK_ROWS))
    m['fetch_wh'] = stack.enter_context(
        patch('sync.supabase_gateway.fetch_warehouse', return_value=MOCK_WAREHOUSE))
    m['fetch_var'] = stack.enter_context(
        patch('sync.supabase_gateway.fetch_variants', return_value=[]))
    m['fetch_inv'] = stack.enter_context(
        patch('sync.supabase_gateway.fetch_inventory_by_warehouse', return_value=[]))
    m['gen_plan'] = stack.enter_context(
        patch('sync.plan_generator.generate_plan', return_value=SIMPLE_PLAN))
    m['compare'] = stack.enter_context(
        patch('sync.verifier.compare_plans', return_value=[]))
    m['rpc'] = stack.enter_context(
        patch('sync.executor._call_sync_rpc', return_value=MOCK_RPC_RESULT))
    m['log'] = stack.enter_context(
        patch('sync.executor._write_sync_log', return_value=MOCK_SYNC_LOG_SUCCESS))
    m['fb'] = stack.enter_context(patch('sync.executor._save_fallback_log'))
    m['get'] = stack.enter_context(patch('sync.executor._get'))
    _setup_get_side_effect(m['get'])
    m['verify_inv'] = stack.enter_context(
        patch('sync.executor.verify_inventory_post_write', return_value=[]))
    m['verify_wh'] = stack.enter_context(
        patch('sync.executor.verify_warehouse_final_state', return_value=[]))
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(0)'
        except SystemExit as e:
            assert e.code == 0, f'退出码应为 0，实际: {e.code}'

        # (a) RPC 调用 1 次
        m['rpc'].assert_called_once()
        # (b) Phase G/I 审计已执行并通过
        m['verify_inv'].assert_called_once()
        m['verify_wh'].assert_called_once()
        # (c) SyncLog success
        m['log'].assert_called_once()
        assert m['log'].call_args[1]['status'] == 'success'
        assert m['log'].call_args[1]['error_message'] is None
        # (d) Fallback 未调用
        m['fb'].assert_not_called()


@test("补充: 无效令牌在 --no-dry-run 路径被拒绝 fail-fast，在任何 I/O 前 exit 1")
def test_s_extra_invalid_token_rejected_before_io():
    """Invalid token must be rejected after argparse parsing, before any I/O or network."""
    import io as _io
    stdout_buf = _io.StringIO()
    _m_open = mock_open()

    invalid_argv = [
        'cli_execute.py',
        '--input-json', '/fake/input.json',
        '--dry-run-report', '/fake/report.json',
        '--execute', '--confirm', 'BAD-TOKEN',
        '--no-dry-run',
    ]
    with patch('sys.argv', invalid_argv), \
         patch('os.path.isfile', return_value=True) as mock_isfile, \
         patch('builtins.open', _m_open) as mock_file, \
         patch('json.load') as mock_json_load, \
         patch('sys.stdout', stdout_buf), \
         patch('sync.supabase_gateway.fetch_warehouse') as mock_fetch_wh, \
         patch('sync.supabase_gateway.fetch_variants') as mock_fetch_var, \
         patch('sync.supabase_gateway.fetch_inventory_by_warehouse') as mock_fetch_inv, \
         patch('sync.executor._call_sync_rpc') as mock_rpc, \
         patch('sync.executor._write_sync_log') as mock_log, \
         patch('sync.executor._save_fallback_log') as mock_fb, \
         patch('sync.executor.verify_inventory_post_write') as mock_verify_inv, \
         patch('sync.executor.verify_warehouse_final_state') as mock_verify_wh, \
         patch('sync.executor._get') as mock_get, \
         patch('sync.executor._SUPABASE_URL', 'https://fake.supabase.co'), \
         patch('sync.executor._SERVICE_KEY', 'fake-service-key'):
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(1)'
        except SystemExit as e:
            assert e.code == 1, f'退出码应为 1，实际: {e.code}'

        stdout_text = stdout_buf.getvalue()
        assert '确认令牌不匹配' in stdout_text, \
            f'stdout 应包含确认令牌不匹配，实际: {stdout_text!r}'

        # 所有 I/O、Supabase 查询、RPC 未调用
        mock_isfile.assert_not_called()
        mock_file.assert_not_called()
        mock_json_load.assert_not_called()
        mock_fetch_wh.assert_not_called()
        mock_fetch_var.assert_not_called()
        mock_fetch_inv.assert_not_called()
        mock_rpc.assert_not_called()
        mock_log.assert_not_called()
        mock_fb.assert_not_called()
        mock_verify_inv.assert_not_called()
        mock_verify_wh.assert_not_called()
        mock_get.assert_not_called()


# =========================================================================
# 运行
# =========================================================================

if __name__ == '__main__':
    print('=' * 60)
    print('P5-SY4D SyncLog 失败模式测试（返工版）')
    print('Mock 覆盖 24 场景 — 全部通过 cli_execute.main() 验证退出码')
    print('=' * 60)
    print()

    # 成功路径
    test_s01_all_success()
    test_s20_all_unchanged()

    # RPC/PG 错误（零写入）
    test_s02_rpc_variant_id_resolve_fail()
    test_s03_p_variants_dup_key()
    test_s04_p_inventory_dup_key()
    test_s05_quantity_negative()
    test_s06_warehouse_invalid()
    test_s07_country_mismatch()
    test_s08_warehouse_name_illegal()
    test_s09_p_warehouse_name_invalid()
    test_s10_cross_country()
    test_s11_post_write_missing_inventory()
    test_s12_post_write_quantity_mismatch()

    # post-commit 审计失败
    test_s13_post_commit_audit_fail()

    # SyncLog 写入失败与 fallback
    test_s14_sync_log_success_write_fail()
    test_s15_sync_log_failed_write_fail()

    # 网络超时
    test_s16_network_timeout()

    # CLI 参数校验
    test_s17_cli_reject_no_sync_log()
    test_s18_cli_accept_dry_run_no_sync_log()

    # 权限
    test_s19_permission_denied()

    # 边界场景
    test_s21_new_variant_no_inventory()
    test_s22_empty_inventory()
    test_s23_last_sync_at_invalid()
    test_s24_last_sync_at_inconsistent()

    # 补充场景
    test_s_extra_rpc_summary_validation_fail()
    test_s_extra_rpc_success_double_fail()
    test_s_extra_sync_log_disabled()

    # P5-SY8B VN 令牌
    test_s_extra_vn_token_no_dry_run_success()
    test_s_extra_invalid_token_rejected_before_io()

    print()
    print('=' * 60)
    print(f'结果: {PASS} 通过, {FAIL} 失败 (共 {PASS + FAIL} 项)')
    print('=' * 60)

    sys.exit(0 if FAIL == 0 else 1)
