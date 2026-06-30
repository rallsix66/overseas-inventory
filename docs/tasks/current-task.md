# Current Task Packet

## Task ID

`P3-S2D` — 在途库存聚合精确到仓库

## 状态

**DONE**（2026-06-30）

## 背景

P3-S2C 的 `getInTransitByVariant()` 按 variant_id 聚合在途数量，但海外库存页每行是 (variant + warehouse) 维度。同一 variant 在两个仓库都有在途时，两行显示相同的总在途数量（串仓）。P3-S2D 扩展为按 (variant_id, warehouse_id) 聚合，海外库存页每行只显示对应仓库的在途数量。

## 依赖

- P3-S2C DONE（`getInTransitByVariant()` 基础聚合）
- `warehouseAccessRepository`（仓库隔离）
- `getUserRole()`（权限判断）

## 范围

1. `shipmentRepository.getInTransitByVariantAndWarehouse()` — 新增方法，按 (variant_id, warehouse_id) 聚合，返回 `Map<variantId, Map<warehouseId, inTransitQty>>`，shipment 查询同时 select warehouse_id，shipment_item 查询同时 select shipment_id 用于关联
2. `getOverseasInventory` action — 改用仓库维度在途 Map，每行 `inTransitQuantity` 精确匹配 `variantId + warehouseId`；从仓库维度 Map 计算 variant 总在途供统计卡片使用
3. Dashboard 关注产品动态保持 `getInTransitByVariant()` variant 总在途（用户确认可接受）
4. 不写 inventory，不启用 warehoused，不接 Best，不做入库联动，不新增 Migration

## 禁止

- 不新增 Migration
- 不写 inventory.quantity
- 不接 Best/shipment_external_ref 外部表
- 不做入库联动
- 不启用 warehoused 状态
- 页面/组件不直接调用 `supabase.from()`

## 停止条件（全部满足）

1. `getInTransitByVariantAndWarehouse()` 按仓库维度聚合正确（16 项行为测试全部通过）
2. 同一 variant 在两个仓库都有在途时，海外库存每行只显示对应仓库数量（不串仓）
3. Admin/Operator 仓库隔离有效
4. `npm run test` 1558/1559 通过（49 文件，concurrency/best live 预存失败），`npm run lint` 0 errors / 27 warnings（all pre-existing），`npm run build` 通过

## 下一步

- P3-S2（完整在途列表与详情含百世双源）依赖 P3-S1D — **BLOCKED**
- P3-S4（状态推进与轨迹映射）依赖 P3-S2 + P3-S3 — **BLOCKED**
- P3-S5（入仓联动）依赖 P3-S4 — **BLOCKED**
- P3-S6（权限与验收）依赖 P3-S5 — **BLOCKED**

---

# 历史任务包（已完成）

## P3-S2C — 库存视图接入内部手动在途只读聚合

## 背景

P3-S2B 内部手动在途维护收口已完成。当前海外库存页、Dashboard 关注产品动态、Dashboard 在途库存入口卡片均未展示内部 shipment/shipment_item 在途数据。本任务将内部在途数据以只读方式接入这三个视图。

## 依赖

- P3-S2B DONE（shipment/shipment_item 表中有在途数据）
- `warehouseAccessRepository`（仓库隔离）
- `getUserRole()`（权限判断）

## 范围

1. `shipmentRepository.getInTransitByVariant()` — 按 variant_id 聚合在途数量（`quantity - warehoused_quantity`），排除 warehoused，Admin/Operator 仓库隔离，只读不写 inventory
2. 海外库存页：新增"在途"和"库存+在途"列 + 在途统计卡片
3. Dashboard 关注产品动态：新增"在途"列
4. Dashboard 首页：在途库存入口卡片从占位替换为真实数据（SKU 数 + 在途总量）
5. `InventoryItem` 类型新增 `inTransitQuantity`；`OverseasStats` 类型新增 `inTransitSkuCount`/`inTransitTotalQuantity`；`FollowedVariantBasic` 类型新增 `inTransitQuantity`

## 禁止

- 不新增 Migration
- 不写 inventory.quantity
- 不接 Best/shipment_external_ref 外部表
- 不做入库联动
- 不启用 warehoused 状态
- 页面/组件不直接调用 `supabase.from()`

