"""P5-SY3B 执行器 — 幂等 Variant 创建 + Inventory UPSERT + Warehouse 改名。

使用 Supabase REST API + service_role key。
所有写入操作设计为可安全重跑（幂等）：
- ProductVariant: 按 (sku, country) 唯一约束，已存在则跳过，禁止覆盖 product_id/match_status
- Inventory: 按 (variant_id, warehouse_id) 唯一约束 UPSERT，更新 quantity/last_sync_at
- Warehouse: 仅按名称/id 精确 UPDATE

禁止：
- 覆盖已匹配 Variant 的 product_id / match_status
- 创建新 Warehouse
- 写 sync_log
"""
import json
import urllib.request
import urllib.error
import ssl
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

from .config import (
    TARGET_WAREHOUSE_NAME,
    OLD_WAREHOUSE_NAME,
)
from .verifier import verify_inventory_post_write, verify_warehouse_final_state


# =========================================================================
# 环境加载
# =========================================================================

def _load_env() -> dict:
    project_root = Path(__file__).resolve().parents[3]
    env_path = project_root / '.env.local'
    if not env_path.exists():
        raise RuntimeError(f'未找到 .env.local: {env_path}')

    env = {}
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '=' in line:
                key, _, value = line.partition('=')
                env[key.strip()] = value.strip().strip('"').strip("'")
    return env


_ENV = _load_env()
_SUPABASE_URL = _ENV.get('NEXT_PUBLIC_SUPABASE_URL', '')
_SERVICE_KEY = _ENV.get('SUPABASE_SERVICE_ROLE_KEY', '')

if not _SUPABASE_URL:
    raise RuntimeError('NEXT_PUBLIC_SUPABASE_URL 未在 .env.local 中配置')
if not _SERVICE_KEY:
    raise RuntimeError('SUPABASE_SERVICE_ROLE_KEY 未在 .env.local 中配置')

_BASE = f'{_SUPABASE_URL}/rest/v1'


# =========================================================================
# HTTP 工具
# =========================================================================

def _get(path: str, _retry: int = 2) -> list:
    """GET 请求 Supabase REST API，返回 list[dict]."""
    url = f'{_BASE}/{path}'
    last_error = None

    for attempt in range(_retry + 1):
        req = urllib.request.Request(url)
        req.add_header('apikey', _SERVICE_KEY)
        req.add_header('Authorization', f'Bearer {_SERVICE_KEY}')
        req.add_header('Accept', 'application/json')

        ctx = ssl.create_default_context()

        try:
            with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
                body = resp.read().decode('utf-8')
                data = json.loads(body)
                if isinstance(data, list):
                    return data
                if isinstance(data, dict):
                    return [data]
                return []
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', errors='replace')
            raise RuntimeError(
                f'Supabase GET 错误 ({e.code}): {e.url}\n{body[:500]}'
            ) from None
        except (urllib.error.URLError, OSError, ConnectionResetError) as e:
            last_error = e
            if attempt < _retry:
                time.sleep(1.0 * (attempt + 1))
                continue

    raise RuntimeError(f'Supabase 连接失败（重试 {_retry} 次后）: {last_error}') from None


def _post(path: str, body: list, upsert: bool = False, _retry: int = 2) -> list:
    """POST 请求 Supabase REST API，返回创建的记录列表."""
    url = f'{_BASE}/{path}'
    data = json.dumps(body).encode('utf-8')
    last_error = None

    for attempt in range(_retry + 1):
        req = urllib.request.Request(url, data=data, method='POST')
        req.add_header('apikey', _SERVICE_KEY)
        req.add_header('Authorization', f'Bearer {_SERVICE_KEY}')
        req.add_header('Content-Type', 'application/json')
        if upsert:
            req.add_header('Prefer', 'resolution=merge-duplicates,return=representation')
        else:
            req.add_header('Prefer', 'return=representation')

        ctx = ssl.create_default_context()

        try:
            with urllib.request.urlopen(req, context=ctx, timeout=60) as resp:
                body_text = resp.read().decode('utf-8')
                if body_text.strip():
                    data = json.loads(body_text)
                    if isinstance(data, list):
                        return data
                    if isinstance(data, dict):
                        return [data]
                return []
        except urllib.error.HTTPError as e:
            body_text = e.read().decode('utf-8', errors='replace')
            raise RuntimeError(
                f'Supabase POST 错误 ({e.code}): {e.url}\n{body_text[:500]}'
            ) from None
        except (urllib.error.URLError, OSError, ConnectionResetError) as e:
            last_error = e
            if attempt < _retry:
                time.sleep(1.0 * (attempt + 1))
                continue

    raise RuntimeError(f'Supabase POST 连接失败（重试 {_retry} 次后）: {last_error}') from None


