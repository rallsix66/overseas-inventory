"""P5-SY3A 计划生成测试 — 不依赖 Supabase 连接或写入。

测试纯函数: input_validator.validate_json / plan_generator.generate_plan
"""
import sys
import os
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from sync.input_validator import validate_json, ValidationError
from sync.plan_generator import generate_plan, _plan_warehouse_rename

# monkey-patch: 模块级 import 的值需要直接替换
import sync.plan_generator
sync.plan_generator.TARGET_WAREHOUSE_NAME = '菲律宾-新创启辰自建仓'
sync.plan_generator.OLD_WAREHOUSE_NAME = '菲律宾仓'
sync.plan_generator.WAREHOUSE_COUNTRY = 'PH'
sync.plan_generator.NEW_VARIANT_COUNTRY = 'PH'
import sync.input_validator
sync.input_validator.TARGET_WAREHOUSE_NAME = '菲律宾-新创启辰自建仓'

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

VALID_JSON_TEMPLATE = {
    'warehouse': '菲律宾-新创启辰自建仓',
    'row_count': 3,
    'rows': [
        {'sku': 'WM0005', 'product_name': '毛孔清洁布丁泥膜',
         'warehouse': '菲律宾-新创启辰自建仓',
         'available_quantity': 1691},
        {'sku': 'WM0074', 'product_name': '蜜粉饼',
         'warehouse': '菲律宾-新创启辰自建仓',
         'available_quantity': 21289},
        {'sku': 'ICEWM0039', 'product_name': '防晒乳',
         'warehouse': '菲律宾-新创启辰自建仓',
         'available_quantity': 2865},
    ],
    'metadata': {
        'warehouse': '菲律宾-新创启辰自建仓',
        'raw_row_count': 3,
        'final_count': 3,
    },
}

DB_SNAPSHOT_OLD_WH = {
    'warehouse': {
        'id': 'wh-ph-001',
        'name': '菲律宾仓',
        'country': 'PH',
        'type': 'overseas',
        'is_active': True,
    },
    'variants': [
        {'id': 'var-001', 'sku': 'WM0005', 'country': 'PH',
         'name': '毛孔清洁布丁泥膜', 'product_id': None, 'match_status': 'unmatched'},
        {'id': 'var-002', 'sku': 'WM0074', 'country': 'PH',
         'name': '蜜粉饼', 'product_id': 'prod-001', 'match_status': 'matched'},
    ],
    'inventories': [
        {'id': 'inv-001', 'variant_id': 'var-001', 'warehouse_id': 'wh-ph-001',
         'quantity': 1500},
    ],
}

DB_SNAPSHOT_NEW_WH = {
    'warehouse': {
        'id': 'wh-ph-001',
        'name': '菲律宾-新创启辰自建仓',
        'country': 'PH',
        'type': 'overseas',
        'is_active': True,
    },
    'variants': [],
    'inventories': [],
}

DB_SNAPSHOT_UNKNOWN_WH = {
    'warehouse': {
        'id': 'wh-ph-001',
        'name': '菲律宾-未知仓库',
        'country': 'PH',
        'type': 'overseas',
        'is_active': True,
    },
    'variants': [],
    'inventories': [],
}


# =========================================================================
# 测试: 输入校验
# =========================================================================

@test("正常 3 行 JSON 通过校验")
def test_valid_json_passes():
    rows = validate_json(VALID_JSON_TEMPLATE)
    assert len(rows) == 3
    assert rows[0]['sku'] == 'WM0005'


@test("仓库名不匹配时抛出 ValidationError")
def test_warehouse_name_mismatch_fails():
    data = json.loads(json.dumps(VALID_JSON_TEMPLATE))
    data['warehouse'] = '菲律宾仓'
    try:
        validate_json(data)
        assert False, '应该抛出 ValidationError'
    except ValidationError as e:
        assert '仓库名不匹配' in str(e)


@test("row_count 与 rows 长度不一致时抛出 ValidationError")
def test_row_count_mismatch_fails():
    data = json.loads(json.dumps(VALID_JSON_TEMPLATE))
    data['row_count'] = 999
    try:
        validate_json(data)
        assert False, '应该抛出 ValidationError'
    except ValidationError as e:
        assert 'row_count' in str(e)


@test("metadata.final_count 与 rows 长度不一致时抛出 ValidationError")
def test_final_count_mismatch_fails():
    data = json.loads(json.dumps(VALID_JSON_TEMPLATE))
    data['metadata']['final_count'] = 999
    try:
        validate_json(data)
        assert False, '应该抛出 ValidationError'
    except ValidationError as e:
        assert 'final_count' in str(e)


