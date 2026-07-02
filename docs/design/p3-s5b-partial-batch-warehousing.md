# P3-S5B：Admin 部分入仓 / Admin 批量入仓 — 需求分析与技术设计

> 状态：设计返工完成（v4 — 收紧 P3-S5B0 范围 + 重写吸收判定），待用户审批
> 日期：2026-07-02
> 依赖：P3-S5A DONE（`warehouse_shipment_transactional` RPC 已执行并验证）
> 返工历史：
>   v1→v2：DIS 入仓动作写入 inventory.quantity → BigSeller 同步后库存翻倍。剥离 inventory 写入
>   v2→v3：① 旧 00023 入口仍活跃，新增 P3-S5B0 前置封存；② "已确认到仓"仅查 customs 会在 auto-complete 后消失
>   v3→v4：① P3-S5B0 范围过大——不应渲染依赖 00026 的双模式按钮，收窄为纯阻断；② tracking_event.occurred_at ≤ last_sync_at 不能证明吸收——BigSeller 同步可能只刷新时间戳但库存未变。重写为手动确认 + 时间窗口兜底

## 1. 需求背景

### 1.1 业务上下文

DIS 的 `inventory.quantity`（各仓库实际库存数量）来源于 BigSeller 抓取同步链路（P5-SY 系列）。BigSeller 本身已管理采购单和海外仓入库流程——当货物到达海外仓时，BigSeller 侧会更新库存数据，DIS 通过定期同步获取最新库存。

P3-S5A 实现了 Admin 手动确认入仓：一笔 shipment 到达 customs 状态后，Admin 可一键将其全部 shipment_item 的 `warehoused_quantity = quantity`（全额入仓），UPSERT 库存，并将 shipment 状态推进至 `warehoused`。

**P3-S5A 的两个问题**：

1. **功能限制**：只能全额入仓，无法分批；只能逐笔操作，无法批量处理
2. **数据权威冲突**：`warehouse_shipment_transactional` RPC（00023）在入仓时直接写入 `inventory.quantity +=`，但 `inventory.quantity` 的真实来源是 BigSeller 同步——同一批入库会被 DIS 和 BigSeller 各计一次，导致库存翻倍或账实不一致

**P3-S5B 要解决**：

1. **封存旧版入仓路径**（P3-S5B0）：在引入新功能之前，先封住 00023 的活跃调用入口——action 阻断桩 + UI 隐藏按钮 + 测试验证。**不在此步骤引入任何新 UI**
2. **部分入仓**（P3-S5B1~B3）：Admin 可按实际到达批次，逐批指定每个 SKU 的确认数量——**只更新 shipment/shipment_item 进度，不写 inventory**
3. **批量入仓**（P3-S5B4）：Admin 可在列表页勾选多笔 customs 状态的 shipment，批量确认到仓——同样不写 inventory
4. **正确展示已确认到仓**：不依赖 `last_sync_at` 自动消失；基于 DIS 侧事实记录 + Admin 手动确认吸收 + 时间窗口兜底

### 1.2 库存数据权威边界（核心设计原则）

```
┌─────────────────────────────────────────────────────────────────┐
│                    库存数据权威模型                                │
│                                                                   │
│  inventory.quantity                                              │
│    ↑                                                              │
│    │ 唯一写入路径：BigSeller 同步链路 (P5-SY)                      │
│    │ - sync_warehouse_inventory RPC                               │
│    │                                                              │
│  DIS 入仓（P3-S5B）：                                            │
│    - 更新 shipment_item.warehoused_quantity（到货进度）           │
│    - 更新 shipment.status（流程状态）                              │
│    - 写入 tracking_event（审计轨迹）                               │
│    - ❌ 不写 inventory.quantity / updated_at / last_sync_at       │
│                                                                   │
│  "已确认到仓" ≠ "BigSeller 已入库"                                │
│    - "已确认到仓"是 DIS 侧事实：Admin 在 DIS 确认货物到达          │
│    - "BigSeller 已入库"是 BigSeller 侧事实：采购入库流程完成       │
│    - 两者之间存在自然时间差                                        │
│    - DIS 不自动推断 BigSeller 是否已入库                           │
│    - 吸收判定由 Admin 手动确认（§6）                               │
│                                                                   │
│  00023 旧版路径处理：                                             │
│    - P3-S5B0 前置封存：action 阻断桩 + UI 隐藏按钮                │
│    - 00023 函数保留不修改（不修改已执行 migration）               │
│    - 长期：另开 Task 通过新 migration CREATE OR REPLACE 修复      │
└─────────────────────────────────────────────────────────────────┘
```

## 2. 当前可复用资产

### 2.1 数据库层

| 资产 | 状态 | 可复用性 |
|---|---|---|
| `shipment_item` 表 | `warehoused_quantity INTEGER DEFAULT 0`，CHECK `warehoused_quantity <= quantity` | ✅ 已支持部分入仓语义，无需 DDL |
| `shipment` 表 | 含 `status`、`warehouse_id`、`updated_at` | ✅ P3-S5B1 新增 `bigseller_absorbed_at` 列（NULL = 未确认吸收） |
| `inventory` 表 | `UNIQUE(variant_id, warehouse_id)`，`quantity INTEGER DEFAULT 0` | ⚠️ **不在此功能中写入**——quantity 仅由 BigSeller 同步维护 |
| `tracking_event` 表 | 含 `status`、`occurred_at`、`created_by` | ✅ 只读引用——`occurred_at` 用于"已确认到仓"的时间窗口计算 |
| `warehouse_shipment_transactional` RPC | Migration 00023，SECURITY INVOKER，含 `inventory.quantity +=` | ⚠️ **P3-S5B0 封存应用层入口**。函数体保留不改 |
| `change_shipment_status_transactional` RPC | Migration 00022，Admin-only | ✅ 无需修改 |
| RLS 策略 | 46 条，shipment/shipment_item/inventory 三层防御 | ✅ 无需修改。`bigseller_absorbed_at` 列由现有 shipment RLS 策略覆盖 |

### 2.2 应用层

| 资产 | 文件 | 可复用性 |
|---|---|---|
| `shipmentRepository` | `src/features/shipments/repository.ts` | ✅ 13 个方法可复用。P3-S5B0 阻断 `warehouseShipment()`。P3-S5B2 新增 4 个方法 |
| `warehouseShipment()` action | `src/features/shipments/actions.ts` | ⚠️ **P3-S5B0 改为阻断桩**。P3-S5B2 新增 `partialWarehouseShipment` + `batchWarehouseShipments` + `confirmBigsellerAbsorption` |
| `WarehouseShipmentButton` | `src/features/shipments/components/warehouse-shipment-button.tsx` | ⚠️ **P3-S5B0 隐藏**（不渲染）。**P3-S5B3 替换**为双模式下拉（全额/部分，走新 RPC） |
| `ShipmentsPageContent` | `src/app/dashboard/shipments/_components/shipments-page-content.tsx` | ✅ P3-S5B4 新增 checkbox 列 + 批量按钮 |
| `shipmentColumns` | `src/features/shipments/columns.tsx` | ✅ 批量模式下新增 checkbox 列定义 |
| `canWarehouseShipment` / `warehouseBlockReason` | 详情页 `[id]/page.tsx` | ✅ 复用。P3-S5B0 期间 guard 阻止旧按钮渲染 |

### 2.3 页面入口