## 停止条件（全部满足）

1. `getInTransitByVariant()` 聚合逻辑正确（14 项行为测试全部通过）
2. 海外库存页显示"在途"和"库存+在途"列 + 在途统计卡片
3. Dashboard 关注产品动态显示"在途"列
4. Dashboard 在途库存卡片显示真实数据（SKU 数 + 在途总量）
5. Admin/Operator 仓库隔离有效
6. `npm run test` 1541/1541 通过（46 文件），`npm run lint` 0/26，`npm run build` 通过

## 下一步

- P3-S2（完整在途列表与详情含百世双源）依赖 P3-S1D — **BLOCKED**
- P3-S4（状态推进与轨迹映射）依赖 P3-S2 + P3-S3 — **BLOCKED**
- P3-S5（入仓联动）依赖 P3-S4 — **BLOCKED**
- P3-S6（权限与验收）依赖 P3-S5 — **BLOCKED**

---

# 历史任务包（已完成）

## P3-S2B — 内部手动在途维护收口

**DONE → 返工完成**（2026-06-29）

## 背景

P3-S2A（内部手动在途只读页面）DONE。P3-S2B 扩展为可维护管理台：新增单号字段、列表重新布局、详情可编辑、状态可手动变更。不读外部在途三表、不调百世 API、不做库存联动。

## 依赖

- P3-S2A DONE
- P3-S3 DONE（创建表单）
- Migration 00001（`shipment` / `shipment_item` / `tracking_event` 表）
- Migration 00005（`create_shipment_transactional` RPC 旧版）
- Migration 00015（仓库隔离 RLS）
- Migration 00018（新增 `shipment_no` 字段 + RPC 更新为 10 参数）
- Migration 00019（`change_shipment_status_transactional` RPC，原子化状态更新 + tracking_event 插入）
- `requireActiveAuth()` / `warehouseAccessRepository`

## 范围

1. Migration 00018：`shipment.shipment_no` NOT NULL UNIQUE + 旧数据回填 SN-YYYYMMDD-NNNN + `create_shipment_transactional` 更新为 10 参数（含 p_shipment_no）
2. 列表页：主标识改为单号 + 品名聚合列（最多 3 个），移除目的国列，船名/航次不再作为列表主显示
3. 详情页：基本信息可编辑（`ShipmentEditForm` 客户端组件）+ 手动状态变更（`ShipmentStatusChange`，booking→loading→departed→arrived→customs，禁用 warehoused，每次追加 tracking_event）
4. 创建页：新增单号必填输入
5. Repository 新增 `update()` / `changeStatus()` + Operator 仓库隔离
6. Server Actions 新增 `updateShipment()` / `changeShipmentStatus()`
7. 权限：Admin 可编辑全部，Operator 仅自己仓库下的 shipment。`requireActiveAuth()` + Zod + Repository + RLS 兜底
8. （返工）Migration 00019：`change_shipment_status_transactional` RPC 替代两阶段分离写入
9. （返工）`update()` 使用 `.select('id').single()` 确认命中 1 行（PGRST116 → NOT_FOUND）
10.（返工）新增 32 项 P3-S2B 行为测试

## 禁止

- 不读/写 `shipment_external_ref` / `shipment_external_item` / `tracking_event_external`
- 不调百世 API
- 不做库存联动（`changeStatus` 禁用 warehoused）
- 页面/组件不直接调用 `supabase.from()`

## 停止条件（已满足）

1. 创建时可填单号（必填，格式校验）
2. 列表显示单号 + 品名，不再用船名航次作为主信息，不显示目的国
3. 详情可编辑基本信息（单号/船名/航次/港口/国家/仓库/预计到仓/备注）
4. 状态可手动变更并产生 tracking_event（禁用 warehoused）
5. Admin/Operator 仓库隔离有效（Operator 仅自己仓库下的 shipment 可编辑）
6. `npm run test` 1526/1527 通过（2 预存失败：concurrency / best live dry-run），`npm run lint` 0/26，`npm run build` 通过
7. `docs/current-state.md` / `docs/tasks/current-task.md` 同步

## 下一步

