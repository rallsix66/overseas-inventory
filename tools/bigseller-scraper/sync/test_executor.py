"""P5-SY3B 执行器测试 — 不依赖 Supabase 连接或写入。

测试纯函数: classify_variants / build_inventory_upsert_rows
验证 idempotent 逻辑：重复执行不变性。
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from sync.executor import classify_variants, build_inventory_upsert_rows

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
# 运行
# =========================================================================

if __name__ == '__main__':
    print('=' * 60)
    print('P5-SY3B 执行器测试')
    print('不依赖 Supabase 连接 | 不执行任何数据库写入')
    print('=' * 60)
    print()

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

    print()
    print('=' * 60)
    print(f'结果: {PASS} 通过, {FAIL} 失败 (共 {PASS + FAIL} 项)')
    print('=' * 60)

    sys.exit(0 if FAIL == 0 else 1)