| 页面 | 路由 | 当前功能 |
|---|---|---|
| Shipment 列表 | `/dashboard/shipments` | 筛选 + 分页 + 行点击进入详情 |
| Shipment 详情 | `/dashboard/shipments/[id]` | 基础信息 + 产品明细 + 轨迹时间线。P3-S5B0 隐藏旧入仓按钮；P3-S5B3 新增双模式按钮 + 吸收确认按钮 |
| 海外库存 | `/dashboard/inventory/overseas` | 在途明细展开 + inventory.quantity（BigSeller 库存）+ P3-S5B4 新增"已确认到仓"列 |

## 3. 功能范围

### 3.0 P3-S5B0：封存旧版 00023 入仓路径（前置步骤，仅阻断）

**背景**：P3-S5A 的 `warehouseShipment` Server Action 和 `WarehouseShipmentButton` 组件仍在活跃调用 `warehouse_shipment_transactional` RPC（00023），该 RPC 执行 `inventory.quantity +=`。在引入新 RPC 之前必须先封住旧入口。

**P3-S5B0 是 P3-S5B1 的前置条件**。旧入口未确认封存前，不允许部署新 RPC。

**P3-S5B0 只做三件事——纯阻断，不引入新 UI**：

| 层级 | 动作 | 说明 |
|---|---|---|
| Server Action | `warehouseShipment()` 改为阻断桩 | 保留函数签名，函数体改为 `return { success: false, error: '旧版入仓入口已停用…' }`。**不调用 repository，不调用 RPC** |
| UI | 详情页隐藏旧"确认入仓"按钮 | 在 `[id]/page.tsx` 中移除或条件隐藏 `WarehouseShipmentButton` 的渲染。**不在此步骤渲染替换按钮**——替换按钮依赖尚未实现的 `partialWarehouseShipment` action 和 00026 RPC，放到 P3-S5B3 |
| 测试 | 验证旧入口不可用 | 见 §9.1 |

**P3-S5B0 明确不做的**：
- ❌ 不渲染双模式下拉按钮（依赖 00026 / `partialWarehouseShipment`，尚未实现）
- ❌ 不调用任何新 RPC
- ❌ 不新增任何 UI 组件
- ❌ 不修改 Migration 00023

**P3-S5B0 验收标准**：
- `warehouseShipment` action 返回中文错误，不产生数据库调用
- 详情页不渲染调用 00023 的按钮
- `npm run build` 通过
- P3-S5B0 测试全部通过（旧入口阻断验证）

**P3-S5B0→P3-S5B3 的过渡**：在 P3-S5B0 到 P3-S5B3 之间，shipment 详情页暂无可用的入仓按钮。此时 customs 状态的 shipment 无法被确认到仓——这是**可接受的临时状态**，因为 P3-S5B0 到 P3-S5B3 在同一个开发周期内连续交付。如果需要在过渡期间保留入仓能力，可临时通过 Supabase Dashboard 手动操作（不推荐），或加快 P3-S5B1~B3 的交付节奏。

### 3.1 部分入仓（Partial Warehousing）

Admin 在详情页按实际到达批次逐 SKU 指定数量，分多次确认。**只更新 shipment/shipment_item 进度，不写 inventory**。流程与 v3 一致（略，详见 §12 数据流图）。

### 3.2 批量入仓（Batch Warehousing）

Admin 在列表页勾选多笔 customs 状态的 shipment，批量确认到仓。**所有模式均走 00026 RPC，不调用 00023，不写 inventory**。流程与 v3 一致（略，详见 §12 数据流图）。

### 3.3 展示字段区分

| 概念 | 数据来源 | 说明 |
|---|---|---|
| **BigSeller 当前库存** | `inventory.quantity` | BigSeller 同步写入。**唯一库存权威数据** |
| **DIS 在途余量** | `shipment_item.quantity - warehoused_quantity`（status ≠ warehoused） | P3-S2C/S2D 已实现 |
| **DIS 已确认到仓** | 见 §6 完整方案 | DIS Admin 已确认货物到达。**不等于 BigSeller 已入库**。展示所有 customs 状态的 warehoused_quantity + warehoused 状态中 Admin 尚未手动确认吸收的 quantity。不写 inventory |

## 4. 技术设计

### 4.1 新增 Migration：00026

**包含两项变更**：
1. 新建 RPC `public.partial_warehouse_shipment`（不写 inventory）
2. `shipment` 表新增 `bigseller_absorbed_at` 列（手动吸收确认）

