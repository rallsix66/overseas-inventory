"""写入计划生成器 — 纯函数，供应商无关。

接收验证后的输入行和 DB 只读快照，生成分类写入计划。
不访问 Supabase 或任何外部服务。
"""
from .config import (
    TARGET_WAREHOUSE_NAME,
    OLD_WAREHOUSE_NAME,
    NEW_VARIANT_COUNTRY,
    NEW_VARIANT_PRODUCT_ID,
    NEW_VARIANT_MATCH_STATUS,
)


def generate_plan(input_rows: list, db_snapshot: dict) -> dict:
    """生成只读写入计划。

    Args:
        input_rows: BigSeller JSON rows（已验证）
        db_snapshot: {
            'warehouse': dict | None,  # PH overseas warehouse
            'variants': list[dict],     # PH product_variant rows
            'inventories': list[dict],  # inventory rows for this warehouse
        }

    Returns:
        {
            'warehouse_rename_required': dict | None,
            'new_variants': list[dict],
            'inventory_inserts': list[dict],
            'inventory_updates': list[dict],
            'inventory_unchanged': list[dict],
            'inventory_after_variant_create': list[dict],
            'rejected_rows': list[dict],
        }
    """
    warehouse = db_snapshot.get('warehouse')
    variants = db_snapshot.get('variants', [])
    inventories = db_snapshot.get('inventories', [])

    # 1. Warehouse 改名计划
    rename_plan = _plan_warehouse_rename(warehouse)

    wh_id = warehouse.get('id') if warehouse else None

    # 2. 构建 lookup 索引
    # variant_by_sku: sku → variant dict
    variant_by_sku = {}
    for v in variants:
        sku = (v.get('sku') or '').strip()
        if sku:
            variant_by_sku[sku] = v

    # inventory_by_variant: variant_id → inventory dict
    inventory_by_variant = {}
    for inv in inventories:
        vid = inv.get('variant_id')
        if vid:
            inventory_by_variant[vid] = inv

    # 3. 逐行分类
    new_variants = []
    inventory_after_variant_create = []
    inventory_inserts = []
    inventory_updates = []
    inventory_unchanged = []
    rejected_rows = []

    for row in input_rows:
        sku = (row.get('sku') or '').strip()
        product_name = (row.get('product_name') or '').strip()
        available_qty = int(row.get('available_quantity', 0))
        daily_sales = row.get('daily_sales')  # float or None
        estimated_days = row.get('estimated_days')  # float or None

        if not sku:
            rejected_rows.append({
                'row': row,
                'reason': 'SKU 为空',
            })
            continue

        variant = variant_by_sku.get(sku)

        if variant is None:
            # 新 SKU — 需要创建 ProductVariant
            new_variants.append({
                'sku': sku,
                'name': product_name,
                'country': NEW_VARIANT_COUNTRY,
                'product_id': NEW_VARIANT_PRODUCT_ID,
                'match_status': NEW_VARIANT_MATCH_STATUS,
                'target_quantity': available_qty,
            })
            # P5-SY3B: 创建 Variant 获取 ID 后，必须创建对应 Inventory
            inventory_after_variant_create.append({
                'sku': sku,
                'warehouse_id': wh_id,
                'warehouse_name': TARGET_WAREHOUSE_NAME,
                'new_quantity': available_qty,
                'daily_sales': daily_sales,
                'estimated_days': estimated_days,
                'depends_on': 'variant_creation',
                'note': f'P5-SY3B: 先创建 variant({sku}) 获取 variant_id，再 INSERT inventory',
            })
            continue

        # 已有 variant — 检查 inventory
        existing_inv = inventory_by_variant.get(variant.get('id'))

        if existing_inv is None:
            # 有 variant 但无 inventory 记录
            inventory_inserts.append({
                'variant_id': variant.get('id'),
                'warehouse_id': wh_id,
                'warehouse_name': TARGET_WAREHOUSE_NAME,
                'sku': sku,
                'product_name': product_name,
                'new_quantity': available_qty,
                'old_quantity': 0,
                'delta': available_qty,
                'daily_sales': daily_sales,
                'estimated_days': estimated_days,
            })
        else:
            old_qty = existing_inv.get('quantity', 0)
            if old_qty == available_qty:
                inventory_unchanged.append({
                    'inventory_id': existing_inv.get('id'),
                    'variant_id': variant.get('id'),
                    'warehouse_id': wh_id,
                    'warehouse_name': TARGET_WAREHOUSE_NAME,
                    'sku': sku,
                    'product_name': product_name,
                    'quantity': available_qty,
                    'daily_sales': daily_sales,
                    'estimated_days': estimated_days,
                })
            else:
                inventory_updates.append({
                    'inventory_id': existing_inv.get('id'),
                    'variant_id': variant.get('id'),
                    'warehouse_id': wh_id,
                    'warehouse_name': TARGET_WAREHOUSE_NAME,
                    'sku': sku,
                    'product_name': product_name,
                    'old_quantity': old_qty,
                    'new_quantity': available_qty,
                    'delta': available_qty - old_qty,
                    'daily_sales': daily_sales,
                    'estimated_days': estimated_days,
                })

    return {
        'warehouse_rename_required': rename_plan,
        'new_variants': new_variants,
        'inventory_inserts': inventory_inserts,
        'inventory_updates': inventory_updates,
        'inventory_unchanged': inventory_unchanged,
        'inventory_after_variant_create': inventory_after_variant_create,
        'rejected_rows': rejected_rows,
    }


def _plan_warehouse_rename(warehouse: dict | None) -> dict | None:
    """生成 Warehouse 改名计划。

    规则：
    - 找不到 PH overseas warehouse → None（上游已抛异常）
    - 名称已是目标名称 → 返回 {'action': 'none', ...}
    - 名称是旧名称 '菲律宾仓' → 返回 {'action': 'rename', ...}
    - 其他未知名称 → 抛出 RuntimeError（不允许自动推测）
    """
    if warehouse is None:
        return None

    current_name = (warehouse.get('name') or '').strip()

    if current_name == TARGET_WAREHOUSE_NAME:
        return {
            'action': 'none',
            'warehouse_id': warehouse.get('id'),
            'current_name': current_name,
            'message': f'仓库名称已是 "{TARGET_WAREHOUSE_NAME}"，无需改名',
        }

    if current_name == OLD_WAREHOUSE_NAME:
        return {
            'action': 'rename',
            'warehouse_id': warehouse.get('id'),
            'current_name': current_name,
            'target_name': TARGET_WAREHOUSE_NAME,
            'message': f'复用原 warehouse ID {warehouse.get("id")}，'
                       f'名称从 "{OLD_WAREHOUSE_NAME}" 改为 "{TARGET_WAREHOUSE_NAME}"',
        }

    # 未知名称 — 必须失败
    raise RuntimeError(
        f'Warehouse 名称为未知值 "{current_name}"，'
        f'仅允许 "{OLD_WAREHOUSE_NAME}" 或 "{TARGET_WAREHOUSE_NAME}"。'
        f'无法自动规划改名。请检查数据库 warehouse 记录。'
    )
