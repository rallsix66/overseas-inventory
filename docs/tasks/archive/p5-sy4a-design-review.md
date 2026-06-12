# Current Task Packet

## Task ID

`P5-SY4A` — SyncLog 与失败保留机制设计及执行边界确认

## 状态

`AWAITING_REVIEW` — 第六次返工完成。统一快照时间解析与全量一致性校验（步骤 6a/6b）已移至所有 Variant/Inventory/Warehouse 写入之前。等待第七次独立验收。禁止开始 P5-SY4B。

## 背景

P5-SY3B 已于 2026-06-12 通过第四次独立验收。菲律宾仓真实库存已录入，执行器具备幂等、写后验证、Warehouse 最终状态验证及计划漂移阻断能力。

现有 `sync_log` 表仅包含：

- `warehouse_id`
- `status`：`success` / `failed`
- `new_variants_count`
- `error_message`
- `started_at` / `finished_at`

当前执行器通过多个 REST 请求分批写入。若中途失败，可能已经产生部分数据库更新；仅补写失败日志不能证明“失败时保留上次成功数据”。

## 本 Task 目标

在开始真实实现前，核对现有执行流程并确定 P5-SY4 的最小可靠方案：

1. 明确哪些失败必须记录 `sync_log.failed`
2. 明确成功日志只能在全部写入和最终验证通过后记录
3. 明确如何保证失败时不留下部分 Inventory 更新
4. 明确 CLI 中日志记录、业务写入、最终验证的执行顺序
5. 产出可实施方案、测试方案和后续小任务拆分

## 必须核对

- `tools/bigseller-scraper/sync/executor.py`
- `tools/bigseller-scraper/sync/cli_execute.py`
- `tools/bigseller-scraper/sync/supabase_gateway.py`
- `supabase/migrations/00001_initial_schema.sql` 的 `sync_log` 表与 RLS
- `docs/project-overview.md` 的失败保留要求
- `docs/database-design.md`

## 关键决策

必须明确判断：

- 继续使用多个 Supabase REST 请求，能否真正保证失败保留
- 是否需要新增 PostgreSQL 事务 RPC 与新 Migration
- `sync_log` 应由事务内还是事务外写入
- 事务失败时如何可靠保留失败日志
- 网络中断、超时、部分批次成功和最终验证失败分别如何处理

不得把“写一条 failed 日志”等同于“保留上次成功数据”。

## 本 Task 允许

- 阅读代码、Migration 与相关文档
- 提取纯函数或增加不连接 Supabase 的测试原型
- 输出架构决策、风险、执行顺序和后续任务拆分
- 更新当前任务文档与状态文档

## 本 Task 禁止

- 禁止真实数据库写入
- 禁止执行 `--no-dry-run`
- 禁止新增或执行 Migration
- 禁止修改现有 Supabase 数据
- 禁止开始同步管理页面或定时任务
- 禁止扩展至其他海外仓
- 禁止无关重构

## 验收标准

- [ ] 明确当前执行器是否存在部分写入风险，并引用真实代码位置
- [ ] 给出满足“失败保留上次成功数据”的最小可靠实现方案
- [ ] 明确 SyncLog 成功与失败记录时机
- [ ] 明确是否需要新 Migration / 事务 RPC，并说明原因
- [ ] 给出覆盖成功、失败、部分执行、日志写入失败的测试矩阵
- [ ] 将后续实现拆成小范围任务，避免一次完成全部 P5-SY4
- [ ] 未发生真实数据库写入

---

## P5-SY4A 第六次独立验收结果（2026-06-12）

结论：**未通过。** 空快照校验已落实并通过纯函数测试，统一快照时间也已用于全部 Inventory 写入与写后核对；但 SQL 草案的执行顺序仍与”在任何业务写入前完成统一时间校验”的验收条件冲突。

### 已通过项

- `input_validator.py:validate_json()` 已在 `len(rows) == 0` 时抛出 `ValidationError`
- `test_plan.py` 已增加空 rows 测试，独立运行结果为 26/26 PASS
- SQL 草案已使用统一 `v_sync_at` 完成 Inventory INSERT / UPDATE / UNCHANGED 与写后核对
- 未创建 `00006` Migration，未发生真实数据库写入

### 阻塞项：统一快照时间校验仍晚于 Variant 业务写入

SQL 草案当前先在步骤 6 执行 `INSERT INTO public.product_variant`，随后才在步骤 7a/7b 解析并校验全部 `last_sync_at`。因此：

- 步骤 6 已发生 Variant 业务写入
- 步骤 7a 才开始统一快照时间解析
- “步骤 7a 在任何业务写入前完成”的注释、P5-SY4B 第 22 项要求和第五次返工验收清单与真实 SQL 顺序不一致

事务异常仍会回滚 Variant，不会产生已提交的部分数据；但本 Task 已明确要求先完成全部快照时间验证再开始业务写入，当前设计尚未满足解锁条件。

### 返工要求

- 将步骤 7a/7b 移到步骤 6 Variant INSERT 之前
- 保证统一快照时间解析与全量一致性校验在所有 Variant / Inventory / Warehouse 写入前完成
- 同步修正步骤编号、执行流程、P5-SY4B 验收描述与验收清单
- 保留步骤 7c 对统一 `v_sync_at` 的使用以及步骤 9 写后核对逻辑
- 禁止创建或执行 Migration，禁止真实数据库写入，禁止开始 P5-SY4B

### P5-SY4B 解锁条件

- SQL 草案真实执行顺序与”统一快照时间校验先于任何业务写入”一致
- 文档中的步骤编号、流程描述和验收清单与 SQL 草案一致
- 通过第七次独立设计验收
- 未创建或执行 Migration，未发生真实数据库写入

---

## P5-SY4A 设计审查 — 第六次返工版（2026-06-12）

> 第五次返工修复了 2 项设计与真实实现不一致（CLI 空快照拒绝 + 统一快照时间强制一致）。第六次验收发现执行顺序问题：统一快照时间解析与校验（旧步骤 7a/7b）仍在 Variant INSERT（旧步骤 6）之后执行，与”在任何业务写入前完成全量校验”的验收要求冲突。此版将统一快照时间解析与一致性校验移至所有业务写入之前（新步骤 6a/6b），Variant INSERT 后移至步骤 7。

### 与第五次返工版的关键差异

| # | 第五次返工问题 | 第六次返工修复 |
|---|---|---|
| 1 | SQL 步骤 6 先执行 Variant INSERT，步骤 7a/7b 才解析并校验统一快照时间，与”任何业务写入前完成校验”矛盾 | 步骤 6a/6b（统一快照时间解析与全量一致性校验）移至步骤 7（Variant INSERT）之前；步骤 8（Inventory 写入）紧随其后。所有业务写入（Variant/Inventory/Warehouse）均在统一快照时间校验完成后执行 |

### 执行顺序对照

| 步骤 | 第五次返工 | 第六次返工 |
|---|---|---|
| 统一时间解析 | 步骤 7a（在 Variant INSERT 之后） | **步骤 6a**（在任何业务写入之前） |
| 全量一致性校验 | 步骤 7b（在 Variant INSERT 之后） | **步骤 6b**（在任何业务写入之前） |
| Variant INSERT | 步骤 6（在校验之前） | **步骤 7**（在校验之后） |
| Inventory 写入 | 步骤 7c | **步骤 8**（使用统一 v_sync_at 步骤 6a） |
| 写后核对 | 步骤 9（引用步骤 7a） | **步骤 10**（引用步骤 6a） |

---

## P5-SY4A 第五次独立验收结果（2026-06-12）

结论：**未通过。第四次返工的 SQL 主路径已修复，但仍有两项设计与真实实现不一致。**

### 阻塞项 1：文档声称 CLI/input_validator 拒绝空快照，但真实代码仍接受

`tools/bigseller-scraper/sync/input_validator.py:35-95` 只验证 `rows` 是列表及计数一致，没有在 `len(rows) == 0` 时抛出 `ValidationError`。因此文档中的“CLI/input_validator 同步拒绝首仓 rows=[]”不是当前真实行为。

返工要求：

- 在 `validate_json()` 中明确拒绝 `rows=[]`
- 增加纯函数测试：空 rows 必须抛出 `ValidationError`
- 不连接 Supabase，不执行真实同步
- 文档必须区分“已经实现”与“留待后续 Task 实现”，不得把未来设计写成当前事实

### 阻塞项 2：同一次快照统一 `last_sync_at` 只写在清单中，SQL 未强制

SQL 草案逐条解析并使用每个 `p_inventory` 项自己的 `last_sync_at`，允许同一快照内不同 SKU 使用不同时间。当前没有变量保存首条快照时间，也没有检查后续条目必须相等。

返工要求：

- RPC 在任何业务写入前解析并验证全部 `p_inventory.last_sync_at`
- 以首条有效时间作为本次快照时间，后续任一条不同必须 `RAISE EXCEPTION`
- 所有 INSERT/UPDATE/UNCHANGED metadata-only UPDATE 使用统一快照时间
- 写后核对使用统一快照时间
- 增加“同一快照包含不同 last_sync_at，事务回滚”的 SQL 与测试矩阵场景

### P5-SY4B 解锁条件

- 真实 `validate_json()` 与纯函数测试已拒绝空 rows
- SQL 草案在写入前强制全部 `last_sync_at` 一致
- P5-SY4B 验收标准、SQL 测试方案和测试矩阵同步补充时间不一致场景
- 通过第六次独立设计验收
- 未创建或执行 Migration，未发生真实数据库写入

---

## P5-SY4A 第四次独立验收结果（2026-06-12）

结论：**未通过。第三次返工要求的完整库存快照、Variant-Inventory 关联校验和 service_role key 安全描述均已闭环，但仍有两个会影响真实同步可信度的阻塞项。**

