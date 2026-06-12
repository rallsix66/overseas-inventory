# Current Task Packet

## Task ID

`P5-SY4B` — Migration 00006：事务型海外库存同步 RPC

## 状态

`AWAITING_REVIEW` — P5-SY4B 返工完成。Migration 00006（673 行）已修正：`quantity` 严格校验（非 null / JSON number / 严格整数拒绝 bool+float+字符串+超大值 / >= 0）移至步骤 5b，在所有 Variant/Inventory/Warehouse 写入前完成；SQL 注释测试场景 1 前置条件已修正（WM0074 已有 Inventory qty=21289 → UNCHANGED），可实际验算 inserted=1 / updated=1 / unchanged=1。禁止执行 Migration、连接 Supabase 执行 SQL 或真实数据库写入。禁止开始 P5-SY4C。

## 第一次独立验收（未通过 → 已修复）

### 阻塞项 1（已修复）：quantity 严格校验移至所有业务写入前

`quantity` 校验原在步骤 8（Variant INSERT 之后）。现已移至步骤 5b `p_inventory` 逐项校验循环内，在任何 Variant/Inventory/Warehouse 写入前完成四层校验：
- 字段存在且非 null（`v_item->'quantity' IS NULL`）
- JSON number 类型（`jsonb_typeof(v_item->'quantity') != 'number'` 拒绝 bool/string）
- 严格整数可解析（`::int` 在 BEGIN/EXCEPTION 中，拒绝 float 1.0 / 科学计数 / 超大值）
- `>= 0`

步骤 8 仅保留 `v_expected_qty := (v_item->>'quantity')::int` 并使用注释标注"已在步骤 5b 完成严格校验"。

### 阻塞项 2（已修复）：SQL 注释测试场景 1 前置条件修正

原前置条件 `WM0074` 无 Inventory → 产生 2 个 INSERT，无法得到 `inserted=1 / unchanged=1`。
修正：`WM0074` 已有 Inventory qty=21289，输入 quantity 同为 21289 → UNCHANGED。
可实际验算：ICEWM0039 INSERT（新 Variant + 新 Inventory）、WM0005 UPDATE（1500→1691）、WM0074 UNCHANGED（21289 不变）。
预期 `variants_created=1, inventory_received=3, inventory_inserted=1, inventory_updated=1, inventory_unchanged=1`。

### 新增测试场景

场景 16b：quantity 非严格整数 5 个子场景（float 1.5 / bool true / string "abc" / 超大值 9999999999 / null），全部在步骤 5b 抛出异常，零写入。

### 已确认

- 统一 `last_sync_at` 校验位于 Variant INSERT 前。
- Warehouse 行锁、`SECURITY INVOKER`、`search_path=''`、`public.` 限定和 REVOKE/GRANT 已实现。
- `python tools/bigseller-scraper/sync/test_plan.py`：26/26 PASS。
- 未执行 Migration，未发生真实数据库写入。

## 背景

现有同步执行器通过多个 REST 请求分批写入 Variant、Inventory 和 Warehouse，中途失败时无法回滚已提交请求。

P5-SY4A 已确认最小可靠方案：新增单个 PostgreSQL 事务 RPC，在同一事务内完成输入验证、Variant 创建、Inventory 三向写入、写后核对和 Warehouse 改名。完整设计与历次审查记录见：

- `docs/tasks/archive/p5-sy4a-design-review.md`

## 本 Task 唯一目标

创建但不执行：

- `supabase/migrations/00006_sync_warehouse_inventory.sql`

函数签名：

```sql
public.sync_warehouse_inventory(
  p_warehouse_id uuid,
  p_variants jsonb,
  p_inventory jsonb,
  p_warehouse_name text
) RETURNS jsonb
```

## 必须实现

1. `SECURITY INVOKER`、`SET search_path = ''`，所有对象使用 `public.` 限定。
2. `SELECT ... FOR UPDATE` 锁定目标 Warehouse，同仓同步串行执行。
3. 校验 Warehouse 存在、`type='overseas'`、`is_active=true`、`country='PH'`，名称仅允许旧名或正式名。
4. 校验 `p_variants` / `p_inventory` 为数组，且 `p_inventory` 非空。
5. 按 `(sku,country)` 检测 Variant 与 Inventory 输入重复。
6. 每个新 Variant 必须在 `p_inventory` 中有对应业务键。
7. 逐项校验 SKU、country，并保证 country 与 Warehouse 一致。
8. 在所有业务写入前解析首条 `last_sync_at` 为统一 `v_sync_at`，并校验全部时间非空、可解析且一致。
9. 幂等创建 Variant：`ON CONFLICT (sku, country) DO NOTHING`。
10. 事务内按 `(sku,country)` 解析 `variant_id`，校验 `quantity >= 0`。
11. Inventory 三向写入，全部使用统一 `v_sync_at`：INSERT、UPDATE、UNCHANGED metadata-only UPDATE。
12. 核对接收数量，并逐 SKU 查询核对最终 quantity 与 last_sync_at。
13. Warehouse 改名后重新核对 `id/country/type/is_active/name`。
14. 返回摘要：`variants_created`、`inventory_received`、`inventory_inserted`、`inventory_updated`、`inventory_unchanged`、`warehouse_renamed`。
15. 收紧权限：

```sql
REVOKE EXECUTE ON FUNCTION public.sync_warehouse_inventory(uuid, jsonb, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_warehouse_inventory(uuid, jsonb, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sync_warehouse_inventory(uuid, jsonb, jsonb, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sync_warehouse_inventory(uuid, jsonb, jsonb, text) TO service_role;
```

## SQL 测试说明

Migration 文件末尾使用注释记录至少 17 个验证场景，不执行测试 SQL。必须包括：

- INSERT + UPDATE + UNCHANGED 混合成功
- Warehouse 不存在、类型错误、停用、国家错误、名称错误
- Variant / Inventory 业务键重复
- 空 `p_inventory`
- 新 Variant 缺少对应 Inventory
- 跨国家输入
- variant_id 无法解析
- quantity 负数
- last_sync_at 为空、无法解析、同一快照时间不一致
- 写后核对失败
- 全部 Inventory unchanged 时刷新 last_sync_at
- anon / authenticated 无执行权限

## 本 Task 禁止

- 禁止执行 Migration 或连接 Supabase 执行 SQL
- 禁止真实数据库写入
- 禁止修改 `00001` 至 `00005`
- 禁止修改 Python executor 或 CLI
- 禁止开始 P5-SY4C
- 禁止新增表或在 RPC 内写 `sync_log`
- 禁止使用 `SECURITY DEFINER`
- 禁止无关重构

## 验收标准

- [ ] 仅新增 `00006_sync_warehouse_inventory.sql`
- [ ] SQL 实际执行顺序保证全部关键输入校验先于业务写入
- [ ] 失败通过 `RAISE EXCEPTION` 回滚整个事务
- [ ] 权限、schema 限定和并发锁完整
- [ ] Migration 文件包含至少 17 个注释形式测试场景
- [ ] 未执行 Migration，未发生真实数据库写入

## 停止条件

Migration 文件创建并完成静态审查后停止，等待独立验收。不得执行 Migration 或进入 P5-SY4C。