@test("SKU 为空时抛出 ValidationError")
def test_empty_sku_fails():
    data = json.loads(json.dumps(VALID_JSON_TEMPLATE))
    data['rows'][0]['sku'] = ''
    try:
        validate_json(data)
        assert False, '应该抛出 ValidationError'
    except ValidationError as e:
        assert 'SKU 为空' in str(e)


@test("(sku, warehouse) 重复时抛出 ValidationError")
def test_duplicate_sku_warehouse_fails():
    data = json.loads(json.dumps(VALID_JSON_TEMPLATE))
    data['rows'][2] = json.loads(json.dumps(data['rows'][0]))  # duplicate row 0
    try:
        validate_json(data)
        assert False, '应该抛出 ValidationError'
    except ValidationError as e:
        assert '重复' in str(e)


@test("available_quantity 为负数时抛出 ValidationError")
def test_negative_quantity_fails():
    data = json.loads(json.dumps(VALID_JSON_TEMPLATE))
    data['rows'][1]['available_quantity'] = -5
    try:
        validate_json(data)
        assert False, '应该抛出 ValidationError'
    except ValidationError as e:
        assert '负数' in str(e) or '为负' in str(e)


@test("available_quantity 为 float 小数时抛出 ValidationError")
def test_fractional_quantity_fails():
    data = json.loads(json.dumps(VALID_JSON_TEMPLATE))
    data['rows'][1]['available_quantity'] = 100.5
    try:
        validate_json(data)
        assert False, '应该抛出 ValidationError'
    except ValidationError as e:
        assert '类型=float' in str(e)


@test("available_quantity 为 float 1.0（非严格 int）时抛出 ValidationError")
def test_float_one_point_oh_fails():
    """1.0 == int(1.0) 为 True，旧逻辑会放过；严格 type check 必须拒绝。"""
    data = json.loads(json.dumps(VALID_JSON_TEMPLATE))
    data['rows'][1]['available_quantity'] = 1.0
    try:
        validate_json(data)
        assert False, '应该抛出 ValidationError'
    except ValidationError as e:
        assert '类型=float' in str(e)


@test("available_quantity 为 bool True 时抛出 ValidationError")
def test_bool_quantity_fails():
    """bool 是 int 子类，isinstance(True, int) 为 True；严格 type check 必须拒绝。"""
    data = json.loads(json.dumps(VALID_JSON_TEMPLATE))
    data['rows'][1]['available_quantity'] = True
    try:
        validate_json(data)
        assert False, '应该抛出 ValidationError'
    except ValidationError as e:
        assert '类型=bool' in str(e)


@test("product_name 为空时抛出 ValidationError")
def test_empty_product_name_fails():
    data = json.loads(json.dumps(VALID_JSON_TEMPLATE))
    data['rows'][1]['product_name'] = ''
    try:
        validate_json(data)
        assert False, '应该抛出 ValidationError'
    except ValidationError as e:
        assert 'product_name 为空' in str(e)


@test("逐行 warehouse 不等于目标名时抛出 ValidationError")
def test_per_row_warehouse_mismatch_fails():
    data = json.loads(json.dumps(VALID_JSON_TEMPLATE))
    data['rows'][1]['warehouse'] = '菲律宾仓'
    try:
        validate_json(data)
        assert False, '应该抛出 ValidationError'
    except ValidationError as e:
        assert 'warehouse=' in str(e)


@test("rows 为空数组时抛出 ValidationError（拒绝抓取异常产生的空快照）")
def test_empty_rows_fails():
    """空 rows 必须被拒绝：抓取异常或输入错误不得误记成功同步。"""
    data = json.loads(json.dumps(VALID_JSON_TEMPLATE))
    data['rows'] = []
    data['row_count'] = 0
    data['metadata']['final_count'] = 0
    try:
        validate_json(data)
        assert False, '应该抛出 ValidationError'
    except ValidationError as e:
        msg = str(e)
        assert '空数组' in msg, f'错误消息应包含"空数组"，实际: {msg}'


# =========================================================================
# 测试: 计划生成
# =========================================================================

