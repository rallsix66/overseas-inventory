"""P5-SY4E CLI 集成测试 — 参数互斥、退出码、报告内容、写入路径未调用。

不依赖 Supabase 连接或写入。所有场景通过 cli_execute.main() 验证。
"""
import sys
import os
import json
import io as _io
from contextlib import ExitStack
from unittest.mock import patch, mock_open

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 必须在 mock 设置前预导入所有含 _load_env 的模块
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

BASE_CLI_ARGS = [
    'cli_execute.py',
    '--input-json', '/fake/input.json',
    '--dry-run-report', '/fake/report.json',
    '--execute', '--confirm', 'P5-SY3B-PH',
]

MOCK_INPUT_DATA = {
    'warehouse': '菲律宾-新创启辰自建仓',
    'row_count': 91,
    'rows': [],
}

MOCK_DRY_RUN_REPORT = {
    'counts': {
        'input_rows': 91,
        'new_variants': 91,
        'inventory_after_variant_create': 91,
        'total_inventory_actions': 91,
    },
}

MOCK_WAREHOUSE = {
    'id': WH_ID,
    'name': '菲律宾-新创启辰自建仓',
}

MOCK_ROWS = []

SIMPLE_PLAN = {
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

MOCK_EXECUTE_RESULT_DRY_RUN = {
    'started_at': SYNC_AT,
    'finished_at': SYNC_AT,
    'warehouse_id': WH_ID,
    'warehouse_name_before': '菲律宾仓',
    'warehouse_name_after': '菲律宾-新创启辰自建仓',
    'warehouse_renamed': False,
    'variants_before': 91,
    'variants_created': 0,
    'variants_skipped': 0,
    'variants_total': 91,
    'inventory_before': 91,
    'inventory_inserted': 0,
    'inventory_updated': 0,
    'inventory_unchanged': 0,
    'inventory_total': 91,
    'inventory_write_actions': 91,
    'rpc_summary': None,
    'phase_g_verified': False,
    'phase_i_verified': False,
    'sync_log_written': False,
    'sync_log_fallback_path': None,
    'errors': [],
}


# 非空计划漂移差异（模拟数据库已写入后的状态）
MOCK_DRIFT_DIFFS = [
    'Warehouse 改名动作不一致: 当前=none, 存储=rename',
    'new_variants 数量不一致: 当前=0, 存储=91',
    'inventory_after_variant_create 数量不一致: 当前=0, 存储=91',
]


# =========================================================================
# Mock 辅助函数
# =========================================================================

def _start_dry_run_mocks(extra_args=None, diffs=None):
    """启动完整 Dry Run Mock 链。

    返回 (ExitStack, mock_dict)。mock_dict 含所有 patcher 便于断言。
    diffs 为 None 时默认返回空列表（无漂移）。
    """
    argv = list(BASE_CLI_ARGS)
    if extra_args:
        argv.extend(extra_args)

    stack = ExitStack()
    m = {}
    m['argv'] = stack.enter_context(patch('sys.argv', argv))
    m['isfile'] = stack.enter_context(patch('os.path.isfile', return_value=True))
    m['open'] = stack.enter_context(patch('builtins.open', mock_open()))
    m['json_load'] = stack.enter_context(patch('json.load',
        side_effect=[MOCK_INPUT_DATA, MOCK_DRY_RUN_REPORT]))
    m['json_dump'] = stack.enter_context(patch('json.dump'))
    m['validate'] = stack.enter_context(
        patch('sync.input_validator.validate_json', return_value=MOCK_ROWS))
    m['fetch_wh'] = stack.enter_context(
        patch('sync.supabase_gateway.fetch_ph_warehouse', return_value=MOCK_WAREHOUSE))
    m['fetch_var'] = stack.enter_context(
        patch('sync.supabase_gateway.fetch_ph_variants', return_value=[]))
    m['fetch_inv'] = stack.enter_context(
        patch('sync.supabase_gateway.fetch_inventory_by_warehouse', return_value=[]))
    m['gen_plan'] = stack.enter_context(
        patch('sync.plan_generator.generate_plan', return_value=SIMPLE_PLAN))
    _diffs = [] if diffs is None else diffs
    m['compare'] = stack.enter_context(
        patch('sync.verifier.compare_plans', return_value=_diffs))
    m['execute_plan'] = stack.enter_context(
        patch('sync.executor.execute_plan', return_value=MOCK_EXECUTE_RESULT_DRY_RUN))
    m['execute_plan_v2'] = stack.enter_context(
        patch('sync.executor.execute_plan_v2'))
    m['rpc'] = stack.enter_context(patch('sync.executor._call_sync_rpc'))
    m['log'] = stack.enter_context(patch('sync.executor._write_sync_log'))
    m['fb'] = stack.enter_context(patch('sync.executor._save_fallback_log'))
    m['verify_inv'] = stack.enter_context(patch('sync.executor.verify_inventory_post_write'))
    m['verify_wh'] = stack.enter_context(patch('sync.executor.verify_warehouse_final_state'))
    m['get'] = stack.enter_context(patch('sync.executor._get'))
    m['stdout'] = stack.enter_context(patch('sys.stdout', _io.StringIO()))
    return stack, m


# =========================================================================
# 测试: 参数互斥
# =========================================================================

@test("--dry-run 与 --no-dry-run 同时指定时 argparse 报错 exit 2")
def test_mutually_exclusive_dry_run_and_no_dry_run():
    """argparse 互斥组不允许同时指定 --dry-run 和 --no-dry-run。"""
    with patch('sys.argv', BASE_CLI_ARGS + ['--dry-run', '--no-dry-run']):
        try:
            from sync.cli_execute import main
            main()
            assert False, '应抛出 SystemExit'
        except SystemExit as e:
            # argparse 互斥组错误退出码为 2
            assert e.code == 2, f'argparse 互斥错误退出码应为 2，实际: {e.code}'


@test("--no-dry-run --no-sync-log 在任何文件 I/O 前被拒绝 exit 1")
def test_no_dry_run_no_sync_log_rejected_before_io():
    """--no-dry-run --no-sync-log 在参数解析后立即拒绝，不触及文件或网络。"""
    with patch('sys.argv', BASE_CLI_ARGS + ['--no-dry-run', '--no-sync-log']), \
         patch('os.path.isfile') as mock_isfile, \
         patch('builtins.open') as mock_file, \
         patch('sync.supabase_gateway.fetch_ph_warehouse') as mock_fetch_wh, \
         patch('sync.executor._call_sync_rpc') as mock_rpc, \
         patch('sync.executor._write_sync_log') as mock_log, \
         patch('sync.executor._save_fallback_log') as mock_fb:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(1)'
        except SystemExit as e:
            assert e.code == 1, f'退出码应为 1，实际: {e.code}'

        # 所有 I/O、网络和执行器均未调用
        mock_isfile.assert_not_called()
        mock_file.assert_not_called()
        mock_fetch_wh.assert_not_called()
        mock_rpc.assert_not_called()
        mock_log.assert_not_called()
        mock_fb.assert_not_called()


# =========================================================================
# 测试: 默认与显式 Dry Run
# =========================================================================

@test("默认（无 mode flag）→ Dry Run 模式，RPC/sync_log/fallback 均未调用")
def test_default_dry_run_mode():
    """不指定 --dry-run 或 --no-dry-run 时默认为 Dry Run。"""
    stack, m = _start_dry_run_mocks()
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(0)'
        except SystemExit as e:
            assert e.code == 0, f'退出码应为 0，实际: {e.code}'

        # execute_plan（旧 REST 模式）被调用且 dry_run=True
        m['execute_plan'].assert_called_once()
        exec_call = m['execute_plan'].call_args
        assert exec_call[1]['dry_run'] is True
        assert exec_call[1]['confirm'] == 'P5-SY3B-PH'

        # execute_plan_v2 不得调用
        m['execute_plan_v2'].assert_not_called()

        # 所有写入路径不得调用
        m['rpc'].assert_not_called()
        m['log'].assert_not_called()
        m['fb'].assert_not_called()
        m['verify_inv'].assert_not_called()
        m['verify_wh'].assert_not_called()
        m['get'].assert_not_called()

        # stdout 包含 Dry Run 默认提示
        stdout_text = m['stdout'].getvalue()
        assert 'DRY RUN 模式（默认）' in stdout_text, \
            f'stdout 应包含默认 Dry Run 提示，实际: {stdout_text!r}'


@test("显式 --dry-run → Dry Run 模式，行为与默认一致")
def test_explicit_dry_run_flag():
    """显式指定 --dry-run 时行为与默认相同，但 stdout 提示不同。"""
    stack, m = _start_dry_run_mocks(extra_args=['--dry-run'])
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(0)'
        except SystemExit as e:
            assert e.code == 0, f'退出码应为 0，实际: {e.code}'

        m['execute_plan'].assert_called_once()
        exec_call = m['execute_plan'].call_args
        assert exec_call[1]['dry_run'] is True

        m['execute_plan_v2'].assert_not_called()
        m['rpc'].assert_not_called()
        m['log'].assert_not_called()
        m['fb'].assert_not_called()

        stdout_text = m['stdout'].getvalue()
        assert 'DRY RUN 模式（--dry-run 显式指定）' in stdout_text, \
            f'stdout 应包含显式 --dry-run 提示，实际: {stdout_text!r}'


# =========================================================================
# 测试: --dry-run --no-sync-log 被接受
# =========================================================================

@test("--dry-run --no-sync-log 被接受 exit 0，sync_log 禁用且无写入")
def test_dry_run_no_sync_log_accepted():
    """显式 --dry-run + --no-sync-log 正常退出，sync_log disabled。"""
    stack, m = _start_dry_run_mocks(extra_args=['--dry-run', '--no-sync-log'])
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(0)'
        except SystemExit as e:
            assert e.code == 0, f'退出码应为 0，实际: {e.code}'

        m['execute_plan'].assert_called_once()
        m['rpc'].assert_not_called()
        m['log'].assert_not_called()
        m['fb'].assert_not_called()

        stdout_text = m['stdout'].getvalue()
        assert 'SyncLog:    禁用' in stdout_text, \
            f'stdout 应显示 SyncLog 禁用，实际: {stdout_text!r}'


# =========================================================================
# 测试: 报告 sync_log 摘要
# =========================================================================

@test("默认 Dry Run 报告包含 sync_log 摘要：enabled=True, written=False, reason 说明")
def test_report_sync_log_summary_dry_run_default():
    """默认 Dry Run 执行报告 JSON 中的 sync_log 摘要字段正确。"""
    report_data = []

    def capture_json_dump(data, *args, **kwargs):
        report_data.append(data)

    stack, m = _start_dry_run_mocks()
    # 覆盖 json.dump mock 以捕获报告数据
    # ExitStack 中 json_dump 已注册，需要先退出再手动控制
    # 简化：在默认 mocks 基础上追加 json.dump 覆盖
    stack.enter_context(patch('json.dump', side_effect=capture_json_dump))
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(0)'
        except SystemExit as e:
            assert e.code == 0

    assert len(report_data) > 0, 'json.dump 应至少被调用一次'
    report = report_data[0]
    sync_log = report.get('sync_log')
    assert sync_log is not None, f'报告应包含 sync_log 字段，keys: {list(report.keys())}'
    assert sync_log['enabled'] is True, \
        f'sync_log.enabled 应为 True，实际: {sync_log["enabled"]}'
    assert sync_log['written'] is False, \
        f'sync_log.written 应为 False，实际: {sync_log["written"]}'
    assert 'Dry Run 模式下不执行实际写入' in sync_log['reason'], \
        f'reason 应说明 Dry Run 不写入，实际: {sync_log["reason"]}'


@test("--dry-run --no-sync-log 报告 sync_log 摘要：enabled=False, reason 说明已禁用")
def test_report_sync_log_summary_disabled():
    """--dry-run --no-sync-log 执行报告 JSON 中 sync_log.enabled=False。"""
    report_data = []

    def capture_json_dump(data, *args, **kwargs):
        report_data.append(data)

    stack, m = _start_dry_run_mocks(extra_args=['--dry-run', '--no-sync-log'])
    stack.enter_context(patch('json.dump', side_effect=capture_json_dump))
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(0)'
        except SystemExit as e:
            assert e.code == 0

    assert len(report_data) > 0, 'json.dump 应至少被调用一次'
    report = report_data[0]
    sync_log = report.get('sync_log')
    assert sync_log is not None, f'报告应包含 sync_log 字段'
    assert sync_log['enabled'] is False, \
        f'sync_log.enabled 应为 False，实际: {sync_log["enabled"]}'
    assert sync_log['written'] is False
    assert '已通过 --no-sync-log 禁用' in sync_log['reason'], \
        f'reason 应说明已禁用，实际: {sync_log["reason"]}'


# =========================================================================
# 测试: 计划漂移检测真实性（非空 diffs → DRIFT_DETECTED，不硬编码 PASS）
# =========================================================================

@test("非空计划漂移 → plan_drift_check=DRIFT_DETECTED，count 与 differences 正确")
def test_plan_drift_detected_in_report():
    """当 compare_plans 返回非空 diffs 时，报告必须记录 DRIFT_DETECTED，
    不得硬编码 PASS。同时验证漂移差异数量和内容。"""
    report_data = []

    def capture_json_dump(data, *args, **kwargs):
        report_data.append(data)

    stack, m = _start_dry_run_mocks(diffs=MOCK_DRIFT_DIFFS)
    stack.enter_context(patch('json.dump', side_effect=capture_json_dump))
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(0)'
        except SystemExit as e:
            assert e.code == 0

    # Dry Run 模式下漂移不阻止执行
    m['execute_plan'].assert_called_once()
    m['execute_plan_v2'].assert_not_called()
    m['rpc'].assert_not_called()
    m['log'].assert_not_called()
    m['fb'].assert_not_called()

    # 报告真实性断言
    assert len(report_data) > 0, 'json.dump 应至少被调用一次'
    report = report_data[0]

    # plan_drift_check 不得为 PASS
    drift_check = report.get('plan_drift_check')
    assert drift_check == 'DRIFT_DETECTED', \
        f'plan_drift_check 应为 DRIFT_DETECTED，实际: {drift_check!r}'
    assert drift_check != 'PASS', \
        '非空 diffs 时 plan_drift_check 不得硬编码为 PASS'

    # plan_drift_count 正确
    assert report['plan_drift_count'] == 3, \
        f'plan_drift_count 应为 3，实际: {report["plan_drift_count"]}'

    # plan_drift_differences 内容正确
    diffs = report['plan_drift_differences']
    assert len(diffs) == 3, f'应有 3 条差异，实际: {len(diffs)}'
    assert any('Warehouse 改名动作不一致' in d for d in diffs), \
        f'差异应包含 Warehouse 改名，实际: {diffs}'
    assert any('new_variants 数量不一致' in d for d in diffs), \
        f'差异应包含 new_variants 数量，实际: {diffs}'
    assert any('inventory_after_variant_create 数量不一致' in d for d in diffs), \
        f'差异应包含 inventory_after_variant_create 数量，实际: {diffs}'

    # stdout 应显示漂移信息
    stdout_text = m['stdout'].getvalue()
    assert 'DRIFT_DETECTED' in stdout_text, \
        f'stdout 应包含 DRIFT_DETECTED，实际: {stdout_text!r}'
    assert '计划漂移检测: 发现差异' in stdout_text, \
        f'stdout 应包含漂移发现提示，实际: {stdout_text!r}'


@test("空计划漂移 → plan_drift_check=PASS，count=0，differences 为空数组")
def test_plan_drift_pass_in_report():
    """当 compare_plans 返回空列表时，报告记录 PASS，count=0，differences=[]。"""
    report_data = []

    def capture_json_dump(data, *args, **kwargs):
        report_data.append(data)

    stack, m = _start_dry_run_mocks(diffs=[])
    stack.enter_context(patch('json.dump', side_effect=capture_json_dump))
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(0)'
        except SystemExit as e:
            assert e.code == 0

    report = report_data[0]
    assert report['plan_drift_check'] == 'PASS', \
        f'空 diffs 时 plan_drift_check 应为 PASS，实际: {report["plan_drift_check"]!r}'
    assert report['plan_drift_count'] == 0, \
        f'plan_drift_count 应为 0，实际: {report["plan_drift_count"]}'
    assert report['plan_drift_differences'] == [], \
        f'plan_drift_differences 应为空数组，实际: {report["plan_drift_differences"]!r}'

    # 所有写入路径未调用
    m['execute_plan'].assert_called_once()
    m['execute_plan_v2'].assert_not_called()
    m['rpc'].assert_not_called()


# =========================================================================
# 测试: Dry Run 模式下 execute_plan_v2 绝对不可调用
# =========================================================================

@test("默认 Dry Run 使用 execute_plan（旧 REST），不触发 execute_plan_v2")
def test_dry_run_uses_execute_plan_not_v2():
    """确保 Dry Run 路径走旧 execute_plan，永不触发 RPC execute_plan_v2。"""
    stack, m = _start_dry_run_mocks()
    with stack:
        try:
            from sync.cli_execute import main
            main()
            assert False, '应调用 sys.exit(0)'
        except SystemExit as e:
            assert e.code == 0

        m['execute_plan'].assert_called_once()
        m['execute_plan_v2'].assert_not_called()


# =========================================================================
# 运行
# =========================================================================

if __name__ == '__main__':
    print('=' * 60)
    print('P5-SY4E CLI 集成测试')
    print('不依赖 Supabase 连接 | 不执行写入')
    print('=' * 60)
    print()

    test_mutually_exclusive_dry_run_and_no_dry_run()
    test_no_dry_run_no_sync_log_rejected_before_io()
    test_default_dry_run_mode()
    test_explicit_dry_run_flag()
    test_dry_run_no_sync_log_accepted()
    test_report_sync_log_summary_dry_run_default()
    test_report_sync_log_summary_disabled()
    test_plan_drift_detected_in_report()
    test_plan_drift_pass_in_report()
    test_dry_run_uses_execute_plan_not_v2()

    print()
    print('=' * 60)
    print(f'结果: {PASS} 通过, {FAIL} 失败 (共 {PASS + FAIL} 项)')
    print('=' * 60)

    sys.exit(0 if FAIL == 0 else 1)