def _patch(path: str, body: dict, _retry: int = 2) -> list:
    """PATCH 请求 Supabase REST API，返回更新的记录列表."""
    url = f'{_BASE}/{path}'
    data = json.dumps(body).encode('utf-8')
    last_error = None

    for attempt in range(_retry + 1):
        req = urllib.request.Request(url, data=data, method='PATCH')
        req.add_header('apikey', _SERVICE_KEY)
        req.add_header('Authorization', f'Bearer {_SERVICE_KEY}')
        req.add_header('Content-Type', 'application/json')
        req.add_header('Prefer', 'return=representation')

        ctx = ssl.create_default_context()

        try:
            with urllib.request.urlopen(req, context=ctx, timeout=60) as resp:
                body_text = resp.read().decode('utf-8')
                if body_text.strip():
                    data = json.loads(body_text)
                    if isinstance(data, list):
                        return data
                    if isinstance(data, dict):
                        return [data]
                return []
        except urllib.error.HTTPError as e:
            body_text = e.read().decode('utf-8', errors='replace')
            raise RuntimeError(
                f'Supabase PATCH 错误 ({e.code}): {e.url}\n{body_text[:500]}'
            ) from None
        except (urllib.error.URLError, OSError, ConnectionResetError) as e:
            last_error = e
            if attempt < _retry:
                time.sleep(1.0 * (attempt + 1))
                continue

    raise RuntimeError(f'Supabase PATCH 连接失败（重试 {_retry} 次后）: {last_error}') from None


# =========================================================================
# 执行核心
# =========================================================================