@test("generate_plan 正常分类: 更新 + 新增 + 不变 + 新SKU")
def test_generate_plan_normal_classification():
    plan = generate_plan(VALID_JSON_TEMPLATE['rows'], DB_SNAPSHOT_OLD_WH)

    # WM0005: variant exists, inventory exists qty=1500 → update to 1691
    assert len(plan['inventory_updates']) == 1
    update = plan['inventory_updates'][0]
    assert update['sku'] == 'WM0005'
    assert update['old_quantity'] == 1500
    assert update['new_quantity'] == 1691
    assert update['delta'] == 191

    # WM0074: variant exists, no inventory → insert
    assert len(plan['inventory_inserts']) == 1
    insert = plan['inventory_inserts'][0]
    assert insert['sku'] == 'WM0074'
    assert insert['new_quantity'] == 21289

    # ICEWM0039: variant doesn't exist → new_variant
    assert len(plan['new_variants']) == 1
    nv = plan['new_variants'][0]
    assert nv['sku'] == 'ICEWM0039'
    assert nv['country'] == 'PH'
    assert nv['product_id'] is None
    assert nv['match_status'] == 'unmatched'

    assert len(plan['inventory_unchanged']) == 0
    assert len(plan['rejected_rows']) == 0

    # 总数一致
    total = (len(plan['new_variants']) + len(plan['inventory_inserts'])
             + len(plan['inventory_updates']) + len(plan['inventory_unchanged'])
             + len(plan['rejected_rows']))
    assert total == 3, f'分类总数应为 3，实际 {total}'


@test("generate_plan 数量不变时归类为 unchanged")
def test_generate_plan_unchanged():
    rows = [{'sku': 'WM0005', 'product_name': '毛孔清洁布丁泥膜',
             'warehouse': '菲律宾-新创启辰自建仓', 'available_quantity': 1500}]
    plan = generate_plan(rows, DB_SNAPSHOT_OLD_WH)
    assert len(plan['inventory_unchanged']) == 1
    assert plan['inventory_unchanged'][0]['sku'] == 'WM0005'
    assert plan['inventory_unchanged'][0]['quantity'] == 1500
    assert len(plan['inventory_updates']) == 0


@test("空 SKU 被归类为 rejected_rows")
def test_empty_sku_rejected():
    rows = [{'sku': '', 'product_name': 'test', 'warehouse': '菲律宾-新创启辰自建仓',
             'available_quantity': 0}]
    plan = generate_plan(rows, DB_SNAPSHOT_OLD_WH)
    assert len(plan['rejected_rows']) == 1
    assert plan['rejected_rows'][0]['reason'] == 'SKU 为空'


@test("warehouse 改名计划: 旧名→改名")
def test_warehouse_rename_old_name():
    plan = _plan_warehouse_rename(DB_SNAPSHOT_OLD_WH['warehouse'])
    assert plan is not None
    assert plan['action'] == 'rename'
    assert plan['current_name'] == '菲律宾仓'
    assert plan['target_name'] == '菲律宾-新创启辰自建仓'
    assert '复用' in plan['message']


@test("warehouse 改名计划: 新名→无需改名")
def test_warehouse_rename_new_name():
    plan = _plan_warehouse_rename(DB_SNAPSHOT_NEW_WH['warehouse'])
    assert plan is not None
    assert plan['action'] == 'none'
    assert '无需改名' in plan['message']


@test("warehouse 改名计划: 未知名→必须抛出 RuntimeError")
def test_warehouse_rename_unknown_name():
    """未知仓库名不再自动规划改名，必须失败。"""
    try:
        _plan_warehouse_rename(DB_SNAPSHOT_UNKNOWN_WH['warehouse'])
        assert False, '应该抛出 RuntimeError'
    except RuntimeError as e:
        msg = str(e)
        assert '未知值' in msg
        assert '无法自动规划改名' in msg


@test("warehouse 为 None 时返回 None")
def test_warehouse_rename_none():
    plan = _plan_warehouse_rename(None)
    assert plan is None


@test("分类总数与输入行数一致")
def test_total_count_matches_input():
    plan = generate_plan(VALID_JSON_TEMPLATE['rows'], DB_SNAPSHOT_OLD_WH)
    total = (len(plan['new_variants']) + len(plan['inventory_inserts'])
             + len(plan['inventory_updates']) + len(plan['inventory_unchanged'])
             + len(plan['rejected_rows']))
    assert total == 3
    assert total == len(VALID_JSON_TEMPLATE['rows'])


@test("新 SKU 计划字段: product_id=null + match_status=unmatched + country=PH")
def test_new_variant_fields():
    plan = generate_plan(VALID_JSON_TEMPLATE['rows'], DB_SNAPSHOT_OLD_WH)
    nv = plan['new_variants'][0]
    assert nv['product_id'] is None
    assert nv['match_status'] == 'unmatched'
    assert nv['country'] == 'PH'


