# Phase 3 — 在途与物流

目标：从百世开放平台只读同步在途数据，支持人工匹配与手动补录，推进物流状态，入仓时事务性联动库存。

## 设计边界（不可在实现中违反）

### 多 Provider 原则

- **百世是首个 provider，但不是唯一 provider**。后续还会有无 API 或不同 API 的系统接入。
- **Schema 命名使用通用 external/in-transit 语义**：表名 `shipment_external_ref` / `shipment_external_item` / `tracking_event_external`（如选路径 B）不绑定任何具体 provider。禁止使用 `best_order` / `best_item` 等强绑定表名。
- **`provider` / `source` 字段必须保留**：`shipment_external_ref.provider` CHECK 约束管理允许的 provider 枚举，当前仅 `CHECK (provider IN ('best'))`。
- **新增 provider 通过新 Migration 扩展 CHECK 约束**：例如 `ALTER TABLE shipment_external_ref DROP CONSTRAINT ...; ALTER TABLE shipment_external_ref ADD CHECK (provider IN ('best', 'xxx'));`。不提前建设 provider 注册表、动态枚举表或复杂 Adapter 层。真实出现第二个 provider 且共性模式稳定后再抽取。
- **Provider 专有响应字段只存 `raw_payload`**：百世或其他 provider 的专有字段禁止进入业务模块公共类型（types.ts 中的 interface）、跨模块契约或页面 props。业务类型只定义 provider 无关的通用字段（`external_order_no` / `waybill_no` / `external_sku` / `quantity` 等）。provider 专有字段解析放在 `src/lib/providers/<name>/` 私有模块中（P3-S1B 实现时创建）。

### 百世集成边界

- **只读**：仅调用 `queryOrderInfoByOrderNo` 与物流轨迹查询，不做下单、不做送货预报、不向百世写入任何数据。
- **凭证隔离**：百世 API 凭证（`BEST_OPEN_BASE_URL` / `BEST_OPEN_PARTNER_ID` / `BEST_OPEN_SECRET`）只能通过环境变量读取，禁止写入代码、文档、测试快照、日志或提交信息。
- **原始响应隔离**：百世原始响应只能存入 `raw_payload`（jsonb），禁止将百世专有字段作为业务模块公共契约或跨模块类型。

### 模型边界

- **双层模型不变**：保持 Product → ProductVariant → Inventory，不引入 SKU 作为全局主键。
- **外部商品隔离**：未匹配 ProductVariant 的百世商品先作为 external item 保存，不强行匹配。
- **库存写入隔离**：百世同步绝不直接修改 `inventory.quantity`；仅 P3-S5 入仓事务在用户确认后才更新库存。

---

## 任务拆分

