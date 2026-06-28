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
| **P3-S1B** | 百世 API Client、签名与 Dry Run 拉取 | P3-S1A | **REWORK (2026-06-28)** | `src/lib/providers/best/` 模块已完成（types.ts / signature.ts / schema.ts / parse-response.ts / client.ts / dry-run.ts / index.ts + 3 测试文件 74 项测试）。独立验收未通过，7 项返工已修复：Zod 校验 + 超时 finally + 错误传播 + 签名固定断言 + 测试维护。API 协议标记 SPECULATIVE。1336/1336 测试通过，lint 0 errors，build 通过。真实 Dry Run 待用户提供百世官方 API 文档和 BEST_OPEN_* 凭证。 |
| **P3-S1C** | 百世只读数据写入 DIS 外部在途表 | P3-S1B | BLOCKED | Dry Run 结果幂等写入 external ref / item / tracking event + 同 provider+external_order_no 不重复 + 未匹配商品保留未匹配状态 + 不更新 inventory |
| **P3-S1D** | 外部商品到 ProductVariant 的人工匹配基础 | P3-S1C | BLOCKED | `shipment_external_item.matched_variant_id` 可读写 + Admin/Operator 可匹配/解除匹配 + 不自动匹配 + 不用 SKU 做主键 |
| **P3-S2** | 在途列表与详情只读页面 | P3-S1D | BLOCKED | 列表展示国家/仓库/外部单号/商品数量/匹配状态/物流状态/最后同步时间 + 详情含商品明细/未匹配提示/轨迹时间线 + 不做新建/状态推进/入仓 |
| **P3-S3** | 手动创建/补录在途记录 | P3-S1A | BLOCKED | 手动创建 shipment + shipment_item（无 API 数据源或人工补录）+ 与百世同步分开 + 不与 P3-S2 合并 |
| **P3-S4** | 状态推进与物流轨迹映射 | P3-S2、P3-S3 | BLOCKED | DIS 六态可推进 + 百世状态保守映射 + 未识别状态只记录 tracking_event 不自动推进 shipment.status + 每次推进产生 tracking_event |
| **P3-S5** | 入仓事务与库存联动 | P3-S4 | BLOCKED | 仅在用户确认入仓时更新 inventory + shipment_item.warehoused_quantity 与 inventory.quantity 事务化 + 百世同步不自动改库存 |
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
        │
        └── P3-S2 + P3-S3
              └── P3-S4（状态推进与轨迹映射）
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
- 复用现有 `shipment` / `shipment_item` / `tracking_event` 表（Migration 00001/00002）。
- 手动创建在途记录表单：船名/航次/国家/仓库/产品明细。
- 与百世只读同步分开（不同数据源，不同 UI 入口）。
- 不与 P3-S2 合并（P3-S2 是只读展示，P3-S3 是写入）。

**停止条件**：手动创建在途表单就绪 + 事务性写入（复用 `create_shipment_transactional` RPC）+ 权限校验 + 与百世同步 UI 入口分离。

### P3-S4 — 状态推进与物流轨迹映射

**范围**：
- DIS 内部六态推进：`booking → loading → departed → arrived → customs → warehoused`。
- 百世状态只做保守映射（仅映射明确可对应的状态）。
- 未识别状态只记录 tracking_event，不自动推进 `shipment.status`。
- 每次状态推进必须产生 `tracking_event`。
- 同时覆盖手动在途（P3-S3）和百世同步在途（P3-S1C）的状态推进。

**停止条件**：六态可推进 + 百世状态保守映射 + 未识别不自动推进 + tracking_event 必生成 + 权限校验。

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

**当前任务**：`P3-S1B` — 百世 API Client、签名与 Dry Run 拉取（REWORK，2026-06-28）

`docs/tasks/current-task.md` 包含 P3-S1B 完整任务包。P3-S1B 独立验收未通过，修复后等待重新验收，不自动进入 P3-S1C。API 协议标记 SPECULATIVE，真实 Dry Run 待百世官方文档和凭证确认。

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