### 阻塞项 1：空库存快照会被 RPC 当作成功同步

文档参数定义明确要求 `p_inventory` 必须非空，但 SQL 草案只检查其为 JSON 数组，没有检查 `jsonb_array_length(p_inventory) > 0`。现有 `validate_json()` 同样允许 `rows=[]`。

当抓取异常产生空结果时，RPC 会跳过全部 Inventory 循环，仍可能完成 Warehouse 核对并返回成功，随后写入 `sync_log.success`。这会把“未抓到任何库存”误报为一次可信同步。

返工要求：

- RPC 在任何写入前拒绝空 `p_inventory`，`v_inv_input_count = 0` 时 `RAISE EXCEPTION` 并回滚
- CLI/输入校验同样拒绝首仓空快照，避免无意义 RPC 调用
- 增加“空库存快照必须失败、零写入、不得记录 success”的 SQL 与 mock 测试

### 阻塞项 2：全部库存不变时 `inventory.last_sync_at` 不会刷新

SQL 草案在 `FOUND + quantity 相同` 时将记录归类为 `inventory_unchanged`，但完全跳过写入，因此载荷中的 `last_sync_at` 被忽略。海外库存页面和统计卡片直接使用 `inventory.last_sync_at` 展示最后同步时间；一次成功的无变化同步后，页面仍会显示旧时间。

返工要求：

- `UNCHANGED` 仍表示 quantity 未变化，但必须执行 metadata-only UPDATE，刷新 `last_sync_at`
- `inventory_unchanged` 计数保持不变，不计入 `inventory_updated`
- RPC 必须校验 `last_sync_at` 非空且可解析；同一次快照应使用同一个同步时间
- 写后核对同时验证 quantity 与 `last_sync_at`
- 场景“全部库存不变”预期改为 quantity 不变、`last_sync_at` 全部刷新、成功记录 SyncLog

### P5-SY4B 解锁条件

- SQL 草案和 P5-SY4B 验收标准明确拒绝空 `p_inventory`
- `UNCHANGED` 分支刷新并核对 `inventory.last_sync_at`
- SQL 测试方案和测试矩阵补充上述两个场景
- 通过第五次独立设计验收
- 未创建或执行 Migration，未发生真实数据库写入

---

## P5-SY4A 第三次独立验收结果（2026-06-12）

结论：**未通过。第二次返工的四项细节已闭环，但仍有两个正常业务场景缺口。**

### 阻塞项 1：正常“全部库存不变”同步会失败

当前 `_build_rpc_payload()` 设计明确排除 `inventory_unchanged`，同时 RPC 要求 `p_inventory` 必须非空。正常情况下，当 BigSeller 数据与数据库完全一致时，写入计划只有 `inventory_unchanged`，最终 `p_inventory=[]`，RPC 会抛出“不能为空数组”，无法记录一次成功的无变化同步。

返工要求：

- RPC 的 `p_inventory` 应表示本次来源的完整库存快照，而不是仅表示发生变化的写入动作
- `_build_rpc_payload()` 必须合并 `inventory_updates`、`inventory_inserts`、`inventory_after_variant_create` 和 `inventory_unchanged`
- 无变化同步仍应进入事务 RPC、完成完整性核对并返回成功摘要
- 返回摘要应区分 `inventory_received`、`inventory_inserted`、`inventory_updated`、`inventory_unchanged`
- 测试矩阵增加“全部库存不变，RPC 成功并写 success SyncLog”

### 阻塞项 2：可能提交没有 Inventory 的新 Variant

当前 `p_variants` 与 `p_inventory` 分别校验，但未验证两者关联。若 `p_variants` 含一个新 SKU，而 `p_inventory` 漏掉该业务键，RPC 会创建 Variant、处理其他 Inventory，并正常提交，留下无对应库存的新 Variant。

返工要求：

- 在任何写入前验证：每个 `p_variants` 的 `(sku,country)` 必须恰好存在于 `p_inventory`
- 缺少对应 Inventory 时必须 `RAISE EXCEPTION`，事务零写入
- `p_inventory` 可以包含已有 Variant 的业务键，因此不要求反向完全相等
- SQL 测试方案和测试矩阵增加“新 Variant 缺少对应 Inventory，必须回滚”

### 额外文档修正

“即使获取 service_role key 也因 REVOKE 无法调用”的描述不正确。持有 service_role key 的调用者具有 service_role 身份，且已被显式 GRANT。应改为：service_role key 必须仅存在于可信服务端或 CLI，泄露即等同于获得同步 RPC 权限。

### P5-SY4B 解锁条件

- 完整快照载荷能够处理全量不变同步（三向分类写入）
- 新 Variant 与 Inventory 关联完整性在写入前验证（步骤 4c）
- 测试矩阵补充上述两个场景（21 场景）
- 修正文档中的 service_role key 安全描述
- 通过第四次独立设计验收
- 未创建或执行 Migration，未发生真实数据库写入

---

## P5-SY4A 第二次独立验收结果（2026-06-12）

结论：**未通过。首次验收的四个方向已修正，但 SQL 草案仍可能正常提交错误数据。**

### 阻塞项 1：去重不是按业务键执行

草案使用 `jsonb_agg(DISTINCT value)`，它只会删除整段 JSON 完全相同的记录。相同 `(sku,country)` 但 `quantity`、`name` 或 `last_sync_at` 不同的两条记录仍会通过，随后同一库存被连续覆盖。

返工要求：

- `p_variants` 必须按 `(sku,country)` 检测重复
- `p_inventory` 必须按 `(sku,country)` 检测重复
- 相同业务键出现两次，无论其他字段是否相同，都必须在写入前抛错回滚

### 阻塞项 2：Warehouse 与输入国家、名称约束未落实

草案读取了 `v_wh_country`，但未验证 Variant/Inventory 的 `country` 必须等于 Warehouse country，也未限制 `p_warehouse_name` 和当前 Warehouse 名称。错误输入可能把其他国家 Variant 的 Inventory 写入 PH Warehouse，或把仓库改为任意名称。

返工要求：

- 每条 `p_variants.country` 和 `p_inventory.country` 必须等于锁定 Warehouse 的 country
- 目标 Warehouse country 必须为本任务允许的 `PH`
- 当前名称只允许旧名或正式目标名
- `p_warehouse_name` 必须非空且等于正式目标名
- 任一不符合必须在写入前抛错回滚

### 阻塞项 3：事务内“验证”仍主要是输入校验与计数器自增

`v_upserted` 在每次 INSERT 后直接自增，只能证明循环执行到结尾，不能证明数据库最终逐项 quantity 和 Warehouse 状态正确。草案也没有在 Warehouse UPDATE 后核对最终状态。

返工要求：

- UPSERT 后在事务内查询并核对每个 `(sku,country,warehouse_id)` 的最终 `quantity`
- 检测目标输入中缺失、无法解析或数量不一致的记录
- Warehouse UPDATE 后重新核对 `id/country/type/is_active/name`
- 任一差异必须 `RAISE EXCEPTION` 回滚
- 保留事务外二次审计，但不能用它替代事务内写后核对

### 阻塞项 4：REVOKE 后缺少显式 service_role 授权

草案称 service_role 无需显式 GRANT，但设计目标要求仅 service_role 可执行。REVOKE PUBLIC/anon/authenticated 后必须明确授予目标角色，不能依赖隐含权限假设。

返工要求：

```sql
REVOKE EXECUTE ON FUNCTION public.sync_warehouse_inventory(uuid, jsonb, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_warehouse_inventory(uuid, jsonb, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sync_warehouse_inventory(uuid, jsonb, jsonb, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sync_warehouse_inventory(uuid, jsonb, jsonb, text) TO service_role;
```

### P5-SY4B 解锁条件

- 修正完整 SQL 草案与 P5-SY4B 验收标准
- 测试矩阵增加：同业务键不同字段重复、跨国家输入、非法 Warehouse 名称、事务内写后核对失败、非 service_role 无执行权限
- 通过第三次独立设计验收
- 未创建或执行 Migration，未发生真实数据库写入

## 停止条件

完成设计与任务拆分后停止，等待独立验收和用户确认。不要直接开始实现数据库事务或 P5-SY4 后续子任务。

---

## P5-SY4A 设计审查 — 第五次返工版（2026-06-12）

> 第四次返工修正了 2 项可信度阻塞（拒绝空 p_inventory + UNCHANGED 刷新 last_sync_at）。第五次验收发现 2 项设计与真实实现不一致：真实 CLI `validate_json()` 仍接受空 rows、SQL 草案逐条接受不同 `last_sync_at` 未强制同一快照统一时间。此版逐一修复。

---

### 一、分批 REST 写入的部分写入风险位置（保持不变）

当前 `executor.py:execute_plan()` 通过多个独立 Supabase REST 请求完成写入。每个 `_post()`、`_patch()` 均为独立 HTTP 请求，**各自独立提交，无跨请求事务保护**。

| 风险位置 | 文件:行号 | 写入方式 | 风险说明 |
|---|---|---|---|
| Phase C Variant 批量创建 | `executor.py:363-374` | `_post('product_variant', batch)` 每批 ≤50 条，多批间 `sleep(0.3)` | 批次 1 成功 + 批次 2 失败 → 已创建的 Variant 无对应 Inventory，DB 残留孤立 Variant |
| Phase F INSERT 批量写入 | `executor.py:451-460` | `_post('inventory', batch)` 每批 ≤50 条，多批间 `sleep(0.3)` | 批次 1 成功 + 批次 2 失败 → 部分 Inventory 已写入，部分未写入 |
| Phase F UPDATE 逐条更新 | `executor.py:463-478` | `_patch('inventory?...')` **逐条** PATCH，每条间 `sleep(0.1)` | **最高风险**：91 条 = 91 个独立 HTTP 请求，中途崩溃则部分 quantity 已覆盖、部分仍为旧值 |
| Phase H Warehouse 改名 | `executor.py:540-543` | `_patch('warehouse?...')` 单次 PATCH | Phase C/F 均已提交，改名失败则 Inventory 已更新但 Warehouse 名未变 |