| Task ID | 任务 | 依赖 | 状态 | 停止条件 |
|---|---|---|---|---|
| **P3-S1A** | 百世只读在途同步边界与数据模型 | — | **DONE (2026-06-26)** | Migration 00017 新建 `shipment_external_ref` / `shipment_external_item` / `tracking_event_external`（路径 B：新建外部轨迹表）+ 类型/Zod/database.ts 已同步 + 64 静态契约测试通过 + 1263/1263 非并发测试通过 + lint 0 errors + build 通过。2026-06-28 用户确认 Migration 00017 已在 Supabase SQL Editor 成功执行。未创建 API Client / Repository / Server Action / UI / 库存联动。 |
| **P3-S1B** | 百世 API Client、签名与 Dry Run 拉取 | P3-S1A | **CODE COMPLETE / BLOCKED_EXTERNAL (2026-06-28)** | `src/lib/providers/best/` 模块完成（types.ts / signature.ts / schema.ts / parse-response.ts / client.ts / dry-run.ts / index.ts + 3 测试文件）。MD5 签名、API Client、queryOrderInfoByOrderNo / 物流轨迹查询、Dry Run 入口全部就绪。本地测试（fake credentials + mock fetch）全部通过。真实 Dry Run 返回"未授权"：当前 partnerId 尚未获得 queryOrderInfoByOrderNo / trackingQuery 接口权限。代码和测试已保留。恢复条件：百世确认 partnerId 已授权两个只读接口后，重新执行 `npm run test:best-live`。不进入 P3-S1C。 |
| **P3-S1C** | 百世只读数据写入 DIS 外部在途表 | P3-S1B | BLOCKED | Dry Run 结果幂等写入 external ref / item / tracking event + 同 provider+external_order_no 不重复 + 未匹配商品保留未匹配状态 + 不更新 inventory |
| **P3-S1D** | 外部商品到 ProductVariant 的人工匹配基础 | P3-S1C | BLOCKED | `shipment_external_item.matched_variant_id` 可读写 + Admin/Operator 可匹配/解除匹配 + 不自动匹配 + 不用 SKU 做主键 |
| **P3-S2C** | 库存视图接入内部手动在途只读聚合 | P3-S2B | **DONE (2026-06-30)** | `shipmentRepository.getInTransitByVariant()` 按 variant_id 聚合在途数量（`quantity - warehoused_quantity`），排除 warehoused，Admin/Operator 仓库隔离。海外库存页新增"在途"/"库存+在途"列 + 在途统计卡片。Dashboard 关注产品动态新增"在途"列。Dashboard 在途库存卡片从占位替换为真实数据。14 项 repository 行为测试。1541/1541 测试（46 文件），lint 0/26，build pass。不新增 Migration。 |
| **P3-S2D** | 在途库存聚合精确到仓库 | P3-S2C | **DONE (2026-06-30)** | `shipmentRepository.getInTransitByVariantAndWarehouse()` 按 (variant_id, warehouse_id) 聚合在途数量。海外库存页每行 inTransitQuantity 精确匹配 variantId + warehouseId（防串仓）。Dashboard 保持 variant 总在途。16 项 repository 行为测试含跨仓隔离验证。1558/1558 测试（47 文件），lint 0 errors / 27 warnings，build pass。不新增 Migration。 |
| **P3-S2E** | 在途入口收口 + 采购单号 + 海外库存轻量展开 | P3-S2D、P3-S3 | **DONE (2026-06-30)** | Migration 00020（`purchase_order_no` + `create_shipment_transactional` 11 参数 admin-only + `RETURNING id`）+ Migration 00021（`change_shipment_status_transactional` admin-only 覆盖）。采购单号全链路：types → Zod → Repository → Actions → UI。海外库存行展开：`InTransitDetailRow` 按 (variantId, warehouseId) 查询在途明细，不串仓。入口收口：侧边栏移除"在途库存"，`/dashboard/inventory/in-transit` → redirect。权限收紧：Server Action + RPC 双层 Admin-only。Supabase 生产库已验证 `purchase_order_no` 字段存在，两个 RPC 均为 Admin-only。44 项 P3-S2E 测试（17 repository 行为 + 27 action/Zod/源码/Migration）。全量 1603/1603 测试（49 文件），lint 0 errors / 26 warnings，build pass。 |
| **P3-S2B** | 内部手动在途维护收口（P3-S2A 扩展） | P3-S2A | **DONE → 返工完成 (2026-06-29)** | `/dashboard/shipments` 列表 + `/dashboard/shipments/[id]` 详情 + 编辑基本信息 + 手动状态变更。Migration 00018 新增 `shipment_no` UNIQUE NOT NULL + RPC 10 参数。Migration 00019 新增 `change_shipment_status_transactional` RPC（原子化状态更新 + tracking_event 插入，GET DIAGNOSTICS 行确认）。`update()` 使用 `.select('id').single()` 确认命中 1 行。`changeStatus()` 调用 RPC 替代两阶段分离写入。列表页单号 + 品名聚合列为主标识（移除目的国）。详情页可编辑基本信息和手动推进状态（booking→loading→departed→arrived→customs，禁用 warehoused）。创建表单新增单号必填。Admin/Operator 仓库隔离 + 编辑权限。1526/1527 测试（47 文件），lint 0/26，build pass。不做库存联动。 |
| **P3-S2A** | 内部手动在途只读页面（P3-S2 子任务） | P3-S3 | **DONE (2026-06-29)** (被 P3-S2B 扩展) | `/dashboard/shipments` 列表 + `/dashboard/shipments/[id]` 详情。仅读内部 `shipment` / `shipment_item` / `tracking_event`，不读外部在途三表。国家/状态筛选、分页、仓库隔离、loading/error/not-found 全覆盖。Range: 不做状态推进/入仓/库存联动。 |
| **P3-S2** | 在途列表与详情只读页面 | P3-S1D | BLOCKED | 列表展示国家/仓库/外部单号/商品数量/匹配状态/物流状态/最后同步时间 + 详情含商品明细/未匹配提示/轨迹时间线 + 不做新建/状态推进/入仓 |
| **P3-S3** | 手动创建/补录在途记录 | P3-S1A | **DONE (2026-06-28)** | Codex 独立验收通过。目标测试 96/96，全量 1439/1439（44 文件），lint 0 errors / 26 warnings，build pass。`/dashboard/shipments/new` 表单就绪 + `requireActiveAuth()` + 仓库数据一致性校验 + `warehouseAccessRepository.canAccessWarehouse()` + Variant 服务端校验 + `create_shipment_transactional` RPC（Migration 00005）+ 服务端 Variant 搜索（所有查询 error 检查 + notIn 在 limit 前 + LIKE 转义 \\/%/\_ + ilike 真实参数断言 + 真实 Server Action 链路）。未实现列表/详情/状态推进/入仓/库存联动。 |
| **P3-S4A** | 内部手动在途状态轨迹收口（含返工） | P3-S2E、P3-S3 | **DONE (2026-06-30)** | Migration 00022：RPC SELECT 当前状态 → 校验流转规则（booking→loading→departed→arrived→customs，禁止倒退/跳步/warehoused）→ UPDATE + INSERT。`SHIPMENT_STATUS_FLOW` + `isValidStatusTransition()` + `getNextValidStatus()` 纯函数。Repository `changeStatus()` 预读 status 校验 + `advanceStatus()` 委托 `changeStatus()` → RPC（不再直接 `from('shipment').update` + `from('tracking_event').insert`）+ `getById()` tracking_event join profiles 升序 + `TrackingEventDetail` 含 creatorName。Actions `advanceShipmentStatus()` Admin-only + 使用 `parsed.data.*`。`ShipmentStatusChange` 仅展示下一合法状态。详情页轨迹升序时间线 + 创建人 + 首个节点蓝色高亮。79 项 P3-S4A 源码检查 + 7 项追加行为测试。1688/1688 测试（50 文件），lint 0/25，build pass。Migration 00022 已手动执行并验证。不做百世映射/入仓联动。 |
| **P3-S4** | 状态推进与物流轨迹映射（百世路径） | P3-S2、P3-S3 | BLOCKED | 百世状态保守映射 + 未识别状态只记录 tracking_event 不自动推进 shipment.status（P3-S4A 已将内部状态流转收口；百世映射待 P3-S1B 解除阻塞后实施） |
| **P3-S5A** | 手动确认入仓事务与库存联动（含返工） | P3-S4A | **DONE (2026-06-30)** + **返工完成 (2026-06-30)** | Migration 00023 新增 `warehouse_shipment_transactional` RPC。返工修复：v_shipment record + IF NOT FOUND + `INSERT ... ON CONFLICT DO UPDATE` 原子 UPSERT（替代 select-then-insert）。详情页 `canWarehouseShipment` / `warehouseBlockReason` 统一判断。104 项测试。1793/1793 测试（51 文件），lint 0/25，build pass。Migration 00023 待手动执行。不做百世映射/批量入仓/部分入仓。 |
| **P3-S5** | 入仓事务与库存联动 | P3-S4 | 阶段 A 完成，阶段 B 待定 | P3-S5A 完成 Admin 手动确认入仓（仅 customs、仅全部入仓）。后续可补充：部分入仓、批量入仓、Operator 确认入仓等（按需拆分） |
| **P3-S6** | 在途模块权限、RLS 与端到端验收 | P3-S5 | BLOCKED | Admin/Operator 权限完整 + 已分配仓库隔离 + Server Action/Repository/RLS 链路一致 + 空状态/无权限/错误/加载状态验收 |