- P3-S2（完整在途列表与详情含百世双源）依赖 P3-S1D — **BLOCKED**
- P3-S4（状态推进与轨迹映射）依赖 P3-S2 + P3-S3 — **BLOCKED**
- P3-S5（入仓联动）依赖 P3-S4 — **BLOCKED**
- P3-S6（权限与验收）依赖 P3-S5 — **BLOCKED**

---

# 历史任务包（已完成）

## P3-S3 — 手动创建/补录在途记录

**状态**：**DONE**（2026-06-28，Codex 独立验收通过）

## 背景

P3-S1A DONE（Migration 00017：`shipment_external_ref` / `shipment_external_item` / `tracking_event_external` 外部在途表）。P3-S3 在任务依赖图上依赖 P3-S1A，但实现复用既有内部 shipment 基线（Migration 00001：`shipment` / `shipment_item` / `tracking_event` 表；Migration 00005：`create_shipment_transactional` RPC 当前版本）。P3-S1B 已收口为 CODE COMPLETE / BLOCKED_EXTERNAL（阻塞原因：百世账号 API 权限尚未开通，代码和测试已保留）。

P3-S3 是 Phase 3 的独立分支，仅依赖 P3-S1A（DONE），不依赖百世 API。复用现有 `shipment` / `shipment_item` / `tracking_event` 表实现手动创建/补录在途记录功能。

**允许**：Repository、Server Action、表单 UI 页面/组件、权限校验、Zod 输入校验、事务性写入（复用 `create_shipment_transactional` RPC Migration 00005）。

**禁止**：百世 API 调用、`shipment_external_ref` / `shipment_external_item` / `tracking_event_external` 写入、库存联动、列表页开发、详情页开发、状态推进、轨迹映射、入仓联动、P3-S2/P3-S4/P3-S5 范围。

## 数据契约（以真实数据库为准）

### shipment（Migration 00001）

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | uuid | PK, `gen_random_uuid()` |
| `vessel_name` | text | nullable |
| `voyage_number` | text | nullable |
| `origin_port` | text | nullable |
| `destination_port` | text | nullable |
| `country` | text | NOT NULL, CHECK IN ('TH','ID','MY','PH','VN','CN') |
| `warehouse_id` | uuid | REFERENCES warehouse(id) ON DELETE SET NULL, nullable |
| `status` | text | NOT NULL, default 'booking', CHECK IN ('booking','loading','departed','arrived','customs','warehoused') |
| `estimated_arrival` | date | nullable |
| `note` | text | nullable |
| `created_by` | uuid | NOT NULL, REFERENCES profiles(id) |
| `created_at` | timestamptz | NOT NULL, default now() |
| `updated_at` | timestamptz | NOT NULL, default now() |

### shipment_item（Migration 00001）

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | uuid | PK, `gen_random_uuid()` |
| `shipment_id` | uuid | NOT NULL, FK → shipment(id) ON DELETE CASCADE |
| `variant_id` | uuid | NOT NULL, FK → product_variant(id) ON DELETE RESTRICT |
| `quantity` | integer | NOT NULL, CHECK >= 1 |
| `warehoused_quantity` | integer | NOT NULL, default 0, CHECK >= 0 |
| `created_at` | timestamptz | NOT NULL, default now() |

附加约束：`CHECK (warehoused_quantity <= quantity)`。

### tracking_event（Migration 00001）

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | uuid | PK, `gen_random_uuid()` |
| `shipment_id` | uuid | NOT NULL, FK → shipment(id) ON DELETE CASCADE |
| `status` | text | NOT NULL, CHECK IN ('booking','loading','departed','arrived','customs','warehoused') |
| `description` | text | nullable |
| `occurred_at` | timestamptz | NOT NULL |
| `created_by` | uuid | NOT NULL, REFERENCES profiles(id) |
| `created_at` | timestamptz | NOT NULL, default now() |

### create_shipment_transactional RPC（Migration 00005，当前版本）

```sql
CREATE OR REPLACE FUNCTION public.create_shipment_transactional(
  p_vessel_name       text,
  p_voyage_number     text,
  p_origin_port       text,
  p_destination_port  text,
  p_country           text,
  p_warehouse_id      uuid,
  p_estimated_arrival date,
  p_note              text,
  p_items             jsonb   -- [{"variant_id": "...", "quantity": 1}, ...]
)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
```