```sql
-- Migration 00026: 到仓确认进度跟踪 + 手动吸收确认
-- ============================================
-- Part A: 新增 shipment.bigseller_absorbed_at 列
-- Part B: 新增 public.partial_warehouse_shipment RPC
-- ============================================

-- ─── Part A: shipment 表新增手动吸收确认列 ───────────────────────

ALTER TABLE public.shipment
ADD COLUMN bigseller_absorbed_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN public.shipment.bigseller_absorbed_at IS
'Admin 手动确认 BigSeller 已吸收本次到仓货物的时间。NULL = 尚未确认吸收。';

-- ─── Part B: 到仓确认 RPC ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.partial_warehouse_shipment(
  p_shipment_id uuid,
  p_items jsonb,          -- [{"variant_id": "uuid-string", "quantity": 5}, ...]
  p_operator_user_id uuid,
  p_description text DEFAULT NULL
) RETURNS jsonb            -- {"warehoused_items": 3, "total_quantity": 45, "all_complete": false}
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_caller_role_name text;
  v_caller_is_active boolean;
  v_item jsonb;
  v_si_record record;
  v_remaining integer;
  v_warehoused_count integer := 0;
  v_total_quantity integer := 0;
  v_all_complete boolean := true;
  v_shipment_warehouse_id uuid;
  v_shipment_status text;
  v_quantity_val jsonb;
  v_parsed_qty integer;
  v_parsed_uuid uuid;
BEGIN
  -- ① auth.uid() 身份绑定（复用 00025 模式）
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '未登录，请先登录';
  END IF;

  IF auth.uid() != p_operator_user_id THEN
    RAISE EXCEPTION '操作者身份校验失败';
  END IF;

  -- ② 调用者必须是活跃 Admin
  SELECT r.name, p.is_active INTO v_caller_role_name, v_caller_is_active
  FROM public.profiles p
  JOIN public.role r ON r.id = p.role_id
  WHERE p.id = auth.uid();

  IF NOT FOUND OR v_caller_is_active IS NOT TRUE THEN
    RAISE EXCEPTION '账号未启用或不存在，请联系管理员';
  END IF;

  IF v_caller_role_name != 'admin' THEN
    RAISE EXCEPTION '仅管理员可执行此操作';
  END IF;

  -- ③ 锁定 shipment 行
  SELECT status, warehouse_id INTO v_shipment_status, v_shipment_warehouse_id
  FROM public.shipment
  WHERE id = p_shipment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '在途记录不存在';
  END IF;

  IF v_shipment_status = 'warehoused' THEN
    RAISE EXCEPTION '该在途记录已完成入仓，不可重复操作';
  END IF;

  IF v_shipment_status != 'customs' THEN
    RAISE EXCEPTION '当前状态为「%」，清关后方可确认入仓', v_shipment_status;
  END IF;

  IF v_shipment_warehouse_id IS NULL THEN
    RAISE EXCEPTION '该在途记录未指定仓库，无法入仓';
  END IF;

  -- ④ 预校验 p_items jsonb 结构（在 cast 之前，避免底层英文错误泄漏）
  IF p_items IS NULL OR jsonb_typeof(p_items) != 'array' THEN
    RAISE EXCEPTION '入仓明细格式错误：期望数组';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '入仓明细不能为空';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF v_item->>'variant_id' IS NULL THEN
      RAISE EXCEPTION '入仓明细缺少 variant_id 字段';
    END IF;

    BEGIN
      v_parsed_uuid := (v_item->>'variant_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'variant_id 格式无效：%', v_item->>'variant_id';
    END;

    v_quantity_val := v_item->'quantity';
    IF v_quantity_val IS NULL THEN
      RAISE EXCEPTION '入仓明细缺少 quantity 字段（variant_id: %）', v_item->>'variant_id';
    END IF;

    IF jsonb_typeof(v_quantity_val) != 'number' THEN
      RAISE EXCEPTION '入仓数量必须为整数（variant_id: %）', v_item->>'variant_id';
    END IF;

    BEGIN
      v_parsed_qty := v_quantity_val::integer;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION '入仓数量格式无效（variant_id: %）', v_item->>'variant_id';
    END;

    IF v_parsed_qty <= 0 THEN
      RAISE EXCEPTION '入仓数量必须大于 0（variant_id: %）', v_item->>'variant_id';
    END IF;
  END LOOP;

  -- ⑤ 逐项处理（仅更新 shipment_item，不写 inventory）
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT * INTO v_si_record
    FROM public.shipment_item
    WHERE shipment_id = p_shipment_id
      AND variant_id = (v_item->>'variant_id')::uuid
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION '产品明细不存在：variant_id=%', v_item->>'variant_id';
    END IF;

    v_remaining := v_si_record.quantity - v_si_record.warehoused_quantity;
    IF v_remaining <= 0 THEN
      RAISE EXCEPTION '产品 % 已全部入仓，无需重复操作', v_item->>'variant_id';
    END IF;

    IF (v_item->>'quantity')::integer > v_remaining THEN
      RAISE EXCEPTION '入仓数量 % 超过在途余量 %（variant_id: %）',
        (v_item->>'quantity')::integer, v_remaining, v_item->>'variant_id';
    END IF;

    -- 更新 warehoused_quantity（累加）
    -- 注意：不写 inventory。inventory.quantity 的唯一事实来源 = BigSeller 同步
    UPDATE public.shipment_item
    SET warehoused_quantity = warehoused_quantity + (v_item->>'quantity')::integer
    WHERE id = v_si_record.id;

    v_warehoused_count := v_warehoused_count + 1;
    v_total_quantity := v_total_quantity + (v_item->>'quantity')::integer;
  END LOOP;

  -- ⑥ 检查是否全部完成 → auto-complete
  SELECT EXISTS(
    SELECT 1 FROM public.shipment_item
    WHERE shipment_id = p_shipment_id
      AND warehoused_quantity < quantity
  ) INTO v_all_complete;
  v_all_complete := NOT v_all_complete;

  -- ⑦ 全部完成 → 自动标记 warehoused
  IF v_all_complete THEN
    UPDATE public.shipment SET status = 'warehoused' WHERE id = p_shipment_id;

    INSERT INTO public.tracking_event (shipment_id, status, description, occurred_at, created_by)
    VALUES (p_shipment_id, 'warehoused',
            COALESCE(p_description, '分批确认到仓完成，全部产品已确认到仓'),
            now(), auth.uid());
  ELSE
    INSERT INTO public.tracking_event (shipment_id, status, description, occurred_at, created_by)
    VALUES (p_shipment_id, v_shipment_status,
            COALESCE(p_description, '部分确认到仓：' || v_total_quantity::text || ' 件已确认到仓'),
            now(), auth.uid());
  END IF;

  RETURN jsonb_build_object(
    'warehoused_items', v_warehoused_count,
    'total_quantity', v_total_quantity,
    'all_complete', v_all_complete
  );
END;
$$;

-- ─── 权限收口 ────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.partial_warehouse_shipment(uuid, jsonb, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.partial_warehouse_shipment(uuid, jsonb, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.partial_warehouse_shipment(uuid, jsonb, uuid, text) TO authenticated;
```

**`bigseller_absorbed_at` 列说明**：

| 属性 | 值 |
|---|---|
| 类型 | `timestamptz DEFAULT NULL` |
| 语义 | NULL = Admin 尚未在 BigSeller 侧验证入库；非 NULL = Admin 已验证 BigSeller 已反映此批货物，记录确认时间 |
| 写入者 | 仅 Admin，通过 `confirmBigsellerAbsorption` Server Action |
| RLS | 由现有 `shipment` 表 RLS 策略覆盖（admin_all 可写，authenticated 可读）。**无需新增 RLS 策略** |
| 回滚 | `ALTER TABLE public.shipment DROP COLUMN IF EXISTS bigseller_absorbed_at`。不影响其他列，不影响 shipment 生命周期 |
| 为什么加在 shipment 而非新建表 | ① 一个 shipment 的吸收确认是整笔操作（非逐 SKU），与 shipment 生命周期天然绑定；② 复用现有 RLS 策略，无需新建表和策略；③ 单列 ALTER TABLE 回滚简单 |

**与 Migration 00023 的关键差异**：

| 项 | 00023（P3-S5B0 封存入口） | 00026（P3-S5B 唯一入仓路径） |
|---|---|---|
| 函数签名 | `(uuid, text) → boolean` | `(uuid, jsonb, uuid, text) → jsonb` |
| auth.uid() 绑定 | ❌ 缺失 | ✅ 完整 00025 模式 |
| SET search_path | ✅ `''` | ✅ `''` |
| **inventory 写入** | ✅ **`ON CONFLICT DO UPDATE quantity +=`** | ❌ **不写 inventory** |
| warehoused_quantity | `= quantity`（全额） | `+= 本次数量`（累加） |
| auto-complete | 始终设为 warehoused | 仅在全部 item 完成时设置 |
| 应用层状态 | **P3-S5B0 阻断桩封存** | P3-S5B 唯一入仓路径 |

### 4.2 数据库类型扩展

```ts
// src/types/database.ts — Database['public']['Tables']['shipment']['Row'] 新增

// shipment 行类型新增字段：
//   bigseller_absorbed_at: string | null

// Database['public']['Functions'] 新增：
partial_warehouse_shipment: {
  Args: {
    p_shipment_id: string
    p_items: Json
    p_operator_user_id: string
    p_description: string | null
  }
  Returns: {
    warehoused_items: number
    total_quantity: number
    all_complete: boolean
  }
}
```

### 4.3 业务类型扩展

```ts
// src/features/shipments/types.ts

// ─── 入仓操作类型 ──────────────────────────────────────────────

export interface PartialWarehouseItem {
  variantId: string;
  quantity: number;
}

export interface PartialWarehouseInput {
  shipmentId: string;
  items: PartialWarehouseItem[];
  description?: string;
}

export interface PartialWarehouseResult {
  warehousedItems: number;
  totalQuantity: number;
  allComplete: boolean;
}

export interface BatchWarehouseShipment {
  shipmentId: string;
  mode: 'full' | 'partial';
  items?: PartialWarehouseItem[];
  description?: string;
}

export interface BatchWarehouseItemResult {
  shipmentId: string;
  shipmentNo: string;
  success: boolean;
  result?: PartialWarehouseResult;
  error?: string;
}

export interface BatchWarehouseResult {
  items: BatchWarehouseItemResult[];
  successCount: number;
  failureCount: number;
}

// ─── 手动吸收确认 ──────────────────────────────────────────────

export interface ConfirmAbsorptionInput {
  shipmentId: string;
  note?: string;           // 可选备注（如"BigSeller 采购入库单 PO-xxx 已确认"）
}

// ─── ShipmentListItem 扩展 ─────────────────────────────────────

// ShipmentListItem 新增字段：
//   warehouseId: string | null;
//   canWarehouse: boolean;             // status='customs' AND warehouseId !== null
//   bigsellerAbsorbedAt: string | null; // NULL = 未确认吸收

// ─── 展示字段类型（海外库存页） ──────────────────────────────────

export interface OverseasInventoryWithWarehousing {
  variantId: string;
  warehouseId: string;
  bigsellerQuantity: number;       // inventory.quantity — BigSeller 唯一库存权威
  inTransitRemaining: number;      // SUM(quantity - warehoused_quantity) per (variant, warehouse)
  confirmedWarehoused: number;     // 见 §6 — 不自动消失，基于手动确认 + 时间窗口
}
```