---

## 依赖链

```text
P3-S1A（数据模型）
  ├── P3-S1B（百世 API Client）
  │     └── P3-S1C（写入 DIS 外部在途表）
  │           └── P3-S1D（人工匹配基础）
  │                 └── P3-S2（在途列表与详情页面）
  │
  └── P3-S3（手动补录）
        ├── P3-S2A ✅（内部手动在途只读页面）
        │     └── P3-S2B ✅（维护收口）
        │           └── P3-S2C ✅（库存视图接入在途）
        │                 └── P3-S2D ✅（仓库维度聚合）
        │                       └── P3-S2E ✅（入口收口 + 采购单号）
        │                             └── P3-S4A ✅（状态轨迹收口 — 内部路径）
        │
        └── P3-S2 + P3-S3
              └── P3-S4（状态推进 — 百世路径，BLOCKED by P3-S1B）
                    └── P3-S5（入仓事务与库存联动）
                          └── P3-S6（权限与验收）
```

P3-S1B/C/D 形成百世只读同步管线；P3-S3 为独立手动补录分支，两者在 P3-S4 汇合。

---

## 各任务详细范围

### P3-S1A — 百世只读在途同步边界与数据模型

**允许**：Migration 00017 SQL 文件、类型定义（`src/features/shipments/types.ts` 或 `src/features/in-transit/types.ts`）、Zod schema、`database.ts` 类型同步、静态契约测试文件（`src/` 内，纳入 Vitest）。

