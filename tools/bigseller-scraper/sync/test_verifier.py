"""P5-SY3B 验证器测试 — 不依赖 Supabase 连接或写入。

测试纯函数: compare_plans / verify_inventory_post_write
覆盖：计划漂移检测 + 写后逐项验证 + idempotent 验证逻辑。
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from sync.verifier import compare_plans, verify_inventory_post_write, verify_warehouse_final_state, should_block_on_drift, orchestrate_drift_decision

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
WH_ID_OTHER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

BASE_GENERATED = {
    'warehouse_rename_required': {
        'action': 'rename',
        'warehouse_id': WH_ID,
        'current_name': '菲律宾仓',
        'target_name': '菲律宾-新创启辰自建仓',
        'message': '改名',
    },
    'new_variants': [
        {'sku': 'WM0099', 'name': 'VC-精华液 30ml', 'country': 'PH',
         'product_id': None, 'match_status': 'unmatched', 'target_quantity': 0},
        {'sku': 'WM0100-#07', 'name': '按压唇冻 #07', 'country': 'PH',
         'product_id': None, 'match_status': 'unmatched', 'target_quantity': 3781},
        {'sku': 'WM0074', 'name': '蜜粉饼', 'country': 'PH',
         'product_id': None, 'match_status': 'unmatched', 'target_quantity': 21289},
    ],
    'inventory_inserts': [],
    'inventory_updates': [],
    'inventory_unchanged': [],
    'inventory_after_variant_create': [
        {'sku': 'WM0099', 'warehouse_id': WH_ID, 'warehouse_name': '菲律宾-新创启辰自建仓',
         'new_quantity': 0, 'depends_on': 'variant_creation'},
        {'sku': 'WM0100-#07', 'warehouse_id': WH_ID, 'warehouse_name': '菲律宾-新创启辰自建仓',
         'new_quantity': 3781, 'depends_on': 'variant_creation'},
        {'sku': 'WM0074', 'warehouse_id': WH_ID, 'warehouse_name': '菲律宾-新创启辰自建仓',
         'new_quantity': 21289, 'depends_on': 'variant_creation'},
    ],
    'rejected_rows': [],
}

BASE_STORED = {
    'warehouse_rename_required': {
        'action': 'rename',
        'warehouse_id': WH_ID,
        'current_name': '菲律宾仓',
        'target_name': '菲律宾-新创启辰自建仓',
        'message': '复用原 warehouse ID',
    },
    'counts': {
        'input_rows': 3,
        'new_variants': 3,
        'inventory_inserts': 0,
        'inventory_updates': 0,
        'inventory_unchanged': 0,
        'inventory_after_variant_create': 3,
        'rejected_rows': 0,
        'total_classified': 3,
        'total_inventory_actions': 3,
    },
    'new_variants': [
        {'sku': 'WM0099', 'name': 'VC-精华液 30ml', 'country': 'PH',
         'product_id': None, 'match_status': 'unmatched', 'target_quantity': 0},
        {'sku': 'WM0100-#07', 'name': '按压唇冻 #07', 'country': 'PH',
         'product_id': None, 'match_status': 'unmatched', 'target_quantity': 3781},
        {'sku': 'WM0074', 'name': '蜜粉饼', 'country': 'PH',
         'product_id': None, 'match_status': 'unmatched', 'target_quantity': 21289},
    ],
    'inventory_after_variant_create': [
        {'sku': 'WM0099', 'warehouse_id': WH_ID, 'warehouse_name': '菲律宾-新创启辰自建仓',
         'new_quantity': 0, 'depends_on': 'variant_creation'},
        {'sku': 'WM0100-#07', 'warehouse_id': WH_ID, 'warehouse_name': '菲律宾-新创启辰自建仓',
         'new_quantity': 3781, 'depends_on': 'variant_creation'},
        {'sku': 'WM0074', 'warehouse_id': WH_ID, 'warehouse_name': '菲律宾-新创启辰自建仓',
         'new_quantity': 21289, 'depends_on': 'variant_creation'},
    ],
}

# =========================================================================
# Inventory post-write 验证测试数据
# =========================================================================

VARIANT_MAP = {
    'WM0099': 'v-001',
    'WM0100-#07': 'v-002',
    'WM0074': 'v-003',
}

INVENTORY_PLAN = [
    {'sku': 'WM0099', 'warehouse_id': WH_ID, 'new_quantity': 0},
    {'sku': 'WM0100-#07', 'warehouse_id': WH_ID, 'new_quantity': 3781},
    {'sku': 'WM0074', 'warehouse_id': WH_ID, 'new_quantity': 21289},
]

ACTUAL_INVENTORY_ALL_MATCH = [
    {'variant_id': 'v-001', 'warehouse_id': WH_ID, 'quantity': 0},
    {'variant_id': 'v-002', 'warehouse_id': WH_ID, 'quantity': 3781},
    {'variant_id': 'v-003', 'warehouse_id': WH_ID, 'quantity': 21289},
]


# =========================================================================
# compare_plans 测试
# =========================================================================

@test("compare_plans: 完全一致的计划返回 0 项差异")
def test_compare_identical():
    diffs = compare_plans(BASE_GENERATED, BASE_STORED)
    assert diffs == [], f'期望 0 差异，实际 {len(diffs)}: {diffs}'


@test("compare_plans: Warehouse ID 不一致被检测")
def test_compare_wh_id_mismatch():
    gen = {
        **BASE_GENERATED,
        'warehouse_rename_required': {
            **BASE_GENERATED['warehouse_rename_required'],
            'warehouse_id': WH_ID_OTHER,
        },
    }
    diffs = compare_plans(gen, BASE_STORED)
    assert len(diffs) >= 1
    assert any('Warehouse ID' in d for d in diffs)


@test("compare_plans: Warehouse 改名动作不一致被检测")
def test_compare_wh_action_mismatch():
    gen = {
        **BASE_GENERATED,
        'warehouse_rename_required': {
            **BASE_GENERATED['warehouse_rename_required'],
            'action': 'none',
        },
    }
    diffs = compare_plans(gen, BASE_STORED)
    assert len(diffs) >= 1
    assert any('改名动作' in d for d in diffs)


@test("compare_plans: Warehouse 改名目标不一致被检测")
def test_compare_wh_target_mismatch():
    gen = {
        **BASE_GENERATED,
        'warehouse_rename_required': {
            **BASE_GENERATED['warehouse_rename_required'],
            'target_name': '错误的目标名',
        },
    }
    diffs = compare_plans(gen, BASE_STORED)
    assert len(diffs) >= 1
    assert any('改名目标' in d for d in diffs)


@test("compare_plans: new_variants SKU 仅生成计划中有")
def test_compare_variant_only_gen():
    gen = {
        **BASE_GENERATED,
        'new_variants': [
            *BASE_GENERATED['new_variants'],
            {'sku': 'NEW-SKU', 'name': '新产品', 'country': 'PH',
             'product_id': None, 'match_status': 'unmatched', 'target_quantity': 100},
        ],
    }
    diffs = compare_plans(gen, BASE_STORED)
    assert len(diffs) >= 1
    assert any('NEW-SKU' in d for d in diffs)
    assert any('仅生成计划中有' in d for d in diffs)


@test("compare_plans: new_variants SKU 仅存储报告中有")
def test_compare_variant_only_stored():
    stored = {
        **BASE_STORED,
        'new_variants': [
            *BASE_STORED['new_variants'],
            {'sku': 'OLD-SKU', 'name': '旧产品', 'country': 'PH',
             'product_id': None, 'match_status': 'unmatched', 'target_quantity': 50},
        ],
    }
    diffs = compare_plans(BASE_GENERATED, stored)
    assert len(diffs) >= 1
    assert any('OLD-SKU' in d for d in diffs)
    assert any('仅存储报告中有' in d for d in diffs)


@test("compare_plans: new_variants name 不一致被检测")
def test_compare_variant_name_mismatch():
    gen = {
        **BASE_GENERATED,
        'new_variants': [
            {**v, 'name': 'CHANGED NAME'} if v['sku'] == 'WM0074' else v
            for v in BASE_GENERATED['new_variants']
        ],
    }
    diffs = compare_plans(gen, BASE_STORED)
    assert len(diffs) >= 1
    assert any('WM0074' in d and 'name' in d for d in diffs)


@test("compare_plans: new_variants target_quantity 不一致被检测")
def test_compare_variant_qty_mismatch():
    gen = {
        **BASE_GENERATED,
        'new_variants': [
            {**v, 'target_quantity': 99999} if v['sku'] == 'WM0074' else v
            for v in BASE_GENERATED['new_variants']
        ],
    }
    diffs = compare_plans(gen, BASE_STORED)
    assert len(diffs) >= 1
    assert any('WM0074' in d and 'target_quantity' in d for d in diffs)


@test("compare_plans: new_variants country 不一致被检测")
def test_compare_variant_country_mismatch():
    gen = {
        **BASE_GENERATED,
        'new_variants': [
            {**v, 'country': 'VN'} if v['sku'] == 'WM0074' else v
            for v in BASE_GENERATED['new_variants']
        ],
    }
    diffs = compare_plans(gen, BASE_STORED)
    assert len(diffs) >= 1
    assert any('WM0074' in d and 'country' in d for d in diffs)


@test("compare_plans: inventory_after_variant_create SKU 不一致被检测")
def test_compare_inventory_sku_mismatch():
    gen = {
        **BASE_GENERATED,
        'inventory_after_variant_create': [
            *BASE_GENERATED['inventory_after_variant_create'],
            {'sku': 'EXTRA-SKU', 'warehouse_id': WH_ID, 'new_quantity': 500},
        ],
    }
    diffs = compare_plans(gen, BASE_STORED)
    assert len(diffs) >= 1
    assert any('EXTRA-SKU' in d for d in diffs)


@test("compare_plans: inventory new_quantity 不一致被检测")
def test_compare_inventory_qty_mismatch():
    gen = {
        **BASE_GENERATED,
        'inventory_after_variant_create': [
            {**item, 'new_quantity': 88888} if item['sku'] == 'WM0074' else item
            for item in BASE_GENERATED['inventory_after_variant_create']
        ],
    }
    diffs = compare_plans(gen, BASE_STORED)
    assert len(diffs) >= 1
    assert any('WM0074' in d and 'new_quantity' in d for d in diffs)


@test("compare_plans: inventory warehouse_id 不一致被检测")
def test_compare_inventory_wh_id_mismatch():
    gen = {
        **BASE_GENERATED,
        'inventory_after_variant_create': [
            {**item, 'warehouse_id': WH_ID_OTHER} if item['sku'] == 'WM0074' else item
            for item in BASE_GENERATED['inventory_after_variant_create']
        ],
    }
    diffs = compare_plans(gen, BASE_STORED)
    assert len(diffs) >= 1
    assert any('WM0074' in d and 'warehouse_id' in d for d in diffs)


@test("compare_plans: 计数不一致被检测")
def test_compare_count_mismatch():
    stored = {
        **BASE_STORED,
        'counts': {
            **BASE_STORED['counts'],
            'new_variants': 99,
        },
    }
    diffs = compare_plans(BASE_GENERATED, stored)
    assert len(diffs) >= 1
    assert any('计数不一致' in d for d in diffs)


@test("compare_plans: 空计划比较返回 0 差异")
def test_compare_empty_plans():
    empty = {
        'warehouse_rename_required': {},
        'new_variants': [],
        'inventory_after_variant_create': [],
        'inventory_inserts': [],
        'inventory_updates': [],
        'inventory_unchanged': [],
        'rejected_rows': [],
    }
    empty_stored = {
        **empty,
        'counts': {},
    }
    diffs = compare_plans(empty, empty_stored)
    assert diffs == []


@test("compare_plans: 混合场景 — 仅一个字段不同，仅报告该差异")
def test_compare_mixed_one_diff():
    gen = {
        **BASE_GENERATED,
        'warehouse_rename_required': {
            **BASE_GENERATED['warehouse_rename_required'],
            'action': 'none',
        },
    }
    diffs = compare_plans(gen, BASE_STORED)
    assert len(diffs) == 1
    assert '改名动作' in diffs[0]


# =========================================================================
# verify_inventory_post_write 测试
# =========================================================================

@test("verify: 全部匹配返回 0 差异")
def test_verify_all_match():
    diffs = verify_inventory_post_write(
        INVENTORY_PLAN, ACTUAL_INVENTORY_ALL_MATCH, VARIANT_MAP, WH_ID
    )
    assert diffs == [], f'期望 0 差异，实际 {len(diffs)}: {diffs}'


@test("verify: quantity 不一致被检测")
def test_verify_qty_mismatch():
    actual = [
        {'variant_id': 'v-001', 'warehouse_id': WH_ID, 'quantity': 0},
        {'variant_id': 'v-002', 'warehouse_id': WH_ID, 'quantity': 9999},  # 错误
        {'variant_id': 'v-003', 'warehouse_id': WH_ID, 'quantity': 21289},
    ]
    diffs = verify_inventory_post_write(
        INVENTORY_PLAN, actual, VARIANT_MAP, WH_ID
    )
    assert len(diffs) >= 1
    assert any('quantity 不一致' in d for d in diffs)
    assert any('WM0100-#07' in d for d in diffs)


@test("verify: 数据库缺少 Inventory 记录被检测")
def test_verify_missing_inventory():
    actual = [
        {'variant_id': 'v-001', 'warehouse_id': WH_ID, 'quantity': 0},
        # v-002 missing
        {'variant_id': 'v-003', 'warehouse_id': WH_ID, 'quantity': 21289},
    ]
    diffs = verify_inventory_post_write(
        INVENTORY_PLAN, actual, VARIANT_MAP, WH_ID
    )
    assert len(diffs) >= 1
    assert any('缺少 Inventory' in d for d in diffs)


@test("verify: 计划外 Inventory 记录被检测")
def test_verify_extra_inventory():
    actual = [
        *ACTUAL_INVENTORY_ALL_MATCH,
        {'variant_id': 'v-999', 'warehouse_id': WH_ID, 'quantity': 5000},
    ]
    diffs = verify_inventory_post_write(
        INVENTORY_PLAN, actual, VARIANT_MAP, WH_ID
    )
    assert len(diffs) >= 1
    assert any('计划外的' in d for d in diffs)


@test("verify: 找不到 variant_id 的 SKU 被检测")
def test_verify_missing_variant_id():
    plan_with_new = [
        *INVENTORY_PLAN,
        {'sku': 'UNKNOWN-SKU', 'warehouse_id': WH_ID, 'new_quantity': 100},
    ]
    diffs = verify_inventory_post_write(
        plan_with_new, ACTUAL_INVENTORY_ALL_MATCH, VARIANT_MAP, WH_ID
    )
    assert len(diffs) >= 1
    assert any('UNKNOWN-SKU' in d or '找不到 variant_id' in d for d in diffs)


@test("verify: 总数不一致被检测")
def test_verify_count_mismatch():
    actual = ACTUAL_INVENTORY_ALL_MATCH[:2]  # 只有 2 条
    diffs = verify_inventory_post_write(
        INVENTORY_PLAN, actual, VARIANT_MAP, WH_ID
    )
    assert any('总数不一致' in d for d in diffs)


@test("verify: 总量不一致被检测")
def test_verify_sum_mismatch():
    actual = [
        {'variant_id': 'v-001', 'warehouse_id': WH_ID, 'quantity': 100},  # 改为 100
        {'variant_id': 'v-002', 'warehouse_id': WH_ID, 'quantity': 3781},
        {'variant_id': 'v-003', 'warehouse_id': WH_ID, 'quantity': 21289},
    ]
    diffs = verify_inventory_post_write(
        INVENTORY_PLAN, actual, VARIANT_MAP, WH_ID
    )
    assert any('总量不一致' in d for d in diffs)


@test("verify: 空计划和空实际数据返回 0 差异")
def test_verify_empty():
    diffs = verify_inventory_post_write([], [], {}, WH_ID)
    assert diffs == []


@test("verify: 多种差异同时被检测")
def test_verify_multiple_diff_types():
    actual = [
        {'variant_id': 'v-001', 'warehouse_id': WH_ID, 'quantity': 999},  # qty 错
        # v-002 missing
        {'variant_id': 'v-003', 'warehouse_id': WH_ID, 'quantity': 21289},
        {'variant_id': 'v-extra', 'warehouse_id': WH_ID, 'quantity': 1},  # 计划外
    ]
    diffs = verify_inventory_post_write(
        INVENTORY_PLAN, actual, VARIANT_MAP, WH_ID
    )
    # 应有: quantity 不一致 + 缺少 Inventory + 计划外记录 + 总数不一致 + 总量不一致
    assert len(diffs) >= 3, f'期望至少 3 类差异，实际 {len(diffs)}: {diffs}'


# =========================================================================
# verify_warehouse_final_state 测试
# =========================================================================

EXPECTED_WH = {
    'id': WH_ID,
    'name': '菲律宾-新创启辰自建仓',
    'country': 'PH',
    'type': 'overseas',
    'is_active': True,
}


@test("verify_wh: 全部匹配返回 0 差异")
def test_verify_wh_all_match():
    actual = {
        'id': WH_ID,
        'name': '菲律宾-新创启辰自建仓',
        'country': 'PH',
        'type': 'overseas',
        'is_active': True,
    }
    diffs = verify_warehouse_final_state(actual, EXPECTED_WH)
    assert diffs == [], f'期望 0 差异，实际 {len(diffs)}: {diffs}'


@test("verify_wh: name 不一致被检测")
def test_verify_wh_name_mismatch():
    actual = {**EXPECTED_WH, 'name': '旧名称-菲律宾仓'}
    diffs = verify_warehouse_final_state(actual, EXPECTED_WH)
    assert len(diffs) == 1
    assert any('Warehouse.name' in d for d in diffs)


@test("verify_wh: country 不一致被检测")
def test_verify_wh_country_mismatch():
    actual = {**EXPECTED_WH, 'country': 'CN'}
    diffs = verify_warehouse_final_state(actual, EXPECTED_WH)
    assert len(diffs) == 1
    assert any('Warehouse.country' in d for d in diffs)


@test("verify_wh: type 不一致被检测")
def test_verify_wh_type_mismatch():
    actual = {**EXPECTED_WH, 'type': 'domestic'}
    diffs = verify_warehouse_final_state(actual, EXPECTED_WH)
    assert len(diffs) == 1
    assert any('Warehouse.type' in d for d in diffs)


@test("verify_wh: id 不一致被检测")
def test_verify_wh_id_mismatch():
    actual = {**EXPECTED_WH, 'id': 'wrong-id-0000-0000-000000000000'}
    diffs = verify_warehouse_final_state(actual, EXPECTED_WH)
    assert len(diffs) == 1
    assert any('Warehouse.id' in d for d in diffs)


@test("verify_wh: is_active=false 被检测")
def test_verify_wh_is_active_false():
    actual = {**EXPECTED_WH, 'is_active': False}
    diffs = verify_warehouse_final_state(actual, EXPECTED_WH)
    assert len(diffs) == 1
    assert any('Warehouse.is_active' in d for d in diffs)


@test("verify_wh: is_active=null 被检测")
def test_verify_wh_is_active_none():
    actual = {**EXPECTED_WH, 'is_active': None}
    diffs = verify_warehouse_final_state(actual, EXPECTED_WH)
    assert len(diffs) >= 1
    assert any('Warehouse.is_active' in d for d in diffs)


@test("verify_wh: 多字段同时不一致全部检测")
def test_verify_wh_multiple_fields():
    actual = {
        'id': WH_ID,
        'name': '错误名称',
        'country': 'VN',
        'type': 'domestic',
        'is_active': False,
    }
    diffs = verify_warehouse_final_state(actual, EXPECTED_WH)
    # name, country, type, is_active = 4 diffs
    assert len(diffs) >= 4, f'期望至少 4 项差异，实际 {len(diffs)}: {diffs}'


@test("verify_wh: 空 actual dict 全部字段报差异")
def test_verify_wh_empty_actual():
    diffs = verify_warehouse_final_state({}, EXPECTED_WH)
    # id, name, country, type (4) + is_active (1) = 5
    assert len(diffs) >= 5, f'期望至少 5 项差异，实际 {len(diffs)}: {diffs}'


# =========================================================================
# should_block_on_drift 测试
# =========================================================================

@test("drift_block: 无差异 + dry_run=True → 不阻止")
def test_drift_block_no_diff_dry():
    assert should_block_on_drift([], True) is False


@test("drift_block: 无差异 + dry_run=False → 不阻止")
def test_drift_block_no_diff_real():
    assert should_block_on_drift([], False) is False


@test("drift_block: 有差异 + dry_run=True → 不阻止（仅警告）")
def test_drift_block_diff_dry():
    assert should_block_on_drift(['diff1'], True) is False


@test("drift_block: 有差异 + dry_run=False → 阻止")
def test_drift_block_diff_real():
    assert should_block_on_drift(['diff1'], False) is True


@test("drift_block: 多项差异 + dry_run=True → 不阻止")
def test_drift_block_multi_diff_dry():
    assert should_block_on_drift(['d1', 'd2', 'd3'], True) is False


@test("drift_block: 多项差异 + dry_run=False → 阻止")
def test_drift_block_multi_diff_real():
    assert should_block_on_drift(['d1', 'd2', 'd3'], False) is True


# =========================================================================
# orchestrate_drift_decision 测试 — 验证 execute_fn 是否被调用
# =========================================================================

def _spy_factory():
    """创建 spy 可调用对象，记录调用次数和参数。"""
    class Spy:
        def __init__(self):
            self.call_count = 0
        def __call__(self):
            self.call_count += 1
            return {'status': 'executed', 'call_count': self.call_count}
    return Spy()


@test("orchestrate: 真实模式 + 存在漂移 → 阻止执行，execute_fn 调用次数为 0")
def test_orchestrate_real_with_drift_blocks():
    spy = _spy_factory()
    result = orchestrate_drift_decision(['diff1', 'diff2'], False, spy)
    assert result['blocked'] is True, '真实模式+漂移应阻止'
    assert result['execute_result'] is None, '阻止时 execute_result 应为 None'
    assert spy.call_count == 0, (
        f'关键断言: execute_fn 不应被调用，实际调用 {spy.call_count} 次'
    )


@test("orchestrate: Dry Run + 存在漂移 → 允许继续，execute_fn 调用次数为 1")
def test_orchestrate_dry_run_with_drift_proceeds():
    spy = _spy_factory()
    result = orchestrate_drift_decision(['diff1'], True, spy)
    assert result['blocked'] is False, 'dry-run+漂移不应阻止'
    assert result['execute_result'] == {'status': 'executed', 'call_count': 1}, (
        'execute_result 应正确传递 spy 返回值'
    )
    assert spy.call_count == 1, (
        f'关键断言: execute_fn 应被调用 1 次，实际调用 {spy.call_count} 次'
    )


@test("orchestrate: 无漂移 + dry_run=True → 允许执行，execute_fn 调用次数为 1")
def test_orchestrate_no_diff_dry_proceeds():
    spy = _spy_factory()
    result = orchestrate_drift_decision([], True, spy)
    assert result['blocked'] is False, '无漂移不应阻止'
    assert result['execute_result'] == {'status': 'executed', 'call_count': 1}
    assert spy.call_count == 1, (
        f'关键断言: execute_fn 应被调用 1 次，实际调用 {spy.call_count} 次'
    )


@test("orchestrate: 无漂移 + 真实模式 → 允许执行，execute_fn 调用次数为 1")
def test_orchestrate_no_diff_real_proceeds():
    spy = _spy_factory()
    result = orchestrate_drift_decision([], False, spy)
    assert result['blocked'] is False, '无漂移不应阻止'
    assert result['execute_result'] == {'status': 'executed', 'call_count': 1}
    assert spy.call_count == 1, (
        f'关键断言: execute_fn 应被调用 1 次，实际调用 {spy.call_count} 次'
    )


@test("orchestrate: 空 diffs + 真实模式 → execute_result 正确传播")
def test_orchestrate_result_propagation():
    def custom_fn():
        return {'custom_key': 'custom_value', 'count': 42}
    result = orchestrate_drift_decision([], False, custom_fn)
    assert result['blocked'] is False
    assert result['execute_result'] == {'custom_key': 'custom_value', 'count': 42}, (
        'execute_fn 的返回值应原样传播'
    )


# =========================================================================
# 运行
# =========================================================================

if __name__ == '__main__':
    print('=' * 60)
    print('P5-SY3B 验证器测试')
    print('不依赖 Supabase 连接 | 不执行任何数据库写入')
    print('=' * 60)
    print()

    # compare_plans 测试
    test_compare_identical()
    test_compare_wh_id_mismatch()
    test_compare_wh_action_mismatch()
    test_compare_wh_target_mismatch()
    test_compare_variant_only_gen()
    test_compare_variant_only_stored()
    test_compare_variant_name_mismatch()
    test_compare_variant_qty_mismatch()
    test_compare_variant_country_mismatch()
    test_compare_inventory_sku_mismatch()
    test_compare_inventory_qty_mismatch()
    test_compare_inventory_wh_id_mismatch()
    test_compare_count_mismatch()
    test_compare_empty_plans()
    test_compare_mixed_one_diff()

    print()

    # verify_inventory_post_write 测试
    test_verify_all_match()
    test_verify_qty_mismatch()
    test_verify_missing_inventory()
    test_verify_extra_inventory()
    test_verify_missing_variant_id()
    test_verify_count_mismatch()
    test_verify_sum_mismatch()
    test_verify_empty()
    test_verify_multiple_diff_types()

    print()
    print('--- verify_warehouse_final_state ---')
    test_verify_wh_all_match()
    test_verify_wh_name_mismatch()
    test_verify_wh_country_mismatch()
    test_verify_wh_type_mismatch()
    test_verify_wh_id_mismatch()
    test_verify_wh_is_active_false()
    test_verify_wh_is_active_none()
    test_verify_wh_multiple_fields()
    test_verify_wh_empty_actual()

    print()
    print('--- should_block_on_drift ---')
    test_drift_block_no_diff_dry()
    test_drift_block_no_diff_real()
    test_drift_block_diff_dry()
    test_drift_block_diff_real()
    test_drift_block_multi_diff_dry()
    test_drift_block_multi_diff_real()

    print()
    print('--- orchestrate_drift_decision (execute_fn 调用边界) ---')
    test_orchestrate_real_with_drift_blocks()
    test_orchestrate_dry_run_with_drift_proceeds()
    test_orchestrate_no_diff_dry_proceeds()
    test_orchestrate_no_diff_real_proceeds()
    test_orchestrate_result_propagation()

    print()
    print('=' * 60)
    print(f'结果: {PASS} 通过, {FAIL} 失败 (共 {PASS + FAIL} 项)')
    print('=' * 60)

    sys.exit(0 if FAIL == 0 else 1)
