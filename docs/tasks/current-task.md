# Current Task Packet

## Task ID

`P3-S1A` — 百世只读在途同步边界与数据模型

## 状态

**AWAITING IMPLEMENTATION**（2026-06-26，Phase 3 启动）

## 背景

Phase 5（海外仓库存同步生产化）已全部完成（P5-SY1 ~ P5-SY13B DONE）。下一阶段回到 Phase 3：在途与物流。

首个有 API 的供应商是百世开放平台。百世是首个 provider 但不是唯一 provider，后续还会有无 API 或不同 API 的系统接入。

百世 API 只用于实时获取"在途产品、数量、物流信息"，不做下单、不做送货预报、不向百世写入任何数据。

P3-S1A 是 Phase 3 的第一个任务，负责设计数据模型和 Migration。

**允许**：Migration 00017 SQL 文件、类型定义、Zod schema、`database.ts` 类型同步、静态契约测试。

**禁止**：API Client 代码、百世 API 调用、Repository 业务逻辑、Server Action、UI 页面/组件、库存联动。

## 范围

### 1. Migration 新建 `shipment_external_ref` 表

存储从外部供应商（百世及后续系统）同步来的在途主单引用：

```sql
CREATE TABLE shipment_external_ref (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          text        NOT NULL CHECK (provider IN ('best')),  -- 后续扩展
  external_order_no text        NOT NULL,
  waybill_no        text,       -- 百世运单号，可能为 null
  country           text        NOT NULL CHECK (country IN ('TH','ID','MY','PH','VN','CN')),
  warehouse_id      uuid        REFERENCES warehouse(id) ON DELETE SET NULL,
  raw_payload       jsonb       NOT NULL DEFAULT '{}',  -- 百世原始响应，不解析为业务字段
  sync_status       text        NOT NULL DEFAULT 'active' CHECK (sync_status IN ('active','stale','error')),
  last_synced_at    timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- 幂等唯一约束：同 provider + external_order_no 不重复
CREATE UNIQUE INDEX idx_shipment_external_ref_provider_order
  ON shipment_external_ref(provider, external_order_no);
```

### 2. Migration 新建 `shipment_external_item` 表

存储外部在途的商品明细：

```sql
CREATE TABLE shipment_external_item (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  external_ref_id      uuid        NOT NULL REFERENCES shipment_external_ref(id) ON DELETE CASCADE,
  external_sku         text        NOT NULL,
  external_product_name text,
  quantity             integer     NOT NULL CHECK (quantity >= 1),
  matched_variant_id   uuid        REFERENCES product_variant(id) ON DELETE SET NULL,
  raw_payload          jsonb       NOT NULL DEFAULT '{}',  -- 百世原始商品行数据
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_shipment_ext_item_ref_id ON shipment_external_item(external_ref_id);
CREATE INDEX idx_shipment_ext_item_variant ON shipment_external_item(matched_variant_id);
CREATE INDEX idx_shipment_ext_item_sku     ON shipment_external_item(external_sku);
```

### 3. Migration 扩展 `tracking_event` 表（或新建 external tracking）

百世物流轨迹需要存储外部事件。两条路径（P3-S1A 实现时评估并选择一条）：

**路径 A**：扩展 `tracking_event` 表新增字段：
```sql
ALTER TABLE tracking_event
  ADD COLUMN IF NOT EXISTS provider       text CHECK (provider IN ('best')),
  ADD COLUMN IF NOT EXISTS external_event_id text,
  ADD COLUMN IF NOT EXISTS raw_payload    jsonb DEFAULT '{}';
```

**路径 B**：新建 `tracking_event_external` 表（保持 `tracking_event` 不变，外部事件独立存储）。

选择标准：如果百世轨迹字段与 DIS 内部 tracking_event 结构差异大，选 B；如果大部分字段重合，选 A。

### 4. RLS 策略

- `shipment_external_ref`：authenticated 可读，admin 可写（后续 task 细化）。
- `shipment_external_item`：authenticated 可读，admin 可写。
- `tracking_event` 扩展字段（如选路径 A）或新表（如选路径 B）：对应 RLS。

### 5. 类型定义

`src/features/shipments/types.ts`（或 `src/features/in-transit/types.ts`）新增：

- `ShipmentExternalRefRow` / `ShipmentExternalRefInsert` / `ShipmentExternalRefUpdate`
- `ShipmentExternalItemRow` / `ShipmentExternalItemInsert` / `ShipmentExternalItemUpdate`
- `ShipmentExternalRefDetail`（含 items + tracking events 的聚合类型）
- `ExternalTrackingEventRow`（如选路径 B）
- Provider 字面量类型：`'best'`

### 6. Zod Schema

