"""P5-SY2 结构保护测试 — 不依赖 BigSeller 登录状态或 Playwright

测试纯函数：
- _validate_header_keywords(): 表头关键词校验
- _parse_cell_rows(): 行解析与列数校验

运行方式：
    python tools/bigseller-scraper/test_structural_protection.py
"""
import sys
import os

# 确保可以 import bigseller_scraper 中的纯函数
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bigseller_scraper import (
    _validate_header_keywords,
    _parse_cell_rows,
    _validate_headers,
    _extract_page_rows,
)

# === 正常 13 列表头（与 BigSeller 2026-06-12 实际表头一致） ===
NORMAL_13_HEADERS = [
    "",              # 0: 复选框列
    "SKU信息",       # 1
    "仓库",          # 2
    "现有库存",      # 3
    "订单已锁",      # 4
    "整仓可用",      # 5
    "在途中",        # 6
    "总成本价",      # 7
    "警戒库存",      # 8
    "预测日销量",    # 9
    "预计可售天数",  # 10
    "备注",          # 11
    "操作",          # 12
]

# === 正常 13 列数据行（模拟 BigSeller 实际数据） ===
NORMAL_13_ROWS = [
    ["", "CHICPEAK 按压唇冻 #07 WM0100-#07 复制", "菲律宾-新创启辰自建仓",
     "3,793", "12", "3,781", "0", "MYR 0.00", "0", "8.89", "425", "添加", ""],
    ["", "ICE LERSKIN VC-阿魏酸抗氧化精华液 30ml WM0099 复制", "菲律宾-新创启辰自建仓",
     "0", "0", "0", "3,840", "MYR 0.00", "0", "0", "-", "添加", ""],
    ["", "CHICPEAK 按压唇冻 #08 WM0101-#08 复制", "菲律宾-新创启辰自建仓",
     "3,813", "5", "3,808", "0", "MYR 0.00", "0", "6.87", "554", "添加", ""],
]

# === 异常表头：关键词不匹配 ===
WRONG_KEYWORD_HEADERS = [
    "", "SKU信息", "仓库", "WRONG_FIELD_NAME",  # 列3 应该是 现有库存/当前库存
    "订单已锁", "整仓可用", "在途中", "总成本价",
    "警戒库存", "预测日销量", "预计可售天数", "备注", "操作",
]

# === 异常表头：列数不足 ===
SHORT_HEADERS = ["", "SKU信息", "仓库", "现有库存"]  # 只有 4 列

# === 异常数据行：12 列 ===
WRONG_COL_ROWS_12 = [
    ["", "CHICPEAK 按压唇冻 #07 WM0100-#07 复制", "菲律宾-新创启辰自建仓",
     "3,793", "12", "3,781", "0", "MYR 0.00", "0", "8.89", "425", "添加"],  # 缺少最后一列
]

# === 异常数据行：14 列 ===
WRONG_COL_ROWS_14 = [
    ["", "CHICPEAK 按压唇冻 #07 WM0100-#07 复制", "菲律宾-新创启辰自建仓",
     "3,793", "12", "3,781", "0", "MYR 0.00", "0", "8.89", "425", "添加", "", "EXTRA"],
]

# === 混合行：正常 13 列 + 异常 12 列 ===
MIXED_ROWS = [
    ["", "CHICPEAK 按压唇冻 #07 WM0100-#07 复制", "菲律宾-新创启辰自建仓",
     "3,793", "12", "3,781", "0", "MYR 0.00", "0", "8.89", "425", "添加", ""],
    ["", "BAD ROW", "菲律宾-新创启辰自建仓",
     "0", "0", "0", "0", "MYR 0.00", "0", "0", "-", "添加"],  # 12 列
]

# === FakePage: 模拟 Playwright page 对象，不启动浏览器 ===
# 用于测试 _validate_headers() 和 _extract_page_rows() 的错误处理路径。
# 真实 DOM 交互逻辑已在集成抓取运行中验证；此处仅验证 Python 侧
# 对 page.evaluate() 返回的 JS 错误结果能正确抛出 RuntimeError。


