"""P5-SY3B 验证器 — 计划漂移检测 + 写后逐项验证。

纯函数，供应商无关。不访问 Supabase 或任何外部服务。
"""


def compare_plans(generated: dict, stored: dict) -> list:
    """比较重新生成的计划与已存储的 Dry Run 报告。

    在真实写入前必须调用，检测输入数据或数据库快照是否漂移。
    任一差异即为漂移，必须 fail-fast。

    Args:
        generated: 从输入 JSON + 最新 DB 快照重新生成的计划
                   （plan_generator.generate_plan() 返回值）
        stored: 已存储的 P5-SY3A Dry Run 报告 JSON

    Returns:
        diffs: list[str]，每个元素是一条差异描述。空列表表示一致。
               差异类型包括：
               - Warehouse ID / action / target_name 不一致
               - new_variants SKU 集合、名称、target_quantity、country 不一致
               - inventory_after_variant_create SKU 集合、new_quantity、warehouse_id 不一致
               - 计数不一致
    """
    diffs = []

    # =========================================================================
    # 1. Warehouse 改名计划
    # =========================================================================
    gen_rename = generated.get('warehouse_rename_required') or {}
    stored_rename = stored.get('warehouse_rename_required') or {}

    gen_wh_id = gen_rename.get('warehouse_id')
    stored_wh_id = stored_rename.get('warehouse_id')
    if gen_wh_id != stored_wh_id:
        diffs.append(
            f'Warehouse ID 不一致: '
            f'生成={gen_wh_id}, 存储={stored_wh_id}'
        )

    gen_action = gen_rename.get('action')
    stored_action = stored_rename.get('action')
    if gen_action != stored_action:
        diffs.append(
            f'Warehouse 改名动作不一致: '
            f'生成={gen_action}, 存储={stored_action}'
        )

    gen_target = gen_rename.get('target_name')
    stored_target = stored_rename.get('target_name')
    if gen_target != stored_target:
        diffs.append(
            f'Warehouse 改名目标不一致: '
            f'生成={gen_target}, 存储={stored_target}'
        )

    # =========================================================================
    # 2. new_variants: SKU 集合、字段值
    # =========================================================================
    gen_variants = generated.get('new_variants', [])
    stored_variants = stored.get('new_variants', [])

    gen_v_by_sku = {v['sku']: v for v in gen_variants}
    stored_v_by_sku = {v['sku']: v for v in stored_variants}

    gen_sku_set = set(gen_v_by_sku.keys())
    stored_sku_set = set(stored_v_by_sku.keys())

    only_gen = gen_sku_set - stored_sku_set
    only_stored = stored_sku_set - gen_sku_set

    if only_gen:
        diffs.append(
            f'new_variants: 仅生成计划中有，存储报告中无 '
            f'({len(only_gen)} SKU): {sorted(only_gen)[:10]}'
            f'{"..." if len(only_gen) > 10 else ""}'
        )
    if only_stored:
        diffs.append(
            f'new_variants: 仅存储报告中有，生成计划中无 '
            f'({len(only_stored)} SKU): {sorted(only_stored)[:10]}'
            f'{"..." if len(only_stored) > 10 else ""}'
        )

    # 对共同 SKU 比较字段值
    common_v = gen_sku_set & stored_sku_set
    for sku in sorted(common_v):
        gv = gen_v_by_sku[sku]
        sv = stored_v_by_sku[sku]

        if gv.get('name') != sv.get('name'):
            diffs.append(
                f'new_variants[{sku}]: name 不一致 — '
                f'生成="{gv.get("name")}" vs 存储="{sv.get("name")}"'
            )
        if gv.get('target_quantity') != sv.get('target_quantity'):
            diffs.append(
                f'new_variants[{sku}]: target_quantity 不一致 — '
                f'生成={gv.get("target_quantity")} vs 存储={sv.get("target_quantity")}'
            )
        if gv.get('country') != sv.get('country'):
            diffs.append(
                f'new_variants[{sku}]: country 不一致 — '
                f'生成={gv.get("country")} vs 存储={sv.get("country")}'
            )

    # =========================================================================
    # 3. inventory_after_variant_create: SKU 集合、quantity、warehouse_id
    # =========================================================================
    gen_inv = generated.get('inventory_after_variant_create', [])
    stored_inv = stored.get('inventory_after_variant_create', [])

    gen_inv_by_sku = {item['sku']: item for item in gen_inv}
    stored_inv_by_sku = {item['sku']: item for item in stored_inv}

    gen_inv_sku_set = set(gen_inv_by_sku.keys())
    stored_inv_sku_set = set(stored_inv_by_sku.keys())

    only_gen_inv = gen_inv_sku_set - stored_inv_sku_set
    only_stored_inv = stored_inv_sku_set - gen_inv_sku_set

    if only_gen_inv:
        diffs.append(
            f'inventory_after_variant_create: 仅生成计划中有，存储报告中无 '
            f'({len(only_gen_inv)} SKU): {sorted(only_gen_inv)[:10]}'
            f'{"..." if len(only_gen_inv) > 10 else ""}'
        )
    if only_stored_inv:
        diffs.append(
            f'inventory_after_variant_create: 仅存储报告中有，生成计划中无 '
            f'({len(only_stored_inv)} SKU): {sorted(only_stored_inv)[:10]}'
            f'{"..." if len(only_stored_inv) > 10 else ""}'
        )

    # 对共同 SKU 比较 quantity 和 warehouse_id
    common_inv = gen_inv_sku_set & stored_inv_sku_set
    for sku in sorted(common_inv):
        gi = gen_inv_by_sku[sku]
        si = stored_inv_by_sku[sku]

        if gi.get('new_quantity') != si.get('new_quantity'):
            diffs.append(
                f'inventory[{sku}]: new_quantity 不一致 — '
                f'生成={gi.get("new_quantity")} vs 存储={si.get("new_quantity")}'
            )
        if gi.get('warehouse_id') != si.get('warehouse_id'):
            diffs.append(
                f'inventory[{sku}]: warehouse_id 不一致 — '
                f'生成={gi.get("warehouse_id")} vs 存储={si.get("warehouse_id")}'
            )

    # =========================================================================
    # 4. 计数比较
    # =========================================================================
    gen_counts = {
        'new_variants': len(gen_variants),
        'inventory_after_variant_create': len(gen_inv),
    }
    stored_counts = stored.get('counts', {})

    for key, gen_val in gen_counts.items():
        stored_val = stored_counts.get(key)
        if stored_val is not None and gen_val != stored_val:
            diffs.append(
                f'{key} 计数不一致: 生成={gen_val}, 存储={stored_val}'
            )

    return diffs


