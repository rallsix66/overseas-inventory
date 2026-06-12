"""输入校验 — 纯函数，不依赖任何供应商或外部服务。

验证 BigSeller 抓取 JSON 的结构、计数和每行数据。
"""
from .config import TARGET_WAREHOUSE_NAME


class ValidationError(Exception):
    """输入数据不满足写入前置条件。"""
    pass


def validate_json(data: dict) -> list:
    """验证 BigSeller JSON 顶层结构，返回 rows 列表。

    校验项：
    - warehouse 精确匹配目标仓库名
    - rows 非空数组（拒绝空快照，防止抓取异常误记成功同步）
    - row_count / metadata.final_count 与 rows 实际长度一致
    - 每行 warehouse 精确匹配目标 BigSeller 仓库名
    - SKU 非空
    - product_name 非空
    - (sku, warehouse) 无重复
    - available_quantity 为严格 int（拒绝 bool 和 float）
    """
    errors = []

    # 1. 仓库名称（顶层）
    wh = data.get('warehouse', '')
    if wh != TARGET_WAREHOUSE_NAME:
        errors.append(
            f'仓库名不匹配: JSON 中为 "{wh}"，期望 "{TARGET_WAREHOUSE_NAME}"'
        )

    # 2. 行数一致性
    rows = data.get('rows', [])
    if not isinstance(rows, list):
        raise ValidationError('JSON 中 "rows" 字段缺失或不是数组')

    if len(rows) == 0:
        raise ValidationError(
            '"rows" 为空数组（抓取异常或输入错误，拒绝写入以避免误记成功同步）'
        )

    row_count = data.get('row_count')
    if row_count is not None and row_count != len(rows):
        errors.append(
            f'row_count={row_count} 但 rows 实际长度={len(rows)}'
        )

    metadata = data.get('metadata')
    if metadata and isinstance(metadata, dict):
        final_count = metadata.get('final_count')
        if final_count is not None and final_count != len(rows):
            errors.append(
                f'metadata.final_count={final_count} 但 rows 实际长度={len(rows)}'
            )

    # 3. 逐行校验
    seen_keys = set()
    for i, row in enumerate(rows):
        sku = (row.get('sku') or '').strip()
        row_warehouse = (row.get('warehouse') or '').strip()
        product_name = (row.get('product_name') or '').strip()
        available = row.get('available_quantity')

        # 每行 warehouse 必须精确等于目标 BigSeller 仓库名
        if row_warehouse != TARGET_WAREHOUSE_NAME:
            errors.append(
                f'第 {i} 行 ({sku or "?"}): '
                f'warehouse="{row_warehouse}" 不等于 "{TARGET_WAREHOUSE_NAME}"'
            )

        if not sku:
            errors.append(f'第 {i} 行: SKU 为空')
            continue

        if not product_name:
            errors.append(f'第 {i} 行 ({sku}): product_name 为空')

        # available_quantity 必须是严格 int，拒绝 bool 和 float
        if isinstance(available, bool) or type(available) is not int:
            errors.append(
                f'第 {i} 行 ({sku}): available_quantity={available!r} '
                f'类型={type(available).__name__}，期望 int'
            )
        elif available < 0:
            errors.append(f'第 {i} 行 ({sku}): available_quantity={available} 为负数')

        key = (sku, row_warehouse)
        if key in seen_keys:
            errors.append(f'第 {i} 行 ({sku}, {row_warehouse}): (sku, warehouse) 重复')
        seen_keys.add(key)

    if errors:
        raise ValidationError(
            f'输入 JSON 校验失败 ({len(errors)} 项):\n'
            + '\n'.join(f'  - {e}' for e in errors)
        )

    return rows


def validate_row_count_report(total_input: int, classified: dict) -> None:
    """验证分类报告总数与输入一致，禁止静默丢行。

    classified 应包含各分类列表的计数字典。
    """
    sum_classified = sum(
        len(v) if isinstance(v, list) else (v if isinstance(v, int) else 0)
        for v in classified.values()
        if not isinstance(v, dict)  # warehouse_rename_required 通常是 dict
    )

    if sum_classified != total_input:
        raise ValidationError(
            f'分类总数 ({sum_classified}) 与输入行数 ({total_input}) 不一致，'
            f'存在静默丢行风险'
        )
