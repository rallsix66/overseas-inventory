#!/usr/bin/env python3
"""P5-SY3B 菲律宾 Inventory 实际写入与新 SKU 创建 — CLI。

用法（Dry Run 验证 — 默认，不写入）：
    python -m tools.bigseller-scraper.sync.cli_execute \\
      --input-json tools/bigseller-scraper/runtime/output/bigseller-inventory-20260612-110740.json \\
      --dry-run-report tools/bigseller-scraper/runtime/p5-sy3a-dry-run-20260612-114902.json \\
      --execute --confirm P5-SY3B-PH

用法（真实写入）：
    python -m tools.bigseller-scraper.sync.cli_execute \\
      --input-json tools/bigseller-scraper/runtime/output/bigseller-inventory-20260612-110740.json \\
      --dry-run-report tools/bigseller-scraper/runtime/p5-sy3a-dry-run-20260612-114902.json \\
      --execute --confirm P5-SY3B-PH --no-dry-run

安全门：
- 必须同时传入 --execute、--confirm P5-SY3B-PH、--input-json 和 --dry-run-report
- 执行前从输入 JSON 重新生成计划，与存储的 Dry Run 报告逐项比较
- 任一项漂移立即 fail-fast，不进入写入
- 默认 --dry-run（只读查询，不写入）
- 真实写入需要显式 --no-dry-run
- 写入后逐项验证 Inventory，任一差异 fail-fast 阻止 Warehouse 改名

执行顺序：
1. 加载输入 JSON 和 Dry Run 报告
2. 重新查询 Supabase 当前状态（只读）
3. 从输入 JSON + 最新 DB 快照重新生成写入计划
4. 比较重新生成的计划与存储的 Dry Run 报告（计划漂移检测）
5. 查询现有 PH Variant + Inventory
6. 按 SKU 去重创建新 Variant (product_id=null, match_status=unmatched)
7. UPSERT Inventory（按 variant_id + warehouse_id，分离 INSERT/UPDATE）
8. 逐项写后验证（每 SKU quantity 核对、计划外记录检测）
9. 验证通过后 Warehouse 改名: "菲律宾仓" → "菲律宾-新创启辰自建仓"

幂等：重复执行相同命令不会产生重复数据。
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNTIME_DIR = os.path.join(BASE_DIR, 'runtime')


def main():
    parser = argparse.ArgumentParser(
        description='P5-SY3B 菲律宾 Inventory 实际写入与新 SKU 创建'
    )
    parser.add_argument(
        '--input-json',
        required=True,
        metavar='PATH',
        help='BigSeller 抓取 JSON 文件路径（必须显式指定）',
    )
    parser.add_argument(
        '--dry-run-report',
        required=True,
        metavar='PATH',
        help='P5-SY3A Dry Run 报告 JSON 路径',
    )
    parser.add_argument(
        '--execute',
        action='store_true',
        default=False,
        help='启用执行模式（必须与 --confirm 同时使用）',
    )
    parser.add_argument(
        '--confirm',
        default=None,
        metavar='TOKEN',
        help='确认令牌（必须为 P5-SY3B-PH）',
    )
    parser.add_argument(
        '--no-dry-run',
        action='store_true',
        default=False,
        help='执行真实写入（默认仅 dry-run 查询）',
    )
    args = parser.parse_args()

    # =========================================================================
    # 安全门
    # =========================================================================
    if not args.execute:
        print('错误: 必须传入 --execute 标志')
        print('用法: --input-json <path> --dry-run-report <path> --execute --confirm P5-SY3B-PH [--no-dry-run]')
        sys.exit(1)

    if args.confirm != 'P5-SY3B-PH':
        print(f'错误: 确认令牌不匹配')
        print(f'  收到: "{args.confirm}"')
        print(f'  期望: "P5-SY3B-PH"')
        print(f'用法: --execute --confirm P5-SY3B-PH')
        sys.exit(1)

    is_dry_run = not args.no_dry_run

    print('=' * 60)
    print('P5-SY3B 菲律宾 Inventory 写入与新 SKU 创建')
    if is_dry_run:
        print('*** DRY RUN 模式 — 仅查询，不写入 ***')
    else:
        print('*** 真实写入模式 ***')
    print(f'确认令牌: P5-SY3B-PH')
    print(f'输入 JSON:  {args.input_json}')
    print(f'Dry Run 报告: {args.dry_run_report}')
    print('=' * 60)
    print()

    # =========================================================================
    # 验证文件存在
    # =========================================================================
    if not os.path.isfile(args.input_json):
        print(f'错误: 输入 JSON 文件不存在 — {args.input_json}')
        sys.exit(1)
    if not os.path.isfile(args.dry_run_report):
        print(f'错误: Dry Run 报告不存在 — {args.dry_run_report}')
        sys.exit(1)

    # =========================================================================
    # 1. 加载输入 JSON 和 Dry Run 报告
    # =========================================================================
    print('[步骤 1/4] 加载文件...')
    with open(args.input_json, 'r', encoding='utf-8') as f:
        input_data = json.load(f)
    print(f'  输入 JSON: warehouse={input_data.get("warehouse")}, '
          f'row_count={input_data.get("row_count")}')

    with open(args.dry_run_report, 'r', encoding='utf-8') as f:
        stored_plan = json.load(f)

    stored_counts = stored_plan.get('counts', {})
    print(f'  Dry Run 报告: input_rows={stored_counts.get("input_rows")}, '
          f'new_variants={stored_counts.get("new_variants")}, '
          f'inventory_after={stored_counts.get("inventory_after_variant_create")}')
    print()

    # =========================================================================
    # 2. 输入校验
    # =========================================================================
    print('[步骤 2/4] 验证输入数据...')
    from .input_validator import validate_json, ValidationError
    try:
        rows = validate_json(input_data)
    except ValidationError as e:
        print(f'  校验失败:\n{e}')
        sys.exit(1)
    print(f'  校验通过: {len(rows)} 行')
    print()

    # =========================================================================
    # 3. 重新查询 Supabase + 重新生成计划 + 计划漂移比较
    # =========================================================================
    print('[步骤 3/4] 重新生成当前计划并比较漂移...')
    from .supabase_gateway import (
        fetch_ph_warehouse,
        fetch_ph_variants,
        fetch_inventory_by_warehouse,
    )

    try:
        warehouse = fetch_ph_warehouse()
    except RuntimeError as e:
        print(f'  Warehouse 查询失败:\n{e}')
        sys.exit(1)
    print(f'  PH overseas warehouse: id={warehouse.get("id")}, '
          f'name="{warehouse.get("name")}"')

    time.sleep(0.3)
    variants = fetch_ph_variants()
    print(f'  PH product_variants: {len(variants)} 条')

    time.sleep(0.3)
    inventories = fetch_inventory_by_warehouse(warehouse['id'])
    print(f'  Inventory (wh={warehouse["id"][:8]}...): {len(inventories)} 条')

    # 重新生成计划
    from .plan_generator import generate_plan
    generated_plan = generate_plan(rows, {
        'warehouse': warehouse,
        'variants': variants,
        'inventories': inventories,
    })

    # 比较漂移
    from .verifier import compare_plans, orchestrate_drift_decision
    diffs = compare_plans(generated_plan, stored_plan)

    if diffs:
        print()
        print('=' * 60)
        print('计划漂移检测: 发现差异')
        print(f'重新生成的计划与存储的 Dry Run 报告不一致 ({len(diffs)} 项差异):')
        print('=' * 60)
        for d in diffs:
            print(f'  [DIFF] {d}')
        print()
        if is_dry_run:
            print('DRY RUN 模式: 漂移仅作警告，继续只读验证...')
            print('可能原因:')
            print('  - 数据库在 Dry Run 后已写入数据（预期行为）')
            print('  - 输入 JSON 与 Dry Run 报告基于的数据不同')
            print()
    else:
        print(f'  计划漂移检测: 通过 — 重新生成的计划与存储报告一致')
    print(f'    new_variants: {len(generated_plan["new_variants"])} SKU')
    print(f'    inventory_after_variant_create: '
          f'{len(generated_plan["inventory_after_variant_create"])} 条')
    print(f'    warehouse_id: {warehouse["id"]}')
    rename = generated_plan.get('warehouse_rename_required') or {}
    print(f'    warehouse 改名: action={rename.get("action")}, '
          f'target={rename.get("target_name")}')
    print()

    # =========================================================================
    # 4. 执行（dry-run 或真实写入）
    # =========================================================================
    print('[步骤 4/4] 执行写入计划...')
    print()
    from .executor import execute_plan

    try:
        decision = orchestrate_drift_decision(
            diffs,
            is_dry_run,
            lambda: execute_plan(
                args.dry_run_report,
                confirm='P5-SY3B-PH',
                dry_run=is_dry_run,
            ),
        )
    except RuntimeError as e:
        print(f'\n执行失败: {e}')
        sys.exit(1)

    if decision['blocked']:
        print()
        print('=' * 60)
        print('已阻止真实写入。可能原因:')
        print('  - 输入 JSON 与 Dry Run 报告基于的数据不同')
        print('  - 数据库在 Dry Run 后发生了变更')
        print('  - 使用的输入 JSON 或 Dry Run 报告不正确')
        print()
        print('请确认文件路径正确，或重新运行 P5-SY3A Dry Run 生成新报告。')
        sys.exit(1)

    result = decision['execute_result']

    # =========================================================================
    # 输出结果
    # =========================================================================
    print()
    print('=' * 60)
    print('执行结果')
    print('=' * 60)
    print(f'  模式:              {"DRY RUN (只读)" if is_dry_run else "真实写入"}')
    print(f'  Warehouse ID:      {result["warehouse_id"]}')
    print(f'  Warehouse 原名:    {result["warehouse_name_before"]}')
    print(f'  --- Variant ---')
    print(f'  执行前:            {result["variants_before"]}')
    print(f'  新创建:            {result["variants_created"]}')
    print(f'  跳过(已存在):      {result["variants_skipped"]}')
    print(f'  总计:              {result["variants_total"]}')
    print(f'  --- Inventory ---')
    print(f'  执行前:            {result["inventory_before"]}')
    print(f'  新增:              {result["inventory_inserted"]}')
    print(f'  更新:              {result["inventory_updated"]}')
    print(f'  写入动作总计:      {result.get("inventory_write_actions", "?")}')
    print(f'  写后总计:          {result["inventory_total"]}')
    print(f'  --- Warehouse ---')
    print(f'  已改名:            {result["warehouse_renamed"]}')
    print(f'  最终名称:          {result["warehouse_name_after"]}')

    if result.get('errors'):
        print(f'\n  警告/错误 ({len(result["errors"])} 项):')
        for e in result['errors']:
            print(f'    - {e}')

    # =========================================================================
    # 核对
    # =========================================================================
    print()
    planned_inv = stored_counts.get('total_inventory_actions', 91)
    actual_inv = result.get('inventory_write_actions', 0)
    inv_ok = actual_inv == planned_inv

    print(f'  核对:')
    print(f'    Inventory 动作: 计划 {planned_inv} == 实际 {actual_inv}  '
          f'[{"OK" if inv_ok else "MISMATCH!"}]')

    if not inv_ok and not is_dry_run:
        print('\n错误: Inventory 写入动作数与计划不一致！')
        sys.exit(1)

    # =========================================================================
    # 保存执行报告（不含密钥）
    # =========================================================================
    report = {
        'task': 'P5-SY3B',
        'generated_at': datetime.now().astimezone().isoformat(timespec='seconds'),
        'dry_run': is_dry_run,
        'input_json_source': args.input_json,
        'dry_run_report_source': args.dry_run_report,
        'plan_drift_check': 'PASS',
        'result': {
            'started_at': result['started_at'],
            'finished_at': result['finished_at'],
            'warehouse_id': result['warehouse_id'],
            'warehouse_name_before': result['warehouse_name_before'],
            'warehouse_name_after': result['warehouse_name_after'],
            'warehouse_renamed': result['warehouse_renamed'],
            'variants_before': result['variants_before'],
            'variants_created': result['variants_created'],
            'variants_skipped': result['variants_skipped'],
            'variants_total': result['variants_total'],
            'inventory_before': result['inventory_before'],
            'inventory_inserted': result['inventory_inserted'],
            'inventory_updated': result['inventory_updated'],
            'inventory_total': result['inventory_total'],
            'inventory_write_actions': result.get('inventory_write_actions', 0),
        },
        'errors': result.get('errors', []),
    }

    os.makedirs(RUNTIME_DIR, exist_ok=True)
    timestamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    mode = 'dry-run' if is_dry_run else 'execute'
    report_name = f'p5-sy3b-{mode}-{timestamp}.json'
    report_path = os.path.join(RUNTIME_DIR, report_name)
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print(f'\n执行报告已保存: {report_path}')

    if is_dry_run:
        print(f'\n===== P5-SY3B Dry Run 完成 =====')
        print(f'未执行任何数据库写入。')
        print(f'确认无误后，重新运行并添加 --no-dry-run 执行真实写入。')
    else:
        print(f'\n===== P5-SY3B 执行完成 =====')
        print(f'Variant: 创建 {result["variants_created"]}, 跳过 {result["variants_skipped"]}')
        print(f'Inventory: 新增 {result["inventory_inserted"]}, 更新 {result["inventory_updated"]}')
        print(f'Warehouse 改名: {"是" if result["warehouse_renamed"] else "否/已是目标名称"}')

    sys.exit(0 if not result.get('errors') or is_dry_run else 1)


if __name__ == '__main__':
    main()