关键特征：
- **9 参数**（无 `p_created_by`，`created_by` 内部使用 `auth.uid()`）。
- **SECURITY INVOKER**（非 SECURITY DEFINER），以调用用户身份执行。
- **角色校验**：内部调用 `get_user_role()`，仅 admin 与 operator 可通过。
- **输入校验**：拒绝 NULL `p_items`、非数组、空数组。
- **同一事务创建**：INSERT shipment + 循环 INSERT shipment_item + INSERT tracking_event（status='booking', description='订舱', occurred_at=now()）。
- **权限**：`REVOKE FROM PUBLIC/anon`，`GRANT TO authenticated`。

Migration 00002 的 10 参数 SECURITY DEFINER 版本已被 Migration 00005 DROP 并替换，不得引用 00002 版本。

## 权限模型

### Admin
- 可以为任意合法仓库创建 shipment。
- `warehouse_id` 可选（可传 null）。

### Operator
- 可以创建 shipment，但只能选择自己已分配的仓库。
- `warehouse_id` 必填（不得传 null）。

### 仓库数据一致性校验（Admin 与 Operator 均需通过）

`warehouse_id` 非 null 时，以下校验全部通过后才允许创建：

1. **仓库存在且启用**：目标仓库必须存在且 `is_active = true`。
2. **仓库类型为海外仓**：`warehouse.type = 'overseas'`（拒绝国内仓）。
3. **国家与仓库一致**：`warehouse.country` 必须等于 `shipment.country`。
4. **Operator 额外要求**：Operator 必须对该仓库有分配权限（通过 `warehouseAccessRepository.canAccessWarehouse(user.id, warehouseId)` 校验）。

校验失败返回明确中文错误（"仓库不存在或已停用" / "只能选择海外仓库" / "国家与仓库不一致" / "您没有该仓库的操作权限"），且不调用创建 RPC。

UI 按所选 country 过滤仓库仅为体验优化，Server Action / Repository 仍必须执行服务端校验。

### 实现层级

1. **Server Action**：`requireActiveAuth()` 获取当前用户 → Zod 校验输入 → 调用仓库校验方法检查存在性、启用状态、类型和国家一致性 → Operator 时额外调用 `warehouseAccessRepository.canAccessWarehouse(user.id, warehouseId)` 检查分配权限。
2. **Repository 层**：提供仓库校验方法（存在性 + 启用 + 类型 + 国家匹配），封装 Supabase 查询。Server Action 不直接调用 Supabase，也不直接调用 `get_assigned_warehouse_ids()`。
3. **RLS**：Migration 00015 已对 `shipment` / `shipment_item` / `tracking_event` 启用 operator 仓库隔离 RLS，作为数据库兜底。不新增 Migration。
4. **停用用户**：`requireActiveAuth()` 已检查 `is_active`，停用用户拒绝访问。
5. **未登录用户**：middleware 路由守卫兜底，Server Action 层 `requireActiveAuth()` 二次校验。

### 验收覆盖

- Admin 创建成功（含 warehouse_id 和 null warehouse_id 两条路径）。
- 已分配仓库 Operator 创建成功。
- 未分配仓库 Operator 创建被拒绝（应用层中文错误）。
- Operator 传 null warehouse_id 被拒绝。
- 停用用户被拒绝。
- 未登录用户被拒绝。
- 国家与仓库 country 不一致被拒绝（中文错误）。
- 停用仓库被拒绝（中文错误）。
- 国内仓库（type != 'overseas'）被拒绝（中文错误）。
- 不存在的仓库 ID 被拒绝（中文错误）。

## 现有代码基线

`src/features/shipments/` 模块已存在，需按真实 schema 审计和复用：