### 4.4 Zod Schema 新增

```ts
// src/features/shipments/schema.ts 新增

import { z } from 'zod';

const partialWarehouseItemSchema = z.object({
  variantId: z.string().uuid('无效的 SKU ID'),
  quantity: z.number().int('入仓数量必须为整数').min(1, '入仓数量必须大于 0'),
});

export const partialWarehouseSchema = z.object({
  shipmentId: z.string().uuid('无效的在途记录 ID'),
  items: z.array(partialWarehouseItemSchema).min(1, '至少需要一个产品').max(50, '最多 50 个产品'),
  description: z.string().max(500, '备注最长 500 个字符').optional(),
});

export type PartialWarehouseValues = z.infer<typeof partialWarehouseSchema>;

// ─── 批量入仓 ──────────────────────────────────────────────────

const batchShipmentBase = z.object({
  shipmentId: z.string().uuid('无效的在途记录 ID'),
  description: z.string().max(500, '备注最长 500 个字符').optional(),
});

const batchShipmentFull = batchShipmentBase.extend({
  mode: z.literal('full'),
});

const batchShipmentPartial = batchShipmentBase.extend({
  mode: z.literal('partial'),
  items: z.array(partialWarehouseItemSchema).min(1, '部分入仓时必须指定入仓明细'),
});

const batchShipmentSchema = z.discriminatedUnion('mode', [batchShipmentFull, batchShipmentPartial]);

export const batchWarehouseSchema = z.object({
  shipments: z.array(batchShipmentSchema).min(1, '至少选择一笔在途记录').max(20, '单次最多处理 20 笔'),
});

export type BatchWarehouseValues = z.infer<typeof batchWarehouseSchema>;

// ─── 手动吸收确认 ──────────────────────────────────────────────

export const confirmAbsorptionSchema = z.object({
  shipmentId: z.string().uuid('无效的在途记录 ID'),
  note: z.string().max(500, '备注最长 500 个字符').optional(),
});

export type ConfirmAbsorptionValues = z.infer<typeof confirmAbsorptionSchema>;
```

### 4.5 Repository 新增方法

```ts
// src/features/shipments/repository.ts

// ─── P3-S5B0：warehouseShipment() 不再被调用，标注 @deprecated ──
// 保留方法体不删除（避免破坏测试结构），但 action 阻断桩已阻止到达

// ─── P3-S5B2 新增 ──────────────────────────────────────────────

/** 部分到仓确认 — 调用 00026 RPC。不写 inventory */
async partialWarehouse(
  shipmentId: string,
  items: Array<{ variantId: string; quantity: number }>,
  operatorId: string,
  description?: string,
): Promise<{ warehousedItems: number; totalQuantity: number; allComplete: boolean }>

/** 批量入仓候选列表（DB 层 customs + has warehouse 过滤） */
async listEligibleForBatchWarehousing(
  filters: { country?: string; page?: number; pageSize?: number },
  userId?: string,
): Promise<PaginatedResult<ShipmentListItem>>

/**
 * 获取指定 variant + warehouse 的"已确认到仓"数量（详见 §6）
 *
 * 计算范围：
 *   SUM(shipment_item.warehoused_quantity)
 *   WHERE shipment.warehouse_id = :warehouse_id
 *     AND shipment_item.variant_id = :variant_id
 *     AND si.warehoused_quantity > 0
 *     AND (
 *       -- 分支 A：shipment 仍在 customs（未关闭，肯定未被吸收）
 *       s.status = 'customs'
 *       OR
 *       -- 分支 B：shipment 已 warehoused 且 Admin 尚未手动确认吸收
 *       (s.status = 'warehoused' AND s.bigseller_absorbed_at IS NULL)
 *     )
 *
 * 何时消失：
 *   - Admin 在 shipment 详情页点击"确认 BigSeller 已吸收"
 *   → bigseller_absorbed_at 设为 now()
 *   → 下次查询时该 shipment 的 quantity 不再计入
 */
async getConfirmedWarehousedQuantity(
  variantId: string,
  warehouseId: string,
): Promise<number>

/** 批量获取某仓库所有 variant 的"已确认到仓"数量 */
async getConfirmedWarehousedByWarehouse(
  warehouseId: string,
): Promise<Map<string, number>>

/**
 * 手动确认 BigSeller 已吸收
 * UPDATE shipment SET bigseller_absorbed_at = now() WHERE id = :shipmentId
 * 仅 Admin 可调用（action 层校验）
 */
async confirmBigsellerAbsorption(
  shipmentId: string,
  operatorId: string,
): Promise<void>

// 现有 list() 方法变更：
//   - 映射时新增 warehouseId: row.warehouse_id
//   - 映射时新增 canWarehouse: row.status === 'customs' && row.warehouse_id !== null
//   - 映射时新增 bigsellerAbsorbedAt: row.bigseller_absorbed_at
```

### 4.6 Server Actions 变更

```ts
// src/features/shipments/actions.ts

// ─── P3-S5B0：旧版入口阻断 ──────────────────────────────────────

/**
 * ⚠️ P3-S5B0 已封存。不调用 repository，不调用 RPC。
 */
export async function warehouseShipment(
  formData: WarehouseShipmentValues,
): Promise<ActionResult<{ success: boolean }>> {
  // 阻断桩：不执行任何数据库操作
  return {
    success: false,
    error: '旧版入仓入口已停用。请使用「全额确认到仓」或「部分确认到仓」功能，确认到仓仅更新在途进度，不修改库存。',
  };
}

// ─── P3-S5B2：新增入仓入口 ──────────────────────────────────────

/** 部分确认到仓（不写 inventory，走 00026 RPC） */
export async function partialWarehouseShipment(
  formData: PartialWarehouseValues,
): Promise<ActionResult<PartialWarehouseResult>>

/** 批量确认到仓（逐笔串行，mode='full' 走 00026 而非 00023） */
export async function batchWarehouseShipments(
  formData: BatchWarehouseValues,
): Promise<ActionResult<BatchWarehouseResult>>

/** 手动确认 BigSeller 已吸收本次到仓货物 */
export async function confirmBigsellerAbsorption(
  formData: ConfirmAbsorptionValues,
): Promise<ActionResult<void>>
```

### 4.7 UI 组件