def verify_inventory_post_write(
    inventory_plan: list,
    actual_inventory: list,
    variant_id_by_sku: dict,
    warehouse_id: str,
) -> list:
    """逐项验证写入后的 Inventory 数据。

    必须在 Inventory 写入后、Warehouse 改名前调用。
    任一差异即为验证失败，必须 fail-fast 阻止 Warehouse 改名。

    Args:
        inventory_plan: inventory_after_variant_create 计划列表
                        （每条含 sku / new_quantity / warehouse_id）
        actual_inventory: 写后从数据库查询的实际 Inventory 列表
                          （每条含 variant_id / warehouse_id / quantity）
        variant_id_by_sku: {sku: variant_id} 完整映射（含已有 + 新建）
        warehouse_id: 目标仓库 UUID

    Returns:
        diffs: list[str]，每个元素是一条差异描述。空列表表示全部一致。
               差异类型包括：
               - SKU 找不到 variant_id
               - 数据库中缺少 Inventory 记录
               - quantity 与期望值不一致
               - 存在计划外的 Inventory 记录
               - 总数或总量不一致
    """
    diffs = []

    # 构建 actual 索引: variant_id → record
    actual_by_variant = {}
    for inv in actual_inventory:
        vid = inv.get('variant_id')
        if vid:
            actual_by_variant[vid] = inv

    actual_variant_ids = set(actual_by_variant.keys())

    # 构建计划 variant_id 集合
    planned_variant_ids = set()
    for item in inventory_plan:
        vid = variant_id_by_sku.get(item['sku'])
        if vid:
            planned_variant_ids.add(vid)

    total_expected_qty = 0
    total_actual_qty = sum(
        inv.get('quantity', 0) for inv in actual_inventory
    )

    missing_variant = []       # SKU 找不到 variant_id
    missing_inventory = []     # 数据库无此 variant 的 Inventory
    quantity_mismatch = []     # quantity 值不一致

    for item in inventory_plan:
        sku = item['sku']
        expected_qty = int(item['new_quantity'])
        expected_vid = variant_id_by_sku.get(sku)

        total_expected_qty += expected_qty

        if not expected_vid:
            missing_variant.append(sku)
            continue

        actual_inv = actual_by_variant.get(expected_vid)
        if actual_inv is None:
            missing_inventory.append(
                f'{sku} (variant_id={expected_vid[:8]}...): '
                f'期望 quantity={expected_qty}，数据库无此记录'
            )
            continue

        actual_qty = actual_inv.get('quantity', 0)
        if actual_qty != expected_qty:
            quantity_mismatch.append(
                f'{sku}: quantity 不一致 — '
                f'期望={expected_qty} vs 实际={actual_qty} '
                f'(差异={actual_qty - expected_qty})'
            )

    # --- 汇总差异 ---

    if missing_variant:
        diffs.append(
            f'找不到 variant_id ({len(missing_variant)} SKU): '
            f'{", ".join(missing_variant[:10])}'
            f'{"..." if len(missing_variant) > 10 else ""}'
        )

    if missing_inventory:
        diffs.append(
            f'数据库缺少 Inventory 记录 ({len(missing_inventory)} 条):'
        )
        for m in missing_inventory[:10]:
            diffs.append(f'  - {m}')
        if len(missing_inventory) > 10:
            diffs.append(f'  ... 及其他 {len(missing_inventory) - 10} 条')

    if quantity_mismatch:
        diffs.append(
            f'Inventory quantity 不一致 ({len(quantity_mismatch)} 条):'
        )
        for m in quantity_mismatch[:10]:
            diffs.append(f'  - {m}')
        if len(quantity_mismatch) > 10:
            diffs.append(f'  ... 及其他 {len(quantity_mismatch) - 10} 条')

    # 总数
    if len(actual_inventory) != len(inventory_plan):
        diffs.append(
            f'Inventory 总数不一致: '
            f'期望={len(inventory_plan)} vs 实际={len(actual_inventory)}'
        )

    # 总量
    if total_expected_qty != total_actual_qty:
        diffs.append(
            f'Inventory 总量不一致: '
            f'期望={total_expected_qty} vs 实际={total_actual_qty} '
            f'(差异={total_actual_qty - total_expected_qty})'
        )

    # 计划外记录（实际有但计划无）
    extra_vids = actual_variant_ids - planned_variant_ids
    if extra_vids:
        extra_info = []
        for vid in sorted(extra_vids)[:10]:
            inv = actual_by_variant[vid]
            extra_info.append(
                f'variant_id={vid[:8]}... quantity={inv.get("quantity")}'
            )
        diffs.append(
            f'存在计划外的 Inventory 记录 ({len(extra_vids)} 条): '
            f'{"; ".join(extra_info)}'
            f'{"..." if len(extra_vids) > 10 else ""}'
        )

    return diffs