| 文件 | 现状 | P3-S3 处理 |
|---|---|---|
| `types.ts` | `CreateShipmentData` / `ShipmentListItem` / `ShipmentDetail` / `ShipmentStatus` 等类型已定义，字段名与真实 DB 一致（camelCase 映射） | 复用，按需补字段 |
| `schema.ts` | `createShipmentSchema`（Zod，字段对应 RPC 参数）+ `advanceStatusSchema` | 复用 `createShipmentSchema`，不修改 `advanceStatusSchema` |
| `repository.ts` | `list()` / `getById()` / `create()`（调用 RPC）/ `advanceStatus()` | 复用 `create()`；`list()` / `getById()` / `advanceStatus()` 属于 P3-S2/P3-S4/P3-S5，不在 P3-S3 范围 |
| `actions.ts` | `createShipment()`（使用 `requireAuth()`）+ `advanceShipmentStatus()` | 复用 `createShipment()`（需升级为 `requireActiveAuth()` + 增强权限校验）；`advanceShipmentStatus()` 属于 P3-S4，不在 P3-S3 范围 |

`src/app/dashboard/shipments/page.tsx` 当前为占位页，不在 P3-S3 范围。

P3-S3 不激活、不扩展、不将 `advanceShipmentStatus` 或 `advanceStatus`/warehoused 逻辑作为交付成果。

## P3-S3 任务范围设计

### 1. Server Action 增强

`src/features/shipments/actions.ts` 中 `createShipment()`：

- 保持使用 `requireActiveAuth()`（当前 `actions.ts` 使用 `requireAuth()`，P3-S3 需升级为 `requireActiveAuth()` 以校验 `is_active`）。
- Zod 校验后，若 `warehouseId` 非空：
  - 调用仓库校验方法（Repository 层），依次检查：仓库存在且启用 → `type = 'overseas'` → `country` 与 `shipment.country` 一致。
  - 任一校验失败 → 拒绝并返回对应中文错误，不调用创建 RPC。
- 若当前用户为 Operator：
  - `warehouseId` 为空/null → 拒绝（"请选择仓库"）。
  - 调用 `warehouseAccessRepository.canAccessWarehouse(user.id, warehouseId)` → 拒绝（"您没有该仓库的操作权限"）。
- Admin 无额外限制（但必须通过仓库数据一致性校验）。
- 全部校验通过后，调用 `shipmentRepository.create(parsed.data)`。
- `revalidatePath('/dashboard/shipments')`。

### 2. UI 页面

`src/app/dashboard/shipments/new/page.tsx`（新建）：

- 表单字段（camelCase，映射到 RPC 参数）：
  - `vesselName` — 船名（可选，文本）
  - `voyageNumber` — 航次（可选，文本）
  - `originPort` — 起运港（可选，文本）
  - `destinationPort` — 目的港（可选，文本）
  - `country` — 国家（必填，select：TH/ID/MY/PH/VN/CN）
  - `warehouseId` — 仓库（select，数据来自仓库列表；Operator 仅显示已分配仓库且必填；Admin 可选）
  - `estimatedArrival` — 预计到仓日期（可选，日期选择器）
  - `note` — 备注（可选，textarea）
  - `items` — 产品明细表格（必填，至少 1 行）：
    - `variantId` — ProductVariant 选择器
    - `quantity` — 数量（integer >= 1）
    - 可添加/删除行
- 提交时调用 `createShipment()` Server Action。
- 成功跳转 `/dashboard/shipments`（P3-S2 详情页就绪前临时跳转）。
- 错误状态（toast 中文错误提示）。
- 加载状态（提交按钮 disabled + spinner）。
- 权限拒绝状态（Operator 无已分配仓库时显示提示）。

### 3. 依赖数据接口

- **仓库列表**：需从现有 `warehouse` 查询中获取（Admin 显示符合所选国家的启用海外仓库；Operator 显示其中已分配给自己的仓库）。
- **ProductVariant 列表**：需查询 variant 基础信息（id / sku / product name），供下拉选择。

### 4. 与百世同步的关系

- P3-S3 手动创建的 shipment/shipment_item/tracking_event 使用 `shipment` / `shipment_item` / `tracking_event` 表。
- 百世同步数据使用 `shipment_external_ref` / `shipment_external_item` / `tracking_event_external` 表（P3-S1A Migration 00017）。
- UI 入口分开：`/dashboard/shipments/new`（手动创建，本任务）vs 百世同步数据查看入口（P3-S2）。

## 不在范围内