| 组件 | 类型 | 阶段 | 说明 |
|---|---|---|---|
| `WarehouseShipmentButton` | MODIFY | **P3-S5B0** | **隐藏**——详情页不再渲染此组件 |
| `WarehouseShipmentButton` | REPLACE | **P3-S5B3** | **替换为双模式下拉**——"全额确认到仓"（构造全量 items → `partialWarehouseShipment`）和"部分确认到仓"（打开 `PartialWarehouseDialog`）。移除旧版单一按钮。文案使用"确认到仓"而非"入仓" |
| `PartialWarehouseDialog` | NEW | P3-S5B3 | 部分确认到仓 Dialog：SKU/产品名/总量/已确认/在途余量 + 数量输入（默认=在途余量），调用 `partialWarehouseShipment`。注明"确认到仓仅更新在途进度，不修改库存" |
| `BigsellerAbsorptionButton` | NEW | P3-S5B3 | shipment 详情页新增按钮：当 `status = warehoused AND bigseller_absorbed_at IS NULL` 时显示"确认 BigSeller 已吸收"。点击弹出确认 Dialog，提交调用 `confirmBigsellerAbsorption` |
| `BatchWarehouseDialog` | NEW | P3-S5B4 | 批量确认到仓 Dialog：勾选 shipments 概览 + 模式选择（全额/部分），调用 `batchWarehouseShipments` |
| `ShipmentsPageContent` | MODIFY | P3-S5B4 | 批量模式 Toggle + checkbox + 批量确认到仓按钮。数据源切换到 `listEligibleForBatchWarehousing` |
| `shipmentColumns` | MODIFY | P3-S5B4 | 新增 checkbox 列定义 |

### 4.8 页面变更

| 页面 | 阶段 | 变更 |
|---|---|---|
| `/dashboard/shipments/[id]` | **P3-S5B0** | **隐藏旧"确认入仓"按钮**。不新增替换按钮 |
| `/dashboard/shipments/[id]` | P3-S5B3 | 新增双模式下拉按钮（全额/部分确认到仓）+ `BigsellerAbsorptionButton`（warehoused + 未确认吸收时显示） |
| `/dashboard/shipments` | P3-S5B4 | 批量模式 Toggle + checkbox + 批量确认到仓按钮 |
| `/dashboard/inventory/overseas` | P3-S5B4 | 新增"已确认到仓"展示列 |

## 5. 权限链

```
页面 (Admin-only guard / isAdmin prop)
  → Server Action (requireActiveAuth + roleName !== 'admin' + Zod)
    → Repository (createClient RLS session)
      → RPC（00026）或简单 UPDATE（bigseller_absorbed_at）
        → PostgreSQL RLS (admin_all policies on shipment)
```

**P3-S5B0 阻断桩**：`warehouseShipment` action 不经过权限校验——直接在函数体返回错误，不进入 repository 层，不访问数据库。

**`confirmBigsellerAbsorption` 权限**：Admin-only Server Action → Repository 执行 `UPDATE shipment SET bigseller_absorbed_at = now() WHERE id = :id`。此 UPDATE 受 shipment 表 RLS 的 admin_all 策略保护。

## 6. "已确认到仓"展示与吸收确认方案（核心）

### 6.1 核心原则

```
"已确认到仓" ≠ "BigSeller 已入库"

"已确认到仓" = DIS Admin 在 DIS 系统中确认货物已到达仓库。
                这是一个 DIS 侧事实，一经确认即为真，不会自动变为假。

"BigSeller 已入库" = BigSeller 侧的采购入库流程完成，
                    inventory.quantity 已反映该批货物。
                    这是一个 BigSeller 侧事实，DIS 无法自动感知。

两者之间存在自然时间差。DIS 不自动推断 BigSeller 是否已入库。
```

### 6.2 为什么 `last_sync_at` 不能作为自动吸收判据

v3 设计曾试图用 `tracking_event.occurred_at <= inventory.last_sync_at` 判定"BigSeller 已吸收"。这是不可靠的：

| 场景 | `last_sync_at` 行为 | 判定结果 | 实际情况 |
|---|---|---|---|
| BigSeller 定时同步触发，但采购单尚未入库 | 更新为 now() | 误判为"已吸收" | inventory.quantity 未变，货物实际未入库 |
| BigSeller 同步了其他 SKU，未同步此 SKU | 更新为 now() | 误判为"已吸收" | 该 SKU 的 quantity 未变 |
| BigSeller 同步异常未执行 | 不变 | 正确（未吸收） | — |

**结论**：`last_sync_at` 只代表"BigSeller 最近一次尝试同步的时间"，不代表"该 SKU 的库存已被 BigSeller 更新"。不能用它作为自动消失的唯一依据。

### 6.3 方案：DIS 事实展示 + Admin 手动确认吸收 + 时间窗口兜底

三层机制：

```
第一层：DIS 事实展示（始终展示，不自动消失）
  └─ customs 状态 → 肯定未被吸收，计入
  └─ warehoused 状态 + bigseller_absorbed_at IS NULL → 计入

第二层：Admin 手动确认吸收（主动让 quantity 消失）
  └─ Admin 在 BigSeller 侧核实入库已完成
  └─ 点击"确认 BigSeller 已吸收"
  └─ bigseller_absorbed_at := now()
  └─ 下次查询不再计入

第三层：时间窗口兜底（防止无限累积）
  └─ warehoused 超过 30 天 + bigseller_absorbed_at 仍为 NULL
  └─ 在"已确认到仓"列显示为灰色 + tooltip"超过 30 天未确认吸收，请核实"
  └─ 仍计入数量（不自动消失），但视觉上提示 Admin 关注
```

### 6.4 显示判定逻辑

对于给定的 **(variant_id, warehouse_id)**：

```
confirmedQuantity = SUM(si.warehoused_quantity)
FROM shipment_item si
JOIN shipment s ON s.id = si.shipment_id
WHERE s.warehouse_id = :warehouse_id
  AND si.variant_id = :variant_id
  AND si.warehoused_quantity > 0
  AND (
    -- 分支 A：shipment 仍在 customs（未关闭，肯定未被吸收）
    s.status = 'customs'
    OR
    -- 分支 B：shipment 已 warehoused 且 Admin 尚未手动确认吸收
    (s.status = 'warehoused' AND s.bigseller_absorbed_at IS NULL)
  )
```

**每条 shipment 对"已确认到仓"的贡献何时终止**：

| 事件 | `bigseller_absorbed_at` | 计入？ |
|---|---|---|
| Shipment 在 customs，部分确认到仓 | NULL | ✅ 计入（分支 A） |
| 最后一批确认 → auto-complete → warehoused | NULL | ✅ 计入（分支 B，无缝切换） |
| Admin 在 BigSeller 核实完毕 → 点击"确认已吸收" | 设为 now() | ❌ 不再计入 |
| 30 天后仍未确认吸收 | NULL | ⚠️ 仍计入，但灰色提示 |

### 6.5 手动吸收确认流程

```
1. Shipment 全部确认到仓（status = warehoused）
2. 详情页显示"确认 BigSeller 已吸收"按钮
   （仅当 status = warehoused AND bigseller_absorbed_at IS NULL）
3. Admin 在 BigSeller 侧确认库存已更新
4. 点击按钮 → 确认 Dialog：
   "确认 BigSeller 已吸收此批到仓货物？
    此操作不会修改库存数据，仅标记 DIS 侧已与 BigSeller 对账完成。"
   可选备注输入（如"BigSeller PO-xxx 已入库"）
5. 提交 → confirmBigsellerAbsorption action
6. bigseller_absorbed_at := now()
7. 海外库存页"已确认到仓"列中该 shipment 的 quantity 不再计入
```

### 6.6 展示位置与视觉规则