**结论**：当前架构在任何 REST 请求失败、网络中断或 Python 进程崩溃时，**已成功请求的写入不可回滚**，必然产生部分写入。

---

### 二、当前实现能否满足”同步失败时保留上一次成功库存数据”

**不能。** 原因：

1. `inventory` 表使用覆盖更新（`quantity = new_value`），无历史快照。一旦 Phase F UPDATE 的 `_patch()` 成功覆盖某条记录，旧 quantity 永久丢失。
2. 无事务边界：若 91 条 UPDATE 中第 45 条失败，前 44 条的 quantity 已被覆盖为新值，无法回退到旧值。
3. 当前 executor 未写 `sync_log`（P5-SY3B 明确禁止），无任何失败记录机制。

仅靠”幂等可重跑”无法解决此问题 — 重跑可以修正数据，但无法恢复已被覆盖的旧库存数据。如果新数据本身是错误的（如 BigSeller 页面返回异常值），部分覆盖后即使发现也无法回退。

**返工补充**：首次验收进一步指出，即使引入事务 RPC，若把关键验证放在事务提交后，验证失败时数据已提交，仍等价于”无法保留旧库存”。因此事务内验证是必要条件。

---

### 三、设计决策（返工修正）

#### 3.1 是否需要 PostgreSQL 事务 RPC 与新 Migration

**是，必须新增 Migration 和事务 RPC 函数。**

理由：
- Supabase REST API 不支持跨请求事务。每个 `POST/PATCH` 是独立提交。
- 要达到”失败保留上次成功数据”，必须在**单个 PostgreSQL 事务**内完成 Variant INSERT + Inventory UPSERT + Warehouse UPDATE，且**关键完整性验证必须在事务内、提交前完成**。
- 现有 Migration 序列最新为 `00005`，需新增 `00006`。

#### 3.2 事务 RPC 函数设计（返工修正）

**核心变更**：RPC 的 Inventory 输入不使用 `variant_id`，改用 `(sku, country)` 作为业务键。RPC 在事务内先创建/复用 Variant，再通过 `(sku, country)` 解析真实 `variant_id` 后写入 Inventory。

**输入参数**：

| 参数 | 类型 | 说明 |
|---|---|---|
| `p_warehouse_id` | `uuid` | 目标 Warehouse ID |
| `p_variants` | `jsonb` | `[{sku, country, name}]` — 待确保存在的 Variant（可空数组，幂等） |
| `p_inventory` | `jsonb` | `[{sku, country, quantity, last_sync_at}]` — 全部待写入 Inventory（必须非空） |
| `p_warehouse_name` | `text` | 目标 Warehouse 名称 |

**事务内完整流程**（13 步，任一步失败 → `RAISE EXCEPTION` → 全部回滚）：

```
1. SELECT ... FOR UPDATE 锁定 warehouse 行 → 串行化同仓并发
2. 校验 warehouse.country='PH' / type / is_active / name
   - name 仅允许旧名 "菲律宾仓" 或正式目标名 "菲律宾-新创启辰自建仓"
   - p_warehouse_name 必须非空且等于正式目标名
3. 输入校验：p_variants/p_inventory 非 NULL、为数组类型
   - p_inventory 为本次来源的完整库存快照（含 unchanged），非仅变化子集
   - p_inventory 必须非空：jsonb_array_length > 0（拒绝抓取异常产生的空快照）
4a. p_variants 按 (sku,country) 业务键检测重复（GROUP BY ... HAVING COUNT(*)>1）
4b. p_inventory 按 (sku,country) 业务键检测重复（同上）
    - 不用 jsonb_agg(DISTINCT value)（仅删除整段 JSON 相同记录）
4c. 新 Variant-Inventory 关联完整性校验：每个 p_variants 的 (sku,country)
    必须恰好存在于 p_inventory（不要求反向相等 — p_inventory 可含已有 Variant）
5a. 逐项校验 p_variants 各条 country == warehouse.country（防止跨国家写入）
5b. 逐项校验 p_inventory 各条 country == warehouse.country
6a. 解析统一快照时间：取 p_inventory 首条 last_sync_at → v_sync_at（在所有 Variant/Inventory/Warehouse 写入前完成）
    - 失败则 RAISE EXCEPTION，零写入
6b. 强制统一快照时间：遍历全部条目校验 last_sync_at 非空、可解析、且等于 v_sync_at
    - 同一次快照内任一 SKU 的 last_sync_at 与首条不同 → RAISE EXCEPTION（写入前校验，零写入）
7. Variant 创建/复用：INSERT … ON CONFLICT (sku, country) DO NOTHING（幂等）
8. 逐 SKU 解析 variant_id + quantity >= 0 + 三向分类写入（全部使用统一 v_sync_at 步骤 6a）
    - SELECT 当前 quantity → FOUND + 不同 → UPDATE quantity + last_sync_at（inventory_updated）
    - SELECT 当前 quantity → NOT FOUND → INSERT quantity + last_sync_at（inventory_inserted）
    - SELECT 当前 quantity → FOUND + 相同 → metadata-only UPDATE 仅刷新 last_sync_at（inventory_unchanged）
    - 每项均计入 inventory_received
9. 写入计数核对：v_received == p_inventory 输入条数
10. 事务内写后核对：逐 SKU SELECT 回 DB 核对最终 quantity 和 last_sync_at
   - 期望 last_sync_at 为统一快照时间 v_sync_at（步骤 6a）
   - 含 inventory_unchanged 项（确认未被并发修改 + last_sync_at 已刷新）
   - 检测缺失记录、无法解析、quantity 不一致、last_sync_at 不一致
11. Warehouse 改名：仅当当前名 != 目标名时 UPDATE
12. Warehouse 写后核对：SELECT 回 DB 核对 id/country/type/is_active/name
13. RETURN jsonb 摘要（含 inventory_received/inserted/updated/unchanged）
```

**与第四次返工版的关键差异**：

| # | 第四次返工问题 | 第五次返工修复 |
|---|---|---|
| 1 | 文档声称 CLI/input_validator 拒绝空快照，但真实 `validate_json()` 仍接受 `rows=[]` | `validate_json()` 新增 `len(rows)==0` → ValidationError；新增纯函数测试验证空 rows 被拒绝 |
| 2 | SQL 草案逐条接受不同 `last_sync_at`，同一快照内允许 SKU A 用 12:00、SKU B 用 12:01 写入 | 步骤 7a 在任何业务写入前解析首条 last_sync_at 为统一 v_sync_at；步骤 7b 遍历全部条目校验一致，任一条不同 → RAISE EXCEPTION 回滚；步骤 9 写后核对使用统一 v_sync_at |

**与第三次返工版的关键差异**：

| # | 第三次返工问题 | 第四次返工修复 |
|---|---|---|
| 1 | 空 `p_inventory`（抓取异常）→ 跳过全部 Inventory 循环 → Warehouse 核对通过 → 误记 success | 步骤 3 新增 `jsonb_array_length(p_inventory) = 0` → RAISE EXCEPTION 回滚；CLI 同步拒绝首仓 rows=[] |
| 2 | UNCHANGED 分支完全跳过写入 → `last_sync_at` 保留旧值 → 页面仍显示旧同步时间 | UNCHANGED 执行 metadata-only UPDATE 刷新 `last_sync_at`；新增 `last_sync_at` 非空/可解析校验；写后核对 quantity AND last_sync_at |

**与第二次返工版的关键差异（第三次已修复，此版保留）**：

| # | 第二次返工问题 | 第三次返工修复 |
|---|---|---|
| 1 | `_build_rpc_payload()` 排除 `inventory_unchanged`，无变化时 `p_inventory=[]` 被 RPC 拒绝 | `p_inventory` 为本次来源完整库存快照（合并全部四类）；RPC 内三向分类写入（INSERT/UPDATE/UNCHANGED） |
| 2 | `p_variants` 与 `p_inventory` 分别校验但未检查关联完整性 | 新增步骤 4c：每个 p_variants 的 `(sku,country)` 必须存在于 p_inventory，缺失则 RAISE EXCEPTION |
| 3 | 安全层描述"即使获取 service_role key 也因 REVOKE 无法调用"有误 | 修正为：service_role key 仅存在于可信服务端/CLI，泄露即获得同步 RPC 权限 |

**与第一次返工版的关键差异（第二次已修复，此版保留）**：

| # | 第一次返工问题 | 第二次返工修复 |
|---|---|---|
| 1 | 去重用 `jsonb_agg(DISTINCT value)` — 同 `(sku,country)` 不同字段仍通过 | 用 `GROUP BY sku,country HAVING COUNT(*) > 1` 逐业务键检测 |
| 2 | Warehouse 未校验 country='PH'、未限制名称、未校验输入 country 一致性 | 新增 country='PH' 校验、名称仅允许旧名/正式名、逐条 country == warehouse.country |
| 3 | 写后核对仅靠 `v_upserted` 计数器自增 — 只能证明循环跑完 | 新增步骤 9：逐 SKU SELECT 回 DB 核实 quantity；步骤 11：SELECT 核实 Warehouse 全字段 |
| 4 | REVOKE 后缺少显式 `GRANT ... TO service_role` | 新增显式 `GRANT EXECUTE ... TO service_role` |

**与初版草案的关键差异**（第一次返工已建立，后续保留）：