def execute_plan(
    dry_run_report_path: str,
    *,
    confirm: str,
    dry_run: bool = False,
) -> dict:
    """执行 Dry Run 报告中的写入计划。

    Args:
        dry_run_report_path: P5-SY3A dry run 报告 JSON 路径
        confirm: 确认令牌，必须等于 P5-SY3B-PH
        dry_run: True 时仅执行只读查询和分类，不写入

    Returns:
        执行报告 dict（不含密钥）

    Raises:
        RuntimeError: confirm 令牌不匹配或查询/写入失败
    """
    # 0. 安全门
    if confirm != 'P5-SY3B-PH':
        raise RuntimeError(
            f'确认令牌不匹配: 收到 "{confirm}"，期望 "P5-SY3B-PH"。'
            f'必须显式传入 --confirm P5-SY3B-PH 才能执行写入。'
        )

    # 1. 加载 Dry Run 报告
    report_path = Path(dry_run_report_path)
    if not report_path.exists():
        raise RuntimeError(f'Dry Run 报告不存在: {dry_run_report_path}')

    with open(report_path, 'r', encoding='utf-8') as f:
        plan = json.load(f)

    new_variants_plan = plan.get('new_variants', [])
    inventory_after = plan.get('inventory_after_variant_create', [])
    inventory_updates_plan = plan.get('inventory_updates', [])
    inventory_inserts_plan = plan.get('inventory_inserts', [])
    inventory_unchanged_plan = plan.get('inventory_unchanged', [])
    rename_plan = plan.get('warehouse_rename_required')

    warehouse_id = rename_plan.get('warehouse_id') if rename_plan else None
    if not warehouse_id:
        raise RuntimeError('Dry Run 报告中缺少 warehouse_id')

    # 构建完整库存预期计划（用于写入和验证）
    def _normalize_inventory_item(item: dict, wh_id: str) -> dict:
        """将不同格式的库存计划项标准化为 {sku, new_quantity, warehouse_id}"""
        return {
            'sku': item['sku'],
            'new_quantity': int(item.get('new_quantity', item.get('quantity', 0))),
            'warehouse_id': item.get('warehouse_id', wh_id),
        }

    # 完整库存预期（供 Phase G 验证使用，包含全部 98 条）
    full_inventory_plan = []
    for item in inventory_updates_plan:
        full_inventory_plan.append(_normalize_inventory_item(item, warehouse_id))
    for item in inventory_inserts_plan:
        full_inventory_plan.append(_normalize_inventory_item(item, warehouse_id))
    for item in inventory_unchanged_plan:
        full_inventory_plan.append(_normalize_inventory_item(item, warehouse_id))
    for item in inventory_after:
        full_inventory_plan.append(_normalize_inventory_item(item, warehouse_id))

    # 写入计划（供 Phase E/F 使用，排除 unchanged，只写需要变更的）
    inventory_write_plan = []
    for item in inventory_updates_plan:
        inventory_write_plan.append(_normalize_inventory_item(item, warehouse_id))
    for item in inventory_inserts_plan:
        inventory_write_plan.append(_normalize_inventory_item(item, warehouse_id))
    for item in inventory_after:
        inventory_write_plan.append(_normalize_inventory_item(item, warehouse_id))

    if not new_variants_plan and not inventory_write_plan:
        raise RuntimeError(
            'Dry Run 报告中 new_variants 和需要写入的 inventory '
            '(updates/inserts/after_variant_create) 均为空，无需执行'
        )

    result = {
        'started_at': datetime.now().astimezone().isoformat(timespec='seconds'),
        'dry_run': dry_run,
        'confirm_token': 'P5-SY3B-PH',
        'warehouse_id': warehouse_id,
        'warehouse_name_before': None,
        'variants_before': 0,
        'variants_created': 0,
        'variants_skipped': 0,
        'variants_total': 0,
        'inventory_before': 0,
        'inventory_inserted': 0,
        'inventory_updated': 0,
        'inventory_total': 0,
        'warehouse_renamed': False,
        'warehouse_name_after': None,
        'errors': [],
        'finished_at': None,
    }

    # =====================================================================
    # Phase A: 查询现状
    # =====================================================================

    # A1. 查询 Warehouse
    wh_rows = _get(
        f'warehouse?id=eq.{warehouse_id}'
        '&select=id,name,country,type,is_active'
    )
    if not wh_rows:
        raise RuntimeError(f'未找到 warehouse id={warehouse_id}')
    wh_current = wh_rows[0]
    result['warehouse_name_before'] = wh_current.get('name')
    print(f'[A1] Warehouse: id={warehouse_id}, name="{wh_current.get("name")}"')

    # A2. 查询现有 PH variants
    existing_variants = _get(
        'product_variant'
        '?select=id,sku,country,name,product_id,match_status'
        f'&country=eq.PH'
    )
    result['variants_before'] = len(existing_variants)
    existing_sku_map = {v['sku']: v for v in existing_variants}
    print(f'[A2] 现有 PH variants: {len(existing_variants)} 条')

    time.sleep(0.3)

    # A3. 查询现有 Inventory
    existing_inventory = _get(
        'inventory'
        '?select=id,variant_id,warehouse_id,quantity'
        f'&warehouse_id=eq.{warehouse_id}'
    )
    result['inventory_before'] = len(existing_inventory)
    existing_inv_set = {inv['variant_id'] for inv in existing_inventory}
    print(f'[A3] 现有 Inventory (wh={warehouse_id[:8]}...): {len(existing_inventory)} 条')

    # =====================================================================
    # Phase B: 分类 — 哪些 Variant 需要创建 / 跳过
    # =====================================================================
    to_create = []
    skipped_variants = []
    for nv in new_variants_plan:
        sku = nv['sku']
        if sku in existing_sku_map:
            ex = existing_sku_map[sku]
            skipped_variants.append({
                'sku': sku,
                'existing_id': ex['id'],
                'match_status': ex.get('match_status'),
                'product_id': ex.get('product_id'),
                'reason': '已存在，跳过（禁止覆盖 product_id / match_status）',
            })
        else:
            to_create.append({
                'sku': sku,
                'country': nv.get('country', 'PH'),
                'name': nv['name'],
                'product_id': None,
                'match_status': 'unmatched',
            })

    result['variants_created'] = 0  # 将在写入后更新
    result['variants_skipped'] = len(skipped_variants)
    print(f'[Phase B] 待创建 Variant: {len(to_create)}, 跳过(已存在): {len(skipped_variants)}')

    # =====================================================================
    # Phase C: 写入 Variant（仅当非 dry_run）
    # =====================================================================
    created_variant_map = {}  # sku → variant_id

    if dry_run:
        print('[Phase C] DRY RUN — 跳过 Variant 写入')
    elif to_create:
        BATCH_SIZE = 50
        for batch_start in range(0, len(to_create), BATCH_SIZE):
            batch = to_create[batch_start:batch_start + BATCH_SIZE]
            created = _post('product_variant', batch, upsert=False)
            for c in created:
                created_variant_map[c['sku']] = c['id']
            print(
                f'[Phase C] 批次 {batch_start // BATCH_SIZE + 1}: '
                f'创建 {len(created)}/{len(batch)} 条 Variant'
            )
            if batch_start + BATCH_SIZE < len(to_create):
                time.sleep(0.3)

        result['variants_created'] = len(created_variant_map)
        print(f'[Phase C] 共创建 Variant: {len(created_variant_map)} 条')
    else:
        print('[Phase C] 无需创建新 Variant（全部已存在）')

    # =====================================================================
    # Phase D: 构建完整 variant_id 映射
    # =====================================================================
    # 已有 variant → 直接复用 ID
    variant_id_by_sku = {}
    for sku, v in existing_sku_map.items():
        variant_id_by_sku[sku] = v['id']
    # 新建 variant → 使用创建返回的 ID
    variant_id_by_sku.update(created_variant_map)

    result['variants_total'] = len(variant_id_by_sku)
    print(f'[Phase D] variant_id 映射: {len(variant_id_by_sku)} 条 (已有 {len(existing_sku_map)} + 新建 {len(created_variant_map)})')

    # =====================================================================
    # Phase E: 构建 Inventory UPSERT 数据（含更新、新增、新变体库存）
    # =====================================================================
    now_iso = datetime.now().astimezone().isoformat(timespec='seconds')
    inventory_rows = []
    missing_variant_errors = []

    for item in inventory_write_plan:
        sku = item['sku']
        variant_id = variant_id_by_sku.get(sku)
        if not variant_id:
            missing_variant_errors.append(
                f'SKU "{sku}": 找不到 variant_id，无法创建 Inventory'
            )
            continue
        inventory_rows.append({
            'variant_id': variant_id,
            'warehouse_id': warehouse_id,
            'quantity': int(item['new_quantity']),
            'last_sync_at': now_iso,
        })

    # Phase E fail-fast: 任一 SKU 找不到 variant_id 立即终止
    if missing_variant_errors:
        error_detail = '\n'.join(f'  - {e}' for e in missing_variant_errors)
        raise RuntimeError(
            f'Phase E 失败: {len(missing_variant_errors)} 个 SKU 找不到 variant_id，'
            f'无法构建完整 Inventory 数据。终止以避免部分写入。\n{error_detail}'
        )

    print(f'[Phase E] 待 UPSERT Inventory: {len(inventory_rows)} 条')

    # 区分 INSERT vs UPDATE（用于计数）
    new_inv_count = sum(
        1 for r in inventory_rows
        if r['variant_id'] not in existing_inv_set
    )
    update_inv_count = len(inventory_rows) - new_inv_count
    print(f'[Phase E]   其中新增: {new_inv_count}, 更新: {update_inv_count}')

    # =====================================================================
    # Phase F: Inventory 写入 — 分 INSERT 和 UPDATE（仅当非 dry_run）
    # =====================================================================
    if dry_run:
        print('[Phase F] DRY RUN — 跳过 Inventory 写入')
        result['inventory_inserted'] = new_inv_count
        result['inventory_updated'] = update_inv_count
    elif inventory_rows:
        # 分离新增和更新
        to_insert_inv = [r for r in inventory_rows if r['variant_id'] not in existing_inv_set]
        to_update_inv = [r for r in inventory_rows if r['variant_id'] in existing_inv_set]

        BATCH_SIZE = 50
        inserted_count = 0
        updated_count = 0

        # INSERT 新记录
        for batch_start in range(0, len(to_insert_inv), BATCH_SIZE):
            batch = to_insert_inv[batch_start:batch_start + BATCH_SIZE]
            created = _post('inventory', batch, upsert=False)
            inserted_count += len(created)
            print(
                f'[Phase F] INSERT 批次 {batch_start // BATCH_SIZE + 1}: '
                f'{len(created)}/{len(batch)} 条'
            )
            if batch_start + BATCH_SIZE < len(to_insert_inv):
                time.sleep(0.3)

        # UPDATE 已有记录
        for batch_start in range(0, len(to_update_inv), BATCH_SIZE):
            batch = to_update_inv[batch_start:batch_start + BATCH_SIZE]
            for row in batch:
                _patch(
                    f'inventory?variant_id=eq.{row["variant_id"]}'
                    f'&warehouse_id=eq.{row["warehouse_id"]}',
                    {'quantity': row['quantity'], 'last_sync_at': row['last_sync_at']}
                )
                updated_count += 1
                time.sleep(0.1)
            print(
                f'[Phase F] UPDATE 批次 {batch_start // BATCH_SIZE + 1}: '
                f'{len(batch)} 条'
            )
            if batch_start + BATCH_SIZE < len(to_update_inv):
                time.sleep(0.3)

        result['inventory_inserted'] = inserted_count
        result['inventory_updated'] = updated_count
        total_written = inserted_count + updated_count
        print(f'[Phase F] 共写入 Inventory: INSERT {inserted_count} + UPDATE {updated_count} = {total_written}')
    else:
        print('[Phase F] Inventory 数据为空，跳过')
        result['inventory_inserted'] = 0
        result['inventory_updated'] = 0

    # =====================================================================
    # Phase G: 写后逐项验证 — 任一差异 fail-fast，禁止进入 Phase H
    # =====================================================================
    time.sleep(0.5)
    verify_inventory = _get(
        'inventory'
        '?select=id,variant_id,warehouse_id,quantity'
        f'&warehouse_id=eq.{warehouse_id}'
    )
    result['inventory_total'] = len(verify_inventory)
    print(f'[Phase G] 写后验证: Inventory 共 {len(verify_inventory)} 条')

    if not dry_run:
        # 重新查询 variant 映射以获取最新 ID（确保 verify 时映射完整）
        time.sleep(0.3)
        current_variants = _get(
            'product_variant'
            '?select=id,sku,country'
            f'&country=eq.PH'
        )
        current_variant_map = {v['sku']: v['id'] for v in current_variants}

        inv_diffs = verify_inventory_post_write(
            inventory_plan=full_inventory_plan,
            actual_inventory=verify_inventory,
            variant_id_by_sku=current_variant_map,
            warehouse_id=warehouse_id,
        )

        if inv_diffs:
            diff_text = '\n'.join(f'  - {d}' for d in inv_diffs)
            raise RuntimeError(
                f'Phase G 写后验证失败 — Inventory 数据不一致 '
                f'({len(inv_diffs)} 项差异):\n{diff_text}\n\n'
                f'已阻止 Warehouse 改名。数据库可能处于不一致状态，'
                f'请检查后重新运行。'
            )

        print(f'[Phase G] 逐项验证通过: '
              f'{len(full_inventory_plan)} 条 SKU quantity 全部一致，无计划外记录')

    # =====================================================================
    # Phase H: Warehouse 改名（仅当非 dry_run 且验证通过）
    # =====================================================================
    if rename_plan and rename_plan.get('action') == 'rename':
        current_name = wh_current.get('name', '')
        if current_name == OLD_WAREHOUSE_NAME:
            if dry_run:
                print(f'[Phase H] DRY RUN — 跳过 Warehouse 改名')
                result['warehouse_renamed'] = False
            else:
                _patch(
                    f'warehouse?id=eq.{warehouse_id}',
                    {'name': TARGET_WAREHOUSE_NAME}
                )
                result['warehouse_renamed'] = True
                print(
                    f'[Phase H] Warehouse 已改名: '
                    f'"{OLD_WAREHOUSE_NAME}" → "{TARGET_WAREHOUSE_NAME}"'
                )
        elif current_name == TARGET_WAREHOUSE_NAME:
            print(f'[Phase H] Warehouse 名称已是 "{TARGET_WAREHOUSE_NAME}"，无需改名')
            result['warehouse_renamed'] = False
        else:
            result['errors'].append(
                f'Warehouse 名称为未知值 "{current_name}"，跳过改名'
            )
            print(f'[Phase H] 错误: 未知 Warehouse 名称 "{current_name}"，跳过改名')
    else:
        print('[Phase H] 无需改名')

    # =====================================================================
    # Phase I: Warehouse 最终状态验证
    # =====================================================================
    wh_final_rows = _get(
        f'warehouse?id=eq.{warehouse_id}'
        '&select=id,name,country,type,is_active'
    )
    if not wh_final_rows:
        raise RuntimeError(
            f'Phase I 失败: 无法查询 Warehouse id={warehouse_id}（可能已被删除）'
        )

    wh_final = wh_final_rows[0]
    result['warehouse_name_after'] = wh_final.get('name')

    if not dry_run:
        wh_expected = {
            'id': warehouse_id,
            'name': TARGET_WAREHOUSE_NAME,
            'country': 'PH',
            'type': 'overseas',
            'is_active': True,
        }
        wh_diffs = verify_warehouse_final_state(wh_final, wh_expected)

        if wh_diffs:
            diff_text = '\n'.join(f'  - {d}' for d in wh_diffs)
            raise RuntimeError(
                f'Phase I 失败: Warehouse 最终状态不符合预期 '
                f'({len(wh_diffs)} 项差异):\n{diff_text}\n\n'
                f'PATCH 可能未生效或数据库状态异常，请检查后重新运行。'
            )

        print(f'[Phase I] Warehouse 最终状态验证通过: '
              f'id={wh_final["id"][:8]}..., '
              f'name="{wh_final["name"]}", '
              f'country={wh_final["country"]}, '
              f'type={wh_final["type"]}, '
              f'is_active={wh_final["is_active"]}')

    result['finished_at'] = datetime.now().astimezone().isoformat(timespec='seconds')

    # 计算汇总字段
    total_writes = result['inventory_inserted'] + result['inventory_updated']
    result['inventory_write_actions'] = total_writes

    return result