**禁止**：API Client 代码、百世 API 调用、Repository 业务逻辑、Server Action、UI 页面/组件、库存联动、修改 `inventory` 表。

**范围**：
- 设计并 Migration 新建 `shipment_external_ref` 与 `shipment_external_item` 表。
- 扩展 `tracking_event`（或新建 external tracking 结构）以容纳百世轨迹数据。
- `shipment_external_ref`：`provider`（例如 `'best'`）、`external_order_no`、`waybill_no`、`raw_payload`（jsonb，存百世原始响应，不解析为业务字段）、`sync_status`、`last_synced_at`、关联 `warehouse_id` 与 `country`。
- `shipment_external_item`：关联 `external_ref_id`、`external_sku`、`external_product_name`、`quantity`、`matched_variant_id`（可空）、`raw_payload`（jsonb）。
- 类型定义放在 `src/features/shipments/types.ts`（或新建 `src/features/in-transit/types.ts`，按架构需要）。
- Schema 定义（Zod）。
- 静态契约测试。

**停止条件**：Migration 00017 文件就绪 + 类型/Zod schema 就绪 + database.ts 已同步 + 静态测试通过（纳入 `npm run test`）+ 不写 API Client / Repository 业务逻辑 / Server Action / UI / 库存联动。完成后等待 Codex 独立验收，不自动进入 P3-S1B。

### P3-S1B — 百世 API Client、签名与 Dry Run 拉取

**范围**：
- 环境变量读取：`BEST_OPEN_BASE_URL` / `BEST_OPEN_PARTNER_ID` / `BEST_OPEN_SECRET`。
- 实现稳定 JSON 序列化与 `MD5(bizData + secret)` 签名（按百世开放平台签名规范）。
- 封装 `queryOrderInfoByOrderNo`（按单号查询运单信息）与物流轨迹查询。
- 仅 Dry Run：拉取数据、验证结构、不写 DIS 数据库。
- 测试：签名正确性、参数结构、错误传播、分页边界、空结果。
- 禁止真实凭证进入测试。

**停止条件**：API Client 就绪 + 签名算法正确 + Dry Run 返回结构化数据 + 测试不含真实凭证 + 不写 DIS 数据库。

### P3-S1C — 百世只读数据写入 DIS 外部在途表

**范围**：
- 将 P3-S1B Dry Run 结果写入 P3-S1A 定义的外部表。
- 幂等：同 `provider` + `external_order_no`（或 `waybill_no`）重跑不重复创建外部引用。
- 未匹配商品保留为未匹配状态（`matched_variant_id = null`）。
- 不自动入仓、不更新 `inventory.quantity`。
- `raw_payload` 存百世原始响应，不解析为业务公共字段。

**停止条件**：百世数据幂等写入 DIS + 重跑不重复 + 未匹配商品保留 + 不改 inventory + 仓储层测试通过。

### P3-S1D — 外部商品到 ProductVariant 的人工匹配基础

**范围**：
- 为 `shipment_external_item` 增加 `matched_variant_id`（已由 P3-S1A 建表时预留）。
- Server Action + Repository 提供匹配/解除匹配数据层。
- Admin 与 Operator 均可操作。
- 不做模糊自动匹配。
- 不用 SKU 作为全局主键（匹配基于 variant_id）。

**停止条件**：人工匹配/解除匹配数据层就绪 + 权限校验 + 不自动匹配 + 不写 UI（UI 在 P3-S2）。

### P3-S2 — 在途列表与详情只读页面

**范围**：
- 展示 DIS 内部在途记录（P3-S3 手动创建）和百世同步来的 external in-transit 数据。
- 列表列：国家/仓库、外部单号、商品数量、匹配状态、物流状态、最后同步时间。
- 详情：商品明细、未匹配提示、轨迹时间线（含百世轨迹）。
- 不做新建在途、不做状态推进、不做入仓。