| 维度 | 初版草案 | 返工修正（第一+二+三+四次） |
|---|---|---|
| Inventory 输入 | `[{variant_id, warehouse_id, quantity}]` | `[{sku, country, quantity, last_sync_at}]` — 本次来源完整快照（含 unchanged），拒绝空数组 |
| variant_id 解析 | 调用方在 RPC 外解析 | RPC 事务内通过 `(sku, country)` 解析 |
| 去重 | 无 | 按 `(sku,country)` 业务键检测，任一重复即抛错 |
| 空快照防护 | 无 | 步骤 3：`jsonb_array_length = 0` → RAISE EXCEPTION（抓取异常不得误记 success） |
| Variant-Inventory 关联 | 无 | 步骤 4c：每个新 Variant 的 `(sku,country)` 必须存在于 p_inventory |
| Inventory 写入 | 单一 UPSERT | 三向分类：INSERT（新增）/ UPDATE（变更 quantity+last_sync_at）/ UNCHANGED（metadata-only UPDATE 刷新 last_sync_at） |
| last_sync_at 校验 | 无 | 步骤 6a/6b：首条解析为统一 v_sync_at（在任何业务写入前）+ 全部条目强制一致（在 Variant INSERT 前）；步骤 8 全部写入使用统一 v_sync_at；步骤 10 写后核对使用统一 v_sync_at |
| 验证位置 | Phase G/I 在 RPC 提交后（只读） | 13 步验证链全部在事务内、提交前（含写后 SELECT 核对） |
| 并发控制 | 无 | `SELECT ... FOR UPDATE` 锁定 warehouse |
| Warehouse 约束 | 仅 type / is_active | + country='PH' + 名称白名单 + 写后核对 |
| 权限 | 仅 `SECURITY INVOKER` | `SECURITY INVOKER` + `SET search_path = ''` + `public.` 限定 + REVOKE ALL + 显式 GRANT service_role |
| 返回摘要 | 无 | `variants_created` + `inventory_received/inserted/updated/unchanged` + `warehouse_renamed` |

**完整 RPC SQL 设计**（第六次返工 — 统一快照时间校验在所有业务写入前 + CLI 空快照拒绝）：