class FakePage:
    """模拟 Playwright page.evaluate() 行为。

    不启动浏览器，仅按预定义规则返回 JS 执行结果。
    支持两种调用形式：
      page.evaluate(js_code)           → 忽略 js_code，返回预定义结果
      page.evaluate(js_code, args)     → 忽略 js_code 和 args，返回预定义结果
    """

    def __init__(self, evaluate_results):
        """evaluate_results: 每次 evaluate() 调用的返回值，可以是:
        - dict: 所有调用返回相同 dict
        - list: 按调用顺序依次返回 list 中的元素
        - callable: 用调用次数调用，返回其结果
        """
        self._results = evaluate_results
        self._call_count = 0

    def evaluate(self, *args, **kwargs):
        self._call_count += 1
        if callable(self._results):
            return self._results(self._call_count)
        if isinstance(self._results, list):
            idx = min(self._call_count - 1, len(self._results) - 1)
            return self._results[idx]
        return self._results


PASS = 0
FAIL = 0


def test(name):
    """测试装饰器：打印测试名并统计结果"""
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
# 测试: 正常 13 列数据通过
# =========================================================================

@test("正常 13 列表头通过校验")
def test_normal_13_headers_pass():
    _validate_header_keywords(NORMAL_13_HEADERS)


@test("正常 13 列数据行通过解析")
def test_normal_13_cell_rows_pass():
    rows = _parse_cell_rows(NORMAL_13_ROWS, header_count=13)
    assert len(rows) == 3, f'应解析 3 行，实际 {len(rows)}'
    # 验证第一条
    assert rows[0]['sku_info'] == 'CHICPEAK 按压唇冻 #07 WM0100-#07 复制'
    assert rows[0]['warehouse'] == '菲律宾-新创启辰自建仓'
    assert rows[0]['cur_stock'] == '3,793'
    assert rows[0]['available'] == '3,781'
    assert rows[0]['transit'] == '0'


# =========================================================================
# 测试: 表头关键词不匹配时失败
# =========================================================================

@test("表头关键词不匹配时抛出 RuntimeError")
def test_wrong_header_keywords_fail():
    try:
        _validate_header_keywords(WRONG_KEYWORD_HEADERS)
        assert False, '应该抛出 RuntimeError'
    except RuntimeError as e:
        assert '列3不匹配' in str(e), f'错误信息应包含列3不匹配，实际: {e}'


@test("表头列数不足时抛出 RuntimeError")
def test_short_headers_fail():
    try:
        _validate_header_keywords(SHORT_HEADERS)
        assert False, '应该抛出 RuntimeError'
    except RuntimeError as e:
        assert '列4缺失' in str(e), f'错误信息应包含列4缺失，实际: {e}'


# =========================================================================
# 测试: 列数不匹配时失败
# =========================================================================

@test("任意行少于表头列数(12列)时抛出 RuntimeError")
def test_column_mismatch_12_fail():
    try:
        _parse_cell_rows(WRONG_COL_ROWS_12, header_count=13)
        assert False, '应该抛出 RuntimeError'
    except RuntimeError as e:
        msg = str(e)
        assert '列数不匹配' in msg, f'错误信息应包含列数不匹配，实际: {msg}'
        assert '1 行' in msg, f'应报告 1 行不匹配，实际: {msg}'


@test("任意行超过表头列数(14列)时抛出 RuntimeError")
def test_column_mismatch_14_fail():
    try:
        _parse_cell_rows(WRONG_COL_ROWS_14, header_count=13)
        assert False, '应该抛出 RuntimeError'
    except RuntimeError as e:
        msg = str(e)
        assert '列数不匹配' in msg, f'错误信息应包含列数不匹配，实际: {msg}'