**停止条件**：列表与详情只读页面就绪 + 外部与内部在途双源展示 + 空/无权限/加载/错误状态处理 + 无写入入口。

### P3-S3 — 手动创建/补录在途记录

**范围**：
- 复用现有 `shipment` / `shipment_item` / `tracking_event` 表（Migration 00001，既有内部 shipment 基线）。
- 手动创建在途记录表单：船名/航次/起运港/目的港/国家/仓库/产品明细。
- `warehouse_id` 非 null 时仓库数据一致性校验（Admin 与 Operator 均需通过）：仓库存在且启用 + `type = 'overseas'` + `warehouse.country` 等于 `shipment.country`。校验失败返回中文错误且不调用创建 RPC。
- Operator 通过 `warehouseAccessRepository.canAccessWarehouse(user.id, warehouseId)` 校验仓库分配权限；Admin 无分配限制但必须通过仓库数据一致性校验。
- Server Action 不直接调用 Supabase 或 `get_assigned_warehouse_ids()`，通过 Repository 方法封装。
- RLS（Migration 00015）作为数据库兜底。
- 与百世只读同步分开（不同数据表，不同 UI 入口）。
- 不与 P3-S2 合并（P3-S2 是只读展示，P3-S3 是写入）。

**停止条件**：手动创建在途表单就绪 + 事务性写入（复用 `create_shipment_transactional` RPC Migration 00005，9 参数、SECURITY INVOKER、auth.uid()）+ Admin/Operator 权限校验（Operator 仅已分配仓库）+ 仓库数据一致性校验（存在/启用/类型/国家一致）+ 与百世同步 UI 入口分离。

### P3-S4A — 内部手动在途状态轨迹收口（已完成）

**已完成 + 返工**（2026-06-30）：内部 shipment/shipment_item/tracking_event 状态轨迹收口已完成。Migration 00022 三层校验（Zod/Repository/RPC）。`advanceStatus()` 统一委托 `changeStatus()` → RPC，不再直接 `from('shipment').update` + `from('tracking_event').insert`。详情页轨迹优化（升序+创建人）。1688/1688 测试（50 文件）。不接 Best/外部表/入仓联动。

### P3-S4 — 状态推进与物流轨迹映射（百世路径）

**范围**：
- 百世状态只做保守映射（仅映射明确可对应的状态）。
- 未识别状态只记录 tracking_event，不自动推进 `shipment.status`。
- 每次状态推进必须产生 `tracking_event`。
- 覆盖百世同步在途（P3-S1C）的状态推进。

**停止条件**：百世状态保守映射 + 未识别不自动推进 + tracking_event 必生成 + 权限校验。

### P3-S5 — 入仓事务与库存联动

**范围**：
- 仅在用户确认入仓时更新库存（`inventory.quantity`）。
- `shipment_item.warehoused_quantity` 与 `inventory.quantity` 在同一事务中更新。
- 事务化 RPC（新建 Migration）或应用层事务。
- 不允许百世同步自动直接改库存。
- 这是高风险任务，必须单独验收。

**停止条件**：入仓确认 → 库存联动事务化 + 百世数据不自动入仓 + 回滚安全 + 库存计算正确 + 权限校验。

### P3-S6 — 在途模块权限、RLS 与端到端验收

**范围**：
- Admin 与 Operator 权限完整验证。
- 已分配仓库隔离（operator 只能看到已分配仓库的在途数据）。
- Server Action、Repository、RLS 链路一致性检查。
- 空状态、无权限、错误状态、加载状态全覆盖。
- 端到端流程验收。

**停止条件**：全权限链路验证通过 + 仓库隔离正确 + 所有状态覆盖 + npm run test / lint / build 通过。

---

## 当前状态

**当前任务**：`P3-S4A` — 内部手动在途状态轨迹收口（**DONE**，2026-06-30）

**P3-S3 状态**：DONE（2026-06-28，Codex 独立验收通过）

**P3-S1B 状态**：CODE COMPLETE / BLOCKED_EXTERNAL（2026-06-28）。