```sql
CREATE OR REPLACE FUNCTION public.sync_warehouse_inventory(
  p_warehouse_id   uuid,
  p_variants       jsonb,   -- [{sku, country, name}], 可空数组
  p_inventory      jsonb,   -- [{sku, country, quantity, last_sync_at}], 必须非空
  p_warehouse_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_wh_country        text;
  v_wh_type           text;
  v_wh_is_active      boolean;
  v_wh_name           text;
  v_dup_keys          jsonb;
  v_variant_count     int;
  v_inv_input_count   int;
  v_item              jsonb;
  v_sku               text;
  v_country           text;
  v_variant_id        uuid;
  v_created           int := 0;
  v_received          int := 0;
  v_inserted          int := 0;
  v_updated           int := 0;
  v_unchanged         int := 0;
  v_current_qty       int;
  v_expected_qty      int;
  v_actual_qty        int;
  v_sync_at           timestamptz;
  v_actual_sync_at    timestamptz;
  -- Warehouse 写后核对变量
  v_wh_id_ck          uuid;
  v_wh_country_ck     text;
  v_wh_type_ck        text;
  v_wh_active_ck      boolean;
  v_wh_name_ck        text;
BEGIN
  -- ============================================
  -- 1. 锁定目标 Warehouse 行（串行化同仓并发同步）
  -- ============================================
  SELECT country, type, is_active, name
  INTO v_wh_country, v_wh_type, v_wh_is_active, v_wh_name
  FROM public.warehouse
  WHERE id = p_warehouse_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Warehouse 不存在: %', p_warehouse_id
      USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 2. 校验 Warehouse 属性
  -- ============================================
  IF v_wh_type != 'overseas' THEN
    RAISE EXCEPTION 'Warehouse 类型错误: 期望 overseas, 实际 % (id=%)',
      v_wh_type, p_warehouse_id
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT v_wh_is_active THEN
    RAISE EXCEPTION 'Warehouse 已停用: %', p_warehouse_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Warehouse country 必须为 PH（本任务仅含菲律宾仓；后续仓需对应调整）
  IF v_wh_country != 'PH' THEN
    RAISE EXCEPTION 'Warehouse country 必须为 PH, 实际: %', v_wh_country
      USING ERRCODE = 'P0001';
  END IF;

  -- 当前名称只允许旧名或正式目标名（阻止任意名称写入，杜绝非法改名）
  IF v_wh_name NOT IN ('菲律宾仓', '菲律宾-新创启辰自建仓') THEN
    RAISE EXCEPTION 'Warehouse 名称非法: 当前名=%, 仅允许旧名或正式目标名',
      v_wh_name
      USING ERRCODE = 'P0001';
  END IF;

  -- p_warehouse_name 必须非空且等于正式目标名
  IF p_warehouse_name IS NULL OR p_warehouse_name = '' THEN
    RAISE EXCEPTION 'p_warehouse_name 不能为空' USING ERRCODE = 'P0001';
  END IF;

  IF p_warehouse_name != '菲律宾-新创启辰自建仓' THEN
    RAISE EXCEPTION 'p_warehouse_name 必须为正式目标名, 实际: %', p_warehouse_name
      USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 3. 输入类型校验
  --    p_inventory 为本次来源的完整库存快照（含 unchanged），非仅变化子集
  -- ============================================
  IF p_variants IS NULL OR jsonb_typeof(p_variants) != 'array' THEN
    RAISE EXCEPTION 'p_variants 必须为 JSON 数组' USING ERRCODE = 'P0001';
  END IF;

  IF p_inventory IS NULL OR jsonb_typeof(p_inventory) != 'array' THEN
    RAISE EXCEPTION 'p_inventory 必须为 JSON 数组' USING ERRCODE = 'P0001';
  END IF;

  v_inv_input_count := jsonb_array_length(p_inventory);
  IF v_inv_input_count = 0 THEN
    RAISE EXCEPTION 'p_inventory 不能为空数组（抓取异常或输入错误，不得记录为成功同步）'
      USING ERRCODE = 'P0001';
  END IF;

  v_variant_count := jsonb_array_length(p_variants);

  -- ============================================
  -- 4. 业务键 (sku, country) 去重检测
  --    相同业务键出现两次，无论其他字段是否不同，必须抛错回滚
  --    不使用 jsonb_agg(DISTINCT value)（仅删除整段 JSON 相同记录）
  -- ============================================

  -- 4a. p_variants 按 (sku, country) 检测重复
  IF v_variant_count > 0 THEN
    WITH dup_check AS (
      SELECT
        value->>'sku' AS sku,
        value->>'country' AS country,
        COUNT(*) AS cnt
      FROM jsonb_array_elements(p_variants)
      GROUP BY 1, 2
      HAVING COUNT(*) > 1
    )
    SELECT jsonb_agg(jsonb_build_object(
      'sku', sku, 'country', country, 'count', cnt
    ))
    INTO v_dup_keys
    FROM dup_check;

    IF v_dup_keys IS NOT NULL THEN
      RAISE EXCEPTION 'p_variants 含重复 (sku,country) 业务键: %', v_dup_keys
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 4b. p_inventory 按 (sku, country) 检测重复
  WITH dup_check AS (
    SELECT
      value->>'sku' AS sku,
      value->>'country' AS country,
      COUNT(*) AS cnt
    FROM jsonb_array_elements(p_inventory)
    GROUP BY 1, 2
    HAVING COUNT(*) > 1
  )
  SELECT jsonb_agg(jsonb_build_object(
    'sku', sku, 'country', country, 'count', cnt
  ))
  INTO v_dup_keys
  FROM dup_check;

  IF v_dup_keys IS NOT NULL THEN
    RAISE EXCEPTION 'p_inventory 含重复 (sku,country) 业务键: %', v_dup_keys
      USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 4c. 新 Variant-Inventory 关联完整性校验
  --     每个 p_variants 的 (sku,country) 必须恰好存在于 p_inventory
  --     不要求反向相等：p_inventory 可含已有 Variant 的业务键
  --     任一缺失 → RAISE EXCEPTION 回滚（写入前校验）
  -- ============================================
  IF v_variant_count > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_variants)
    LOOP
      v_sku := v_item->>'sku';
      v_country := v_item->>'country';

      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_inventory) AS inv
        WHERE inv->>'sku' = v_sku AND inv->>'country' = v_country
      ) THEN
        RAISE EXCEPTION '新 Variant 缺少对应 Inventory: sku=%, country=%',
          v_sku, v_country
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END IF;

  -- ============================================
  -- 5. 逐项校验 country 与 Warehouse country 一致 + 字段非空
  --    防止其他国家 Variant/Inventory 被写入 PH Warehouse
  --    任一不符合 → RAISE EXCEPTION 回滚（写入前校验）
  -- ============================================

  -- 5a. p_variants: 逐项校验
  IF v_variant_count > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_variants)
    LOOP
      v_sku := v_item->>'sku';
      v_country := v_item->>'country';

      IF v_sku IS NULL OR v_sku = '' THEN
        RAISE EXCEPTION 'Variant SKU 不能为空' USING ERRCODE = 'P0001';
      END IF;

      IF v_country IS NULL OR v_country = '' THEN
        RAISE EXCEPTION 'Variant country 不能为空 (sku: %)', v_sku
          USING ERRCODE = 'P0001';
      END IF;

      IF v_country != v_wh_country THEN
        RAISE EXCEPTION 'Variant country 必须等于 Warehouse country: variant=%, warehouse=% (sku: %)',
          v_country, v_wh_country, v_sku
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END IF;

  -- 5b. p_inventory: 逐项校验
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_inventory)
  LOOP
    v_sku := v_item->>'sku';
    v_country := v_item->>'country';

    IF v_sku IS NULL OR v_sku = '' THEN
      RAISE EXCEPTION 'Inventory SKU 不能为空' USING ERRCODE = 'P0001';
    END IF;

    IF v_country IS NULL OR v_country = '' THEN
      RAISE EXCEPTION 'Inventory country 不能为空 (sku: %)', v_sku
        USING ERRCODE = 'P0001';
    END IF;

    IF v_country != v_wh_country THEN
      RAISE EXCEPTION 'Inventory country 必须等于 Warehouse country: inventory=%, warehouse=% (sku: %)',
        v_country, v_wh_country, v_sku
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- ============================================
  -- 6a. 解析统一快照时间（在任何业务写入前完成）
  --     在所有 Variant/Inventory/Warehouse 写入之前，以 p_inventory 首条 last_sync_at
  --     作为本次统一快照时间。后续任一条不同 → RAISE EXCEPTION 回滚（零写入）
  -- ============================================
  BEGIN
    SELECT (value->>'last_sync_at')::timestamptz
    INTO v_sync_at
    FROM jsonb_array_elements(p_inventory)
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION '首条 last_sync_at 无法解析为 timestamptz: %',
      (SELECT value->>'last_sync_at' FROM jsonb_array_elements(p_inventory) LIMIT 1)
      USING ERRCODE = 'P0001';
  END;

  IF v_sync_at IS NULL THEN
    RAISE EXCEPTION '首条 last_sync_at 不能为空' USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 6b. 强制统一快照时间：遍历全部条目校验 last_sync_at 非空、可解析、且等于统一快照时间
  --     在任何 Variant/Inventory/Warehouse 写入前完成全量一致性校验
  --     同一次快照内任一 SKU 的 last_sync_at 与首条不同 → RAISE EXCEPTION 回滚（零写入）
  -- ============================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_inventory)
  LOOP
    DECLARE
      v_item_sync_at timestamptz;
    BEGIN
      IF v_item->>'last_sync_at' IS NULL OR v_item->>'last_sync_at' = '' THEN
        RAISE EXCEPTION 'last_sync_at 不能为空: sku=%, country=%',
          v_item->>'sku', v_item->>'country'
          USING ERRCODE = 'P0001';
      END IF;

      BEGIN
        v_item_sync_at := (v_item->>'last_sync_at')::timestamptz;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'last_sync_at 无法解析: sku=%, country=%, 值=%',
          v_item->>'sku', v_item->>'country', v_item->>'last_sync_at'
          USING ERRCODE = 'P0001';
      END;

      IF v_item_sync_at != v_sync_at THEN
        RAISE EXCEPTION '同一次快照内 last_sync_at 不一致: sku=%, country=%, 统一时间=%, 本条时间=%',
          v_item->>'sku', v_item->>'country', v_sync_at, v_item_sync_at
          USING ERRCODE = 'P0001';
      END IF;
    END;
  END LOOP;

  -- ============================================
  -- 7. Variant 创建或复用（幂等，仅当有新 Variant 时执行）
  --     统一快照时间已在步骤 6a/6b 完成全量校验，此处可安全写入
  -- ============================================
  IF v_variant_count > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_variants)
    LOOP
      INSERT INTO public.product_variant (sku, country, name, product_id, match_status)
      VALUES (
        v_item->>'sku',
        v_item->>'country',
        v_item->>'name',
        NULL,
        'unmatched'
      )
      ON CONFLICT (sku, country) DO NOTHING;

      IF FOUND THEN
        v_created := v_created + 1;
      END IF;
    END LOOP;
  END IF;

  -- ============================================
  -- 8. 逐 SKU 解析 variant_id + quantity 校验 + 三向分类写入
  --     全部 INSERT / UPDATE / UNCHANGED metadata-only UPDATE 使用统一快照时间 v_sync_at（步骤 6a）
  --     INSERT（新记录）/ UPDATE（quantity 变更）/ UNCHANGED（metadata-only UPDATE 刷新 last_sync_at）
  --     所有 country 已在步骤 5b 中校验
  -- ============================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_inventory)
  LOOP
    v_sku := v_item->>'sku';
    v_country := v_item->>'country';

    -- 事务内解析 variant_id（Variant 创建在步骤 7，此处可见）
    SELECT id INTO v_variant_id
    FROM public.product_variant
    WHERE sku = v_sku AND country = v_country;

    IF NOT FOUND THEN
      RAISE EXCEPTION '无法解析 variant_id: sku=%, country=%', v_sku, v_country
        USING ERRCODE = 'P0001';
    END IF;

    -- 逐项 quantity 校验
    v_expected_qty := (v_item->>'quantity')::int;
    IF v_expected_qty < 0 THEN
      RAISE EXCEPTION 'quantity 不能为负数: sku=%, quantity=%', v_sku, v_expected_qty
        USING ERRCODE = 'P0001';
    END IF;

    -- 查询当前 quantity 以判断 INSERT / UPDATE / UNCHANGED
    -- 全部使用统一快照时间 v_sync_at（来自步骤 6a）
    SELECT quantity INTO v_current_qty
    FROM public.inventory
    WHERE variant_id = v_variant_id AND warehouse_id = p_warehouse_id;

    IF NOT FOUND THEN
      -- 新 Inventory 记录
      INSERT INTO public.inventory (variant_id, warehouse_id, quantity, last_sync_at)
      VALUES (v_variant_id, p_warehouse_id, v_expected_qty, v_sync_at);
      v_inserted := v_inserted + 1;
    ELSIF v_current_qty != v_expected_qty THEN
      -- quantity 变更，UPDATE quantity + last_sync_at
      UPDATE public.inventory
      SET quantity = v_expected_qty,
          last_sync_at = v_sync_at
      WHERE variant_id = v_variant_id AND warehouse_id = p_warehouse_id;
      v_updated := v_updated + 1;
    ELSE
      -- quantity 不变，metadata-only UPDATE 刷新 last_sync_at
      -- 仍计入 inventory_unchanged（非 inventory_updated）
      UPDATE public.inventory
      SET last_sync_at = v_sync_at
      WHERE variant_id = v_variant_id AND warehouse_id = p_warehouse_id;
      v_unchanged := v_unchanged + 1;
    END IF;

    v_received := v_received + 1;
  END LOOP;

  -- ============================================
  -- 9. 写入计数核对
  -- ============================================
  IF v_received != v_inv_input_count THEN
    RAISE EXCEPTION 'Inventory 接收数量不匹配: 期望 %, 实际 %',
      v_inv_input_count, v_received
      USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 10. 事务内写后核对：逐 SKU 查询 DB 最终 quantity 和 last_sync_at
  --     使用统一快照时间 v_sync_at（步骤 6a 解析）作为期望 last_sync_at
  --     含 inventory_unchanged 项（确认未被并发修改 + last_sync_at 已刷新）
  --     检测缺失记录、无法解析、quantity 不一致、last_sync_at 不一致
  --     任一差异 → RAISE EXCEPTION 回滚
  -- ============================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_inventory)
  LOOP
    v_sku := v_item->>'sku';
    v_country := v_item->>'country';
    v_expected_qty := (v_item->>'quantity')::int;

    -- 再次解析 variant_id
    SELECT id INTO v_variant_id
    FROM public.product_variant
    WHERE sku = v_sku AND country = v_country;

    IF NOT FOUND THEN
      RAISE EXCEPTION '写后核对: 无法解析 variant_id: sku=%, country=%', v_sku, v_country
        USING ERRCODE = 'P0001';
    END IF;

    -- 查询 Inventory 最终 quantity 和 last_sync_at
    -- 期望 last_sync_at 为统一快照时间 v_sync_at（步骤 6a）
    SELECT quantity, last_sync_at INTO v_actual_qty, v_actual_sync_at
    FROM public.inventory
    WHERE variant_id = v_variant_id AND warehouse_id = p_warehouse_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION '写后核对: 缺失 Inventory 记录: sku=%, country=%, variant_id=%',
        v_sku, v_country, v_variant_id
        USING ERRCODE = 'P0001';
    END IF;

    IF v_actual_qty != v_expected_qty THEN
      RAISE EXCEPTION '写后核对: quantity 不一致: sku=%, country=%, 期望=%, 实际=%',
        v_sku, v_country, v_expected_qty, v_actual_qty
        USING ERRCODE = 'P0001';
    END IF;

    IF v_actual_sync_at IS NULL OR v_actual_sync_at != v_sync_at THEN
      RAISE EXCEPTION '写后核对: last_sync_at 不一致: sku=%, country=%, 期望=%, 实际=%',
        v_sku, v_country, v_sync_at, v_actual_sync_at
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- ============================================
  -- 11. Warehouse 改名（仅当名称不同）
  -- ============================================
  IF v_wh_name != p_warehouse_name THEN
    UPDATE public.warehouse
    SET name = p_warehouse_name
    WHERE id = p_warehouse_id;
  END IF;

  -- ============================================
  -- 12. Warehouse 写后核对：重新核对 id/country/type/is_active/name
  --      任一差异 → RAISE EXCEPTION 回滚
  -- ============================================
  SELECT id, country, type, is_active, name
  INTO v_wh_id_ck, v_wh_country_ck, v_wh_type_ck, v_wh_active_ck, v_wh_name_ck
  FROM public.warehouse
  WHERE id = p_warehouse_id;

  IF v_wh_id_ck IS NULL THEN
    RAISE EXCEPTION '写后核对: Warehouse 记录丢失: %', p_warehouse_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_wh_country_ck != 'PH' THEN
    RAISE EXCEPTION '写后核对: Warehouse country 异常: 期望 PH, 实际 %', v_wh_country_ck
      USING ERRCODE = 'P0001';
  END IF;

  IF v_wh_type_ck != 'overseas' THEN
    RAISE EXCEPTION '写后核对: Warehouse type 异常: 期望 overseas, 实际 %', v_wh_type_ck
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT v_wh_active_ck THEN
    RAISE EXCEPTION '写后核对: Warehouse is_active 异常: 期望 true, 实际 false'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_wh_name_ck != p_warehouse_name THEN
    RAISE EXCEPTION '写后核对: Warehouse name 异常: 期望 %, 实际 %',
      p_warehouse_name, v_wh_name_ck
      USING ERRCODE = 'P0001';
  END IF;

  -- ============================================
  -- 13. 返回摘要（含三向分类计数）
  -- ============================================
  RETURN jsonb_build_object(
    'variants_created', v_created,
    'inventory_received', v_received,
    'inventory_inserted', v_inserted,
    'inventory_updated', v_updated,
    'inventory_unchanged', v_unchanged,
    'warehouse_renamed', (v_wh_name != p_warehouse_name)
  );
END;
$$;
```