- `shipmentExternalRefSchema`：provider / external_order_no / country / warehouse_id 校验
- `shipmentExternalItemSchema`：external_ref_id / external_sku / quantity / matched_variant_id 校验

### 7. database.ts 类型同步

`src/types/database.ts` 的 Tables 记录需同步新增表的 Row/Insert/Update 类型。

### 8. 静态契约测试

- Migration SQL 文件存在
- 表声明存在（`CREATE TABLE shipment_external_ref` / `CREATE TABLE shipment_external_item`）
- 字段类型正确（`raw_payload jsonb` / `provider text` / `external_order_no text` 等）
- 唯一索引存在
- 外键约束正确
- RLS 策略存在且启用
- CHECK 约束正确
- Migration 不修改已执行 Migration 00001~00016

### 9. 文档同步

- `docs/current-state.md`：Phase 3 启动，P3-S1A 为当前任务
- `docs/tasks/current-task.md`：本文件
- `docs/tasks/phase-3-shipments.md`：P3-S1A 状态更新为 IN_PROGRESS 或 DONE

## 不在范围内

- 不调用百世 API
- 不写百世 API Client 代码
- 不写 Repository 业务逻辑
- 不写 Server Action
- 不写 UI / 页面
- 不写库存联动
- 不修改 `inventory` 表
- 不修改现有 `shipment` / `shipment_item` 表（仅扩展 `tracking_event` 或新建外部表）
- 不实现匹配逻辑（仅预留 `matched_variant_id` 字段）

## 权限链

- Migration 执行：Supabase SQL Editor（手动执行，与现有流程一致）
- RLS：authenticated 可读，admin 可写（初步；后续 task 按需要细化 operator 仓库隔离）
- P3-S1A 不涉及 Server Action 或 Repository 代码

## 停止条件

1. Migration SQL 文件就绪（`supabase/migrations/00017_shipment_external_ref.sql` 或下一个可用编号）
2. `shipment_external_ref` 与 `shipment_external_item` 表定义完整
3. `tracking_event` 扩展或 `tracking_event_external` 新建完成
4. RLS 策略齐全
5. 类型定义与 Zod Schema 就绪
6. `database.ts` 已同步
7. 静态契约测试通过
8. `npm run test` 所有测试通过（不破坏现有 1199 项）
9. `npm run lint` 0 errors
10. `npm run build` 通过
11. 不写 API Client / Repository 业务逻辑 / Server Action / UI / 库存联动

**P3-S1A 完成后停止，等待 Codex 独立验收，不自动进入 P3-S1B。**

## 依赖

- P5-SY13B DONE（仓库分配管理 UI，production migration verified）
- Migration 00016 已在生产数据库执行
- 现有 `shipment` / `shipment_item` / `tracking_event` 表保留不变
- `warehouse` 表已有 5 个海外仓 + 1 个国内仓

## 设计决策（待 P3-S1A 实现时确认）

1. **Schema 命名通用性**：表名使用 `shipment_external_ref` / `shipment_external_item` 等 external/in-transit 通用语义，禁止 `best_order` / `best_item` 等强绑定特定 provider 的命名。`provider` 字段区分数据源，不通过表名区分。
2. **tracking_event 扩展 vs 新建表**：见上文路径 A/B 评估。
3. **模块位置**：现有 `src/features/shipments/` 或新建 `src/features/in-transit/` — 按架构需要判断。如果 in-transit 职责与 shipments 差异足够大（外部同步 vs 手动管理），新建模块更清晰。
4. **provider 枚举扩展策略**：当前仅 `'best'`，后续新增 provider 通过新 Migration 扩展 CHECK 约束。不提前建设 provider 注册表或复杂 Adapter 层。真实出现第二个 provider 且共性模式稳定后再抽取。
5. **`raw_payload` 访问控制**：Repository 层只透出 `raw_payload` 为 `Record<string, unknown>` 或 `unknown`，禁止定义百世专有字段接口作为公共契约。百世专有字段解析放在 `src/lib/providers/best/` 私有模块（P3-S1B 实现时创建）。

## 风险

1. **Migration 编号冲突**：当前最新为 00016，P3-S1A 使用 00017。如有并行开发，编号可能冲突 — P3-S1A 实现前检查最新 Migration 编号。
2. **tracking_event 扩展影响现有查询**：如选路径 A（新增列），现有 `tracking_event` 查询不受影响（新增列可空），但需确认现有 shipment 页面兼容。
3. **过度设计**：当前只有一个外部 provider（百世），不要提前建设多 provider 动态适配层。`provider` 字段用 CHECK 约束管理，provider 专有逻辑集中在 `src/lib/providers/best/`（P3-S1B 实现）。