@test("inventory_after_variant_create 包含对应新 SKU 的 Inventory 写入动作")
def test_inventory_after_variant_create_present():
    """每条 new_variant 必须有一条对应的 inventory_after_variant_create。"""
    plan = generate_plan(VALID_JSON_TEMPLATE['rows'], DB_SNAPSHOT_OLD_WH)
    after = plan['inventory_after_variant_create']
    nv = plan['new_variants']
    # 测试数据中 ICEWM0039 是新 SKU（无 variant）
    assert len(after) == 1
    assert len(nv) == 1
    assert after[0]['sku'] == 'ICEWM0039'
    assert after[0]['new_quantity'] == 2865
    assert after[0]['depends_on'] == 'variant_creation'
    assert after[0]['warehouse_id'] is not None


@test("inventory_after_variant_create 数量与 new_variants 一致")
def test_inventory_after_variant_create_count_matches():
    """验证 inventory_after_variant_create 条数 == new_variants 条数。"""
    plan = generate_plan(VALID_JSON_TEMPLATE['rows'], DB_SNAPSHOT_OLD_WH)
    assert len(plan['inventory_after_variant_create']) == len(plan['new_variants'])


@test("全部新 SKU 场景: Inventory 动作总数 == 输入行数")
def test_all_new_variants_inventory_action_count():
    """空 DB（无 variant 无 inventory）：全部 3 行都是新 SKU，
    分类总计=3，inventory_after_variant_create=3，其余 inventory 动作=0。"""
    plan = generate_plan(VALID_JSON_TEMPLATE['rows'], DB_SNAPSHOT_NEW_WH)
    assert len(plan['new_variants']) == 3
    assert len(plan['inventory_after_variant_create']) == 3
    assert len(plan['inventory_inserts']) == 0
    assert len(plan['inventory_updates']) == 0
    assert len(plan['inventory_unchanged']) == 0
    assert len(plan['rejected_rows']) == 0
    # 分类总计
    total_classified = (
        len(plan['new_variants']) + len(plan['inventory_inserts'])
        + len(plan['inventory_updates']) + len(plan['inventory_unchanged'])
        + len(plan['rejected_rows'])
    )
    assert total_classified == 3
    # Inventory 动作总计
    total_inventory = (
        len(plan['inventory_inserts']) + len(plan['inventory_updates'])
        + len(plan['inventory_after_variant_create'])
    )
    assert total_inventory == 3


@test("混合场景: 分类总计与 Inventory 动作总计分别核对")
def test_mixed_scenario_separate_counts():
    """old wh 快照: WM0005(update) + WM0074(insert) + ICEWM0039(new_variant)。
    分类总计=3, Inventory 动作=2+1=3。"""
    plan = generate_plan(VALID_JSON_TEMPLATE['rows'], DB_SNAPSHOT_OLD_WH)
    # 分类总计
    total_classified = (
        len(plan['new_variants']) + len(plan['inventory_inserts'])
        + len(plan['inventory_updates']) + len(plan['inventory_unchanged'])
        + len(plan['rejected_rows'])
    )
    assert total_classified == 3, f'分类总计应为 3，实际 {total_classified}'
    # Inventory 动作总计
    total_inventory = (
        len(plan['inventory_inserts']) + len(plan['inventory_updates'])
        + len(plan['inventory_after_variant_create'])
    )
    assert total_inventory == 3, f'Inventory 动作总计应为 3，实际 {total_inventory}'


# =========================================================================
# 运行
# =========================================================================

if __name__ == '__main__':
    print('=' * 60)
    print('P5-SY3A 写入计划生成测试')
    print('不依赖 Supabase 连接 | 不执行任何数据库写入')
    print('=' * 60)
    print()

    test_valid_json_passes()
    test_warehouse_name_mismatch_fails()
    test_row_count_mismatch_fails()
    test_final_count_mismatch_fails()
    test_empty_sku_fails()
    test_duplicate_sku_warehouse_fails()
    test_negative_quantity_fails()
    test_fractional_quantity_fails()
    test_float_one_point_oh_fails()
    test_bool_quantity_fails()
    test_empty_product_name_fails()
    test_per_row_warehouse_mismatch_fails()
    test_empty_rows_fails()
    test_generate_plan_normal_classification()
    test_generate_plan_unchanged()
    test_empty_sku_rejected()
    test_warehouse_rename_old_name()
    test_warehouse_rename_new_name()
    test_warehouse_rename_unknown_name()
    test_warehouse_rename_none()
    test_total_count_matches_input()
    test_new_variant_fields()
    test_inventory_after_variant_create_present()
    test_inventory_after_variant_create_count_matches()
    test_all_new_variants_inventory_action_count()
    test_mixed_scenario_separate_counts()

    print()
    print('=' * 60)
    print(f'结果: {PASS} 通过, {FAIL} 失败 (共 {PASS + FAIL} 项)')
    print('=' * 60)

    sys.exit(0 if FAIL == 0 else 1)