#### 3.3 并发与权限设计（返工新增）

**并发隔离**：

- RPC 第一步 `SELECT ... FOR UPDATE` 锁定目标 `warehouse` 行
- 同仓并发同步自动串行化：第二个调用者等待第一个事务提交或回滚后继续
- 不同仓并发不受影响（锁在不同行）
- 锁定持续到事务结束（提交或回滚时释放）

**权限收口**：

```sql
-- 收紧执行权限：禁止浏览器用户调用同步写入 RPC
REVOKE EXECUTE ON FUNCTION public.sync_warehouse_inventory(uuid, jsonb, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_warehouse_inventory(uuid, jsonb, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sync_warehouse_inventory(uuid, jsonb, jsonb, text) FROM authenticated;
-- 显式授予 service_role 执行权限（REVOKE 后必须显式 GRANT，不依赖隐式内建行为）
GRANT EXECUTE ON FUNCTION public.sync_warehouse_inventory(uuid, jsonb, jsonb, text) TO service_role;
```

**安全层级**：

| 层级 | 措施 |
|---|---|
| RPC 权限 | `REVOKE` FROM PUBLIC/anon/authenticated + 显式 `GRANT` TO service_role |
| Schema 隔离 | `SET search_path = ''` — 阻止 search_path 劫持 |
| Schema 限定 | 所有表引用使用 `public.` 前缀 |
| 调用者身份 | `SECURITY INVOKER` — 使用调用者（service_role）权限 |
| 浏览器防护 | 前端无法获取 service_role key；service_role key 仅存在于可信服务端或 CLI，泄露即等同于获得同步 RPC 权限 |

**与现有 RPC 模式对比**：

| 函数 | SECURITY | 角色校验 | execute 权限 | 用途 |
|---|---|---|---|---|
| `batch_match_variants` (00004) | INVOKER | 函数内 `get_user_role()='admin'` | GRANT TO authenticated | 浏览器 admin 批量匹配 |
| `create_shipment_transactional` (00005) | INVOKER | 函数内 `get_user_role() IN ('admin','operator')` | GRANT TO authenticated | 浏览器 admin/operator 创建货件 |
| **`sync_warehouse_inventory` (00006)** | **INVOKER** | **无需（service_role 无用户会话）** | **REVOKE ALL + 显式 GRANT service_role** | **Python 同步脚本** |

#### 3.4 sync_log 写入规则（返工统一）

**核心原则**：sync_log 仅在”已开始尝试同步写入”后记录。预执行失败（未调用 RPC、未发生任何数据库变更）不记录。

| 阶段 | 事件 | sync_log 写入 | 原因 |
|---|---|---|---|
| 输入校验失败 | `sys.exit(1)` | **不写** | 输入无效，未尝试写入 |
| 漂移阻断（真实模式） | `sys.exit(1)` | **不写** | 计划已变更，未尝试写入 |
| RPC 调用 → 成功返回 | 进入验证阶段 | 暂不写 | 等待验证结果 |
| RPC 调用 → PG 错误 | `sys.exit(1)` | **写 `failed`**（含 PG error） | RPC 已尝试但全部回滚 |
| RPC 调用 → 网络超时 | `sys.exit(1)` | **写 `failed`**（含 `network_timeout_unknown`） | 结果不确定 |
| RPC 成功 + 二次审计通过 | — | **写 `success`** → `sys.exit(0)` | 写入完整且验证通过 |
| RPC 成功 + 二次审计失败 | `sys.exit(1)` | **写 `failed`**（含审计差异详情） | 数据已提交但状态异常 |
| sync_log REST 写入失败 | 见 3.6 | 重试 1 次 + 本地 JSON 兜底 | 确保至少一种记录留存 |

**`--no-sync-log` 限制**：

- **仅 Dry Run 模式可用**：`--dry-run --no-sync-log` 跳过所有 sync_log 写入（包括 REST 调用和本地兜底）
- **真实同步必须记录**：`--no-dry-run --no-sync-log` 组合 → CLI 拒绝执行，输出错误说明
- **测试环境**：`--no-sync-log` 可用于 mock 测试，避免测试间 sync_log 写入副作用

**sync_log.success 写入失败的退出行为**：

```
RPC 成功 → 验证通过 → 写 sync_log.success:
  ├── REST 写入成功 → sys.exit(0)
  └── REST 写入失败:
      ├── 重试 1 次成功 → sys.exit(0)
      └── 重试仍失败:
          ├── 保存到本地 JSON 兜底文件
          ├── 输出警告到 stderr（含兜底文件路径）
          └── sys.exit(2)  ← 非零退出，不报告为完整成功
```

**网络结果未知的恢复策略**：

```
网络超时 → 写 sync_log.failed (error_message = “network_timeout_unknown: <异常详情>”) → sys.exit(1)

后续重试前：
  1. 只读查询 DB 当前状态（Variant + Inventory + Warehouse）
  2. 与本次输入计划逐条比较
  3. 若 DB 已含本次全部数据 → RPC 实际已提交，仅日志未写入 → 补写 sync_log.success
  4. 若 DB 部分含本次数据 → 数据不一致 → 人工介入（罕见，事务应保证原子性）
  5. 若 DB 无本次数据 → RPC 未提交 → 可安全重试
```

#### 3.5 完整执行流程（返工版）

```
CLI 执行流程:
1. 输入校验（Zod 等价纯函数）
   └── 失败: sys.exit(1)，不写 sync_log（输入无效）

2. 漂移检测（真实模式）
   └── 漂移: 阻止执行，sys.exit(1)，不写 sync_log（未尝试写入）

3. build_rpc_payload():
   - p_variants: 仅含 new_variants[{sku, country, name}]（已存在 Variant 不传入）
   - p_inventory: 本次来源的完整库存快照 [{sku, country, quantity, last_sync_at}]
     （合并 inventory_updates + inventory_inserts + inventory_after_variant_create + inventory_unchanged）
   - p_warehouse_name: TARGET_WAREHOUSE_NAME

4. RPC 调用 sync_warehouse_inventory():
   ├── 成功（返回 jsonb 摘要）→ 进入步骤 5
   ├── PG 错误(RuntimeError/HTTPError 含 PG 错误码):
   │   ├── 写 sync_log.failed (error_message 含原始 PG 错误)
   │   └── sys.exit(1)
   └── 网络超时(URLError/OSError/ConnectionResetError):
       ├── 写 sync_log.failed (error_message = “network_timeout_unknown: ...”)
       └── sys.exit(1)

5. 二次审计 — 只读核对（RPC 提交后）:
   ├── 重新查询 Inventory + Warehouse
   ├── 逐项比较 quantity（与输入计划）
   ├── Warehouse 名称/状态核对
   ├── 通过 → 写 sync_log.success → sys.exit(0)
   └── 失败:
       ├── 写 sync_log.failed (含核对差异详情 + “post-commit audit failed”)
       └── sys.exit(1)
```

**二次审计 vs 事务内验证的分工**：

| 验证类型 | 位置 | 失败后果 | 验证内容 |
|---|---|---|---|
| 事务内验证 | RPC 内，提交前 | 全部回滚，零写入 | SKU 去重、Variant 可解析、quantity >= 0、写入计数、Warehouse 属性 |
| 二次审计 | RPC 外，提交后 | 数据已提交，记录 failed + 人工排查 | 逐 SKU quantity 精确一致、无缺记录/计划外记录、Warehouse 最终名称 |

#### 3.6 sync_log 写入失败的自保机制

```python
def _write_sync_log(entry: dict, *, allow_fallback: bool = True) -> bool:
    “””写入 sync_log，失败时重试 1 次 + 本地 JSON 兜底。

    Args:
        entry: sync_log 记录 dict
        allow_fallback: 是否允许本地 JSON 兜底（success 日志必须兜底）

    Returns:
        True 表示 REST 写入成功
    “””
    try:
        _post('sync_log', [entry])
        return True
    except Exception as e:
        time.sleep(0.5)
        try:
            _post('sync_log', [entry])
            return True
        except Exception:
            if allow_fallback:
                _save_fallback_log(entry)
                print(
                    f'警告: sync_log 写入失败，已保存到本地文件: {e}',
                    file=sys.stderr
                )
            return False


def _save_fallback_log(entry: dict) -> None:
    “””写入本地 JSON 兜底文件。”””
    fallback_dir = Path(__file__).resolve().parents[2] / 'runtime' / 'sync_log_fallback'
    fallback_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime('%Y%m%dT%H%M%S')
    filepath = fallback_dir / f'sync_log_{ts}.json'
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(entry, f, ensure_ascii=False, indent=2)
```

---

### 四、最小可靠实施方案（返工版）