- 不调用百世 API。
- 不写 `shipment_external_ref` / `shipment_external_item` / `tracking_event_external`。
- 不实现或扩展列表页（`/dashboard/shipments` 保持占位）。
- 不实现详情页。
- 不实现 P3-S2（在途列表与详情只读页面，含百世数据双源展示）。
- 不实现 P3-S4（状态推进与物流轨迹映射）。
- 不实现 P3-S5（入仓事务与库存联动）。
- 不修改 `inventory`。
- 不新增 Migration（复用 00001/00005/00015）。
- 不激活或扩展 `advanceShipmentStatus` / `advanceStatus` / warehoused 逻辑。

## 停止条件

1. `/dashboard/shipments/new` 手动创建在途记录表单 UI 就绪（vessel_name / voyage_number / origin_port / destination_port / country / warehouse_id / estimated_arrival / note + items 明细表格）。
2. 事务性写入复用 `create_shipment_transactional` RPC（Migration 00005，9 参数、SECURITY INVOKER、auth.uid()）。
3. Admin 可创建（含 null warehouse_id）。
4. Operator 可创建已分配仓库的 shipment；未分配仓库或 null warehouse_id 被拒绝（应用层中文错误）。
5. 停用用户和未登录用户被拒绝。
6. 所有输入 Zod 校验，中文错误提示。
7. 空数据、加载、错误、无权限状态已处理。
8. 页面和客户端组件没有直接访问数据库。
9. 创建成功跳转 `/dashboard/shipments`（临时）。
10. TypeScript 无错误，`npm run test` 通过，`npm run lint` 0 errors，`npm run build` 通过。
11. `docs/current-state.md` 已更新。

**P3-S3 完成后停止，等待独立验收，不自动进入 P3-S4。**

## 依赖

- P3-S1A DONE（Migration 00017 外部在途表已执行）。P3-S3 实现复用既有内部 shipment 基线：Migration 00001（`shipment` / `shipment_item` / `tracking_event` 表）+ Migration 00005（`create_shipment_transactional` RPC 当前版本，9 参数、SECURITY INVOKER、auth.uid()）。
- Migration 00015（user_warehouses + RLS + `get_assigned_warehouse_ids()`）已执行。
- P3-S1B CODE COMPLETE / BLOCKED_EXTERNAL（不影响 P3-S3，P3-S3 不依赖百世 API）。
- `src/lib/auth.ts`：`requireActiveAuth()` / `requireActiveAdmin()` 已就绪。
- `src/features/shipments/` 模块骨架已存在（types / schema / repository / actions）。
- shadcn/ui 组件库可用。

## 风险

1. **`create_shipment_transactional` RPC 权限**：当前版本（Migration 00005）为 SECURITY INVOKER，operator 需有 shipment/shipment_item/tracking_event 的 INSERT 权限。Migration 00015 已对 operator 启用这些表的 RLS INSERT 策略，但需在实现时验证 operator warehouse_id ∈ assigned 时 INSERT 成功。
2. **ProductVariant 选择器**：手动选择产品变体需要查询 Variant 列表（含产品名和 SKU），需确认现有查询接口对 operator 的仓库隔离过滤是否影响 variant 查询。
3. **`warehouse_id` nullable**：RPC 接受 null warehouse_id，但 operator RLS 要求 warehouse_id ∈ assigned（null 不在任何已分配集合中），RLS 层天然拒绝 operator 传 null。应用层仍需前置校验给出明确中文错误。
4. **现有 `createShipment()` action 权限**：当前使用 `requireAuth()`，P3-S3 需升级为 `requireActiveAuth()` 并增加 operator 分支（仓库分配校验）。

---

## REWORK 记录

### REWORK Round 2（2026-06-28）

**状态**：REWORK。3 类修复全部实现，等待 Codex 复验。

