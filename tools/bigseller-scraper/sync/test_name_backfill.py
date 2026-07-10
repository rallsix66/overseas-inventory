"""P6-UX-V2-E: name_backfill 纯函数测试 — 不依赖 Supabase 连接或写入。

测试 build_backfill_plan(), _validate_patch_response(), format_backfill_report()。
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from sync.name_backfill import (
    build_backfill_plan,
    _validate_patch_response,
    format_backfill_report,
    _BACKFILL_CONFIRM_TOKEN,
    WAREHOUSE_TO_COUNTRY,
)

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

SAMPLE_ROWS = [
    {
        'sku': '780103214084',
        'product_name': 'VC-阿魏酸抗氧化精华',
        'warehouse': '菲律宾-新创启辰自建仓',
        'available_quantity': 100,
        'raw': {
            'sku_info': 'ICE LERSKIN VC-阿魏酸抗氧化精华 780103214084 复制',
        },
    },
    {
        'sku': 'WM0111-P08',
        'product_name': '唇泥 P08-1.8g',
        'warehouse': '菲律宾-新创启辰自建仓',
        'available_quantity': 200,
        'raw': {
            'sku_info': 'CHIC PEAK 唇泥 P08-1.8g WM0111-P08',
        },
    },
    {
        'sku': 'WM0100-#07',
        'product_name': '按压唇冻 #07',
        'warehouse': '菲律宾-新创启辰自建仓',
        'available_quantity': 300,
        'raw': {
            'sku_info': 'CHICPEAK 按压唇冻 #07 WM0100-#07 复制',
        },
    },
    {
        'sku': 'WM0099',
        'product_name': 'VC-阿魏酸抗氧化精华液 30ml',
        'warehouse': '菲律宾-新创启辰自建仓',
        'available_quantity': 50,
        'raw': {
            'sku_info': 'ICELERSKIN VC-阿魏酸抗氧化精华液 30ml WM0099 复制',
        },
    },
]

PH_VARIANT_MAP = {
    ('780103214084', 'PH'): {
        'id': 'var-001', 'sku': '780103214084', 'country': 'PH',
        'name': 'VC-阿魏酸抗氧化精华',
    },
    ('WM0111-P08', 'PH'): {
        'id': 'var-002', 'sku': 'WM0111-P08', 'country': 'PH',
        'name': 'CHIC PEAK 唇泥 P08-1.8g',
    },
    ('WM0100-#07', 'PH'): {
        'id': 'var-003', 'sku': 'WM0100-#07', 'country': 'PH',
        'name': '按压唇冻 #07',
    },
    ('WM0099', 'PH'): {
        'id': 'var-004', 'sku': 'WM0099', 'country': 'PH',
        'name': 'VC-阿魏酸抗氧化精华液 30ml',
    },
}

EMPTY_VARIANT_MAP: dict = {}


# =========================================================================
# 测试: _validate_patch_response
# =========================================================================


@test("PATCH 返回空数组时校验失败")
def test_validate_empty_array_fails():
    err = _validate_patch_response([], 'var-001', 'ICE LERSKIN VC')
    assert err is not None, '空数组应失败'
    assert '空数组' in err.lower() or '未确认' in err, f'错误信息不匹配: {err!r}'


@test("PATCH 返回多行时校验失败")
def test_validate_multiple_rows_fails():
    err = _validate_patch_response(
        [
            {'id': 'var-001', 'name': 'ICE LERSKIN VC'},
            {'id': 'var-002', 'name': 'OTHER'},
        ],
        'var-001',
        'ICE LERSKIN VC',
    )
    assert err is not None, '多行应失败'
    assert '行' in err and '2' in err, f'应提示返回行数: {err!r}'


@test("PATCH 返回 id 不匹配时校验失败")
def test_validate_id_mismatch_fails():
    err = _validate_patch_response(
        [{'id': 'var-999', 'name': 'ICE LERSKIN VC'}],
        'var-001',
        'ICE LERSKIN VC',
    )
    assert err is not None, 'id 不匹配应失败'
    assert 'id' in err.lower(), f'应提示 id 不匹配: {err!r}'


@test("PATCH 返回 name 不匹配时校验失败")
def test_validate_name_mismatch_fails():
    err = _validate_patch_response(
        [{'id': 'var-001', 'name': 'WRONG NAME'}],
        'var-001',
        'ICE LERSKIN VC',
    )
    assert err is not None, 'name 不匹配应失败'
    assert 'name' in err.lower(), f'应提示 name 不匹配: {err!r}'


@test("PATCH 返回正确时校验通过")
def test_validate_success():
    err = _validate_patch_response(
        [{'id': 'var-001', 'name': 'ICE LERSKIN VC'}],
        'var-001',
        'ICE LERSKIN VC',
    )
    assert err is None, f'校验应通过，实际: {err!r}'


# =========================================================================
# 测试: build_backfill_plan — 差异生成
# =========================================================================


@test("品牌修复差异正确生成: ICE LERSKIN / CHICPEAK 被补充")
def test_diffs_generated_correctly():
    plan = build_backfill_plan(SAMPLE_ROWS, PH_VARIANT_MAP, country='PH')

    assert len(plan['diffs']) == 3, f'应有 3 条差异，实际 {len(plan["diffs"])}'

    diff_ice = [d for d in plan['diffs'] if d['sku'] == '780103214084']
    assert len(diff_ice) == 1
    assert diff_ice[0]['old_name'] == 'VC-阿魏酸抗氧化精华'
    assert diff_ice[0]['new_name'] == 'ICE LERSKIN VC-阿魏酸抗氧化精华'

    diff_chicpeak = [d for d in plan['diffs'] if d['sku'] == 'WM0100-#07']
    assert len(diff_chicpeak) == 1
    assert diff_chicpeak[0]['old_name'] == '按压唇冻 #07'
    assert diff_chicpeak[0]['new_name'] == 'CHICPEAK 按压唇冻 #07'

    diff_icelerskin = [d for d in plan['diffs'] if d['sku'] == 'WM0099']
    assert len(diff_icelerskin) == 1
    assert diff_icelerskin[0]['new_name'] == 'ICELERSKIN VC-阿魏酸抗氧化精华液 30ml'


@test("新旧名称相同时正确跳过")
def test_same_name_skipped():
    plan = build_backfill_plan(SAMPLE_ROWS, PH_VARIANT_MAP, country='PH')

    same = [s for s in plan['skipped']['same_name'] if s['sku'] == 'WM0111-P08']
    assert len(same) == 1, f'WM0111-P08 应被跳过，实际: {plan["skipped"]["same_name"]}'
    assert same[0]['name'] == 'CHIC PEAK 唇泥 P08-1.8g'


@test("无匹配 Variant 时正确记录到 skipped.no_variant")
def test_no_variant_skipped():
    plan = build_backfill_plan(SAMPLE_ROWS, EMPTY_VARIANT_MAP, country='PH')

    assert len(plan['diffs']) == 0
    assert len(plan['skipped']['no_variant']) == 4


@test("提取后名称为空时跳过")
def test_empty_new_name_skipped():
    rows = [{
        'sku': 'SKU-EMPTY',
        'product_name': 'whatever',
        'warehouse': '菲律宾-新创启辰自建仓',
        'available_quantity': 1,
        'raw': {'sku_info': ''},
    }]
    variant_map = {
        ('SKU-EMPTY', 'PH'): {
            'id': 'var-empty', 'sku': 'SKU-EMPTY', 'country': 'PH',
            'name': 'whatever',
        },
    }
    plan = build_backfill_plan(rows, variant_map, country='PH')

    assert len(plan['diffs']) == 0
    assert len(plan['skipped']['empty_new_name']) == 1
    assert plan['skipped']['empty_new_name'][0]['sku'] == 'SKU-EMPTY'


@test("重复 SKU 输入被拒绝并记录到 skipped.duplicate_input")
def test_duplicate_input_rejected():
    """同一 (sku, country) 在输入中出现两次 → 第一次正常处理，
    第二次记录到 skipped.duplicate_input，不生成重复 diff。"""
    rows = [
        {
            'sku': 'WM0099',
            'product_name': '精华液',
            'warehouse': '菲律宾-新创启辰自建仓',
            'available_quantity': 50,
            'raw': {'sku_info': 'ICELERSKIN VC-阿魏酸抗氧化精华液 30ml WM0099 复制'},
        },
        {
            'sku': 'WM0099',  # 第二次出现，同一 (sku, PH)
            'product_name': '精华液',
            'warehouse': '菲律宾-新创启辰自建仓',
            'available_quantity': 55,
            'raw': {'sku_info': 'ICELERSKIN VC-阿魏酸抗氧化精华液 30ml WM0099 复制'},
        },
    ]
    plan = build_backfill_plan(rows, PH_VARIANT_MAP, country='PH')

    # 只应生成 1 条 diff（第一次出现）
    assert len(plan['diffs']) == 1, (
        f'应只有 1 条 diff（第一次出现），实际 {len(plan["diffs"])}'
    )
    assert plan['diffs'][0]['sku'] == 'WM0099'

    # 第二次出现应记录到 duplicate_input
    assert len(plan['skipped']['duplicate_input']) == 1, (
        f'应记录 1 条重复，实际 {len(plan["skipped"]["duplicate_input"])}'
    )
    dup = plan['skipped']['duplicate_input'][0]
    assert dup['sku'] == 'WM0099'
    assert dup['country'] == 'PH'
    assert '重复' in dup['reason']


# =========================================================================
# 测试: country 隔离
# =========================================================================


@test("按 (sku, country) 隔离: 同 SKU 不同 country 互不干扰")
def test_country_isolation():
    multi_country_map = {
        ('WM0099', 'PH'): {
            'id': 'var-ph-004', 'sku': 'WM0099', 'country': 'PH',
            'name': 'VC-阿魏酸抗氧化精华液 30ml',
        },
        ('WM0099', 'TH'): {
            'id': 'var-th-099', 'sku': 'WM0099', 'country': 'TH',
            'name': '泰国特供精华液',
        },
    }

    plan = build_backfill_plan(SAMPLE_ROWS, multi_country_map, country='PH')

    diffs = [d for d in plan['diffs'] if d['sku'] == 'WM0099']
    assert len(diffs) == 1
    assert diffs[0]['variant_id'] == 'var-ph-004'
    assert diffs[0]['country'] == 'PH'
    th_diff = [d for d in plan['diffs'] if d['variant_id'] == 'var-th-099']
    assert len(th_diff) == 0, 'TH variant 不应被回填'


@test("不同 country 回填: TH 国家只影响 TH variant")
def test_different_country_backfill():
    multi_country_map = {
        ('WM0099', 'PH'): {
            'id': 'var-ph-004', 'sku': 'WM0099', 'country': 'PH',
            'name': 'VC-阿魏酸抗氧化精华液 30ml',
        },
        ('WM0099', 'TH'): {
            'id': 'var-th-099', 'sku': 'WM0099', 'country': 'TH',
            'name': '精华液（缺品牌）',
        },
    }

    plan = build_backfill_plan(SAMPLE_ROWS, multi_country_map, country='TH')

    diffs = [d for d in plan['diffs'] if d['sku'] == 'WM0099']
    assert len(diffs) == 1
    assert diffs[0]['variant_id'] == 'var-th-099'
    assert diffs[0]['country'] == 'TH'
    assert diffs[0]['new_name'] == 'ICELERSKIN VC-阿魏酸抗氧化精华液 30ml'


# =========================================================================
# 测试: P6-UX-V2-E-OVER-CLEAN — 新版/SPF90+/*1 被保留
# =========================================================================

OVER_CLEAN_ROWS = [
    {
        'sku': '757577407113',
        'product_name': '防晒铝罐喷雾 150ML',
        'warehouse': '菲律宾-新创启辰自建仓',
        'available_quantity': 50,
        'raw': {
            'sku_info': '新版 防晒铝罐喷雾 150ML 757577407113 复制',
        },
    },
    {
        'sku': '6974674958025',
        'product_name': 'HUNMUI英文版防晒霜SPF90',
        'warehouse': '菲律宾-新创启辰自建仓',
        'available_quantity': 30,
        'raw': {
            'sku_info': 'HUNMUI英文版防晒霜SPF90+ 6974674958025 复制',
        },
    },
    {
        'sku': '714855625102',
        'product_name': '防晒棒',
        'warehouse': '菲律宾-新创启辰自建仓',
        'available_quantity': 20,
        'raw': {
            'sku_info': '防晒棒*1 714855625102 复制',
        },
    },
]

OVER_CLEAN_VARIANT_MAP = {
    ('757577407113', 'PH'): {
        'id': 'var-oc-001', 'sku': '757577407113', 'country': 'PH',
        'name': '防晒铝罐喷雾 150ML',
    },
    ('6974674958025', 'PH'): {
        'id': 'var-oc-002', 'sku': '6974674958025', 'country': 'PH',
        'name': 'HUNMUI英文版防晒霜SPF90',
    },
    ('714855625102', 'PH'): {
        'id': 'var-oc-003', 'sku': '714855625102', 'country': 'PH',
        'name': '防晒棒',
    },
}


@test("old_name 缺少 新版，new_name 补回 新版")
def test_over_clean_new_version_restored():
    plan = build_backfill_plan(OVER_CLEAN_ROWS, OVER_CLEAN_VARIANT_MAP, country='PH')
    diff = [d for d in plan['diffs'] if d['sku'] == '757577407113']
    assert len(diff) == 1, f'应有 1 条 diff，实际 {len(diff)}'
    assert diff[0]['old_name'] == '防晒铝罐喷雾 150ML'
    assert diff[0]['new_name'] == '新版 防晒铝罐喷雾 150ML', (
        f'new_name 应包含 新版，实际: {diff[0]["new_name"]!r}'
    )


@test("old_name 缺少 SPF90+ 的 +，new_name 补回 +")
def test_over_clean_spf_plus_restored():
    plan = build_backfill_plan(OVER_CLEAN_ROWS, OVER_CLEAN_VARIANT_MAP, country='PH')
    diff = [d for d in plan['diffs'] if d['sku'] == '6974674958025']
    assert len(diff) == 1, f'应有 1 条 diff，实际 {len(diff)}'
    assert diff[0]['old_name'] == 'HUNMUI英文版防晒霜SPF90'
    assert diff[0]['new_name'] == 'HUNMUI英文版防晒霜SPF90+', (
        f'new_name 应包含 SPF90+，实际: {diff[0]["new_name"]!r}'
    )


@test("old_name 缺少 *1，new_name 补回 *1")
def test_over_clean_star_quantity_restored():
    plan = build_backfill_plan(OVER_CLEAN_ROWS, OVER_CLEAN_VARIANT_MAP, country='PH')
    diff = [d for d in plan['diffs'] if d['sku'] == '714855625102']
    assert len(diff) == 1, f'应有 1 条 diff，实际 {len(diff)}'
    assert diff[0]['old_name'] == '防晒棒'
    assert diff[0]['new_name'] == '防晒棒*1', (
        f'new_name 应包含 *1，实际: {diff[0]["new_name"]!r}'
    )


# =========================================================================
# 测试: format_backfill_report
# =========================================================================


@test("format_backfill_report 包含差异明细")
def test_report_includes_diffs():
    plan = build_backfill_plan(SAMPLE_ROWS, PH_VARIANT_MAP, country='PH')
    report = format_backfill_report(plan)

    assert 'ICE LERSKIN VC-阿魏酸抗氧化精华' in report
    assert 'CHICPEAK 按压唇冻 #07' in report
    assert '待更新: 3 条' in report
    assert '跳过:   1 条' in report


@test("format_backfill_report 无差异时提示无需更新")
def test_report_no_diffs():
    rows = [{
        'sku': 'WM0111-P08',
        'product_name': 'CHIC PEAK 唇泥 P08-1.8g',
        'warehouse': '菲律宾-新创启辰自建仓',
        'available_quantity': 200,
        'raw': {'sku_info': 'CHIC PEAK 唇泥 P08-1.8g WM0111-P08'},
    }]
    plan = build_backfill_plan(rows, PH_VARIANT_MAP, country='PH')
    report = format_backfill_report(plan)

    assert '待更新: 0 条' in report
    assert '没有需要更新的记录' in report


@test("format_backfill_report 显示重复输入跳过信息")
def test_report_includes_duplicate_input():
    rows = [
        {
            'sku': 'WM0099', 'product_name': 'x',
            'warehouse': '菲律宾-新创启辰自建仓',
            'available_quantity': 1,
            'raw': {'sku_info': 'ICELERSKIN VC 精华 WM0099 复制'},
        },
        {
            'sku': 'WM0099', 'product_name': 'x',
            'warehouse': '菲律宾-新创启辰自建仓',
            'available_quantity': 2,
            'raw': {'sku_info': 'ICELERSKIN VC 精华 WM0099 复制'},
        },
    ]
    plan = build_backfill_plan(rows, PH_VARIANT_MAP, country='PH')
    report = format_backfill_report(plan)

    assert '输入重复' in report
    assert '待更新: 1 条' in report


# =========================================================================
# 测试: 写入保护
# =========================================================================


@test("确认令牌常量已定义且非空")
def test_confirm_token_defined():
    assert _BACKFILL_CONFIRM_TOKEN, '确认令牌不应为空'
    assert len(_BACKFILL_CONFIRM_TOKEN) > 8, '确认令牌应足够长'


# =========================================================================
# 测试: import 不需要 .env.local
# =========================================================================


@test("import name_backfill 不需要 .env.local（纯函数和常量不触发 env 读取）")
def test_import_does_not_require_env_local():
    """验证模块级常量（WAREHOUSE_TO_COUNTRY, _BACKFILL_CONFIRM_TOKEN）
    和纯函数（build_backfill_plan, _validate_patch_response,
    format_backfill_report）在 import 时不触发 .env.local 读取。
    测试文件本身能 import 成功即是证明。"""
    assert WAREHOUSE_TO_COUNTRY is not None
    assert _BACKFILL_CONFIRM_TOKEN is not None
    assert callable(build_backfill_plan)
    assert callable(_validate_patch_response)
    assert callable(format_backfill_report)


# =========================================================================
# 运行
# =========================================================================

if __name__ == '__main__':
    print('=' * 60)
    print('P6-UX-V2-E: name_backfill 纯函数测试')
    print('不依赖 Supabase 连接 | 不执行任何数据库写入 | 不需要 .env.local')
    print('=' * 60)
    print()

    # _validate_patch_response 测试
    test_validate_empty_array_fails()
    test_validate_multiple_rows_fails()
    test_validate_id_mismatch_fails()
    test_validate_name_mismatch_fails()
    test_validate_success()

    # build_backfill_plan 测试
    test_diffs_generated_correctly()
    test_same_name_skipped()
    test_no_variant_skipped()
    test_empty_new_name_skipped()
    test_duplicate_input_rejected()

    # country 隔离测试
    test_country_isolation()
    test_different_country_backfill()

    # P6-UX-V2-E-OVER-CLEAN: 新版/SPF90+/*1 补回
    test_over_clean_new_version_restored()
    test_over_clean_spf_plus_restored()
    test_over_clean_star_quantity_restored()

    # format_backfill_report 测试
    test_report_includes_diffs()
    test_report_no_diffs()
    test_report_includes_duplicate_input()

    # 写入保护测试
    test_confirm_token_defined()

    # import 不需要 .env.local 测试
    test_import_does_not_require_env_local()

    print()
    print('=' * 60)
    print(f'结果: {PASS} 通过, {FAIL} 失败 (共 {PASS + FAIL} 项)')
    print('=' * 60)

    sys.exit(0 if FAIL == 0 else 1)