| 页面 | 展示 | 规则 |
|---|---|---|
| `/dashboard/inventory/overseas` 表格 | "已确认到仓"列 | 数量 > 0 → 蓝色 badge。tooltip："DIS 已确认到仓。不等于 BigSeller 已入库，请对照 BigSeller 库存核实" |
| 同上，但含超过 30 天未确认的 shipment | 同上 + 行内 warning icon | 数量旁显示 ⚠️ + tooltip："含超过 30 天未确认吸收的到仓记录，请在 BigSeller 侧核实入库状态" |
| Shipment 详情页 | 产品明细表格 | 已有 warehoused_quantity / quantity 列，无需额外展示 |
| Shipment 详情页 | `BigsellerAbsorptionButton` | `status = warehoused AND bigseller_absorbed_at IS NULL` → 显示"确认 BigSeller 已吸收"按钮。`bigseller_absorbed_at IS NOT NULL` → 显示绿色"已对账 ✓" + 确认时间 |

### 6.7 边界情况

| 场景 | 行为 |
|---|---|
| 新 variant（inventory 行不存在） | "已确认到仓"正常计入（与 inventory 无关）。BigSeller 库存列显示为"—"（无数据） |
| 部分入仓多次后才全部完成 | customs 期间计入全部 warehoused_quantity；auto-complete 后切换到分支 B（`bigseller_absorbed_at IS NULL`）→ 继续计入。**无缝切换，不消失** |
| Admin 误点"确认已吸收" | 可在后续版本增加"撤销吸收确认"功能（`bigseller_absorbed_at := NULL`）。当前版本通过 Supabase Dashboard 手动修正 |
| 同一 variant 有多笔 shipment | 各 shipment 独立判定，SUM 汇总 |
| `bigseller_absorbed_at` 始终 NULL，超过 30 天 | 仍计入，但 UI 灰色 + ⚠️ 提示。不自动消失 |
| 未来增加自动吸收机制 | `bigseller_absorbed_at` 列可同时支持手动和自动写入——自动吸收逻辑（如基于 `inventory.quantity` 变化检测）可在后续版本中通过更新此列实现，不影响现有展示逻辑 |

### 6.8 "待同步入库 / projected stock"（可选派生展示）

```
projectedStock = inventory.quantity + confirmedQuantity
```

含义：BigSeller 库存 + DIS 已确认但尚未手动对账的数量。**仅用于展示参考，不写入数据库**。建议初期不作为独立列，运营通过"BigSeller 库存"和"已确认到仓"两列对照即可。

## 7. P3-S5B 所有入仓路径溯源

| 入口 | 阶段 | UI | Action | RPC | 写 inventory? |
|---|---|---|---|---|---|
| 旧版全额入仓 | P3-S5B0 | ~~隐藏~~ | `warehouseShipment` → **阻断桩** | 不调用 | ❌ |
| 全额确认到仓（详情页） | P3-S5B3 | 双模式下拉"全额确认到仓" | `partialWarehouseShipment`（全量 items） | 00026 | ❌ |
| 部分确认到仓（详情页） | P3-S5B3 | 双模式下拉"部分确认到仓" → Dialog | `partialWarehouseShipment`（用户指定 items） | 00026 | ❌ |
| 批量全额确认到仓 | P3-S5B4 | 列表批量 + Dialog mode='full' | `batchWarehouseShipments` → 逐笔全量 items | 00026 | ❌ |
| 批量部分确认到仓 | P3-S5B4 | 列表批量 + Dialog mode='partial' | `batchWarehouseShipments` → 逐笔用户 items | 00026 | ❌ |

**结论：P3-S5B 上线后，不存在任何活跃路径调用 00023 或写入 inventory.quantity。**

## 8. 不修改项

- **不修改** Migration 00001~00025（含 00023）——00023 函数体保留，应用层入口由 P3-S5B0 封存
- **不修改** `shipment_item` 表结构
- **不修改** `inventory` 表结构——`quantity` 仅由 BigSeller 同步写入；`last_sync_at` 在 P3-S5B 中**不用于自动判定吸收**
- **不修改** `tracking_event` 表结构
- **不修改** Product/ProductVariant 模型
- **不修改** 状态流转规则（`SHIPMENT_STATUS_FLOW`）
- **不修改** Operator 权限模型
- **不引入** 新技术栈
- **不新增** 对 `inventory` 表的 INSERT/UPDATE/DELETE

## 9. 测试计划

### 9.1 P3-S5B0：旧入口封存测试（`p3-s5b0-block-old-path.test.ts`）

| 分组 | 测试数 | 内容 |
|---|---|---|
| warehouseShipment action 阻断 | 4 | 返回 `success: false`、错误信息含"已停用"、不调用任何 repository 方法、不产生 Supabase 调用 |
| 详情页按钮隐藏 | 3 | 不渲染 `WarehouseShipmentButton`、`canWarehouseShipment` guard 不驱动旧按钮渲染、页面不导入旧版按钮组件（或导入但不使用） |
| 回归 | 2 | 现有 P3-S5A 测试中引用 `warehouseShipment` action 的测试更新为验证阻断行为、build 通过 |

**P3-S5B0 不测试**：新按钮渲染（尚未实现）、新 RPC 调用（尚未实现）

### 9.2 P3-S5B1：Migration 静态契约测试（`p3-s5b-migration.test.ts`）

| 分组 | 测试数 | 内容 |
|---|---|---|
| RPC 存在性 | 1 | `partial_warehouse_shipment` 已定义 |
| 权限模型 | 4 | SECURITY INVOKER、`SET search_path=''`、REVOKE FROM PUBLIC+anon、GRANT TO authenticated |
| auth.uid() 绑定 | 6 | IS NOT NULL、= p_operator_user_id、活跃 Admin 查询、NOT FOUND 拒绝、非 admin 拒绝、锁前执行顺序 |
| jsonb 预校验 | 7 | 非数组拒绝、空数组拒绝、缺 variant_id 拒绝、variant_id 无效 UUID 拒绝、缺 quantity 拒绝、quantity 非数字拒绝、quantity ≤ 0 拒绝 |
| 业务规则 | 8 | customs-only、非 warehoused、warehouse_id NOT NULL、≤ remaining 校验、warehoused_quantity 累加、auto-complete、tracking_event.occurred_at 写入 |
| tracking_event | 3 | 部分确认 tracking_event、全部完成 tracking_event、created_by = auth.uid() |
| 参数签名 | 1 | 4 参数（uuid, jsonb, uuid, text）、返回 jsonb |
| **bigseller_absorbed_at 列** | 3 | 列存在、类型为 timestamptz、DEFAULT NULL |
| **不写 inventory 验证** | 2 | RPC 源码不含 `INSERT INTO public.inventory`、不含 `UPDATE public.inventory` |
| 不破坏现有 | 3 | 不修改 shipment_item / inventory 表结构、不修改 00023 函数、不修改 00022 函数 |
| 中文错误 | 1 | 所有 RAISE EXCEPTION 均为中文（≥ 15 条） |

### 9.3 P3-S5B3/P3-S5B4：应用层行为测试（`p3-s5b.test.ts`）