**P3-S2E 完成**（2026-06-30）：在途入口收口 + 采购单号 + 海外库存轻量展开已完成。Migration 00020 新增 `shipment.purchase_order_no` 并升级 `create_shipment_transactional` 为 11 参数 Admin-only（含 `RETURNING id INTO v_shipment_id`）；Migration 00021 覆盖 `change_shipment_status_transactional` 为 Admin-only。Supabase 生产库已验证 `purchase_order_no` 字段存在，`create_shipment_transactional` / `change_shipment_status_transactional` 均为 Admin-only。海外库存行展开按 (variantId, warehouseId) 查询内部在途明细（单号/采购单号/在途数量/预计到货/详情链接），不串仓。44 项 P3-S2E 测试通过；全量 1603/1603（49 文件），lint 0 errors / 26 warnings，build pass。

**P3-S2D 完成**（2026-06-30）：`shipmentRepository.getInTransitByVariantAndWarehouse()` 按 (variant_id, warehouse_id) 聚合在途数量。海外库存页每行 inTransitQuantity 精确匹配 variantId + warehouseId（防串仓）。Dashboard 保持 variant 总在途。16 项测试含跨仓隔离验证。1558/1558 测试（47 文件），lint 0 errors / 27 warnings，build pass。不新增 Migration。

**P3-S2C 完成**（2026-06-30）：`shipmentRepository.getInTransitByVariant()` 按 variant_id 聚合在途数量（`quantity - warehoused_quantity`），排除 warehoused，Admin/Operator 仓库隔离。海外库存页新增"在途"/"库存+在途"列 + 在途统计卡片。Dashboard 关注产品动态新增"在途"列。Dashboard 在途库存卡片从占位替换为真实数据。14 项测试。1541/1541（46 文件），lint 0/26，build pass。不新增 Migration。

**P3-S2B 返工完成**（2026-06-29）：Migration 00018 新增 `shipment_no` NOT NULL UNIQUE + RPC 10 参数。Migration 00019 新增 `change_shipment_status_transactional` RPC（原子化状态更新 + tracking_event 插入，GET DIAGNOSTICS 行确认，SECURITY INVOKER）。`update()` 使用 `.select('id').single()` 确认命中 1 行（PGRST116 → NOT_FOUND）。`changeStatus()` 改为调用 RPC 替代两阶段分离写入。列表页单号 + 品名聚合列为主标识，移除目的国列和船名航次主显示。详情页可编辑基本信息（ShipmentEditForm）和手动变更状态（ShipmentStatusChange，booking→loading→departed→arrived→customs，禁用 warehoused，每次追加 tracking_event）。创建表单新增单号必填。Repository 新增 `update()` / `changeStatus()` + Server Actions 新增 `updateShipment()` / `changeShipmentStatus()`。Admin/Operator 仓库隔离 + 编辑权限完整。1526/1527 测试（47 文件），lint 0/26，build pass。不做库存联动。

**P3-S2A 完成**（被 P3-S2B 扩展）：`/dashboard/shipments` 列表页 + `/dashboard/shipments/[id]` 详情页就绪。仅读内部三表，不读外部在途三表。1491/1491 测试通过（45 文件，含 51 项 P3-S2A 行为测试），lint 0/26，build 通过。

**下一步**：P3-S4A DONE（内部状态轨迹收口）。P3-S4（百世路径）依赖 P3-S1B 解除阻塞。P3-S5（入仓联动）依赖 P3-S4。P3-S6（权限与验收）依赖 P3-S5。

## 与现有代码的关系

- 现有 `shipment` / `shipment_item` / `tracking_event` 表保留（用于手动补录 P3-S3 和状态推进 P3-S4）。
- P3-S1A 新增 `shipment_external_ref` / `shipment_external_item` 表**不替换**现有表，作为外部同步数据的独立存储。
- 现有 `src/features/shipments/` 模块保留，P3-S1A 可能新增 `src/features/in-transit/` 模块或扩展 shipments 模块（按 P3-S1A 实现时判断）。
- `tracking_event` 表可能需要扩展以容纳百世轨迹字段（provider / external_event_id / raw_payload），由 P3-S1A Migration 决定。

## 禁止事项

- 禁止将百世 API 凭证写入代码、文档、测试快照、日志或提交信息。
- 禁止百世原始响应字段作为业务模块公共类型。
- 禁止百世同步自动修改 `inventory.quantity`。
- 禁止使用 SKU 作为全局产品主键。
- 禁止合并 P3-S2 + P3-S3（只读展示与手动写入必须分任务验收）。
- 禁止将新建、状态推进、入仓联动合并为一个任务包。