| 层 | 变更 | 说明 |
|---|---|---|
| Migration `00006` | 新增 `sync_warehouse_inventory` RPC 函数 | 含事务内验证 + FOR UPDATE + 权限收口；无新表 |
| `executor.py` | 新增 `execute_plan_v2()` 调用 RPC | 保留旧 `execute_plan()` 不动（已有 14 项测试） |
| `executor.py` | 新增 `_build_rpc_payload()` 将 plan 转为 RPC 输入 | keys = `{sku, country, quantity, last_sync_at}` |
| `executor.py` | 新增 `_write_sync_log()` + `_save_fallback_log()` | 重试 1 次 + 本地 JSON 兜底 |
| `cli_execute.py` | 新增 `--sync-log` flag + sync_log 写入编排 | `--no-sync-log` 仅 Dry Run 可用 |
| `sync_log` 表 | **无需修改** | 现有 schema 满足需求 |

**不需要**：新表、staging 表、两阶段提交、事件溯源、消息队列。

---

### 五、P5-SY4 后续任务拆分（返工版）

---

#### P5-SY4B — Migration 00006: 事务 RPC 函数

| 项 | 内容 |
|---|---|
| **目标** | 创建 `sync_warehouse_inventory` 函数，单事务内完成统一快照时间解析与强制一致性校验 + 13 步验证链：FOR UPDATE 锁仓 → Warehouse 属性/国家/名称校验 → 输入校验（含拒绝空 p_inventory）→ (sku,country) 业务键去重 → Variant-Inventory 关联完整性校验 → 逐条 country 与 Warehouse 一致性校验 → 统一快照时间解析（首条→v_sync_at，在任何业务写入前）→ 全部条目 last_sync_at 一致性校验（任一条不同→回滚，在 Variant INSERT 前）→ Variant 幂等创建 → variant_id 解析 + quantity 校验 + 三向分类写入（全部使用统一 v_sync_at，UNCHANGED 刷新 last_sync_at）→ 计数核对 → 事务内写后逐 SKU SELECT 核对 quantity 和 last_sync_at（期望为统一 v_sync_at）→ Warehouse 改名 → Warehouse 写后 SELECT 核对 → 返回摘要。全部验证失败时 RAISE EXCEPTION 回滚。 |
| **修改文件** | `supabase/migrations/00006_sync_warehouse_inventory.sql`（新建） |
| **函数签名** | `public.sync_warehouse_inventory(p_warehouse_id uuid, p_variants jsonb, p_inventory jsonb, p_warehouse_name text) RETURNS jsonb` |
| **必须包含** | (1) `SELECT ... FOR UPDATE` 锁 warehouse；(2) 校验 country='PH' / type / is_active；(3) 校验 name 仅允许旧名('菲律宾仓')或正式目标名('菲律宾-新创启辰自建仓')；(4) 校验 p_warehouse_name 非空且等于正式目标名；(5) p_variants 按 (sku,country) GROUP BY 检测重复（不用 jsonb_agg DISTINCT）；(6) p_inventory 按 (sku,country) 检测重复；(7) p_inventory 必须非空（`jsonb_array_length > 0`，拒绝抓取异常空快照）；(8) 新 Variant-Inventory 关联完整性：每个 p_variants 的 (sku,country) 必须存在于 p_inventory（不要求反向相等）；(9) 逐条校验 p_variants.country == warehouse.country；(10) 逐条校验 p_inventory.country == warehouse.country；(11) `ON CONFLICT (sku, country) DO NOTHING`；(12) 事务内 `SELECT ... WHERE sku AND country` 解析 variant_id；(13) 逐项 `quantity >= 0`；(14) last_sync_at 非空且可解析为 timestamptz（BEGIN...EXCEPTION 捕获转换失败）；(15) 三向分类写入：SELECT 当前 quantity → NOT FOUND→INSERT / FOUND+不同→UPDATE quantity+last_sync_at / FOUND+相同→metadata-only UPDATE 仅刷新 last_sync_at（仍计入 inventory_unchanged）；(16) received 计数核对；(17) 事务内逐 SKU `SELECT quantity, last_sync_at FROM inventory` 写后核对（含 unchanged 项，缺失/quantity 不一致/last_sync_at 不一致→RAISE EXCEPTION）；(18) Warehouse 改名；(19) Warehouse 写后 `SELECT id/country/type/is_active/name` 核对；(20) `SECURITY INVOKER` + `SET search_path = ''` + `public.` 限定 + `REVOKE` PUBLIC/anon/authenticated + 显式 `GRANT` TO service_role；(21) 返回摘要含 `variants_created` + `inventory_received` + `inventory_inserted` + `inventory_updated` + `inventory_unchanged` + `warehouse_renamed`；(22) 统一快照时间：步骤 6a 在任何业务写入前解析首条 last_sync_at 为统一 v_sync_at；步骤 6b 在 Variant INSERT 前遍历全部条目校验每个 last_sync_at 非空、可解析、且等于统一 v_sync_at，任一不同→RAISE EXCEPTION；步骤 8 全部 INSERT/UPDATE/UNCHANGED 使用统一 v_sync_at；步骤 10 写后核对期望 last_sync_at 为统一 v_sync_at；SQL 注释说明每个验证步骤及其执行时机 |
| **SQL 级测试方案** | 迁移文件内包含 SQL 注释形式的测试用例（≥17 场景）：(1) 正常成功（含 INSERT+UPDATE+UNCHANGED 混合，统一快照时间写入）；(2) Warehouse 不存在/非 overseas/已停用 → RAISE EXCEPTION；(3) Warehouse country≠PH → RAISE EXCEPTION；(4) Warehouse name 非法 → RAISE EXCEPTION；(5) p_warehouse_name 非空/非目标名 → RAISE EXCEPTION；(6) p_variants 同 (sku,country) 不同 name → RAISE EXCEPTION；(7) p_inventory 同 (sku,country) 不同 quantity → RAISE EXCEPTION；(8) p_inventory 为空数组 → RAISE EXCEPTION；(9) 新 Variant 缺少对应 Inventory → RAISE EXCEPTION；(10) Variant/Inventory country≠Warehouse country → RAISE EXCEPTION；(11) SKU 无法解析 variant_id → RAISE EXCEPTION；(12) quantity 负数 → RAISE EXCEPTION；(13) last_sync_at 为空或无法解析 → RAISE EXCEPTION；(14) 写后核对缺失记录 → RAISE EXCEPTION；(15) 写后核对 quantity 不一致 → RAISE EXCEPTION；(16) 同一快照内 last_sync_at 不一致（SKU A 用 12:00、SKU B 用 12:01）→ RAISE EXCEPTION（事务回滚，零写入）；(17) 全部 inventory_unchanged（统一快照时间，quantity 不变、last_sync_at 全部刷新、写后核对 last_sync_at 一致）→ 成功返回。同时列出 Supabase SQL Editor 本地验证步骤。 |
| **禁止事项** | 禁止执行 Migration（仅创建文件）；禁止修改 00001-00005；禁止在函数内写 sync_log；禁止新增表；禁止使用 `SECURITY DEFINER` |
| **停止条件** | Migration 文件完成 SQL 语法检查 + 已含 17+ SQL 测试场景说明后停止，等待独立验收 |

---

#### P5-SY4C — Executor 适配 RPC + sync_log 写入

| 项 | 内容 |
|---|---|
| **目标** | 新增 `execute_plan_v2()` 将写入计划转为 RPC 调用，替代分批 REST 写入；实现 sync_log 成功/失败/超时三类写入；network_timeout_unknown 分类与恢复指引 |
| **修改文件** | `sync/executor.py`（新增 `execute_plan_v2` + `_build_rpc_payload` + `_call_sync_rpc` + `_write_sync_log` + `_save_fallback_log`）；`sync/cli_execute.py`（新增 `--sync-log` / `--no-sync-log` flag + sync_log 写入编排） |
| **关键函数** | `_build_rpc_payload()`: 从 plan 构建 RPC 输入 — `p_variants` 仅含 new_variants 的 `{sku, country, name}`；`p_inventory` 合并 updates/inserts/after_variant_create/unchanged 为本次来源完整库存快照 `{sku, country, quantity, last_sync_at}` |
| **验收标准** | (1) `execute_plan_v2()` 单次 RPC 替代 Phase C/F/H 多次 REST 调用；(2) Phase G/I 二次审计保留在 RPC 后（只读核对）；(3) RPC 成功+审计通过 → `sync_log.success` → `sys.exit(0)`；(4) RPC 失败 → `sync_log.failed`（含 PG 错误）→ `sys.exit(1)`；(5) 网络超时 → `sync_log.failed`（含 `network_timeout_unknown`）→ `sys.exit(1)`；(6) sync_log.success 写入失败 → 兜底 + `sys.exit(2)`；(7) `--no-dry-run --no-sync-log` → CLI 拒绝执行；(8) 保留旧 `execute_plan()` 不变 |
| **禁止事项** | 禁止删除旧 `execute_plan()`；禁止修改 Phase E/I 现有逻辑；禁止真实数据库写入；禁止修改 verify 纯函数；禁止硬编码 warehouse_id |
| **停止条件** | 代码通过 Python 语法检查 + 现有全部测试仍通过后停止 |

---

#### P5-SY4D — 测试覆盖：全部失败模式

| 项 | 内容 |
|---|---|
| **目标** | 新增 mock-based 测试覆盖全部成功/失败/边界场景，不连接 Supabase |
| **修改文件** | `sync/test_sync_log.py`（新建） |
| **验收标准** | 全部场景（见第六节测试矩阵）；mock RPC 调用和 sync_log REST 写入；每个场景验证：(a) 数据状态（RPC 调/未调），(b) sync_log 写入状态/内容，(c) 本地兜底触发条件，(d) 退出码正确；(1) `--no-dry-run --no-sync-log` 组合被拒绝；(2) `--dry-run --no-sync-log` 组合被接受 |
| **禁止事项** | 禁止连接 Supabase；禁止真实数据库写入；禁止修改现有测试文件 |
| **停止条件** | 全部新增测试通过 + 现有全部测试仍通过后停止 |

