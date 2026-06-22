"""P5-SY3B 执行器测试 — 不依赖 Supabase 连接或写入。

测试纯函数: classify_variants / build_inventory_upsert_rows
验证 idempotent 逻辑：重复执行不变性。
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from sync.executor import (
    classify_variants,
    build_inventory_upsert_rows,
    _build_rpc_payload,
    _save_fallback_log,
    execute_plan_v2,
)

# monkey-patch: 所有 executor 测试数据均使用 PH country
import sync.config
sync.config.WAREHOUSE_COUNTRY = 'PH'

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

SAMPLE_NEW_VARIANTS = [
    {'sku': 'WM0099', 'name': 'VC-阿魏酸抗氧化精华液 30ml', 'country': 'PH', 'target_quantity': 0},
    {'sku': 'WM0100-#07', 'name': '按压唇冻 #07', 'country': 'PH', 'target_quantity': 3781},
    {'sku': 'WM0074', 'name': '蜜粉饼', 'country': 'PH', 'target_quantity': 21289},
]

SAMPLE_INVENTORY_AFTER = [
    {'sku': 'WM0099', 'warehouse_id': WH_ID, 'new_quantity': 0,
     'depends_on': 'variant_creation'},
    {'sku': 'WM0100-#07', 'warehouse_id': WH_ID, 'new_quantity': 3781,
     'depends_on': 'variant_creation'},
    {'sku': 'WM0074', 'warehouse_id': WH_ID, 'new_quantity': 21289,
     'depends_on': 'variant_creation'},
]

# 模拟已存在 WM0074 (已匹配产品)
EXISTING_SKU_MAP_WITH_MATCHED = {
    'WM0074': {
        'id': 'var-002',
        'sku': 'WM0074',
        'country': 'PH',
        'name': '蜜粉饼',
        'product_id': 'prod-001',
        'match_status': 'matched',
    },
}

# 模拟已存在 WM0074 (未匹配)
EXISTING_SKU_MAP_UNMATCHED = {
    'WM0074': {
        'id': 'var-002',
        'sku': 'WM0074',
        'country': 'PH',
        'name': '蜜粉饼',
        'product_id': None,
        'match_status': 'unmatched',
    },
}

# 空 DB
EMPTY_SKU_MAP = {}


# =========================================================================
# classify_variants 测试
# =========================================================================

@test("全部新 SKU: 3 条全部待创建")
def test_all_new_classify():
    to_create, skipped = classify_variants(SAMPLE_NEW_VARIANTS, EMPTY_SKU_MAP)
    assert len(to_create) == 3
    assert len(skipped) == 0
    assert to_create[0]['sku'] == 'WM0099'
    assert to_create[0]['product_id'] is None
    assert to_create[0]['match_status'] == 'unmatched'


@test("混合场景: 1 条已存在（matched）→ 跳过，2 条待创建")
def test_mixed_classify_with_matched():
    to_create, skipped = classify_variants(SAMPLE_NEW_VARIANTS, EXISTING_SKU_MAP_WITH_MATCHED)
    assert len(to_create) == 2
    assert len(skipped) == 1
    assert skipped[0]['sku'] == 'WM0074'
    assert skipped[0]['product_id'] == 'prod-001'
    assert skipped[0]['match_status'] == 'matched'
    assert 'product_id' in skipped[0]['reason']


@test("混合场景: 1 条已存在（unmatched）→ 跳过，2 条待创建")
def test_mixed_classify_with_unmatched():
    to_create, skipped = classify_variants(SAMPLE_NEW_VARIANTS, EXISTING_SKU_MAP_UNMATCHED)
    assert len(to_create) == 2
    assert len(skipped) == 1
    assert skipped[0]['sku'] == 'WM0074'
    assert skipped[0]['product_id'] is None


@test("全部已存在: 3 条全部跳过，0 条待创建")
def test_all_existing_classify():
    full_map = {
        'WM0099': {'id': 'v1', 'sku': 'WM0099', 'product_id': None, 'match_status': 'unmatched'},
        'WM0100-#07': {'id': 'v2', 'sku': 'WM0100-#07', 'product_id': None, 'match_status': 'unmatched'},
        'WM0074': {'id': 'v3', 'sku': 'WM0074', 'product_id': 'prod-001', 'match_status': 'matched'},
    }
    to_create, skipped = classify_variants(SAMPLE_NEW_VARIANTS, full_map)
    assert len(to_create) == 0
    assert len(skipped) == 3


@test("待创建的 Variant 字段: product_id=null, match_status=unmatched, country=PH")
def test_to_create_fields():
    to_create, _ = classify_variants(SAMPLE_NEW_VARIANTS, EMPTY_SKU_MAP)
    for v in to_create:
        assert v['product_id'] is None, f'{v["sku"]}: product_id 应为 None'
        assert v['match_status'] == 'unmatched', f'{v["sku"]}: match_status 应为 unmatched'
        assert v['country'] == 'PH', f'{v["sku"]}: country 应为 PH'
        assert v['name'], f'{v["sku"]}: name 不应为空'


@test("空输入: classify_variants([], {}) 返回空列表")
def test_empty_input_classify():
    to_create, skipped = classify_variants([], {})
    assert to_create == []
    assert skipped == []


@test("idempotent: 首次运行后全部已存在，第二次 classify 0 条待创建")
def test_classify_idempotent():
    # 首次: 空 DB → 3 条待创建
    to_create_1, skipped_1 = classify_variants(SAMPLE_NEW_VARIANTS, EMPTY_SKU_MAP)
    assert len(to_create_1) == 3
    assert len(skipped_1) == 0

    # 模拟首次创建完成后: 构建 existing map (假设全部创建成功)
    after_create_map = {
        'WM0099': {'id': 'new-1', 'sku': 'WM0099', 'product_id': None, 'match_status': 'unmatched'},
        'WM0100-#07': {'id': 'new-2', 'sku': 'WM0100-#07', 'product_id': None, 'match_status': 'unmatched'},
        'WM0074': {'id': 'new-3', 'sku': 'WM0074', 'product_id': None, 'match_status': 'unmatched'},
    }

    # 第二次: 相同输入 → 0 条待创建，3 条跳过
    to_create_2, skipped_2 = classify_variants(SAMPLE_NEW_VARIANTS, after_create_map)
    assert len(to_create_2) == 0, f'第二次 classify 应有 0 条待创建，实际 {len(to_create_2)}'
    assert len(skipped_2) == 3, f'第二次 classify 应有 3 条跳过，实际 {len(skipped_2)}'


# =========================================================================
# build_inventory_upsert_rows 测试
# =========================================================================

@test("3 条 Inventory 全部成功: variant_id 全部匹配")
def test_build_inventory_all_match():
    variant_id_map = {
        'WM0099': 'v-001',
        'WM0100-#07': 'v-002',
        'WM0074': 'v-003',
    }
    rows, errors = build_inventory_upsert_rows(SAMPLE_INVENTORY_AFTER, variant_id_map, WH_ID)
    assert len(rows) == 3
    assert len(errors) == 0
    assert rows[0]['variant_id'] == 'v-001'
    assert rows[0]['warehouse_id'] == WH_ID
    assert rows[0]['quantity'] == 0
    assert rows[1]['quantity'] == 3781
    assert rows[2]['quantity'] == 21289


@test("SKU 缺失 variant_id 时报告错误，不阻塞其他行")
def test_build_inventory_partial_match():
    variant_id_map = {
        'WM0099': 'v-001',
        # WM0100-#07 missing intentionally
        'WM0074': 'v-003',
    }
    rows, errors = build_inventory_upsert_rows(SAMPLE_INVENTORY_AFTER, variant_id_map, WH_ID)
    assert len(rows) == 2
    assert len(errors) == 1
    assert 'WM0100-#07' in errors[0]
    assert rows[0]['variant_id'] == 'v-001'
    assert rows[1]['variant_id'] == 'v-003'


@test("空输入: build_inventory_upsert_rows([], {}, WH_ID) 返回空")
def test_build_inventory_empty():
    rows, errors = build_inventory_upsert_rows([], {}, WH_ID)
    assert rows == []
    assert errors == []


@test("Inventory 行包含 last_sync_at 字段")
def test_inventory_rows_have_last_sync_at():
    variant_id_map = {'WM0099': 'v-001'}
    rows, _ = build_inventory_upsert_rows(
        [SAMPLE_INVENTORY_AFTER[0]], variant_id_map, WH_ID
    )
    assert len(rows) == 1
    assert 'last_sync_at' in rows[0]
    assert rows[0]['last_sync_at'] is not None


@test("quantity 严格取 new_quantity 整数值")
def test_inventory_quantity_is_int():
    variant_id_map = {'WM0100-#07': 'v-002'}
    item = {'sku': 'WM0100-#07', 'warehouse_id': WH_ID, 'new_quantity': 3781}
    rows, _ = build_inventory_upsert_rows([item], variant_id_map, WH_ID)
    assert type(rows[0]['quantity']) is int
    assert rows[0]['quantity'] == 3781


@test("idempotent: 相同输入多次调用，返回行数相同")
def test_build_inventory_idempotent():
    variant_id_map = {
        'WM0099': 'v-001',
        'WM0100-#07': 'v-002',
        'WM0074': 'v-003',
    }
    rows1, _ = build_inventory_upsert_rows(SAMPLE_INVENTORY_AFTER, variant_id_map, WH_ID)
    rows2, _ = build_inventory_upsert_rows(SAMPLE_INVENTORY_AFTER, variant_id_map, WH_ID)
    assert len(rows1) == len(rows2) == 3
    for r1, r2 in zip(rows1, rows2):
        assert r1['variant_id'] == r2['variant_id']
        assert r1['quantity'] == r2['quantity']
        assert r1['warehouse_id'] == r2['warehouse_id']


@test("全部 SKU 找不到 variant_id 时全部报错，rows 为空")
def test_build_inventory_all_missing():
    rows, errors = build_inventory_upsert_rows(SAMPLE_INVENTORY_AFTER, {}, WH_ID)
    assert len(rows) == 0
    assert len(errors) == 3


# =========================================================================
# P5-SY4C 测试数据
# =========================================================================

SAMPLE_PLAN_FULL = {
    'warehouse_rename_required': {
        'action': 'rename',
        'warehouse_id': WH_ID,
        'current_name': '菲律宾仓',
        'target_name': '菲律宾-新创启辰自建仓',
    },
    'new_variants': [
        {'sku': 'NEW001', 'name': '新产品A', 'country': 'PH',
         'product_id': None, 'match_status': 'unmatched', 'target_quantity': 100},
    ],
    'inventory_updates': [
        {'variant_id': 'v1', 'warehouse_id': WH_ID, 'sku': 'WM0005',
         'new_quantity': 1691, 'old_quantity': 1500},
    ],
    'inventory_inserts': [
        {'variant_id': 'v2', 'warehouse_id': WH_ID, 'sku': 'EXIST001',
         'new_quantity': 500, 'old_quantity': 0},
    ],
    'inventory_after_variant_create': [
        {'sku': 'NEW001', 'warehouse_id': WH_ID, 'new_quantity': 100,
         'depends_on': 'variant_creation'},
    ],
    'inventory_unchanged': [
        {'inventory_id': 'inv1', 'variant_id': 'v3', 'warehouse_id': WH_ID,
         'sku': 'WM0074', 'quantity': 21289},
    ],
}

SAMPLE_PLAN_NO_VARIANTS = {
    'warehouse_rename_required': {
        'action': 'none',
        'warehouse_id': WH_ID,
        'current_name': '菲律宾-新创启辰自建仓',
        'target_name': '菲律宾-新创启辰自建仓',
    },
    'new_variants': [],
    'inventory_updates': [
        {'variant_id': 'v1', 'warehouse_id': WH_ID, 'sku': 'WM0005',
         'new_quantity': 2000, 'old_quantity': 1500},
    ],
    'inventory_inserts': [],
    'inventory_after_variant_create': [],
    'inventory_unchanged': [
        {'inventory_id': 'inv1', 'variant_id': 'v3', 'warehouse_id': WH_ID,
         'sku': 'WM0074', 'quantity': 21289},
    ],
}

SAMPLE_PLAN_EMPTY_INVENTORY = {
    'warehouse_rename_required': {
        'action': 'none',
        'warehouse_id': WH_ID,
        'current_name': '菲律宾-新创启辰自建仓',
        'target_name': '菲律宾-新创启辰自建仓',
    },
    'new_variants': [],
    'inventory_updates': [],
    'inventory_inserts': [],
    'inventory_after_variant_create': [],
    'inventory_unchanged': [],
}

SAMPLE_PLAN_NO_WAREHOUSE = {
    'warehouse_rename_required': None,
    'new_variants': [],
    'inventory_updates': [],
    'inventory_inserts': [],
    'inventory_after_variant_create': [],
    'inventory_unchanged': [],
}

SYNC_AT = '2026-06-13T12:00:00+08:00'


# =========================================================================
# _build_rpc_payload 测试
# =========================================================================

@test("_build_rpc_payload: 完整快照合并（updates + inserts + after_create + unchanged）")
def test_build_rpc_full_merge():
    wh_id, p_variants, p_inventory, p_wh_name = _build_rpc_payload(
        SAMPLE_PLAN_FULL, SYNC_AT
    )
    assert wh_id == WH_ID
    assert p_wh_name == '菲律宾-新创启辰自建仓'
    assert len(p_variants) == 1
    assert p_variants[0] == {'sku': 'NEW001', 'country': 'PH', 'name': '新产品A'}
    assert len(p_inventory) == 4
    # 验证所有条目使用统一 last_sync_at
    for item in p_inventory:
        assert item['last_sync_at'] == SYNC_AT
        assert 'sku' in item
        assert 'country' in item
        assert 'quantity' in item
        assert item['country'] == 'PH'


@test("_build_rpc_payload: 无新 Variant 时 p_variants 为空数组")
def test_build_rpc_no_variants():
    _, p_variants, p_inventory, _ = _build_rpc_payload(
        SAMPLE_PLAN_NO_VARIANTS, SYNC_AT
    )
    assert p_variants == []
    assert len(p_inventory) == 2  # 1 update + 1 unchanged


@test("_build_rpc_payload: 空快照抛出 RuntimeError")
def test_build_rpc_empty_inventory():
    try:
        _build_rpc_payload(SAMPLE_PLAN_EMPTY_INVENTORY, SYNC_AT)
        assert False, '应抛出 RuntimeError'
    except RuntimeError as e:
        assert '空快照' in str(e) or '不能为空' in str(e)


@test("_build_rpc_payload: 缺少 warehouse_id 抛出 RuntimeError")
def test_build_rpc_no_warehouse():
    try:
        _build_rpc_payload(SAMPLE_PLAN_NO_WAREHOUSE, SYNC_AT)
        assert False, '应抛出 RuntimeError'
    except RuntimeError as e:
        assert 'warehouse_id' in str(e).lower()


@test("_build_rpc_payload: 重复 (sku,country) 抛出 RuntimeError")
def test_build_rpc_duplicate_key():
    plan = {
        'warehouse_rename_required': {
            'warehouse_id': WH_ID,
            'target_name': '菲律宾-新创启辰自建仓',
        },
        'new_variants': [],
        'inventory_updates': [
            {'sku': 'DUP001', 'warehouse_id': WH_ID, 'new_quantity': 100},
            {'sku': 'DUP001', 'warehouse_id': WH_ID, 'new_quantity': 200},
        ],
        'inventory_inserts': [],
        'inventory_after_variant_create': [],
        'inventory_unchanged': [],
    }
    try:
        _build_rpc_payload(plan, SYNC_AT)
        assert False, '应抛出 RuntimeError'
    except RuntimeError as e:
        assert '重复' in str(e) or 'DUP001' in str(e)


@test("_build_rpc_payload: 负数 quantity 抛出 RuntimeError")
def test_build_rpc_negative_qty():
    plan = {
        'warehouse_rename_required': {
            'warehouse_id': WH_ID,
            'target_name': '菲律宾-新创启辰自建仓',
        },
        'new_variants': [],
        'inventory_updates': [
            {'sku': 'NEG001', 'warehouse_id': WH_ID, 'new_quantity': -5},
        ],
        'inventory_inserts': [],
        'inventory_after_variant_create': [],
        'inventory_unchanged': [],
    }
    try:
        _build_rpc_payload(plan, SYNC_AT)
        assert False, '应抛出 RuntimeError'
    except RuntimeError as e:
        assert '负数' in str(e) or '不能为负数' in str(e)


@test("_build_rpc_payload: 空 Variant name 抛出 RuntimeError")
def test_build_rpc_empty_variant_name():
    plan = {
        'warehouse_rename_required': {
            'warehouse_id': WH_ID,
            'target_name': '菲律宾-新创启辰自建仓',
        },
        'new_variants': [
            {'sku': 'NONAME', 'name': '', 'country': 'PH'},
        ],
        'inventory_updates': [],
        'inventory_inserts': [],
        'inventory_after_variant_create': [
            {'sku': 'NONAME', 'warehouse_id': WH_ID, 'new_quantity': 100},
        ],
        'inventory_unchanged': [],
    }
    try:
        _build_rpc_payload(plan, SYNC_AT)
        assert False, '应抛出 RuntimeError'
    except RuntimeError as e:
        assert 'name' in str(e).lower() or '不能为空' in str(e)


@test("_build_rpc_payload: 仅 unchanged 条目的快照正常构建")
def test_build_rpc_unchanged_only():
    plan = {
        'warehouse_rename_required': {
            'warehouse_id': WH_ID,
            'target_name': '菲律宾-新创启辰自建仓',
        },
        'new_variants': [],
        'inventory_updates': [],
        'inventory_inserts': [],
        'inventory_after_variant_create': [],
        'inventory_unchanged': [
            {'sku': 'A', 'warehouse_id': WH_ID, 'quantity': 100},
            {'sku': 'B', 'warehouse_id': WH_ID, 'quantity': 200},
        ],
    }
    _, p_variants, p_inventory, _ = _build_rpc_payload(plan, SYNC_AT)
    assert len(p_variants) == 0
    assert len(p_inventory) == 2
    # unchanged 使用 quantity 字段（非 new_quantity）
    qtys = {item['sku']: item['quantity'] for item in p_inventory}
    assert qtys['A'] == 100
    assert qtys['B'] == 200


@test("_build_rpc_payload: 所有条目统一 last_sync_at")
def test_build_rpc_unified_sync_at():
    _, _, p_inventory, _ = _build_rpc_payload(SAMPLE_PLAN_FULL, SYNC_AT)
    for item in p_inventory:
        assert item['last_sync_at'] == SYNC_AT


# =========================================================================
# _save_fallback_log 测试
# =========================================================================

@test("_save_fallback_log: 写入文件并返回路径")
def test_save_fallback_log(tmp_path=None):
    import tempfile
    import os as _os
    with tempfile.TemporaryDirectory() as tmpdir:
        data = {
            'warehouse_id': WH_ID,
            'status': 'success',
            'new_variants_count': 5,
            'error_message': None,
            'started_at': '2026-06-13T12:00:00+08:00',
            'finished_at': '2026-06-13T12:00:05+08:00',
        }
        path = _save_fallback_log(data, tmpdir)
        assert _os.path.isfile(path)
        assert 'fallback-sync-log-' in path

        import json
        with open(path, 'r', encoding='utf-8') as f:
            content = json.load(f)
        assert content['type'] == 'fallback_sync_log'
        assert content['sync_log_data'] == data


@test("_save_fallback_log: 目录不存在时自动创建")
def test_save_fallback_log_creates_dir():
    import tempfile
    import os as _os
    with tempfile.TemporaryDirectory() as tmpdir:
        nested = _os.path.join(tmpdir, 'nested', 'runtime')
        data = {
            'warehouse_id': WH_ID,
            'status': 'failed',
            'new_variants_count': 0,
            'error_message': 'RPC error',
            'started_at': '2026-06-13T12:00:00+08:00',
            'finished_at': '2026-06-13T12:00:01+08:00',
        }
        path = _save_fallback_log(data, nested)
        assert _os.path.isfile(path)


# =========================================================================
# execute_plan_v2 参数验证测试
# =========================================================================

@test("execute_plan_v2: plan 缺少 warehouse_id 抛出 RuntimeError")
def test_execute_v2_no_warehouse():
    try:
        execute_plan_v2(
            SAMPLE_PLAN_NO_WAREHOUSE,
            sync_log_enabled=False,
            last_sync_at=SYNC_AT,
        )
        assert False, '应抛出 RuntimeError'
    except RuntimeError as e:
        assert 'warehouse_id' in str(e).lower()


@test("execute_plan_v2: 空快照 plan 在 _build_rpc_payload 阶段抛出")
def test_execute_v2_empty_snapshot():
    try:
        execute_plan_v2(
            SAMPLE_PLAN_EMPTY_INVENTORY,
            sync_log_enabled=False,
            last_sync_at=SYNC_AT,
        )
        assert False, '应抛出 RuntimeError'
    except RuntimeError as e:
        assert '空快照' in str(e) or '不能为空' in str(e)


# =========================================================================
# P5-SY4C 严格 quantity 校验测试（拒绝 bool/float/字符串/None）
# =========================================================================

def _plan_with_qty(raw_qty):
    """辅助：构建含指定 quantity 值的 inventory_updates plan."""
    return {
        'warehouse_rename_required': {
            'warehouse_id': WH_ID,
            'target_name': '菲律宾-新创启辰自建仓',
        },
        'new_variants': [],
        'inventory_updates': [
            {'sku': 'QTYTEST', 'warehouse_id': WH_ID, 'new_quantity': raw_qty},
        ],
        'inventory_inserts': [],
        'inventory_after_variant_create': [],
        'inventory_unchanged': [],
    }


def _plan_unchanged_with_qty(raw_qty):
    """辅助：构建含指定 quantity 值的 inventory_unchanged plan."""
    return {
        'warehouse_rename_required': {
            'warehouse_id': WH_ID,
            'target_name': '菲律宾-新创启辰自建仓',
        },
        'new_variants': [],
        'inventory_updates': [],
        'inventory_inserts': [],
        'inventory_after_variant_create': [],
        'inventory_unchanged': [
            {'sku': 'QTYTEST', 'warehouse_id': WH_ID, 'quantity': raw_qty},
        ],
    }


@test("quantity: float 1.5 被拒绝（type is not int）")
def test_quantity_rejects_float_1_5():
    try:
        _build_rpc_payload(_plan_with_qty(1.5), SYNC_AT)
        assert False, '应抛出 RuntimeError'
    except RuntimeError as e:
        assert 'int' in str(e) or 'float' in str(e)


@test("quantity: float 1.0 被拒绝（type is not int）")
def test_quantity_rejects_float_1_0():
    try:
        _build_rpc_payload(_plan_with_qty(1.0), SYNC_AT)
        assert False, '应抛出 RuntimeError'
    except RuntimeError as e:
        assert 'int' in str(e) or 'float' in str(e)


@test("quantity: bool True 被拒绝（bool 是 int 子类，必须显式拒绝）")
def test_quantity_rejects_bool_true():
    try:
        _build_rpc_payload(_plan_with_qty(True), SYNC_AT)
        assert False, '应抛出 RuntimeError'
    except RuntimeError as e:
        assert 'bool' in str(e).lower() or '布尔' in str(e)


@test("quantity: 字符串 '5' 被拒绝（type is not int）")
def test_quantity_rejects_string():
    try:
        _build_rpc_payload(_plan_with_qty('5'), SYNC_AT)
        assert False, '应抛出 RuntimeError'
    except RuntimeError as e:
        assert ('str' in str(e) or 'int' in str(e) or
                '必须为 int' in str(e) or '类型' in str(e))


@test("quantity: None 被拒绝（不能为 null）")
def test_quantity_rejects_none():
    try:
        _build_rpc_payload(_plan_with_qty(None), SYNC_AT)
        assert False, '应抛出 RuntimeError'
    except RuntimeError as e:
        assert 'None' in str(e) or 'null' in str(e).lower() or '不能为 None' in str(e)


@test("quantity: unchanged 条目 float 被拒绝")
def test_quantity_unchanged_rejects_float():
    try:
        _build_rpc_payload(_plan_unchanged_with_qty(1.5), SYNC_AT)
        assert False, '应抛出 RuntimeError'
    except RuntimeError as e:
        assert 'int' in str(e) or 'float' in str(e)


@test("quantity: unchanged 条目 bool 被拒绝")
def test_quantity_unchanged_rejects_bool():
    try:
        _build_rpc_payload(_plan_unchanged_with_qty(False), SYNC_AT)
        assert False, '应抛出 RuntimeError'
    except RuntimeError as e:
        assert 'bool' in str(e).lower() or '布尔' in str(e)


@test("quantity: 正常 int 零值被接受")
def test_quantity_accepts_zero():
    _, _, p_inventory, _ = _build_rpc_payload(_plan_with_qty(0), SYNC_AT)
    assert len(p_inventory) == 1
    assert p_inventory[0]['quantity'] == 0
    assert type(p_inventory[0]['quantity']) is int


# =========================================================================
# p_variants 输入校验测试
# =========================================================================

@test("p_variants: 重复 (sku,country) 业务键被拒绝")
def test_p_variants_duplicate_key():
    plan = {
        'warehouse_rename_required': {
            'warehouse_id': WH_ID,
            'target_name': '菲律宾-新创启辰自建仓',
        },
        'new_variants': [
            {'sku': 'DUP', 'name': '产品A', 'country': 'PH'},
            {'sku': 'DUP', 'name': '产品B', 'country': 'PH'},
        ],
        'inventory_updates': [],
        'inventory_inserts': [],
        'inventory_after_variant_create': [
            {'sku': 'DUP', 'warehouse_id': WH_ID, 'new_quantity': 100},
        ],
        'inventory_unchanged': [],
    }
    try:
        _build_rpc_payload(plan, SYNC_AT)
        assert False, '应抛出 RuntimeError'
    except RuntimeError as e:
        assert '重复' in str(e) or 'DUP' in str(e)


@test("p_variants: 新 Variant 缺少对应 Inventory 被拒绝")
def test_p_variants_missing_inventory():
    plan = {
        'warehouse_rename_required': {
            'warehouse_id': WH_ID,
            'target_name': '菲律宾-新创启辰自建仓',
        },
        'new_variants': [
            {'sku': 'ORPHAN', 'name': '孤儿产品', 'country': 'PH'},
        ],
        'inventory_updates': [
            {'sku': 'OTHER', 'warehouse_id': WH_ID, 'new_quantity': 100},
        ],
        'inventory_inserts': [],
        'inventory_after_variant_create': [],
        'inventory_unchanged': [],
    }
    try:
        _build_rpc_payload(plan, SYNC_AT)
        assert False, '应抛出 RuntimeError'
    except RuntimeError as e:
        assert 'ORPHAN' in str(e) or '缺少对应' in str(e)


@test("_build_rpc_payload: 空 SKU 被拒绝")
def test_quantity_empty_sku():
    plan = {
        'warehouse_rename_required': {
            'warehouse_id': WH_ID,
            'target_name': '菲律宾-新创启辰自建仓',
        },
        'new_variants': [],
        'inventory_updates': [
            {'sku': '', 'warehouse_id': WH_ID, 'new_quantity': 100},
        ],
        'inventory_inserts': [],
        'inventory_after_variant_create': [],
        'inventory_unchanged': [],
    }
    try:
        _build_rpc_payload(plan, SYNC_AT)
        assert False, '应抛出 RuntimeError'
    except RuntimeError as e:
        assert 'SKU' in str(e) and '空' in str(e)


# =========================================================================
# Mock 测试: execute_plan_v2 编排与错误分类
# =========================================================================

from unittest.mock import patch, MagicMock

MOCK_RPC_RESULT = {
    'variants_created': 1,
    'inventory_received': 4,
    'inventory_inserted': 1,
    'inventory_updated': 1,
    'inventory_unchanged': 2,
    'warehouse_renamed': True,
}

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
        {'sku': 'WM0005', 'warehouse_id': WH_ID, 'new_quantity': 1500},
    ],
    'inventory_inserts': [],
    'inventory_after_variant_create': [
        {'sku': 'NEW001', 'warehouse_id': WH_ID, 'new_quantity': 100},
    ],
    'inventory_unchanged': [
        {'sku': 'WM0074', 'warehouse_id': WH_ID, 'quantity': 21289},
    ],
}

MOCK_VARIANT_LIST = [
    {'id': 'v-001', 'sku': 'WM0005', 'country': 'PH'},
    {'id': 'v-002', 'sku': 'WM0074', 'country': 'PH'},
    {'id': 'v-003', 'sku': 'NEW001', 'country': 'PH'},
]
MOCK_VARIANT_MAP = {v['sku']: v['id'] for v in MOCK_VARIANT_LIST}

MOCK_INVENTORY_LIST = [
    {'id': 'inv-1', 'variant_id': 'v-001', 'warehouse_id': WH_ID, 'quantity': 1500},
    {'id': 'inv-2', 'variant_id': 'v-002', 'warehouse_id': WH_ID, 'quantity': 21289},
    {'id': 'inv-3', 'variant_id': 'v-003', 'warehouse_id': WH_ID, 'quantity': 100},
]

MOCK_WAREHOUSE = {
    'id': WH_ID, 'name': '菲律宾-新创启辰自建仓',
    'country': 'PH', 'type': 'overseas', 'is_active': True,
}


@test("网络超时写 failed: error_message 含 network_timeout_unknown")
def test_network_timeout_writes_failed_with_keyword():
    import sync.executor as ex
    with patch('sync.executor._call_sync_rpc') as mock_rpc, \
         patch('sync.executor._write_sync_log') as mock_log, \
         patch('sync.executor._save_fallback_log') as mock_fb:
        mock_rpc.side_effect = RuntimeError(
            'network_timeout_unknown: RPC 网络超时\n结果未知'
        )
        mock_log.return_value = {'id': 'log-1'}

        try:
            ex.execute_plan_v2(SIMPLE_PLAN, sync_log_enabled=True,
                               last_sync_at=SYNC_AT)
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert 'network_timeout_unknown' in str(e).lower()

        assert mock_log.called
        call_args = mock_log.call_args
        assert call_args[1]['status'] == 'failed'
        assert 'network_timeout_unknown' in str(call_args[1].get('error_message', '')).lower()


@test("RPC 成功后 Phase G 查询异常写 failed: 含 post-commit audit failed")
def test_phase_g_query_exception_writes_failed():
    import sync.executor as ex
    with patch('sync.executor._call_sync_rpc') as mock_rpc, \
         patch('sync.executor._get') as mock_get, \
         patch('sync.executor._write_sync_log') as mock_log, \
         patch('sync.executor._save_fallback_log') as mock_fb:
        mock_rpc.return_value = MOCK_RPC_RESULT
        mock_log.return_value = {'id': 'log-1'}
        # 第一次 _get (inventory) 抛异常
        mock_get.side_effect = RuntimeError('Supabase 连接失败')

        try:
            ex.execute_plan_v2(SIMPLE_PLAN, sync_log_enabled=True,
                               last_sync_at=SYNC_AT)
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert 'post-commit audit failed' in str(e).lower()

        assert mock_log.called
        call_args = mock_log.call_args
        assert call_args[1]['status'] == 'failed'
        assert 'post-commit audit failed' in str(call_args[1].get('error_message', '')).lower()


@test("RPC 成功后 Phase I 查询异常写 failed: 含 post-commit audit failed")
def test_phase_i_query_exception_writes_failed():
    import sync.executor as ex
    # Phase G 查询返回正常数据，Phase I 查询抛异常
    call_count = [0]

    def _get_side_effect(path):
        call_count[0] += 1
        # call 1: inventory query (Phase G) → OK
        # call 2: variant query (Phase G) → OK
        # call 3: warehouse query (Phase I) → FAIL
        if call_count[0] <= 2:
            if 'inventory' in path:
                return MOCK_INVENTORY_LIST
            if 'product_variant' in path:
                return MOCK_VARIANT_LIST
            return []
        raise RuntimeError('Supabase Warehouse 查询失败')

    with patch('sync.executor._call_sync_rpc') as mock_rpc, \
         patch('sync.executor._get') as mock_get, \
         patch('sync.executor.verify_inventory_post_write') as mock_verify_inv, \
         patch('sync.executor._write_sync_log') as mock_log, \
         patch('sync.executor._save_fallback_log') as mock_fb:
        mock_rpc.return_value = MOCK_RPC_RESULT
        mock_log.return_value = {'id': 'log-1'}
        mock_get.side_effect = _get_side_effect
        mock_verify_inv.return_value = []  # no diffs

        try:
            ex.execute_plan_v2(SIMPLE_PLAN, sync_log_enabled=True,
                               last_sync_at=SYNC_AT)
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert 'post-commit audit failed' in str(e).lower()

        assert mock_log.called
        call_args = mock_log.call_args
        assert call_args[1]['status'] == 'failed'
        assert 'post-commit audit failed' in str(call_args[1].get('error_message', '')).lower()


@test("sync_log 首次失败、第二次成功")
def test_sync_log_retry_succeeds():
    import sync.executor as ex
    from unittest.mock import patch, MagicMock
    import io
    import urllib.error

    # 模拟 urllib：第一次 HTTPError，第二次成功
    call_count = [0]

    def _mock_urlopen(*args, **kwargs):
        call_count[0] += 1
        if call_count[0] == 1:
            raise urllib.error.HTTPError(
                url='http://test/rpc', code=500, msg='Server Error',
                hdrs=None, fp=io.BytesIO(b'{"error":"test"}')
            )
        # 第二次成功：返回含 sync_log 数据的响应
        resp = MagicMock()
        resp.read.return_value = (
            b'[{"id":"log-ok","warehouse_id":"'
            + WH_ID.encode() +
            b'","status":"success"}]'
        )
        resp.__enter__ = MagicMock(return_value=resp)
        resp.__exit__ = MagicMock(return_value=False)
        return resp

    with patch('urllib.request.urlopen', side_effect=_mock_urlopen), \
         patch('urllib.request.Request', MagicMock()):
        result = ex._write_sync_log(
            warehouse_id=WH_ID,
            status='success',
            new_variants_count=5,
            error_message=None,
            started_at=SYNC_AT,
            finished_at=SYNC_AT,
        )
        assert result['id'] == 'log-ok'
        assert call_count[0] == 2


@test("sync_log 连续失败后保存 fallback")
def test_sync_log_consecutive_fail_saves_fallback():
    import sync.executor as ex
    import tempfile

    def _fail_sync_log(*args, **kwargs):
        raise RuntimeError('sync_log 连续失败')

    with tempfile.TemporaryDirectory() as tmpdir:
        with patch('sync.executor._call_sync_rpc') as mock_rpc, \
             patch('sync.executor._get') as mock_get, \
             patch('sync.executor.verify_inventory_post_write') as mock_verify_inv, \
             patch('sync.executor.verify_warehouse_final_state') as mock_verify_wh, \
             patch('sync.executor._write_sync_log') as mock_log:
            mock_rpc.return_value = MOCK_RPC_RESULT
            mock_log.side_effect = _fail_sync_log
            # Phase G/I queries: inventory → MOCK_INVENTORY_LIST,
            # variant → MOCK_VARIANT_LIST, warehouse → MOCK_WAREHOUSE
            mock_get.side_effect = lambda path: (
                MOCK_INVENTORY_LIST if 'inventory' in path
                else [MOCK_WAREHOUSE] if 'warehouse' in path
                else MOCK_VARIANT_LIST
            )
            mock_verify_inv.return_value = []
            mock_verify_wh.return_value = []

            result = ex.execute_plan_v2(SIMPLE_PLAN, sync_log_enabled=True,
                                        last_sync_at=SYNC_AT,
                                        fallback_dir=tmpdir)
            assert result['sync_log_written'] is False
            assert result['sync_log_fallback_path'] is not None
            import os as _os
            assert _os.path.isfile(result['sync_log_fallback_path'])


@test("RPC 成功 + 审计通过 + success log 成功（完整 happy path）")
def test_full_happy_path():
    import sync.executor as ex
    with patch('sync.executor._call_sync_rpc') as mock_rpc, \
         patch('sync.executor._get') as mock_get, \
         patch('sync.executor.verify_inventory_post_write') as mock_verify_inv, \
         patch('sync.executor.verify_warehouse_final_state') as mock_verify_wh, \
         patch('sync.executor._write_sync_log') as mock_log:
        mock_rpc.return_value = MOCK_RPC_RESULT
        mock_log.return_value = {'id': 'log-success'}
        mock_get.side_effect = lambda path: (
            MOCK_INVENTORY_LIST if 'inventory' in path
            else [MOCK_WAREHOUSE] if 'warehouse' in path
            else MOCK_VARIANT_LIST
        )
        mock_verify_inv.return_value = []
        mock_verify_wh.return_value = []

        result = ex.execute_plan_v2(SIMPLE_PLAN, sync_log_enabled=True,
                                    last_sync_at=SYNC_AT)
        assert result['sync_log_written'] is True
        assert result['phase_g_verified'] is True
        assert result['phase_i_verified'] is True
        assert result['rpc_summary'] == MOCK_RPC_RESULT

        # finished_at 在 Phase G/I 全部通过后设置，非空
        assert result['finished_at'] is not None, \
            'finished_at 应在 Phase G/I 通过后设置'
        assert len(result['finished_at']) > 0, \
            'finished_at 不应为空字符串'

        # 验证 success log 被调用
        success_call = mock_log.call_args
        assert success_call[1]['status'] == 'success'
        assert success_call[1]['error_message'] is None

        # result.finished_at 与 SyncLog.finished_at 必须使用同一值
        assert success_call[1]['finished_at'] == result['finished_at'], (
            f'SyncLog.finished_at ({success_call[1]["finished_at"]}) '
            f'!= result.finished_at ({result["finished_at"]})'
        )


@test("成功路径调用顺序: sync_log 写入在 Phase G/I 查询之后")
def test_success_path_call_order_sync_log_after_audit():
    """使用 MagicMock 追踪调用顺序：_write_sync_log 在所有 _get 查询之后被调用。"""
    import sync.executor as ex
    from unittest.mock import patch, MagicMock

    mock_rpc = MagicMock(return_value=MOCK_RPC_RESULT)
    mock_log = MagicMock(return_value={'id': 'log-order'})

    def _get_logic(path):
        if 'inventory' in path:
            return MOCK_INVENTORY_LIST
        if 'warehouse' in path:
            return [MOCK_WAREHOUSE]
        return MOCK_VARIANT_LIST

    mock_get = MagicMock(side_effect=_get_logic)

    with patch('sync.executor._call_sync_rpc', mock_rpc), \
         patch('sync.executor._get', mock_get), \
         patch('sync.executor.verify_inventory_post_write', return_value=[]), \
         patch('sync.executor.verify_warehouse_final_state', return_value=[]), \
         patch('sync.executor._write_sync_log', mock_log), \
         patch('sync.executor._save_fallback_log'):

        result = ex.execute_plan_v2(SIMPLE_PLAN, sync_log_enabled=True,
                                    last_sync_at=SYNC_AT)
        assert result['sync_log_written'] is True

    # result.finished_at 与 SyncLog.finished_at 必须使用同一值
    log_call_finished = mock_log.call_args[1]['finished_at']
    assert log_call_finished is not None, 'SyncLog.finished_at 不应为 None'
    assert log_call_finished == result['finished_at'], \
        f'SyncLog.finished_at ({log_call_finished}) != result.finished_at ({result["finished_at"]})'


@test("RPC 成功 + success log 连续失败 → fallback，模拟 CLI exit 2")
def test_rpc_success_sync_log_fail_exit_2():
    import sync.executor as ex
    import tempfile
    with tempfile.TemporaryDirectory() as tmpdir:
        with patch('sync.executor._call_sync_rpc') as mock_rpc, \
             patch('sync.executor._get') as mock_get, \
             patch('sync.executor.verify_inventory_post_write') as mock_verify_inv, \
             patch('sync.executor.verify_warehouse_final_state') as mock_verify_wh, \
             patch('sync.executor._write_sync_log') as mock_log:
            mock_rpc.return_value = MOCK_RPC_RESULT
            mock_log.side_effect = RuntimeError('sync_log 写入连续失败')
            mock_get.side_effect = lambda path: (
                MOCK_INVENTORY_LIST if 'inventory' in path
                else [MOCK_WAREHOUSE] if 'warehouse' in path
                else MOCK_VARIANT_LIST
            )
            mock_verify_inv.return_value = []
            mock_verify_wh.return_value = []

            result = ex.execute_plan_v2(SIMPLE_PLAN, sync_log_enabled=True,
                                        last_sync_at=SYNC_AT,
                                        fallback_dir=tmpdir)
            # RPC 成功但 sync_log 失败
            assert result['sync_log_written'] is False
            assert result['sync_log_fallback_path'] is not None
            assert result['rpc_summary'] is not None
            # CLI 应 exit 2


@test("RPC 失败 → RuntimeError → CLI exit 1")
def test_rpc_failure_exit_1():
    import sync.executor as ex
    with patch('sync.executor._call_sync_rpc') as mock_rpc, \
         patch('sync.executor._write_sync_log') as mock_log, \
         patch('sync.executor._save_fallback_log') as mock_fb:
        mock_rpc.side_effect = RuntimeError(
            'Supabase RPC 错误 (400): quantity 不能为负数'
        )
        mock_log.return_value = {'id': 'log-failed'}

        try:
            ex.execute_plan_v2(SIMPLE_PLAN, sync_log_enabled=True,
                               last_sync_at=SYNC_AT)
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert 'RPC 错误' in str(e) or 'quantity' in str(e)

        # 验证写入了 sync_log.failed
        assert mock_log.called
        assert mock_log.call_args[1]['status'] == 'failed'


@test("审计失败 → RuntimeError → CLI exit 1")
def test_audit_failure_exit_1():
    import sync.executor as ex
    with patch('sync.executor._call_sync_rpc') as mock_rpc, \
         patch('sync.executor._get') as mock_get, \
         patch('sync.executor.verify_inventory_post_write') as mock_verify_inv, \
         patch('sync.executor._write_sync_log') as mock_log, \
         patch('sync.executor._save_fallback_log') as mock_fb:
        mock_rpc.return_value = MOCK_RPC_RESULT
        mock_log.return_value = {'id': 'log-audit-fail'}
        mock_get.side_effect = lambda path: (
            MOCK_INVENTORY_LIST if 'inventory' in path else MOCK_VARIANT_LIST
        )
        # Phase G 验证返回差异
        mock_verify_inv.return_value = [
            'SKU WM0005: expected 1500, got 9999'
        ]

        try:
            ex.execute_plan_v2(SIMPLE_PLAN, sync_log_enabled=True,
                               last_sync_at=SYNC_AT)
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert 'post-commit audit failed' in str(e).lower()

        assert mock_log.called
        assert mock_log.call_args[1]['status'] == 'failed'
        assert 'post-commit audit failed' in str(mock_log.call_args[1].get('error_message', '')).lower()

        # 审计失败时 sync_log.finished_at 非空（由 _record_audit_failure 设置）
        assert mock_log.call_args[1]['finished_at'] is not None, \
            '审计失败时 SyncLog.finished_at 不应为 None'
        assert len(mock_log.call_args[1]['finished_at']) > 0, \
            '审计失败时 SyncLog.finished_at 不应为空'


@test("审计失败: result.finished_at 设置为失败时间，SyncLog.finished_at 使用同一值")
def test_audit_failure_sets_result_finished_at():
    """审计失败时 _record_audit_failure 设置 result.finished_at，
    SyncLog.finished_at 必须与此值一致。"""
    import sync.executor as ex
    # 使用副作用捕获 result 返回值（即使抛异常，内部 result dict 已被修改）
    captured_result = []

    def _audit_failure_wrapper(plan, sync_log_enabled, last_sync_at):
        try:
            return ex.execute_plan_v2_original(plan, sync_log_enabled=sync_log_enabled,
                                               last_sync_at=last_sync_at)
        except RuntimeError:
            # 无法获取 result dict，通过 mock_log 间接验证
            raise

    with patch('sync.executor._call_sync_rpc') as mock_rpc, \
         patch('sync.executor._get') as mock_get, \
         patch('sync.executor.verify_inventory_post_write') as mock_verify_inv, \
         patch('sync.executor._write_sync_log') as mock_log, \
         patch('sync.executor._save_fallback_log') as mock_fb:
        mock_rpc.return_value = MOCK_RPC_RESULT
        mock_log.return_value = {'id': 'log-audit-fail'}
        mock_get.side_effect = lambda path: (
            MOCK_INVENTORY_LIST if 'inventory' in path else MOCK_VARIANT_LIST
        )
        mock_verify_inv.return_value = [
            'SKU WM0005: expected 1500, got 9999'
        ]

        try:
            ex.execute_plan_v2(SIMPLE_PLAN, sync_log_enabled=True,
                               last_sync_at=SYNC_AT)
            assert False, '应抛出 RuntimeError'
        except RuntimeError:
            pass

    # 审计失败时应写入了 failed sync_log
    assert mock_log.called
    call_kwargs = mock_log.call_args[1]
    assert call_kwargs['status'] == 'failed'
    # finished_at 非空
    log_finished = call_kwargs['finished_at']
    assert log_finished is not None, '审计失败时 SyncLog.finished_at 不应为 None'
    assert len(log_finished) > 0, '审计失败时 SyncLog.finished_at 不应为空'


# =========================================================================
# P5-SY4C 返工: 新增聚焦 Mock 测试
# =========================================================================

@test("URLError 不重试: urlopen 仅调用 1 次，抛 network_timeout_unknown")
def test_urlerror_no_retry():
    """验证 _call_sync_rpc 在 URLError 时只发送一次请求"""
    import sync.executor as ex
    import urllib.error
    from unittest.mock import patch

    call_count = [0]

    def _mock_urlopen(*args, **kwargs):
        call_count[0] += 1
        raise urllib.error.URLError('connection refused')

    with patch('urllib.request.urlopen', side_effect=_mock_urlopen), \
         patch('urllib.request.Request', MagicMock()):
        try:
            ex._call_sync_rpc(
                warehouse_id=WH_ID,
                p_variants=[],
                p_inventory=[{'sku': 'X', 'country': 'PH', 'quantity': 1,
                              'last_sync_at': SYNC_AT}],
                p_warehouse_name='菲律宾-新创启辰自建仓',
            )
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert 'network_timeout_unknown' in str(e).lower()
            assert '未重试' in str(e) or '仅发送一次' in str(e)

        assert call_count[0] == 1, f'urlopen 应仅调用 1 次，实际 {call_count[0]} 次'


@test("审计失败 + sync_log 写入失败: 最终异常仍含 post-commit audit failed，且 fallback 已生成")
def test_audit_fail_sync_log_fail_preserves_main_error():
    """post-commit 审计失败时 sync_log 写入也失败，
    最终 RuntimeError 必须包含 post-commit audit failed（非 fallback 信息）"""
    import sync.executor as ex
    import tempfile

    def _fail_sync_log(*args, **kwargs):
        raise RuntimeError('sync_log 写入失败')

    with tempfile.TemporaryDirectory() as tmpdir:
        with patch('sync.executor._call_sync_rpc') as mock_rpc, \
             patch('sync.executor._get') as mock_get, \
             patch('sync.executor.verify_inventory_post_write') as mock_verify_inv, \
             patch('sync.executor._write_sync_log') as mock_log:
            mock_rpc.return_value = MOCK_RPC_RESULT
            mock_log.side_effect = _fail_sync_log
            mock_get.side_effect = lambda path: (
                MOCK_INVENTORY_LIST if 'inventory' in path else MOCK_VARIANT_LIST
            )
            # Phase G 验证返回差异 → 触发审计失败
            mock_verify_inv.return_value = [
                'SKU WM0005: expected 1500, got 9999'
            ]

            try:
                ex.execute_plan_v2(SIMPLE_PLAN, sync_log_enabled=True,
                                   last_sync_at=SYNC_AT,
                                   fallback_dir=tmpdir)
                assert False, '应抛出 RuntimeError'
            except RuntimeError as e:
                assert 'post-commit audit failed' in str(e).lower(), \
                    f'主错误缺失 post-commit audit failed: {e}'
                assert 'Phase G' in str(e), \
                    f'主错误应包含原始审计阶段: {e}'
                # sync_log fallback 信息不应替换主错误
                # （主错误应为审计失败，fallback 仅记录在内部 errors 列表）


@test("RPC 空响应被拒绝并写 failed log")
def test_rpc_empty_response_rejected():
    """_call_sync_rpc 返回 {} → 校验拒绝，写 sync_log.failed"""
    import sync.executor as ex

    with patch('sync.executor._call_sync_rpc') as mock_rpc, \
         patch('sync.executor._write_sync_log') as mock_log, \
         patch('sync.executor._save_fallback_log') as mock_fb:
        mock_rpc.return_value = {}
        mock_log.return_value = {'id': 'log-fail'}

        try:
            ex.execute_plan_v2(SIMPLE_PLAN, sync_log_enabled=True,
                               last_sync_at=SYNC_AT)
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert 'RPC 返回摘要校验失败' in str(e)
            assert 'variants_created' in str(e).lower() or '缺少必需字段' in str(e)

        assert mock_log.called
        call_args = mock_log.call_args
        assert call_args[1]['status'] == 'failed'
        assert 'RPC 返回摘要校验失败' in str(call_args[1].get('error_message', ''))


@test("RPC 非法 JSON → RuntimeError + 写 failed log")
def test_rpc_invalid_json_writes_failed_log():
    """_call_sync_rpc 因非法 JSON 抛 RuntimeError → execute_plan_v2 写 failed log"""
    import sync.executor as ex

    with patch('sync.executor._call_sync_rpc') as mock_rpc, \
         patch('sync.executor._write_sync_log') as mock_log, \
         patch('sync.executor._save_fallback_log') as mock_fb:
        mock_rpc.side_effect = RuntimeError(
            'Supabase RPC 返回非法 JSON（RPC 已执行，提交状态未知）: '
            'Expecting value: line 1 column 1 (char 0)\n'
            '必须只读查询核对数据库状态后再决定是否重试'
        )
        mock_log.return_value = {'id': 'log-fail'}

        try:
            ex.execute_plan_v2(SIMPLE_PLAN, sync_log_enabled=True,
                               last_sync_at=SYNC_AT)
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert '非法 JSON' in str(e)

        assert mock_log.called
        call_args = mock_log.call_args
        assert call_args[1]['status'] == 'failed'
        assert '非法 JSON' in str(call_args[1].get('error_message', ''))


@test("RPC 摘要缺字段/错误类型/计数不一致均被拒绝")
def test_rpc_summary_field_type_count_validation():
    """逐一验证: 缺字段、bool 替 int、负数、warehouse_renamed 非 bool、计数不等"""
    import sync.executor as ex

    # 场景 a: 缺字段
    with patch('sync.executor._call_sync_rpc') as mock_rpc, \
         patch('sync.executor._write_sync_log') as mock_log, \
         patch('sync.executor._save_fallback_log') as mock_fb:
        mock_rpc.return_value = {'variants_created': 0}
        mock_log.return_value = {'id': 'log-fail'}

        try:
            ex.execute_plan_v2(SIMPLE_PLAN, sync_log_enabled=True,
                               last_sync_at=SYNC_AT)
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert '缺少必需字段' in str(e)
            assert 'inventory_received' in str(e)

    # 场景 b: bool 替代 int
    with patch('sync.executor._call_sync_rpc') as mock_rpc, \
         patch('sync.executor._write_sync_log') as mock_log, \
         patch('sync.executor._save_fallback_log') as mock_fb:
        mock_rpc.return_value = {
            'variants_created': True,  # bool, 非 int
            'inventory_received': 4,
            'inventory_inserted': 1,
            'inventory_updated': 1,
            'inventory_unchanged': 2,
            'warehouse_renamed': True,
        }
        mock_log.return_value = {'id': 'log-fail'}

        try:
            ex.execute_plan_v2(SIMPLE_PLAN, sync_log_enabled=True,
                               last_sync_at=SYNC_AT)
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert 'variants_created' in str(e)
            assert 'bool' in str(e).lower() or '必须为 int' in str(e)

    # 场景 c: 负数
    with patch('sync.executor._call_sync_rpc') as mock_rpc, \
         patch('sync.executor._write_sync_log') as mock_log, \
         patch('sync.executor._save_fallback_log') as mock_fb:
        mock_rpc.return_value = {
            'variants_created': -1,
            'inventory_received': 4,
            'inventory_inserted': 1,
            'inventory_updated': 1,
            'inventory_unchanged': 2,
            'warehouse_renamed': True,
        }
        mock_log.return_value = {'id': 'log-fail'}

        try:
            ex.execute_plan_v2(SIMPLE_PLAN, sync_log_enabled=True,
                               last_sync_at=SYNC_AT)
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert '负数' in str(e) or '不能为负数' in str(e)

    # 场景 d: warehouse_renamed 非 bool
    with patch('sync.executor._call_sync_rpc') as mock_rpc, \
         patch('sync.executor._write_sync_log') as mock_log, \
         patch('sync.executor._save_fallback_log') as mock_fb:
        mock_rpc.return_value = {
            'variants_created': 0,
            'inventory_received': 4,
            'inventory_inserted': 1,
            'inventory_updated': 1,
            'inventory_unchanged': 2,
            'warehouse_renamed': 'yes',  # 字符串，非 bool
        }
        mock_log.return_value = {'id': 'log-fail'}

        try:
            ex.execute_plan_v2(SIMPLE_PLAN, sync_log_enabled=True,
                               last_sync_at=SYNC_AT)
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert 'warehouse_renamed' in str(e)
            assert 'bool' in str(e).lower()

    # 场景 e: 计数不一致
    with patch('sync.executor._call_sync_rpc') as mock_rpc, \
         patch('sync.executor._write_sync_log') as mock_log, \
         patch('sync.executor._save_fallback_log') as mock_fb:
        mock_rpc.return_value = {
            'variants_created': 0,
            'inventory_received': 10,  # 与 inserted+updated+unchanged 不等
            'inventory_inserted': 1,
            'inventory_updated': 2,
            'inventory_unchanged': 3,
            'warehouse_renamed': True,
        }
        mock_log.return_value = {'id': 'log-fail'}

        try:
            ex.execute_plan_v2(SIMPLE_PLAN, sync_log_enabled=True,
                               last_sync_at=SYNC_AT)
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert 'inventory_received' in str(e)
            assert '!=' in str(e) or '不等于' in str(e) or '10' in str(e)


# =========================================================================
# P5-SY4C 第三次返工: 响应解析路径测试 (覆盖真实 urlopen mock)
# =========================================================================


@test("_call_sync_rpc: 非法 UTF-8 响应 → RuntimeError, urlopen 仅调用 1 次")
def test_rpc_utf8_decode_error():
    """mock urlopen 返回无法解码为 UTF-8 的字节 → UnicodeDecodeError
    → RuntimeError('非法 UTF-8')，不重试"""
    import sync.executor as ex
    from unittest.mock import patch, MagicMock

    call_count = [0]

    def _bad_utf8_response(*args, **kwargs):
        call_count[0] += 1
        resp = MagicMock()
        resp.read.return_value = b'\xff\xfe\x80\x81\x82'
        resp.__enter__ = MagicMock(return_value=resp)
        resp.__exit__ = MagicMock(return_value=False)
        return resp

    with patch('urllib.request.urlopen', side_effect=_bad_utf8_response), \
         patch('urllib.request.Request', MagicMock()):
        try:
            ex._call_sync_rpc(
                warehouse_id=WH_ID,
                p_variants=[],
                p_inventory=[{'sku': 'X', 'country': 'PH', 'quantity': 1,
                              'last_sync_at': SYNC_AT}],
                p_warehouse_name='菲律宾-新创启辰自建仓',
            )
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert 'UTF-8' in str(e), f'应包含 "UTF-8": {e}'
            assert '提交状态未知' in str(e), f'应包含 "提交状态未知": {e}'
            assert '必须只读' in str(e), f'应包含 "必须只读": {e}'

    assert call_count[0] == 1, f'urlopen 应仅调用 1 次，实际 {call_count[0]} 次'


@test("_write_sync_log: 非法 JSON 响应 → 重试 1 次后抛 RuntimeError")
def test_sync_log_invalid_json_retry_then_raise():
    """mock urlopen 返回非 JSON 字符串 → JSONDecodeError → 重试 → RuntimeError"""
    import sync.executor as ex
    from unittest.mock import patch, MagicMock

    call_count = [0]

    def _bad_json_response(*args, **kwargs):
        call_count[0] += 1
        resp = MagicMock()
        resp.read.return_value = b'this is not json at all'
        resp.__enter__ = MagicMock(return_value=resp)
        resp.__exit__ = MagicMock(return_value=False)
        return resp

    with patch('urllib.request.urlopen', side_effect=_bad_json_response), \
         patch('urllib.request.Request', MagicMock()):
        try:
            ex._write_sync_log(
                warehouse_id=WH_ID,
                status='success',
                new_variants_count=3,
                error_message=None,
                started_at=SYNC_AT,
                finished_at=SYNC_AT,
            )
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert 'JSONDecodeError' in str(e) or '响应解析错误' in str(e), \
                f'错误信息应提及 JSONDecodeError 或响应解析错误: {e}'
        except json.JSONDecodeError:
            assert False, '不应直接泄漏 JSONDecodeError'

    assert call_count[0] == 2, f'urlopen 应调用 2 次（重试 1 次），实际 {call_count[0]} 次'  # noqa: F821


@test("_write_sync_log: 非法 UTF-8 响应 → 重试 1 次后抛 RuntimeError")
def test_sync_log_utf8_decode_error_retry_then_raise():
    """mock urlopen 返回非 UTF-8 字节 → UnicodeDecodeError → 重试 → RuntimeError"""
    import sync.executor as ex
    from unittest.mock import patch, MagicMock

    call_count = [0]

    def _bad_utf8_response(*args, **kwargs):
        call_count[0] += 1
        resp = MagicMock()
        resp.read.return_value = b'\xff\xfe\x80\x81\x82'
        resp.__enter__ = MagicMock(return_value=resp)
        resp.__exit__ = MagicMock(return_value=False)
        return resp

    with patch('urllib.request.urlopen', side_effect=_bad_utf8_response), \
         patch('urllib.request.Request', MagicMock()):
        try:
            ex._write_sync_log(
                warehouse_id=WH_ID,
                status='success',
                new_variants_count=3,
                error_message=None,
                started_at=SYNC_AT,
                finished_at=SYNC_AT,
            )
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert 'UnicodeDecodeError' in str(e) or '响应解析错误' in str(e), \
                f'错误信息应提及 UnicodeDecodeError 或响应解析错误: {e}'

    assert call_count[0] == 2, f'urlopen 应调用 2 次（重试 1 次），实际 {call_count[0]} 次'


@test("_write_sync_log: 空响应 → 重试 1 次后抛 RuntimeError")
def test_sync_log_empty_response_retry_then_raise():
    """mock urlopen 返回空响应体 → RuntimeError('空响应') → 重试 → 最终 RuntimeError"""
    import sync.executor as ex
    from unittest.mock import patch, MagicMock

    call_count = [0]

    def _empty_response(*args, **kwargs):
        call_count[0] += 1
        resp = MagicMock()
        resp.read.return_value = b''
        resp.__enter__ = MagicMock(return_value=resp)
        resp.__exit__ = MagicMock(return_value=False)
        return resp

    with patch('urllib.request.urlopen', side_effect=_empty_response), \
         patch('urllib.request.Request', MagicMock()):
        try:
            ex._write_sync_log(
                warehouse_id=WH_ID,
                status='success',
                new_variants_count=0,
                error_message=None,
                started_at=SYNC_AT,
                finished_at=SYNC_AT,
            )
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert '空响应' in str(e), f'错误信息应包含 "空响应": {e}'

    assert call_count[0] == 2, f'urlopen 应调用 2 次（重试 1 次），实际 {call_count[0]} 次'


@test("_write_sync_log: 非预期 JSON 结构 → 重试 1 次后抛 RuntimeError")
def test_sync_log_unexpected_structure_retry_then_raise():
    """mock urlopen 返回字符串 JSON（非 list/dict）→ RuntimeError → 重试 → 最终 RuntimeError"""
    import sync.executor as ex
    from unittest.mock import patch, MagicMock

    call_count = [0]

    def _unexpected_structure(*args, **kwargs):
        call_count[0] += 1
        resp = MagicMock()
        resp.read.return_value = b'"just a bare string"'
        resp.__enter__ = MagicMock(return_value=resp)
        resp.__exit__ = MagicMock(return_value=False)
        return resp

    with patch('urllib.request.urlopen', side_effect=_unexpected_structure), \
         patch('urllib.request.Request', MagicMock()):
        try:
            ex._write_sync_log(
                warehouse_id=WH_ID,
                status='success',
                new_variants_count=0,
                error_message=None,
                started_at=SYNC_AT,
                finished_at=SYNC_AT,
            )
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert '非预期' in str(e) or '结构' in str(e), \
                f'错误信息应包含 "非预期" 或 "结构": {e}'

    assert call_count[0] == 2, f'urlopen 应调用 2 次（重试 1 次），实际 {call_count[0]} 次'


@test("execute_plan_v2: RPC 成功 + SyncLog 响应解析失败 → fallback (CLI exit 2 路径)")
def test_rpc_success_sync_log_parse_error_fallback():
    """RPC 成功后 sync_log 写入因非法 JSON 响应失败 → 保存 fallback → 不抛异常。
    模拟 CLI exit 2 的条件：sync_log_written=False + sync_log_fallback_path 已设置。"""
    import sync.executor as ex
    import tempfile
    from unittest.mock import patch, MagicMock

    call_count = [0]

    def _bad_sync_log_response(*args, **kwargs):
        """Mock urlopen for sync_log write: first call bad JSON, second also bad."""
        call_count[0] += 1
        resp = MagicMock()
        resp.read.return_value = b'not json {{'
        resp.__enter__ = MagicMock(return_value=resp)
        resp.__exit__ = MagicMock(return_value=False)
        return resp

    with tempfile.TemporaryDirectory() as tmpdir:
        with patch('sync.executor._call_sync_rpc') as mock_rpc, \
             patch('sync.executor._get') as mock_get, \
             patch('sync.executor.verify_inventory_post_write') as mock_verify_inv, \
             patch('sync.executor.verify_warehouse_final_state') as mock_verify_wh, \
             patch('urllib.request.urlopen', side_effect=_bad_sync_log_response), \
             patch('urllib.request.Request', MagicMock()):
            mock_rpc.return_value = MOCK_RPC_RESULT
            mock_get.side_effect = lambda path: (
                MOCK_INVENTORY_LIST if 'inventory' in path
                else [MOCK_WAREHOUSE] if 'warehouse' in path
                else MOCK_VARIANT_LIST
            )
            mock_verify_inv.return_value = []
            mock_verify_wh.return_value = []

            result = ex.execute_plan_v2(SIMPLE_PLAN, sync_log_enabled=True,
                                        last_sync_at=SYNC_AT,
                                        fallback_dir=tmpdir)
            # RPC 成功
            assert result['rpc_summary'] == MOCK_RPC_RESULT
            assert result['phase_g_verified'] is True
            assert result['phase_i_verified'] is True
            # SyncLog 写入失败 → fallback
            assert result['sync_log_written'] is False, \
                'sync_log 应因解析错误写入失败'
            assert result['sync_log_fallback_path'] is not None, \
                '应已保存 fallback 日志'
            import os as _os
            assert _os.path.isfile(result['sync_log_fallback_path']), \
                'fallback 文件应存在'

        # urlopen 的 sync_log POST 应被调用 2 次（重试 1 次）
        # _call_sync_rpc 也使用 urlopen 但被 mock 了，
        # 所以只统计 sync_log 写入的 urlopen 调用：
        assert call_count[0] == 2, \
            f'sync_log urlopen 应调用 2 次，实际 {call_count[0]} 次'


@test("execute_plan_v2: RPC 非法 UTF-8 → failed log + RuntimeError (exit 1)")
def test_rpc_utf8_error_writes_failed_log():
    """RPC 返回非法 UTF-8 → _call_sync_rpc 抛 RuntimeError
    → execute_plan_v2 捕获 → 写 sync_log.failed → 重新抛出"""
    import sync.executor as ex
    from unittest.mock import patch

    with patch('sync.executor._call_sync_rpc') as mock_rpc, \
         patch('sync.executor._write_sync_log') as mock_log, \
         patch('sync.executor._save_fallback_log') as mock_fb:
        mock_rpc.side_effect = RuntimeError(
            'Supabase RPC 返回非法 UTF-8（RPC 已执行，提交状态未知）: '
            "'utf-8' codec can't decode byte 0xff in position 0: invalid start byte\n"
            '必须只读查询核对数据库状态后再决定是否重试\n'
            '禁止自动重试 RPC 写请求'
        )
        mock_log.return_value = {'id': 'log-fail'}

        try:
            ex.execute_plan_v2(SIMPLE_PLAN, sync_log_enabled=True,
                               last_sync_at=SYNC_AT)
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert '非法 UTF-8' in str(e)
            assert 'RPC 已执行' in str(e)

        assert mock_log.called
        call_args = mock_log.call_args
        assert call_args[1]['status'] == 'failed'
        assert '非法 UTF-8' in str(call_args[1].get('error_message', ''))


# =========================================================================
# P5-SY4C 第四次返工: SyncLog 响应严格校验 + fallback 自身失败保护
# =========================================================================


@test("_write_sync_log: list 首元素为 null → 重试后 RuntimeError")
def test_sync_log_list_first_null_retry_then_raise():
    """mock urlopen 返回 [null] → RuntimeError('首元素必须为 dict') → 重试"""
    import sync.executor as ex
    from unittest.mock import patch, MagicMock

    call_count = [0]

    def _null_response(*args, **kwargs):
        call_count[0] += 1
        resp = MagicMock()
        resp.read.return_value = b'[null]'
        resp.__enter__ = MagicMock(return_value=resp)
        resp.__exit__ = MagicMock(return_value=False)
        return resp

    with patch('urllib.request.urlopen', side_effect=_null_response), \
         patch('urllib.request.Request', MagicMock()):
        try:
            ex._write_sync_log(
                warehouse_id=WH_ID,
                status='success',
                new_variants_count=0,
                error_message=None,
                started_at=SYNC_AT,
                finished_at=SYNC_AT,
            )
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert '必须为 dict' in str(e), \
                f'错误信息应包含 "必须为 dict": {e}'

    assert call_count[0] == 2, f'urlopen 应调用 2 次，实际 {call_count[0]} 次'


@test("_write_sync_log: list 首元素为字符串 → 重试后 RuntimeError")
def test_sync_log_list_first_string_retry_then_raise():
    """mock urlopen 返回 ["notadict"] → RuntimeError('首元素必须为 dict') → 重试"""
    import sync.executor as ex
    from unittest.mock import patch, MagicMock

    call_count = [0]

    def _string_response(*args, **kwargs):
        call_count[0] += 1
        resp = MagicMock()
        resp.read.return_value = b'["notadict"]'
        resp.__enter__ = MagicMock(return_value=resp)
        resp.__exit__ = MagicMock(return_value=False)
        return resp

    with patch('urllib.request.urlopen', side_effect=_string_response), \
         patch('urllib.request.Request', MagicMock()):
        try:
            ex._write_sync_log(
                warehouse_id=WH_ID,
                status='success',
                new_variants_count=0,
                error_message=None,
                started_at=SYNC_AT,
                finished_at=SYNC_AT,
            )
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert '必须为 dict' in str(e), \
                f'错误信息应包含 "必须为 dict": {e}'

    assert call_count[0] == 2, f'urlopen 应调用 2 次，实际 {call_count[0]} 次'


@test("_write_sync_log: list 首元素为数字 → 重试后 RuntimeError")
def test_sync_log_list_first_number_retry_then_raise():
    """mock urlopen 返回 [123] → RuntimeError('首元素必须为 dict') → 重试"""
    import sync.executor as ex
    from unittest.mock import patch, MagicMock

    call_count = [0]

    def _number_response(*args, **kwargs):
        call_count[0] += 1
        resp = MagicMock()
        resp.read.return_value = b'[123]'
        resp.__enter__ = MagicMock(return_value=resp)
        resp.__exit__ = MagicMock(return_value=False)
        return resp

    with patch('urllib.request.urlopen', side_effect=_number_response), \
         patch('urllib.request.Request', MagicMock()):
        try:
            ex._write_sync_log(
                warehouse_id=WH_ID,
                status='success',
                new_variants_count=0,
                error_message=None,
                started_at=SYNC_AT,
                finished_at=SYNC_AT,
            )
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert '必须为 dict' in str(e), \
                f'错误信息应包含 "必须为 dict": {e}'

    assert call_count[0] == 2, f'urlopen 应调用 2 次，实际 {call_count[0]} 次'


@test("RPC 失败 + sync_log 失败 + fallback 磁盘失败 → 保留 RPC 主错误 (exit 1)")
def test_rpc_fail_sync_log_fail_fallback_disk_fail():
    """fallback 保存也失败时，RPC 主错误不被覆盖，OSError 不泄漏"""
    import sync.executor as ex
    from unittest.mock import patch

    rpc_error_msg = 'Supabase RPC 错误 (400): quantity 不能为负数'

    with patch('sync.executor._call_sync_rpc') as mock_rpc, \
         patch('sync.executor._write_sync_log') as mock_log, \
         patch('sync.executor._save_fallback_log') as mock_fb:
        mock_rpc.side_effect = RuntimeError(rpc_error_msg)
        mock_log.side_effect = RuntimeError('sync_log 写入失败')
        mock_fb.side_effect = OSError('磁盘空间不足')

        try:
            ex.execute_plan_v2(SIMPLE_PLAN, sync_log_enabled=True,
                               last_sync_at=SYNC_AT)
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            # 主错误应为 RPC 错误，不是 fallback 失败
            assert 'quantity 不能为负数' in str(e), \
                f'主错误应为 RPC 错误，实际: {e}'
            assert '磁盘空间不足' not in str(e), \
                f'主错误不应包含 fallback 失败细节: {e}'
        except OSError:
            assert False, '不应泄漏 OSError'


@test("审计失败 + sync_log 失败 + fallback 磁盘失败 → 保留审计主错误 (exit 1)")
def test_audit_fail_sync_log_fail_fallback_disk_fail():
    """审计失败后 sync_log 和 fallback 均失败，审计主错误不被覆盖"""
    import sync.executor as ex
    from unittest.mock import patch

    with patch('sync.executor._call_sync_rpc') as mock_rpc, \
         patch('sync.executor._get') as mock_get, \
         patch('sync.executor.verify_inventory_post_write') as mock_verify_inv, \
         patch('sync.executor._write_sync_log') as mock_log, \
         patch('sync.executor._save_fallback_log') as mock_fb:
        mock_rpc.return_value = MOCK_RPC_RESULT
        mock_log.side_effect = RuntimeError('sync_log 写入失败')
        mock_fb.side_effect = OSError('磁盘空间不足')
        mock_get.side_effect = lambda path: (
            MOCK_INVENTORY_LIST if 'inventory' in path else MOCK_VARIANT_LIST
        )
        mock_verify_inv.return_value = [
            'SKU WM0005: expected 1500, got 9999'
        ]

        try:
            ex.execute_plan_v2(SIMPLE_PLAN, sync_log_enabled=True,
                               last_sync_at=SYNC_AT)
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert 'post-commit audit failed' in str(e).lower(), \
                f'主错误应为审计失败，实际: {e}'
            assert '磁盘空间不足' not in str(e), \
                f'主错误不应包含 fallback 失败细节: {e}'
        except OSError:
            assert False, '不应泄漏 OSError'


@test("RPC 成功 + sync_log 失败 + fallback 磁盘失败 → exit 2 (不抛异常)")
def test_rpc_success_sync_log_fail_fallback_disk_fail_exit_2():
    """RPC 成功后 sync_log 和 fallback 均失败，结果标记 exit 2 路径，
    fallback 失败记录在 errors 中，不抛异常"""
    import sync.executor as ex
    import tempfile
    from unittest.mock import patch

    with tempfile.TemporaryDirectory() as tmpdir:
        with patch('sync.executor._call_sync_rpc') as mock_rpc, \
             patch('sync.executor._get') as mock_get, \
             patch('sync.executor.verify_inventory_post_write') as mock_verify_inv, \
             patch('sync.executor.verify_warehouse_final_state') as mock_verify_wh, \
             patch('sync.executor._write_sync_log') as mock_log, \
             patch('sync.executor._save_fallback_log') as mock_fb:
            mock_rpc.return_value = MOCK_RPC_RESULT
            # sync_log success 写入失败
            mock_log.side_effect = RuntimeError(
                'sync_log 写入失败（重试 1 次后仍失败，响应解析错误）: '
                'JSONDecodeError: Expecting value'
            )
            # fallback 也失败
            mock_fb.side_effect = OSError('磁盘空间不足')
            mock_get.side_effect = lambda path: (
                MOCK_INVENTORY_LIST if 'inventory' in path
                else [MOCK_WAREHOUSE] if 'warehouse' in path
                else MOCK_VARIANT_LIST
            )
            mock_verify_inv.return_value = []
            mock_verify_wh.return_value = []

            result = ex.execute_plan_v2(SIMPLE_PLAN, sync_log_enabled=True,
                                        last_sync_at=SYNC_AT,
                                        fallback_dir=tmpdir)
            # RPC 成功
            assert result['rpc_summary'] == MOCK_RPC_RESULT
            assert result['phase_g_verified'] is True
            # sync_log 未写入
            assert result['sync_log_written'] is False
            # fallback 也失败 → 没有 fallback 路径
            assert result['sync_log_fallback_path'] is None
            # fallback 失败信息记录在 errors 中
            assert any('fallback 保存也失败' in err or '磁盘空间不足' in str(err)
                       for err in result['errors']), \
                f'errors 应包含 fallback 保存失败信息: {result["errors"]}'


# =========================================================================
# P5-SY4C 第五次返工: SyncLog 成功响应字段校验 + stderr 双失败警告
# =========================================================================


@test("_write_sync_log: 返回 {} → 重试后 RuntimeError")
def test_sync_log_empty_dict_retry_then_raise():
    """mock urlopen 返回 {} → RuntimeError('空对象') → 重试"""
    import sync.executor as ex
    from unittest.mock import patch, MagicMock

    call_count = [0]

    def _empty_dict_response(*args, **kwargs):
        call_count[0] += 1
        resp = MagicMock()
        resp.read.return_value = b'{}'
        resp.__enter__ = MagicMock(return_value=resp)
        resp.__exit__ = MagicMock(return_value=False)
        return resp

    with patch('urllib.request.urlopen', side_effect=_empty_dict_response), \
         patch('urllib.request.Request', MagicMock()):
        try:
            ex._write_sync_log(
                warehouse_id=WH_ID,
                status='success',
                new_variants_count=0,
                error_message=None,
                started_at=SYNC_AT,
                finished_at=SYNC_AT,
            )
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert ('空对象' in str(e) or '缺少非空字段' in str(e)), \
                f'错误信息应包含 "空对象" 或 "缺少非空字段": {e}'

    assert call_count[0] == 2, f'urlopen 应调用 2 次，实际 {call_count[0]} 次'


@test("_write_sync_log: 返回 [{}] → 重试后 RuntimeError")
def test_sync_log_list_empty_dict_retry_then_raise():
    """mock urlopen 返回 [{}] → RuntimeError('空对象') → 重试"""
    import sync.executor as ex
    from unittest.mock import patch, MagicMock

    call_count = [0]

    def _list_empty_dict_response(*args, **kwargs):
        call_count[0] += 1
        resp = MagicMock()
        resp.read.return_value = b'[{}]'
        resp.__enter__ = MagicMock(return_value=resp)
        resp.__exit__ = MagicMock(return_value=False)
        return resp

    with patch('urllib.request.urlopen', side_effect=_list_empty_dict_response), \
         patch('urllib.request.Request', MagicMock()):
        try:
            ex._write_sync_log(
                warehouse_id=WH_ID,
                status='success',
                new_variants_count=0,
                error_message=None,
                started_at=SYNC_AT,
                finished_at=SYNC_AT,
            )
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert ('空对象' in str(e) or '缺少非空字段' in str(e)), \
                f'错误信息应包含 "空对象" 或 "缺少非空字段": {e}'

    assert call_count[0] == 2, f'urlopen 应调用 2 次，实际 {call_count[0]} 次'


@test("_write_sync_log: status 不匹配 → 重试后 RuntimeError")
def test_sync_log_status_mismatch_retry_then_raise():
    """mock urlopen 返回 status=failed 但请求 status=success → RuntimeError('status 不匹配')"""
    import sync.executor as ex
    from unittest.mock import patch, MagicMock

    call_count = [0]

    def _mismatch_response(*args, **kwargs):
        call_count[0] += 1
        resp = MagicMock()
        resp.read.return_value = (
            b'[{"id":"log-1","status":"failed","warehouse_id":"wh"}]'
        )
        resp.__enter__ = MagicMock(return_value=resp)
        resp.__exit__ = MagicMock(return_value=False)
        return resp

    with patch('urllib.request.urlopen', side_effect=_mismatch_response), \
         patch('urllib.request.Request', MagicMock()):
        try:
            ex._write_sync_log(
                warehouse_id=WH_ID,
                status='success',
                new_variants_count=0,
                error_message=None,
                started_at=SYNC_AT,
                finished_at=SYNC_AT,
            )
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert 'status 不匹配' in str(e), \
                f'错误信息应包含 "status 不匹配": {e}'
            assert 'success' in str(e) and 'failed' in str(e), \
                f'错误信息应包含期望和实际的 status 值: {e}'

    assert call_count[0] == 2, f'urlopen 应调用 2 次，实际 {call_count[0]} 次'


@test("_write_sync_log: 缺少 id 字段 → 重试后 RuntimeError")
def test_sync_log_missing_id_retry_then_raise():
    """mock urlopen 返回含 status/warehouse_id 但缺 id 的记录 → RuntimeError"""
    import sync.executor as ex
    from unittest.mock import patch, MagicMock

    call_count = [0]

    def _missing_id_response(*args, **kwargs):
        call_count[0] += 1
        resp = MagicMock()
        resp.read.return_value = b'[{"status":"success","warehouse_id":"wh"}]'
        resp.__enter__ = MagicMock(return_value=resp)
        resp.__exit__ = MagicMock(return_value=False)
        return resp

    with patch('urllib.request.urlopen', side_effect=_missing_id_response), \
         patch('urllib.request.Request', MagicMock()):
        try:
            ex._write_sync_log(
                warehouse_id=WH_ID,
                status='success',
                new_variants_count=0,
                error_message=None,
                started_at=SYNC_AT,
                finished_at=SYNC_AT,
            )
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert 'id' in str(e).lower() and '必须为非空字符串' in str(e), \
                f'错误信息应包含 id 必须为非空字符串: {e}'

    assert call_count[0] == 2, f'urlopen 应调用 2 次，实际 {call_count[0]} 次'


@test("_write_sync_log: 缺少 warehouse_id 字段 → 重试后 RuntimeError")
def test_sync_log_missing_warehouse_id_retry_then_raise():
    """mock urlopen 返回含 id/status 但缺 warehouse_id 的记录 → RuntimeError"""
    import sync.executor as ex
    from unittest.mock import patch, MagicMock

    call_count = [0]

    def _missing_wh_response(*args, **kwargs):
        call_count[0] += 1
        resp = MagicMock()
        resp.read.return_value = b'[{"id":"log-1","status":"success"}]'
        resp.__enter__ = MagicMock(return_value=resp)
        resp.__exit__ = MagicMock(return_value=False)
        return resp

    with patch('urllib.request.urlopen', side_effect=_missing_wh_response), \
         patch('urllib.request.Request', MagicMock()):
        try:
            ex._write_sync_log(
                warehouse_id=WH_ID,
                status='success',
                new_variants_count=0,
                error_message=None,
                started_at=SYNC_AT,
                finished_at=SYNC_AT,
            )
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert 'warehouse_id' in str(e) and '必须为非空字符串' in str(e), \
                f'错误信息应包含 warehouse_id 必须为非空字符串: {e}'

    assert call_count[0] == 2, f'urlopen 应调用 2 次，实际 {call_count[0]} 次'


@test("RPC 失败 + sync_log/fallback 双失败: stderr 警告可见且主错误保留")
def test_rpc_fail_double_fail_stderr_warning():
    """sync_log 和 fallback 均失败时，stderr 必须输出明确警告，
    RPC 主错误保持不变，OSError 不泄漏"""
    import sync.executor as ex
    import io as _io
    from unittest.mock import patch

    rpc_error_msg = 'Supabase RPC 错误 (400): quantity 不能为负数'
    stderr_buf = _io.StringIO()

    with patch('sync.executor._call_sync_rpc') as mock_rpc, \
         patch('sync.executor._write_sync_log') as mock_log, \
         patch('sync.executor._save_fallback_log') as mock_fb, \
         patch('sys.stderr', stderr_buf):
        mock_rpc.side_effect = RuntimeError(rpc_error_msg)
        mock_log.side_effect = RuntimeError('sync_log 写入失败')
        mock_fb.side_effect = OSError('磁盘空间不足')

        try:
            ex.execute_plan_v2(SIMPLE_PLAN, sync_log_enabled=True,
                               last_sync_at=SYNC_AT)
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert 'quantity 不能为负数' in str(e), \
                f'主错误应为 RPC 错误，实际: {e}'
        except OSError:
            assert False, '不应泄漏 OSError'

    stderr_text = stderr_buf.getvalue()
    assert 'sync_log 写入失败且 fallback 保存失败' in stderr_text, \
        f'stderr 应包含 sync_log/fallback 双失败警告，实际: {stderr_text!r}'
    assert 'sync_log 错误' in stderr_text, \
        f'stderr 应包含 sync_log 错误原因，实际: {stderr_text!r}'
    assert 'fallback 错误' in stderr_text, \
        f'stderr 应包含 fallback 错误原因，实际: {stderr_text!r}'


@test("审计失败 + sync_log/fallback 双失败: stderr 警告可见且主错误保留")
def test_audit_fail_double_fail_stderr_warning():
    """审计失败后 sync_log 和 fallback 均失败，
    stderr 必须输出明确警告，审计主错误不丢失"""
    import sync.executor as ex
    import io as _io
    from unittest.mock import patch

    stderr_buf = _io.StringIO()

    with patch('sync.executor._call_sync_rpc') as mock_rpc, \
         patch('sync.executor._get') as mock_get, \
         patch('sync.executor.verify_inventory_post_write') as mock_verify_inv, \
         patch('sync.executor._write_sync_log') as mock_log, \
         patch('sync.executor._save_fallback_log') as mock_fb, \
         patch('sys.stderr', stderr_buf):
        mock_rpc.return_value = MOCK_RPC_RESULT
        mock_log.side_effect = RuntimeError('sync_log 写入失败')
        mock_fb.side_effect = OSError('磁盘空间不足')
        mock_get.side_effect = lambda path: (
            MOCK_INVENTORY_LIST if 'inventory' in path else MOCK_VARIANT_LIST
        )
        mock_verify_inv.return_value = [
            'SKU WM0005: expected 1500, got 9999'
        ]

        try:
            ex.execute_plan_v2(SIMPLE_PLAN, sync_log_enabled=True,
                               last_sync_at=SYNC_AT)
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert 'post-commit audit failed' in str(e).lower(), \
                f'主错误应为审计失败，实际: {e}'
        except OSError:
            assert False, '不应泄漏 OSError'

    stderr_text = stderr_buf.getvalue()
    assert 'sync_log 写入失败且 fallback 保存失败' in stderr_text, \
        f'stderr 应包含 sync_log/fallback 双失败警告，实际: {stderr_text!r}'
    assert 'sync_log 错误' in stderr_text, \
        f'stderr 应包含 sync_log 错误原因，实际: {stderr_text!r}'
    assert 'fallback 错误' in stderr_text, \
        f'stderr 应包含 fallback 错误原因，实际: {stderr_text!r}'


# =========================================================================
# P5-SY4C 第六次返工: SyncLog 身份校验增强 + list 长度 + 类型约束
# =========================================================================


@test("_write_sync_log: warehouse_id 不匹配 → 重试后 RuntimeError")
def test_sync_log_warehouse_id_mismatch_retry_then_raise():
    """mock urlopen 返回 warehouse_id 与请求不一致 → RuntimeError"""
    import sync.executor as ex
    from unittest.mock import patch, MagicMock

    call_count = [0]

    def _wh_mismatch_response(*args, **kwargs):
        call_count[0] += 1
        resp = MagicMock()
        resp.read.return_value = (
            b'[{"id":"log-1","status":"success",'
            b'"warehouse_id":"00000000-0000-0000-0000-000000000000"}]'
        )
        resp.__enter__ = MagicMock(return_value=resp)
        resp.__exit__ = MagicMock(return_value=False)
        return resp

    with patch('urllib.request.urlopen', side_effect=_wh_mismatch_response), \
         patch('urllib.request.Request', MagicMock()):
        try:
            ex._write_sync_log(
                warehouse_id=WH_ID,
                status='success',
                new_variants_count=0,
                error_message=None,
                started_at=SYNC_AT,
                finished_at=SYNC_AT,
            )
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert 'warehouse_id 不匹配' in str(e), \
                f'错误信息应包含 "warehouse_id 不匹配": {e}'

    assert call_count[0] == 2, f'urlopen 应调用 2 次，实际 {call_count[0]} 次'


@test("_write_sync_log: id 为数字 → 重试后 RuntimeError")
def test_sync_log_id_number_retry_then_raise():
    """mock urlopen 返回 id=123（非字符串） → RuntimeError('必须为非空字符串')"""
    import sync.executor as ex
    from unittest.mock import patch, MagicMock

    call_count = [0]

    def _id_number_response(*args, **kwargs):
        call_count[0] += 1
        resp = MagicMock()
        resp.read.return_value = (
            b'[{"id":123,"status":"success",'
            b'"warehouse_id":"' + WH_ID.encode() + b'"}]'
        )
        resp.__enter__ = MagicMock(return_value=resp)
        resp.__exit__ = MagicMock(return_value=False)
        return resp

    with patch('urllib.request.urlopen', side_effect=_id_number_response), \
         patch('urllib.request.Request', MagicMock()):
        try:
            ex._write_sync_log(
                warehouse_id=WH_ID,
                status='success',
                new_variants_count=0,
                error_message=None,
                started_at=SYNC_AT,
                finished_at=SYNC_AT,
            )
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert 'id' in str(e) and '必须为非空字符串' in str(e), \
                f'错误信息应包含 id 必须为非空字符串: {e}'

    assert call_count[0] == 2, f'urlopen 应调用 2 次，实际 {call_count[0]} 次'


@test("_write_sync_log: warehouse_id 为数字 → 重试后 RuntimeError")
def test_sync_log_warehouse_id_number_retry_then_raise():
    """mock urlopen 返回 warehouse_id=456（非字符串） → RuntimeError('必须为非空字符串')"""
    import sync.executor as ex
    from unittest.mock import patch, MagicMock

    call_count = [0]

    def _wh_number_response(*args, **kwargs):
        call_count[0] += 1
        resp = MagicMock()
        resp.read.return_value = (
            b'[{"id":"log-1","status":"success","warehouse_id":456}]'
        )
        resp.__enter__ = MagicMock(return_value=resp)
        resp.__exit__ = MagicMock(return_value=False)
        return resp

    with patch('urllib.request.urlopen', side_effect=_wh_number_response), \
         patch('urllib.request.Request', MagicMock()):
        try:
            ex._write_sync_log(
                warehouse_id=WH_ID,
                status='success',
                new_variants_count=0,
                error_message=None,
                started_at=SYNC_AT,
                finished_at=SYNC_AT,
            )
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert 'warehouse_id' in str(e) and '必须为非空字符串' in str(e), \
                f'错误信息应包含 warehouse_id 必须为非空字符串: {e}'

    assert call_count[0] == 2, f'urlopen 应调用 2 次，实际 {call_count[0]} 次'


@test("_write_sync_log: list 返回多条记录 → 重试后 RuntimeError")
def test_sync_log_list_multi_record_retry_then_raise():
    """mock urlopen 返回 2 条记录 → RuntimeError('必须恰好包含 1 条')"""
    import sync.executor as ex
    from unittest.mock import patch, MagicMock

    call_count = [0]

    def _multi_record_response(*args, **kwargs):
        call_count[0] += 1
        resp = MagicMock()
        resp.read.return_value = (
            b'[{"id":"log-1","status":"success",'
            b'"warehouse_id":"' + WH_ID.encode() + b'"},'
            b'{"id":"log-2","status":"success",'
            b'"warehouse_id":"' + WH_ID.encode() + b'"}]'
        )
        resp.__enter__ = MagicMock(return_value=resp)
        resp.__exit__ = MagicMock(return_value=False)
        return resp

    with patch('urllib.request.urlopen', side_effect=_multi_record_response), \
         patch('urllib.request.Request', MagicMock()):
        try:
            ex._write_sync_log(
                warehouse_id=WH_ID,
                status='success',
                new_variants_count=0,
                error_message=None,
                started_at=SYNC_AT,
                finished_at=SYNC_AT,
            )
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert '恰好包含 1 条' in str(e), \
                f'错误信息应包含 "恰好包含 1 条": {e}'
            assert '2 条' in str(e), \
                f'错误信息应报告实际条数: {e}'

    assert call_count[0] == 2, f'urlopen 应调用 2 次，实际 {call_count[0]} 次'


# =========================================================================
# P5-SY8 令牌—模式强制绑定测试 (execute_plan)
# =========================================================================

@test("execute_plan: P5-SY8C-TH + dry_run=False 在任何 I/O 前被拒绝，Path.exists/open/_get 均未调用")
def test_execute_plan_p5_sy8c_th_rejects_no_dry_run_before_io():
    """P5-SY8C-TH 令牌仅支持 dry_run=True。使用 dry_run=False 时
    必须在 Path.exists、open、_get、_post、_patch 之前拒绝。"""
    import sync.executor as ex
    from unittest.mock import patch

    with patch('sync.config.WAREHOUSE_COUNTRY', 'TH'), \
         patch('pathlib.Path.exists') as mock_exists, \
         patch('builtins.open') as mock_open, \
         patch('sync.executor._get') as mock_get, \
         patch('sync.executor._post') as mock_post, \
         patch('sync.executor._patch') as mock_patch:
        try:
            ex.execute_plan(
                '/fake/report.json',
                confirm='P5-SY8C-TH',
                dry_run=False,
            )
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert 'P5-SY8C-TH' in str(e)
            assert ('dry_run' in str(e).lower() or
                    '只读' in str(e) or
                    '不得执行真实写入' in str(e))
            assert 'P5-SY8D-TH' in str(e)

        mock_exists.assert_not_called()
        mock_open.assert_not_called()
        mock_get.assert_not_called()
        mock_post.assert_not_called()
        mock_patch.assert_not_called()


@test("execute_plan: P5-SY8C-TH + dry_run=True 正常通过模式检查")
def test_execute_plan_p5_sy8c_th_accepts_dry_run():
    """P5-SY8C-TH + dry_run=True 不应被模式检查拒绝。"""
    import sync.executor as ex
    from unittest.mock import patch

    with patch('sync.config.WAREHOUSE_COUNTRY', 'TH'), \
         patch('pathlib.Path.exists', return_value=False) as mock_exists, \
         patch('builtins.open') as mock_open:
        try:
            ex.execute_plan(
                '/fake/report.json',
                confirm='P5-SY8C-TH',
                dry_run=True,
            )
            assert False, '后续 Path.exists 应触发错误（文件不存在）'
        except RuntimeError as e:
            assert 'P5-SY8C-TH 仅支持' not in str(e), \
                f'不应触发模式拒绝: {e}'
            assert '不存在' in str(e) or 'not exist' in str(e).lower()

        mock_exists.assert_called()
        mock_open.assert_not_called()


@test("execute_plan: P5-SY8D-TH + dry_run=False 正常通过所有安全门（允许真实写入）")
def test_execute_plan_p5_sy8d_th_accepts_no_dry_run():
    """P5-SY8D-TH 是唯一可执行 --no-dry-run 的 TH 令牌。"""
    import sync.executor as ex
    from unittest.mock import patch

    with patch('sync.config.WAREHOUSE_COUNTRY', 'TH'), \
         patch('pathlib.Path.exists', return_value=False) as mock_exists, \
         patch('builtins.open') as mock_open:
        try:
            ex.execute_plan(
                '/fake/report.json',
                confirm='P5-SY8D-TH',
                dry_run=False,
            )
            assert False, '后续 Path.exists 应触发错误（文件不存在）'
        except RuntimeError as e:
            assert '仅支持 dry_run=True' not in str(e), \
                f'不应触发模式拒绝: {e}'
            assert '不存在' in str(e) or 'not exist' in str(e).lower()

        mock_exists.assert_called()
        mock_open.assert_not_called()


@test("execute_plan: P5-SY8E-MY + dry_run=False 在任何 I/O 前被拒绝，Path.exists/open/_get 均未调用")
def test_execute_plan_p5_sy8e_my_rejects_no_dry_run_before_io():
    """P5-SY8E-MY 令牌仅支持 --dry-run。使用 --no-dry-run 时必须
    在 Path.exists、open、_get 之前拒绝。"""
    import sync.executor as ex
    from unittest.mock import patch

    with patch('sync.config.WAREHOUSE_COUNTRY', 'MY'), \
         patch('pathlib.Path.exists') as mock_exists, \
         patch('builtins.open') as mock_open, \
         patch('sync.executor._get') as mock_get, \
         patch('sync.executor._post') as mock_post, \
         patch('sync.executor._patch') as mock_patch:
        try:
            ex.execute_plan(
                '/fake/report.json',
                confirm='P5-SY8E-MY',
                dry_run=False,
            )
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert 'P5-SY8E-MY' in str(e)
            assert ('dry_run' in str(e).lower() or
                    '只读' in str(e) or
                    '不得执行真实写入' in str(e))

        mock_exists.assert_not_called()
        mock_open.assert_not_called()
        mock_get.assert_not_called()
        mock_post.assert_not_called()
        mock_patch.assert_not_called()


@test("execute_plan: P5-SY8E-MY + dry_run=True 正常通过模式检查")
def test_execute_plan_p5_sy8e_my_accepts_dry_run():
    """P5-SY8E-MY + dry_run=True 不应被模式检查拒绝。"""
    import sync.executor as ex
    from unittest.mock import patch

    with patch('sync.config.WAREHOUSE_COUNTRY', 'MY'), \
         patch('pathlib.Path.exists', return_value=False) as mock_exists, \
         patch('builtins.open') as mock_open:
        try:
            ex.execute_plan(
                '/fake/report.json',
                confirm='P5-SY8E-MY',
                dry_run=True,
            )
            assert False, '后续 Path.exists 应触发错误（文件不存在）'
        except RuntimeError as e:
            assert 'P5-SY8E-MY 仅支持' not in str(e), \
                f'不应触发模式拒绝: {e}'
            assert '不存在' in str(e) or 'not exist' in str(e).lower()

        mock_exists.assert_called()
        mock_open.assert_not_called()


@test("execute_plan: P5-SY8F-MY + dry_run=False 正常通过所有安全门（允许真实写入）")
def test_execute_plan_p5_sy8f_my_accepts_no_dry_run():
    """P5-SY8F-MY 是唯一可执行 --no-dry-run 的 MY 令牌。"""
    import sync.executor as ex
    from unittest.mock import patch

    with patch('sync.config.WAREHOUSE_COUNTRY', 'MY'), \
         patch('pathlib.Path.exists', return_value=False) as mock_exists, \
         patch('builtins.open') as mock_open:
        try:
            ex.execute_plan(
                '/fake/report.json',
                confirm='P5-SY8F-MY',
                dry_run=False,
            )
            assert False, '后续 Path.exists 应触发错误（文件不存在）'
        except RuntimeError as e:
            assert '仅支持 dry_run=True' not in str(e), \
                f'不应触发模式拒绝: {e}'
            assert '不存在' in str(e) or 'not exist' in str(e).lower()

        mock_exists.assert_called()
        mock_open.assert_not_called()


@test("execute_plan: P5-SY8F-MY + dry_run=True 正常通过模式检查")
def test_execute_plan_p5_sy8f_my_accepts_dry_run():
    """P5-SY8F-MY + dry_run=True 不应被模式检查拒绝。"""
    import sync.executor as ex
    from unittest.mock import patch

    with patch('sync.config.WAREHOUSE_COUNTRY', 'MY'), \
         patch('pathlib.Path.exists', return_value=False) as mock_exists, \
         patch('builtins.open') as mock_open:
        try:
            ex.execute_plan(
                '/fake/report.json',
                confirm='P5-SY8F-MY',
                dry_run=True,
            )
            assert False, '后续 Path.exists 应触发错误（文件不存在）'
        except RuntimeError as e:
            assert 'P5-SY8F-MY 仅支持' not in str(e), \
                f'不应触发模式拒绝: {e}'
            assert '不存在' in str(e) or 'not exist' in str(e).lower()

        mock_exists.assert_called()
        mock_open.assert_not_called()


@test("execute_plan: P5-SY8G-ID + dry_run=False 在任何 I/O 前被拒绝，Path.exists/open/_get 均未调用")
def test_execute_plan_p5_sy8g_id_rejects_no_dry_run_before_io():
    """P5-SY8G-ID 令牌仅支持 --dry-run。使用 --no-dry-run 时必须
    在 Path.exists、open、_get 之前拒绝。"""
    import sync.executor as ex
    from unittest.mock import patch

    with patch('sync.config.WAREHOUSE_COUNTRY', 'ID'), \
         patch('pathlib.Path.exists') as mock_exists, \
         patch('builtins.open') as mock_open, \
         patch('sync.executor._get') as mock_get, \
         patch('sync.executor._post') as mock_post, \
         patch('sync.executor._patch') as mock_patch:
        try:
            ex.execute_plan(
                '/fake/report.json',
                confirm='P5-SY8G-ID',
                dry_run=False,
            )
            assert False, '应抛出 RuntimeError'
        except RuntimeError as e:
            assert 'P5-SY8G-ID' in str(e)
            assert 'P5-SY8H-ID' in str(e), \
                f'错误消息应提示 P5-SY8H-ID 为待发布写令牌，实际: {e}'
            assert ('dry_run' in str(e).lower() or
                    '只读' in str(e) or
                    '不得执行真实写入' in str(e))

        mock_exists.assert_not_called()
        mock_open.assert_not_called()
        mock_get.assert_not_called()
        mock_post.assert_not_called()
        mock_patch.assert_not_called()


@test("execute_plan: P5-SY8G-ID + dry_run=True 正常通过模式检查")
def test_execute_plan_p5_sy8g_id_accepts_dry_run():
    """P5-SY8G-ID + dry_run=True 不应被模式检查拒绝。"""
    import sync.executor as ex
    from unittest.mock import patch

    with patch('sync.config.WAREHOUSE_COUNTRY', 'ID'), \
         patch('pathlib.Path.exists', return_value=False) as mock_exists, \
         patch('builtins.open') as mock_open:
        try:
            ex.execute_plan(
                '/fake/report.json',
                confirm='P5-SY8G-ID',
                dry_run=True,
            )
            assert False, '后续 Path.exists 应触发错误（文件不存在）'
        except RuntimeError as e:
            assert 'P5-SY8G-ID 仅支持' not in str(e), \
                f'不应触发模式拒绝: {e}'
            assert '不存在' in str(e) or 'not exist' in str(e).lower()

        mock_exists.assert_called()
        mock_open.assert_not_called()


@test("execute_plan: P5-SY8H-ID + dry_run=False 正常通过所有安全门（允许真实写入）")
def test_execute_plan_p5_sy8h_id_accepts_no_dry_run():
    """P5-SY8H-ID 是唯一可执行 --no-dry-run 的 ID 令牌。"""
    import sync.executor as ex
    from unittest.mock import patch

    with patch('sync.config.WAREHOUSE_COUNTRY', 'ID'), \
         patch('pathlib.Path.exists', return_value=False) as mock_exists, \
         patch('builtins.open') as mock_open:
        try:
            ex.execute_plan(
                '/fake/report.json',
                confirm='P5-SY8H-ID',
                dry_run=False,
            )
            assert False, '后续 Path.exists 应触发错误（文件不存在）'
        except RuntimeError as e:
            assert '仅支持 dry_run=True' not in str(e), \
                f'不应触发模式拒绝: {e}'
            assert '不存在' in str(e) or 'not exist' in str(e).lower()

        mock_exists.assert_called()
        mock_open.assert_not_called()


@test("execute_plan: P5-SY8H-ID + dry_run=True 正常通过模式检查")
def test_execute_plan_p5_sy8h_id_accepts_dry_run():
    """P5-SY8H-ID + dry_run=True 不应被模式检查拒绝。"""
    import sync.executor as ex
    from unittest.mock import patch

    with patch('sync.config.WAREHOUSE_COUNTRY', 'ID'), \
         patch('pathlib.Path.exists', return_value=False) as mock_exists, \
         patch('builtins.open') as mock_open:
        try:
            ex.execute_plan(
                '/fake/report.json',
                confirm='P5-SY8H-ID',
                dry_run=True,
            )
            assert False, '后续 Path.exists 应触发错误（文件不存在）'
        except RuntimeError as e:
            assert 'P5-SY8H-ID 仅支持' not in str(e), \
                f'不应触发模式拒绝: {e}'
            assert '不存在' in str(e) or 'not exist' in str(e).lower()

        mock_exists.assert_called()
        mock_open.assert_not_called()


# =========================================================================
# 运行
# =========================================================================

if __name__ == '__main__':
    print('=' * 60)
    print('P5-SY3B/P5-SY4C 执行器测试')
    print('不依赖 Supabase 连接 | 不执行任何数据库写入')
    print('=' * 60)
    print()

    # P5-SY3B 测试
    test_all_new_classify()
    test_mixed_classify_with_matched()
    test_mixed_classify_with_unmatched()
    test_all_existing_classify()
    test_to_create_fields()
    test_empty_input_classify()
    test_classify_idempotent()
    test_build_inventory_all_match()
    test_build_inventory_partial_match()
    test_build_inventory_empty()
    test_inventory_rows_have_last_sync_at()
    test_inventory_quantity_is_int()
    test_build_inventory_idempotent()
    test_build_inventory_all_missing()

    # P5-SY4C 纯函数测试
    test_build_rpc_full_merge()
    test_build_rpc_no_variants()
    test_build_rpc_empty_inventory()
    test_build_rpc_no_warehouse()
    test_build_rpc_duplicate_key()
    test_build_rpc_negative_qty()
    test_build_rpc_empty_variant_name()
    test_build_rpc_unchanged_only()
    test_build_rpc_unified_sync_at()
    test_save_fallback_log()
    test_save_fallback_log_creates_dir()
    test_execute_v2_no_warehouse()
    test_execute_v2_empty_snapshot()

    # P5-SY4C 严格 quantity 校验
    test_quantity_rejects_float_1_5()
    test_quantity_rejects_float_1_0()
    test_quantity_rejects_bool_true()
    test_quantity_rejects_string()
    test_quantity_rejects_none()
    test_quantity_unchanged_rejects_float()
    test_quantity_unchanged_rejects_bool()
    test_quantity_accepts_zero()

    # P5-SY4C p_variants 校验
    test_p_variants_duplicate_key()
    test_p_variants_missing_inventory()
    test_quantity_empty_sku()

    # P5-SY4C Mock 编排测试
    test_network_timeout_writes_failed_with_keyword()
    test_phase_g_query_exception_writes_failed()
    test_phase_i_query_exception_writes_failed()
    test_sync_log_retry_succeeds()
    test_sync_log_consecutive_fail_saves_fallback()
    test_full_happy_path()
    test_success_path_call_order_sync_log_after_audit()
    test_rpc_success_sync_log_fail_exit_2()
    test_rpc_failure_exit_1()
    test_audit_failure_exit_1()
    test_audit_failure_sets_result_finished_at()

    # P5-SY4C 返工新增测试
    test_urlerror_no_retry()
    test_audit_fail_sync_log_fail_preserves_main_error()
    test_rpc_empty_response_rejected()
    test_rpc_invalid_json_writes_failed_log()
    test_rpc_summary_field_type_count_validation()

    # P5-SY4C 第三次返工: 响应解析路径测试
    test_rpc_utf8_decode_error()
    test_sync_log_invalid_json_retry_then_raise()
    test_sync_log_utf8_decode_error_retry_then_raise()
    test_sync_log_empty_response_retry_then_raise()
    test_sync_log_unexpected_structure_retry_then_raise()
    test_rpc_success_sync_log_parse_error_fallback()
    test_rpc_utf8_error_writes_failed_log()

    # P5-SY4C 第四次返工: SyncLog 严格校验 + fallback 失败保护
    test_sync_log_list_first_null_retry_then_raise()
    test_sync_log_list_first_string_retry_then_raise()
    test_sync_log_list_first_number_retry_then_raise()
    test_rpc_fail_sync_log_fail_fallback_disk_fail()
    test_audit_fail_sync_log_fail_fallback_disk_fail()
    test_rpc_success_sync_log_fail_fallback_disk_fail_exit_2()

    # P5-SY4C 第五次返工: SyncLog 成功响应字段校验 + stderr 双失败警告
    test_sync_log_empty_dict_retry_then_raise()
    test_sync_log_list_empty_dict_retry_then_raise()
    test_sync_log_status_mismatch_retry_then_raise()
    test_sync_log_missing_id_retry_then_raise()
    test_sync_log_missing_warehouse_id_retry_then_raise()
    test_rpc_fail_double_fail_stderr_warning()
    test_audit_fail_double_fail_stderr_warning()

    # P5-SY4C 第六次返工: SyncLog 身份校验增强
    test_sync_log_warehouse_id_mismatch_retry_then_raise()
    test_sync_log_id_number_retry_then_raise()
    test_sync_log_warehouse_id_number_retry_then_raise()
    test_sync_log_list_multi_record_retry_then_raise()

    # P5-SY8 令牌—模式强制绑定 (execute_plan)
    test_execute_plan_p5_sy8c_th_rejects_no_dry_run_before_io()
    test_execute_plan_p5_sy8c_th_accepts_dry_run()
    test_execute_plan_p5_sy8d_th_accepts_no_dry_run()
    test_execute_plan_p5_sy8e_my_rejects_no_dry_run_before_io()
    test_execute_plan_p5_sy8e_my_accepts_dry_run()
    test_execute_plan_p5_sy8f_my_accepts_no_dry_run()
    test_execute_plan_p5_sy8f_my_accepts_dry_run()
    test_execute_plan_p5_sy8g_id_rejects_no_dry_run_before_io()
    test_execute_plan_p5_sy8g_id_accepts_dry_run()
    test_execute_plan_p5_sy8h_id_accepts_no_dry_run()
    test_execute_plan_p5_sy8h_id_accepts_dry_run()

    print()
    print('=' * 60)
    print(f'结果: {PASS} 通过, {FAIL} 失败 (共 {PASS + FAIL} 项)')
    print('=' * 60)

    sys.exit(0 if FAIL == 0 else 1)