| 分组 | 测试数 | 内容 |
|---|---|---|
| Schema | 8 | partialWarehouseSchema 合法/非法、batchWarehouseSchema discriminated union、confirmAbsorptionSchema |
| Repository | 12 | partialWarehouse RPC 调用、listEligibleForBatchWarehousing 过滤、仓库隔离、getConfirmedWarehousedQuantity customs 分支、warehoused+未确认吸收分支、warehoused+已确认吸收不计入分支、confirmBigsellerAbsorption 设置时间戳、getConfirmedWarehousedByWarehouse 批量聚合、**partialWarehouse 不写 inventory** |
| **"已确认到仓"展示完整性** | 5 | auto-complete 后不消失（customs→warehoused + bigseller_absorbed_at=NULL → 仍计入）、Admin 确认吸收后消失（bigseller_absorbed_at 设置 → 不计入）、跨多笔 shipment SUM 正确、超过 30 天未确认仍计入（含 warning 标记检测）、**BigSeller 同步更新 last_sync_at 后不自动消失** |
| Actions 权限 | 4 | Admin-only、Operator 拒绝、未登录拒绝、Zod 拒绝 |
| **Actions 不调用 00023** | 3 | batchWarehouseShipments mode='full' 不调用 warehouse_shipment_transactional、mode='partial' 不调用 warehouse_shipment_transactional、**warehouseShipment 阻断桩不调用任何 RPC** |
| 组件源码检查 | 8 | P3-S5B0：旧按钮不渲染。P3-S5B3：PartialWarehouseDialog 不直接 supabase、双模式按钮不调用 00023、BigsellerAbsorptionButton 不直接 supabase。P3-S5B4：BatchWarehouseDialog 不直接 supabase、批量模式数据源切换、组件文案不含"库存增加" |
| 页面回归 | 4 | 列表页不破坏现有筛选/分页、详情页不破坏现有展示、海外库存页新增"已确认到仓"列、P3-S5B0 期间详情页不渲染旧版按钮 |

### 9.4 兼容性回归

- 现有 P3-S5A 测试：action 阻断桩后更新相关测试
- 现有 P3-S4A/S2E/S2D/S2C/S2B 测试全部通过
- `npm run build` 通过
- `npm run lint` 0 errors

## 10. 任务拆分

| Task ID | 内容 | 文件数 | 依赖 |
|---|---|---|---|
| **P3-S5B0** | **封存旧版 00023 入口（纯阻断，不引入新 UI）**：① `warehouseShipment` action 阻断桩；② 详情页隐藏旧"确认入仓"按钮；③ `p3-s5b0-block-old-path.test.ts`（~9 项） | 3 文件（actions.ts + [id]/page.tsx + test） | P3-S5A |
| **P3-S5B1** | Migration 00026（RPC + `bigseller_absorbed_at` 列）+ `src/types/database.ts` + feature types/schema + `p3-s5b-migration.test.ts`（~39 项） | 5 文件 | **P3-S5B0** |
| **P3-S5B2** | Repository 新增方法（`partialWarehouse` + `listEligibleForBatchWarehousing` + `getConfirmedWarehousedQuantity` + `getConfirmedWarehousedByWarehouse` + `confirmBigsellerAbsorption`）+ Server Actions（`partialWarehouseShipment` + `batchWarehouseShipments` + `confirmBigsellerAbsorption`） | 2 文件 | P3-S5B1 |
| **P3-S5B3** | 部分确认到仓 UI + 手动吸收确认 UI：详情页双模式下拉按钮（替换旧按钮）+ `PartialWarehouseDialog` + `BigsellerAbsorptionButton` | 3 文件 | P3-S5B2 |
| **P3-S5B4** | 批量确认到仓 UI（列表页 checkbox + `BatchWarehouseDialog` + columns）+ 海外库存页"已确认到仓"列 | 4 文件 | P3-S5B2 |
| **P3-S5B5** | `p3-s5b.test.ts`（应用层行为测试）+ 文档同步 + 最终质量门 | 3 文件 | P3-S5B4 |

**关键依赖链**：
```
P3-S5A → P3-S5B0（封存旧入口） → P3-S5B1（Migration + 类型） → P3-S5B2（数据层 + Actions）
                                                                       ├── P3-S5B3（详情页新 UI）
                                                                       └── P3-S5B4（批量 UI + 海外库存列）
                                                                       └── P3-S5B5（测试 + 文档）
```

**P3-S5B0 必须在 P3-S5B1 之前完成**。旧入口未封存的情况下部署新 RPC，新旧路径并存 → 库存翻倍风险。

**P3-S5B3 在 P3-S5B2 之后**。双模式按钮依赖 `partialWarehouseShipment` action 和 00026 RPC，两者在 P3-S5B1/B2 才就绪。

## 11. 风险分析

| 风险 | 级别 | 缓解 |
|---|---|---|
| **00023 旧入口残留（P3-S5B0 前）** | **高** | P3-S5B0 前置封存：action 阻断桩 + UI 隐藏按钮 |
| **库存翻倍（已消除）** | **已消除** | P3-S5B 所有路径不写 inventory；P3-S5B0 封存 00023 |
| **"已确认到仓"因 last_sync_at 更新但库存未变而错误消失（已消除）** | **已消除** | 吸收判定不再依赖 `last_sync_at`。改为 Admin 手动确认（`bigseller_absorbed_at`）。BigSeller 同步不导致已有确认量自动消失 |
| **"已确认到仓"无限制累积** | 低 | 30 天未确认吸收 → UI 灰色 ⚠️ 提示。不自动消失但强调运营关注。后续可迭代为自动吸收检测 |
| Admin 忘记确认吸收 | 低 | 30 天 warning 提示作为兜底。不影响库存数据正确性（inventory.quantity 仍由 BigSeller 同步维护） |
| 00023 函数体中仍含 inventory 写入（DB 层可被 service_role 直接调用） | 中 | P3-S5B0 封存应用层入口。长期：新 migration CREATE OR REPLACE 移除 00023 的 inventory 写入 |
| `bigseller_absorbed_at` 列回滚 | 低 | `ALTER TABLE DROP COLUMN IF EXISTS` 即时回滚。不影响 shipment 生命周期和其他列 |
| 部分入仓 concurrency | 中 | FOR UPDATE 行锁串行化；不写 inventory |
| 批量入仓超时（20 笔串行） | 低 | 每笔 RPC 更轻量（无 inventory UPSERT）；约 3-6s |
| auto-complete 竞态 | 低 | RPC 同一事务 FOR UPDATE |
| BigSeller 同步延迟 | **可接受** | "已确认到仓"列展示正是为了让运营观察 DIS vs BigSeller 差异。`bigseller_absorbed_at` 提供明确的对账确认机制 |

**停止条件**：
- P3-S5B0 测试未全部通过（旧入口未确认封存）
- 任何 Migration 测试失败
- 00026 RPC 源码中对 `inventory` 表有任何 INSERT/UPDATE/DELETE
- 详情页仍渲染调用 00023 的按钮（P3-S5B0 后）
- `npm run build` 失败
- 现有测试回归失败

## 12. 数据流图