---

#### P5-SY4E — CLI 集成与 Dry Run 端到端验证

| 项 | 内容 |
|---|---|
| **目标** | CLI `--sync-log` 模式 Dry Run 端到端验证：完整执行流程通过只读验证 |
| **修改文件** | `sync/cli_execute.py`（最终集成） |
| **验收标准** | (1) `--execute --confirm P5-SY3B-PH`（默认 dry-run + sync-log）输出完整流程；(2) `--dry-run --no-sync-log` 跳过日志；(3) `--no-dry-run --no-sync-log` 被拒绝；(4) Dry Run 报告含 sync_log 摘要；(5) 语法/lint/build 全部通过 |
| **禁止事项** | 禁止 `--no-dry-run`；禁止真实数据库写入；禁止扩展其他仓库 |
| **停止条件** | Dry Run 通过后停止，等待最终独立验收和真实写入授权 |

---

### 六、测试矩阵（第六次返工版 — 24 场景）

| # | 场景 | RPC 结果 | 审计结果 | 数据预期 | sync_log 预期 | exit code |
|---|---|---|---|---|---|---|
| 1 | 全部成功（混合 INSERT+UPDATE+UNCHANGED） | 成功（返回分类计数） | 通过 | Variant + Inventory + Warehouse 全部写入，last_sync_at 全部刷新 | `success`, `error_message=null` | 0 |
| 2 | RPC 内 SKU 无法解析 variant_id | PG 错误（RAISE EXCEPTION） | 不执行 | **零写入**（事务回滚） | `failed`, 含 `无法解析 variant_id: sku=...` | 1 |
| 3 | p_variants 同 (sku,country) 不同 name | PG 错误（业务键重复） | 不执行 | **零写入** | `failed`, 含 `含重复 (sku,country) 业务键` | 1 |
| 4 | p_inventory 同 (sku,country) 不同 quantity | PG 错误（业务键重复） | 不执行 | **零写入** | `failed`, 含 `含重复 (sku,country) 业务键` | 1 |
| 5 | RPC 内 quantity 负数校验失败 | PG 错误 | 不执行 | **零写入** | `failed`, 含 `quantity 不能为负数` | 1 |
| 6 | Warehouse 不存在/非 overseas/已停用 | PG 错误 | 不执行 | **零写入** | `failed`, 含对应校验错误 | 1 |
| 7 | Warehouse country ≠ PH | PG 错误 | 不执行 | **零写入** | `failed`, 含 `country 必须为 PH` | 1 |
| 8 | Warehouse 名称非法（非旧名/非正式名） | PG 错误 | 不执行 | **零写入** | `failed`, 含 `名称非法` | 1 |
| 9 | p_warehouse_name 为空或非正式目标名 | PG 错误 | 不执行 | **零写入** | `failed`, 含 `正式目标名` | 1 |
| 10 | Variant/Inventory country ≠ Warehouse country | PG 错误 | 不执行 | **零写入** | `failed`, 含 `必须等于 Warehouse country` | 1 |
| 11 | 事务内写后核对：缺失 Inventory 记录 | PG 错误（RAISE EXCEPTION） | 不执行 | **零写入**（事务回滚） | `failed`, 含 `缺失 Inventory 记录` | 1 |
| 12 | 事务内写后核对：quantity 不一致 | PG 错误（RAISE EXCEPTION） | 不执行 | **零写入**（事务回滚） | `failed`, 含 `quantity 不一致` | 1 |
| 13 | 二次审计失败（post-commit 发现差异） | 成功（已提交） | 发现差异 | 数据已提交但状态异常 | `failed`, 含 `post-commit audit failed` + 差异详情 | 1 |
| 14 | sync_log.success 写入失败 | 成功 | 通过 | 数据已写入 | REST 重试 1 次仍失败 → 本地 JSON 兜底 | 2 |
| 15 | sync_log.failed 写入失败 | PG 错误 | 不执行 | **零写入** | REST 重试 1 次仍失败 → 本地 JSON 兜底 | 1 |
| 16 | 网络超时（结果未知）| URLError | 不执行 | **不确定** | `failed`, `network_timeout_unknown: ...` | 1 |
| 17 | `--no-dry-run --no-sync-log` 组合 | N/A | N/A | N/A | CLI 拒绝执行，输出错误 | 1 |
| 18 | `--dry-run --no-sync-log` 组合 | N/A | N/A | N/A | 无 sync_log 写入，仅 Dry Run 报告 | 0 |
| 19 | 非 service_role 调用 RPC | PG 错误（permission denied） | 不执行 | **零写入** | N/A（调用方捕获异常） | N/A |
| 20 | 全部库存不变（quantity 均与 DB 一致，last_sync_at 全部刷新）| 成功（inventory_unchanged=N, inserted=0, updated=0） | 通过 | metadata-only UPDATE 刷新 last_sync_at，quantity 不变 | `success`, `error_message=null` | 0 |
| 21 | 新 Variant 缺少对应 Inventory（p_variants 含 (sku,country) 不在 p_inventory 中）| PG 错误（RAISE EXCEPTION） | 不执行 | **零写入**（事务回滚） | `failed`, 含 `新 Variant 缺少对应 Inventory: sku=...` | 1 |
| 22 | p_inventory 为空数组（抓取异常或输入错误）| PG 错误（RAISE EXCEPTION） | 不执行 | **零写入**（事务回滚） | `failed`, 含 `不能为空数组` | 1 |
| 23 | last_sync_at 为空或无法解析 | PG 错误（RAISE EXCEPTION） | 不执行 | **零写入**（事务回滚） | `failed`, 含 `last_sync_at 不能为空` 或 `无法解析` | 1 |
| 24 | 同一快照内 last_sync_at 不一致（SKU A 12:00、SKU B 12:01）| PG 错误（RAISE EXCEPTION） | 不执行 | **零写入**（事务回滚，写入前全部校验） | `failed`, 含 `last_sync_at 不一致` | 1 |

> 场景 2-12 验证事务内 RAISE EXCEPTION 导致全部回滚（含第二次返工新增：业务键去重 2 场景、Warehouse 国家/名称约束 3 场景、跨国家输入 1 场景、写后核对 2 场景）。场景 19 验证 REVOKE 生效：authenticated/anon 调用被拒。场景 20 验证全部库存不变时 RPC 刷新 last_sync_at 并返回成功（第四次返工修正：从零写入改为 metadata-only UPDATE）。场景 21 验证新 Variant 缺少对应 Inventory 时事务回滚（第三次返工新增）。场景 22 验证空 p_inventory 被拒绝（第四次返工新增）。场景 23 验证 last_sync_at 校验失败（第四次返工新增）。场景 24 验证同一快照 last_sync_at 不一致被拒绝（第五次返工新增：步骤 7a/7b 在任何业务写入前强制全部一致）。二次审计（场景 13）仅作为提交后检测网，不再承担”保留旧库存”的职责——该职责由 13 步事务内验证链保证。

### 七、执行顺序依赖

```
P5-SY4A (本节) — 第六次设计返工
  └── P5-SY4B — Migration 00006 创建（含 17+ SQL 测试场景）
       └── P5-SY4C — Executor 适配 RPC + sync_log
            └── P5-SY4D — 测试覆盖（24 场景）
                 └── P5-SY4E — CLI 集成与 Dry Run
                      └── 独立验收 → 授权真实写入
```

### 八、第六次返工验收清单

- [ ] D1-1：真实 `input_validator.py:validate_json()` 新增 `len(rows) == 0` → ValidationError（拒绝抓取异常空快照）
- [ ] D1-2：`test_plan.py` 新增纯函数测试：空 rows 必须抛出 ValidationError
- [ ] D1-3：测试不连接 Supabase、不执行真实同步
- [ ] D2-1：SQL 步骤 6a 在所有业务写入前解析首条 `last_sync_at` 为统一 `v_sync_at`
- [ ] D2-2：SQL 步骤 6b 在 Variant INSERT 前遍历全部条目校验每个 `last_sync_at` 非空、可解析、且等于 `v_sync_at`；任一不同 → RAISE EXCEPTION
- [ ] D2-3：SQL 步骤 8 全部 INSERT/UPDATE/UNCHANGED 使用统一 `v_sync_at`（不再逐条从 `p_inventory` 各自解析）
- [ ] D2-4：SQL 步骤 10 写后核对期望 `last_sync_at` 为统一 `v_sync_at`（不再逐条重新解析）
- [ ] D2-5：SQL 测试方案新增场景 16：同一快照 last_sync_at 不一致 → RAISE EXCEPTION 回滚
- [ ] D2-6：测试矩阵新增场景 24：同一快照 last_sync_at 不一致（SKU A 12:00、SKU B 12:01）→ 零写入
- [ ] D3-1：SQL 步骤 6a/6b（统一快照时间解析与全量一致性校验）在步骤 7（Variant INSERT）之前执行
- [ ] D3-2：所有业务写入（Variant/Inventory/Warehouse）均在校验统一快照时间之后执行
- [ ] D3-3：流程描述中 13 步编号与 SQL 草案中注释编号一致（6a/6b → 7 → 8 → 9 → 10 → 11 → 12 → 13）
- [ ] P5-SY4B 必须包含 22 项（统一快照时间描述更新为步骤 6a/6b/8/10）
- [ ] SQL 测试方案 17+ 场景
- [ ] P5-SY4D 测试矩阵 24 场景
- [ ] 未发生真实数据库写入