# =========================================================================
# Warehouse 最终状态验证（Phase H 后纯函数）
# =========================================================================

def verify_warehouse_final_state(actual: dict, expected: dict) -> list:
    """验证 Warehouse 改名后的最终状态是否符合预期。

    必须在 Phase H Warehouse 改名后调用。
    任一字段不一致即返回差异列表，调用方应 fail-fast。

    Args:
        actual: 写后从数据库查询的 Warehouse 完整记录
                （含 id, name, country, type, is_active）
        expected: 期望的 Warehouse 状态
                  （含 id, name, country, type, is_active）

    Returns:
        diffs: list[str]，每个元素是一条差异描述。空列表表示全部一致。
               验证字段：id, name, country, type, is_active
    """
    diffs = []
    for field in ['id', 'name', 'country', 'type']:
        exp_val = expected.get(field)
        act_val = actual.get(field)
        if act_val != exp_val:
            diffs.append(
                f'Warehouse.{field}: '
                f'期望="{exp_val}" vs 实际="{act_val}"'
            )
    # is_active 单独比较（数据库可能返回 boolean 或多种形式）
    is_active = actual.get('is_active')
    if is_active is not True:
        diffs.append(
            f'Warehouse.is_active: 期望=True vs 实际={is_active!r}'
        )
    return diffs


# =========================================================================
# 计划漂移阻断决策（供 CLI 层使用）
# =========================================================================

def should_block_on_drift(diffs: list, is_dry_run: bool) -> bool:
    """判断计划漂移时是否应阻止执行。

    纯函数，供 CLI 和测试使用。不访问外部服务。

    Args:
        diffs: compare_plans() 返回的差异列表
        is_dry_run: 是否为 dry-run 模式

    Returns:
        True: 必须阻止执行（真实模式 + 存在漂移）
        False: 可以继续（dry-run 模式或无漂移）
    """
    if not diffs:
        return False
    if is_dry_run:
        return False
    return True


# =========================================================================
# 漂移决策到执行编排（供 CLI 层使用，纯函数可测试）
# =========================================================================

def orchestrate_drift_decision(diffs: list, is_dry_run: bool, execute_fn):
    """执行漂移决策：阻止执行或调用 execute_fn。

    将 CLI 中"漂移判断 → 是否调用 execute_plan()"的编排逻辑提取为纯函数，
    使 execute_plan() 是否被调用的行为边界可直接测试。

    纯函数，不访问 Supabase 或任何外部服务。
    execute_fn 仅在允许执行时被调用，调用方通过 spy/stub 即可验证行为。

    Args:
        diffs: compare_plans() 返回的差异列表
        is_dry_run: 是否为 dry-run 模式
        execute_fn: 零参数可调用对象，仅在允许执行时被调用

    Returns:
        dict:
        - blocked: True 表示已阻止执行，execute_fn 未被调用
        - execute_result: execute_fn 的返回值（blocked=False 时有效），
          blocked=True 时为 None
    """
    if should_block_on_drift(diffs, is_dry_run):
        return {'blocked': True, 'execute_result': None}
    return {'blocked': False, 'execute_result': execute_fn()}