| Fix | 类别 | 修复内容 |
|-----|------|---------|
| Fix 7 | Repository 查询错误检查 | `searchVariants()` 中所有 5 条 Supabase 查询均读取 `.error`，任一失败抛出 `ShipmentError('查询 SKU 列表失败', 'DB_ERROR')`；LIKE 转义同时处理 `\`、`%`、`_`（先转义反斜杠，再转义百分号和下划线）；归档过滤 `notIn('id', archivedIds)` 放在每条 product_variant 查询的 `limit()` 之前，不再在 JS 层过滤 |
| Fix 8 | 独立 Repository 行为测试 | 新建 `repository-behavior.test.ts`：mock `createClient()` + `variantRepository`，不 mock `shipmentRepository` 本身，直接调用真实 `shipmentRepository.searchVariants()`。覆盖错误传播（5 条查询路径 + getUserArchivedVariantIds）、notIn 在 limit 前、三路合并去重、LIKE 转义（`\`/`%`/`_`）、Repository 错误经 Server Action 返回 ActionResult 中文错误 |
| Fix 9 | 清理文档与测试 | 删除 `p3-s3-contract.test.ts` 中"Repository 查询行为"仅做源码字符串检查的虚假覆盖（移至 `repository-behavior.test.ts` 行为测试）；三份文档统一 P3-S3 REWORK；删除 1386/1388、2 个预存失败、24 warnings 等旧数据 |

### REWORK Round 2 修改文件

| 文件 | 操作 | 说明 |
|---|---|---|
| `src/features/shipments/repository.ts` | 修改 | 所有查询 error 检查 + notIn 在 limit 前 + LIKE 转义含 `\` |
| `src/features/shipments/repository-behavior.test.ts` | **新建** | mock createClient + variantRepository，直接调用真实 searchVariants() |
| `src/features/shipments/p3-s3-contract.test.ts` | 修改 | 移除虚假"Repository 查询行为"section；源码非回归合并到 section 3 |
| `docs/current-state.md` | 修改 | P3-S3 统一 REWORK；删除旧数据 |
| `docs/tasks/current-task.md` | 修改 | 新增 Round 2 记录（本表） |
| `docs/tasks/phase-3-shipments.md` | 修改 | P3-S3 状态统一 REWORK；删除旧测试计数 |

### 质量门（Round 2）

- `npm run test`：1432/1432 通过（44 文件），零失败（新增 repository-behavior.test.ts 23 项测试）
- `npm run lint`：0 errors / 26 warnings（全部预存）
- `npm run build`：通过
- `git diff --check`：通过

### REWORK Round 3（2026-06-28，微修复）

3 项微修复，全部实现并通过质量门：

| Fix | 类别 | 修复内容 |
|-----|------|---------|
| Fix 10 | 文档 stale 数据清理 | `docs/current-state.md` Last Updated 替换 old stale data 为 Round 2 准确数据 |
| Fix 11 | LIKE ilike 参数断言 | `createQueryMock` 新增 `callLog` 记录完整 `{ method, args }`；LIKE 测试改为直接断言 `ilike()` 第二个参数（反斜杠/百分号/下划线/组合/无特殊字符）；不重复生产 regex |
| Fix 12 | 真实 Server Action 链路 | 删除 `searchVariantsAction()` 模拟函数；mock `requireActiveAuth` + `createClient` + `variantRepository`，不 mock `shipmentRepository`；直接调用 `actions.ts` 真实 `searchVariants()`；验证 Supabase error 到 ShipmentError 到 ActionResult 完整链路 |

### 最终验收（2026-06-28，Codex 独立验收通过）

- 目标测试：96/96（p3-s3-contract.test.ts + repository-behavior.test.ts）
- 全量测试：1439/1439（44 文件），0 failures
- `npm run lint`：0 errors / 26 warnings（全部预存）
- `npm run build`：通过
- `git diff --check`：通过
- Repository 错误传播、LIKE 实际参数、真实 Server Action 链路均已验证
- P3-S3 标记 DONE。P3-S1B 保持 CODE COMPLETE / BLOCKED_EXTERNAL。

### 范围边界（不变）

- 未实现列表/详情页（P3-S2）
- 未激活 `advanceShipmentStatus` / `advanceStatus` / warehoused 逻辑（P3-S4/P3-S5）
- 未调用百世 API
- 未写入外部在途三表
- 未新增 Migration
- 未修改 `inventory`（仅 LF/CRLF 警告）

### REWORK Round 1（2026-06-28，已完成）

6 项修复已实现并通过质量门（1411/1411 测试，lint 0 errors，build pass）。详情不再重复。

### 范围边界（不变）

- 未实现列表/详情页（P3-S2）
- 未激活 `advanceShipmentStatus` / `advanceStatus` / warehoused 逻辑（P3-S4/P3-S5）
- 未调用百世 API
- 未写入外部在途三表
- 未新增 Migration
- 未修改 `inventory`