@test("混合行(13列+12列)中任意一行不匹配即抛出 RuntimeError")
def test_mixed_column_counts_fail():
    try:
        _parse_cell_rows(MIXED_ROWS, header_count=13)
        assert False, '应该抛出 RuntimeError — 不允许静默跳过不匹配行'
    except RuntimeError as e:
        msg = str(e)
        assert '列数不匹配' in msg, f'错误信息应包含列数不匹配，实际: {msg}'


# =========================================================================
# 测试: 正常数据解析字段正确
# =========================================================================

@test("解析后的字段映射正确")
def test_parsed_fields_correct():
    rows = _parse_cell_rows(NORMAL_13_ROWS, header_count=13)
    # 第1行: 有库存
    r0 = rows[0]
    assert r0['sku_info'] == 'CHICPEAK 按压唇冻 #07 WM0100-#07 复制'
    assert r0['warehouse'] == '菲律宾-新创启辰自建仓'
    assert r0['cur_stock'] == '3,793'
    assert r0['locked'] == '12'
    assert r0['available'] == '3,781'
    assert r0['transit'] == '0'
    assert r0['daily_sales'] == '8.89'
    assert r0['est_days'] == '425'
    # 第2行: 零库存+在途
    r1 = rows[1]
    assert r1['available'] == '0'
    assert r1['transit'] == '3,840'


# =========================================================================
# 测试: FakePage — VXE 容器绑定失败与容器标记丢失
# =========================================================================


@test("_validate_headers() VXE_CONTAINER_NOT_FOUND 时抛出 RuntimeError")
def test_vxe_container_not_found():
    """当页面不存在同时含 header/body table 的 VXE 容器时，_validate_headers() 必须抛出 RuntimeError。"""
    fake_page = FakePage({
        'error': 'VXE_CONTAINER_NOT_FOUND',
        'detail': '未找到同时包含 table.vxe-table--header 和 table.vxe-table--body 的 VXE 容器',
    })
    try:
        _validate_headers(fake_page)
        assert False, '应该抛出 RuntimeError'
    except RuntimeError as e:
        msg = str(e)
        assert 'VXE 容器绑定失败' in msg, f'错误信息应包含 VXE 容器绑定失败，实际: {msg}'
        assert '无法证明表头与表体来自同一数据表' in msg, f'应提示无法证明同一数据表，实际: {msg}'


@test("_extract_page_rows() CONTAINER_NOT_FOUND 时抛出 RuntimeError")
def test_extract_rows_container_not_found():
    """当标记属性 data-bigseller-scraper="target" 的 VXE 容器不存在时，_extract_page_rows() 必须抛出 RuntimeError。"""
    fake_page = FakePage({
        'error': 'CONTAINER_NOT_FOUND',
        'detail': '未找到 data-bigseller-scraper="target" 标记的 VXE 容器',
    })
    try:
        _extract_page_rows(fake_page, header_count=13)
        assert False, '应该抛出 RuntimeError'
    except RuntimeError as e:
        msg = str(e)
        assert '表体绑定失败' in msg, f'错误信息应包含表体绑定失败，实际: {msg}'
        assert '无法证明表体与已验证表头来自同一 VXE 容器' in msg, f'应提示无法证明同一 VXE 容器，实际: {msg}'


# =========================================================================
# 运行
# =========================================================================

if __name__ == '__main__':
    print('=' * 60)
    print('P5-SY2 结构保护测试')
    print('不依赖 BigSeller 登录状态 | 不依赖 Playwright')
    print('=' * 60)
    print()

    test_normal_13_headers_pass()
    test_normal_13_cell_rows_pass()
    test_wrong_header_keywords_fail()
    test_short_headers_fail()
    test_column_mismatch_12_fail()
    test_column_mismatch_14_fail()
    test_mixed_column_counts_fail()
    test_parsed_fields_correct()
    test_vxe_container_not_found()
    test_extract_rows_container_not_found()

    print()
    print('=' * 60)
    print(f'结果: {PASS} 通过, {FAIL} 失败 (共 {PASS + FAIL} 项)')
    print('=' * 60)

    sys.exit(0 if FAIL == 0 else 1)