```
┌─────────────────────────────────────────────────────────────┐
│              P3-S5B0：封存旧入口（纯阻断）                     │
├──────────┬──────────────────────────────────────────────────┤
│          │  warehouseShipment action → 阻断桩（中文错误）     │
│          │  WarehouseShipmentButton → 隐藏（不渲染）         │
│          │  ❌ 00023 不再可达                                 │
│          │  ❌ 不引入新按钮（00026 尚未实现）                 │
│          │                                                    │
│  ──────── ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─     │
│          │                                                    │
│  P3-S5B3 │  Admin 点击"部分确认到仓"（双模式下拉）            │
│  Detail  │  → PartialWarehouseDialog                          │
│  Page    │  → partialWarehouseShipment action                 │
│          │  → 00026 RPC                                       │
│          │  ┌─ ① auth.uid() 身份绑定 + 活跃 Admin            │
│          │  ├─ ② FOR UPDATE shipment                          │
│          │  ├─ ③ 预校验 p_items jsonb（中文错误）            │
│          │  ├─ ④ FOR UPDATE shipment_item 逐行               │
│          │  ├─ ⑤ warehousehoused_quantity += N               │
│          │  │     ❌ 不写 inventory                            │
│          │  ├─ ⑥ remaining > 0 → status 保持 customs          │
│          │  └─ ⑦ tracking_event（部分确认 + occurred_at）     │
│          │  → return { warehoused_items, total_qty,           │
│          │            all_complete }                            │
│          │                                                    │
│          │  Shipment 全部确认后（status = warehoused）：      │
│          │  → BigsellerAbsorptionButton 出现                  │
│          │  → Admin 在 BigSeller 核实入库 → 点击确认          │
│          │  → bigseller_absorbed_at := now()                  │
│          │                                                    │
│  海外    │  "已确认到仓"列（§6 算法）：                       │
│  库存页  │  SKU-A: customs → 计入（分支 A）                   │
│          │  SKU-B: warehoused + bigseller_absorbed_at=NULL    │
│          │         → 计入（分支 B）                            │
│          │  SKU-C: warehoused + bigseller_absorbed_at=时间戳  │
│          │         → 不计入（Admin 已确认吸收）               │
│          │  ⚠️ 超过 30 天未确认 → 灰色提示但数量仍计入        │
│          │  ❌ BigSeller 同步 last_sync_at 更新 → 不影响      │
└──────────┴──────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│           批量确认到仓 (Batch) — P3-S5B4                      │
├──────────┬──────────────────────────────────────────────────┤
│  List    │  Admin 批量模式 → listEligibleForBatchWarehousing │
│  Page    │  checkbox 列 → 勾选 → BatchWarehouseDialog        │
│          │  mode='full'  → 构造全量 items → 00026 RPC        │
│          │  mode='partial' → 用户指定 items → 00026 RPC      │
│          │  ❌ 两种模式均不走 00023                           │
│          │  ❌ 两种模式均不写 inventory                       │
└──────────┴──────────────────────────────────────────────────┘
```

## 13. 文件清单

### 新建文件

| 文件 | 说明 | 阶段 |
|---|---|---|
| `src/features/shipments/p3-s5b0-block-old-path.test.ts` | 旧入口封存验证（~9 项） | **P3-S5B0** |
| `supabase/migrations/00026_partial_warehousing.sql` | RPC + `bigseller_absorbed_at` 列 + REVOKE/GRANT | P3-S5B1 |
| `src/features/shipments/p3-s5b-migration.test.ts` | Migration 静态契约测试（~39 项） | P3-S5B1 |
| `src/features/shipments/components/partial-warehouse-dialog.tsx` | 部分确认到仓 Dialog | P3-S5B3 |
| `src/features/shipments/components/bigseller-absorption-button.tsx` | 手动吸收确认按钮 + Dialog | P3-S5B3 |
| `src/features/shipments/components/batch-warehouse-dialog.tsx` | 批量确认到仓 Dialog | P3-S5B4 |
| `src/features/shipments/p3-s5b.test.ts` | 应用层行为测试 | P3-S5B5 |

### 修改文件

| 文件 | 变更内容 | 阶段 |
|---|---|---|
| `src/features/shipments/actions.ts` | P3-S5B0：`warehouseShipment` → 阻断桩。P3-S5B2：新增 `partialWarehouseShipment` + `batchWarehouseShipments` + `confirmBigsellerAbsorption` | P3-S5B0 → P3-S5B2 |
| `src/app/dashboard/shipments/[id]/page.tsx` | P3-S5B0：隐藏 `WarehouseShipmentButton`。P3-S5B3：渲染双模式下拉 + `BigsellerAbsorptionButton` | P3-S5B0 → P3-S5B3 |
| `src/features/shipments/components/warehouse-shipment-button.tsx` | P3-S5B3：替换为双模式下拉（全额/部分，均走 00026）；移除旧版按钮逻辑 | P3-S5B3 |
| `src/types/database.ts` | `shipment.Row` 新增 `bigseller_absorbed_at`；`Functions` 新增 `partial_warehouse_shipment` | P3-S5B1 |
| `src/features/shipments/types.ts` | 新增 9 个类型/接口 + `OverseasInventoryWithWarehousing`；`ShipmentListItem` 新增 3 字段 | P3-S5B1 |
| `src/features/shipments/schema.ts` | 新增 4 个 Zod schema（含 discriminatedUnion + confirmAbsorptionSchema） | P3-S5B1 |
| `src/features/shipments/repository.ts` | 新增 5 个方法；`list()` 返回新增 3 字段；`warehouseShipment()` 标注 @deprecated | P3-S5B2 |
| `src/features/shipments/columns.tsx` | 新增 checkbox 列定义 | P3-S5B4 |
| `src/app/dashboard/shipments/_components/shipments-page-content.tsx` | 批量模式 Toggle + checkbox + 按钮 + 数据源切换 | P3-S5B4 |
| `src/app/dashboard/shipments/page.tsx` | 传递批量模式数据 | P3-S5B4 |
| `src/app/dashboard/inventory/overseas/page.tsx` | 新增"已确认到仓"展示列 | P3-S5B4 |
| `docs/current-state.md` | 更新 P3-S5B 状态 | P3-S5B5 |
| `docs/tasks/current-task.md` | 更新 Task 状态 | P3-S5B5 |

## 14. 对 P3-S5A (Migration 00023) 的影响与处理

| 层级 | P3-S5B 动作 |
|---|---|
| UI | P3-S5B0 隐藏旧按钮。P3-S5B3 替换为走 00026 的新按钮 |
| Server Action | P3-S5B0 阻断桩。不再调用 repository.warehouseShipment() |
| Repository | `warehouseShipment()` 标注 @deprecated，无代码路径到达 |
| Migration | 不修改 00023 SQL。函数在 DB 中保留但应用层不可达 |
| 长期 | P3-S5B 验收后另开 Task，新 migration CREATE OR REPLACE 移除 inventory 写入 |

## 15. 待澄清问题

1. **P3-S5B0 阻断桩的力度**：`warehouseShipment` action 是完全阻断（始终返回错误），还是保留一个 "确认理解风险" 的 bypass？（建议：完全阻断，无 bypass。00026 覆盖所有入仓场景）
2. **P3-S5B0→P3-S5B3 过渡期间**：shipment 详情页暂无可用的入仓按钮。这是可接受的临时状态吗？（建议：可接受。P3-S5B0~B3 在同一开发周期内连续交付，过渡窗口短）
3. **批量入仓上限**：单次 20 笔是否合理？
4. **"已确认到仓"列的默认可见性**：是否作为海外库存页默认展示列？（建议：是，帮助运营建立对照 BigSeller 库存的习惯）
5. **30 天 warning 阈值**：时间窗口兜底的 30 天是否合理？是否需要可配置？（建议：30 天足够覆盖运营对账周期。先硬编码，后续可改为环境变量）
6. **撤销吸收确认**：Admin 误点"确认 BigSeller 已吸收"后，是否需要"撤销"按钮（`bigseller_absorbed_at := NULL`）？（建议：P3-S5B 先不做撤销按钮，出现误操作通过 Supabase Dashboard 手动修正。后续版本再加）
7. **00023 后续处理时机**：P3-S5B 验收后是否立即开 Task 以 CREATE OR REPLACE 移除 inventory 写入？（建议：是）