# =========================================================================
# 公开工具函数（供测试使用）
# =========================================================================

def classify_variants(
    new_variants_plan: list,
    existing_sku_map: dict,
) -> tuple:
    """纯函数：分类哪些 variant 需要创建/跳过。

    Args:
        new_variants_plan: Dry Run 中的 new_variants 列表
        existing_sku_map: {sku: variant_dict} 已有 variant 映射

    Returns:
        (to_create: list, skipped: list)
    """
    to_create = []
    skipped = []
    for nv in new_variants_plan:
        sku = nv['sku']
        if sku in existing_sku_map:
            ex = existing_sku_map[sku]
            skipped.append({
                'sku': sku,
                'existing_id': ex.get('id'),
                'match_status': ex.get('match_status'),
                'product_id': ex.get('product_id'),
                'reason': '已存在，跳过（禁止覆盖 product_id / match_status）',
            })
        else:
            to_create.append({
                'sku': sku,
                'country': nv.get('country', 'PH'),
                'name': nv.get('name', ''),
                'product_id': None,
                'match_status': 'unmatched',
            })
    return to_create, skipped


def build_inventory_upsert_rows(
    inventory_after: list,
    variant_id_by_sku: dict,
    warehouse_id: str,
) -> tuple:
    """纯函数：构建 Inventory UPSERT 数据。

    Args:
        inventory_after: Dry Run 中的 inventory_after_variant_create 列表
        variant_id_by_sku: {sku: variant_id} 映射
        warehouse_id: 目标仓库 UUID

    Returns:
        (inventory_rows: list, errors: list)
    """
    now_iso = datetime.now().astimezone().isoformat(timespec='seconds')
    inventory_rows = []
    errors = []

    for item in inventory_after:
        sku = item['sku']
        variant_id = variant_id_by_sku.get(sku)
        if not variant_id:
            errors.append(
                f'SKU "{sku}": 找不到 variant_id，无法创建 Inventory'
            )
            continue
        inventory_rows.append({
            'variant_id': variant_id,
            'warehouse_id': warehouse_id,
            'quantity': int(item['new_quantity']),
            'last_sync_at': now_iso,
        })

    return inventory_rows, errors
