# Current Task Packet

## Task ID

`P7-PRODUCT-OVERVIEW` — 标准产品总看板

## 状态

**P7-PLAN**（2026-07-10）— DONE（Codex 复验通过）。P6-OVERSEAS-INVENTORY-UX-V2 已完整闭合，P7 文档阶段完成，下一步进入 P7-MVP 实现。

---

## 阶段 1：P7-PLAN / 文档与口径确认（当前阶段）

### 1.1 背景与动机

P6 E 阶段将"产品看板长期方向"记录为：

```text
标准产品名 → 国内库存 → 各海外市场库存 → 在途库存 → 国内生产周期 → 各市场运输周期
```

当前各模块页面（海外库存 `/dashboard/inventory/overseas`、在途管理 `/dashboard/shipments`、关注产品动态 Dashboard 首页）以 **仓库/SKU/变体** 为视角，运营缺少按 **标准产品** 汇总的单一视图。

P7 目标是在不新增数据库模型、不接入新数据源的前提下，基于现有真实数据构建标准产品总看板。

### 1.2 数据关系图（现有真实模型）

```text
Product (标准产品，主键)
  └── ProductVariant (各国 SKU 映射)
        ├── Inventory (海外仓库存，5 仓真实数据)
        │     ├── quantity (BigSeller available_quantity)
        │     ├── daily_sales (BigSeller 预测日销量)
        │     ├── estimated_days (BigSeller 预计可售天数)
        │     └── last_sync_at
        ├── ShipmentItem (在途明细)
        │     ├── quantity (发运数量)
        │     └── warehoused_quantity (已入仓数量)
        └── Shipment (在途主单)
              ├── status (booking→loading→departed→arrived→customs→warehoused)
              ├── country / warehouse_id / estimated_arrival
              └── warehouse_id → Warehouse
                                    ├── country (TH/ID/MY/PH/VN/CN)
                                    ├── type (domestic/overseas)
                                    ├── name
                                    └── lead_time_days

user_variant_preference
  ├── preference_type = 'favorited' → 关注
  └── preference_type = 'archived'  → 归档
```

### 1.3 可复用能力清单

#### RPC（已验证可用，无需新建）

| RPC | 覆盖范围 | 复用场景 |
|-----|----------|----------|
| `get_overseas_inventory` | 5 仓海外库存列表 + 分页 + 筛选 + in_transit 白名单 | **不能直接用于 P7 Product 维度分页**（返回粒度是 inventory 行而非 product，缺少 product_id/category/daily_sales/estimated_days/lead_time_days 等 Product Overview 所需字段）。仅可作为变体级数据补充，不可作为分页主表 |
| `get_overseas_stats` | 海外库存总量/SKU 数/低库存数 | 总看板统计卡片 |
| `get_in_transit_confirmed_aggregate` | 按 variant+warehouse 聚合在途 + 已确认到仓 | 总看板在途列 |
| `get_low_stock` | 低库存列表 | 不直接用于总看板，但口径可参考 |

**RPC 决策：P7-MVP 暂不新增 RPC（待验证方案，非最终结论）。**

当前方案是复用已有 RPC 作为变体级数据补充，在应用层按 Product 聚合。但以下前提必须在实现阶段验证：

1. **分页必须以 `product` 表为驱动**，不允许先调用 `get_overseas_inventory` 分页后再按 Product 聚合——该 RPC 返回的是 inventory 行（变体+仓库粒度），按它分页会导致 Product 维度分页不准确（同一个 Product 的多个变体/仓库行分散在不同页）。
2. **正确链路**：`product` 表分页（`is_active = true`，搜索时 name/code ILIKE）→ `product_variant` 获取关联变体 → `inventory` 表直查海外仓库存 + `warehouse` 表补全国家/仓库名/lead_time_days → `get_in_transit_confirmed_aggregate` RPC 补全在途。
3. 若实现阶段发现以下任一情况，**应重新评估新增只读 RPC `get_product_overview`**，不在文档阶段提前封死：
   - Product 维度筛选（按国家/告警等级）在应用层聚合复杂度过高或性能不可接受
   - Product 维度排序（按总库存/在途/告警等级）需要跨表聚合后排序，应用层实现脆弱
   - Operator 仓库隔离在 Product 维度下过滤逻辑复杂，SQL 层实现更可靠
   - 数据量增长到 Product > 500 或关联变体数导致应用层聚合成为瓶颈

#### Repository（可直接复用）

| 方法 | 文件 | 覆盖 |
|------|------|------|
| `inventoryRepository.getOverseasList()` | `src/features/inventory/repository.ts` | 海外库存分页/筛选 |
| `inventoryRepository.getOverseasStats()` | 同上 | 统计卡片 |
| `inventoryRepository.getInTransitConfirmedAggregate()` | 同上 | 在途+已确认聚合 |
| `shipmentRepository.getInTransitByVariant()` | `src/features/shipments/repository.ts` | 按 variant 在途 |
| `shipmentRepository.getInTransitByVariantAndWarehouse()` | 同上 | 按 variant+warehouse 在途 |

#### Server Actions（可直接复用）

| Action | 文件 | 覆盖 |
|--------|------|------|
| `getOverseasInventory()` | `src/features/inventory/actions.ts` | 完整海外库存编排 |
| `bindOverseasVariant()` | 同上 | 产品绑定（总看板不直接使用，但跳转后可用） |

#### UI 组件（可参考/复用）

| 组件 | 位置 | 可复用元素 |
|------|------|------------|
| `FollowedProductsSection` | `src/features/preferences/components/` | 筛选标签 + alertLevel badge + 表格 + ExternalLink 跳转模式 |
| `Pagination` | `src/components/ui/pagination.tsx` | 通用分页 |
| `OverseasPageContent` | `overseas/_components/` | 筛选栏 + 统计卡片 + 表格结构参考 |
| `LowStockSummarySection` | `dashboard/_components/` | 低库存汇总区块结构 |

### 1.4 已知缺口与技术债

#### TECH-DEBT-01：国内库存缺失

| 维度 | 现状 |
|------|------|
| 数据来源 | **无**。Dashboard 首页入口卡片为灰色占位「即将推出」。 |
| 数据库行 | `warehouse` 表有一条 `type=domestic, country=CN` 记录，但 `inventory` 表中**无任何 domestic 库存行**。 |
| RPC | 无 `get_domestic_inventory`。`get_overseas_inventory` 仅覆盖 `warehouse.type='overseas'`。 |
| Repository | `inventoryRepository.list()` 支持 `warehouseType='domestic'` filter，但查询结果恒为空。 |
| 同步链路 | 无 supplier / CLI / 抓取器。海外仓通过 BigSeller 抓取 + Python CLI；国内仓无对应能力。 |
| 页面 | `/dashboard/inventory/domestic` 为占位页。 |

**P7-MVP 处理**：
- 总看板**保留国内库存列位置，显示「待接入」灰色占位**，不展示假数据（不显示 0、不显示假数字）。
- 不新增 domestic_inventory 假表、假字段、假 RPC。
- 后续作为独立任务 P8-DOMESTIC-INVENTORY 设计：
  - 确认数据来源（聚水潭 / 手动录入 / 其他）
  - 新建 supplier adapter + CLI + RPC + Migration
  - 独立验收，不阻塞 P7，不阻塞海外库存和在途视角推进。

#### TECH-DEBT-02：国内生产周期缺失

| 维度 | 现状 |
|------|------|
| 数据字段 | 无。当前无表/字段存储生产周期（如 `production_cycle_days`）。 |
| 隐含相关列 | `warehouse.lead_time_days` 仅表示**运输**补货周期（5 海外仓统一 = 30 天），不区分生产 vs 运输。 |

**P7-MVP 处理**：
- 总看板**不展示生产周期列**（无数据）。
- 记录为技术债：后续需确认是否在 Product 表增加 `production_cycle_days`，或在 Warehouse 表区分 `lead_time_days`（运输）和独立的生产周期字段。
- 不伪造假列、假 RPC、假 Migration。

#### TECH-DEBT-03：各市场运输周期精细化缺失

| 维度 | 现状 |
|------|------|
| 已有数据 | `warehouse.lead_time_days` = 30（5 个海外仓统一值，手动填入）。 |
| 粒度 | 仓级别，非市场/国家对级别。无法区分"中国→泰国"和"中国→印尼"不同周期。 |
| 动态计算 | 无。当前值是静态配置，非从 tracking_event.occurred_at 差值得出的真实运输时间。 |

**P7-MVP 处理**：
- 总看板**可展示 `warehouse.lead_time_days`**（已有真实配置数据，非假数据），列名标注「补货周期（天）」。
- 不做按市场/国家对拆分，不做动态运输时间计算。
- 记录为技术债：真正市场级运输周期需从 `tracking_event` 时间差统计，或手动配置国家对周期。

### 1.5 P7-MVP 明确不做项

| 不做项 | 原因 |
|--------|------|
| 国内库存真实数据接入 | 无数据来源/模型/同步链路 → 独立 P8 |
| 国内库存假数据展示（0 / 假数字） | 占位只显示「待接入」，不伪造 |
| 国内生产周期字段/计算 | 无数据 → 独立任务设计 |
| 各市场运输周期精细化拆分 | lead_time_days 已可用但粒度不足，精细化需独立任务 |
| 按产品新建/编辑/绑定操作 | 不在总看板范围，复用已有页面跳转 |
| 图表/趋势图/柱状图 | MVP 仅表格，不做可视化 |
| 新建 Migration | 全部从已有表读取 |
| 新建 RPC | 暂不新增 RPC（待验证方案）；以 `product` 表为分页主表 + 应用层聚合先行。若实现阶段发现 Product 维度筛选/排序/权限隔离复杂度过高，则重新评估新增只读 RPC `get_product_overview` |
| 新建 RLS 策略 | 不建新表 |
| 修改 Product → ProductVariant → Inventory 核心模型 | 不破坏现有架构 |
| 接入百世外部在途表（shipment_external_ref 等） | BLOCKED_EXTERNAL（P3-S1B） |
| 修改 BigSeller 同步流程 | 只读看板，不写数据 |
| 自动同步启用 | WEBSYNC_REAL_WRITE_ENABLED=false |

### 1.6 P7 实现阶段拆分（规划，不在本轮执行）

```
P7-PLAN  → 文档与口径确认（当前）
P7-MVP   → 标准产品总看板只读页面实现
P7-UX    → 运营可用性收口（筛选/排序/跳转/导出）
P7-REVIEW → 独立验收与文档同步
```

---

## 阶段 2：P7-MVP / 标准产品总看板实现（规划）

### 2.1 页面路由

`/dashboard/products/overview` — 标准产品总看板

- **Server Component**：`src/app/dashboard/products/overview/page.tsx`
- **Client Component**：`src/app/dashboard/products/overview/_components/overview-page-content.tsx`
- **侧边栏入口**：产品分组下新增「产品总看板」，`LayoutDashboard` 或 `BarChart3` 图标

### 2.2 页面数据结构

以 **Product（标准产品）** 为行，按 **海外市场（国家）** 为列展开：

```
Product
├── 基本信息：name / code / category / safety_stock / is_active
├── 国内库存：null（占位「待接入」）
├── 海外市场（每个国家一列）：
│   ├── quantity（库存量）→ 0 显示「—」
│   ├── warehouseName
│   ├── inTransitQuantity（在途）
│   └── alertLevel（正常/低库存/缺货/可售预警）
├── 总在途：跨市场在途合计
└── 最差告警：worstAlertLevel（critical > warning > normal > unknown）
```

### 2.3 新 Types

在 `src/features/inventory/types.ts` 新增：

```typescript
/** 单个市场库存摘要 */
interface MarketInventorySummary {
  country: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
  safetyStock: number;
  inTransitQuantity: number;
  dailySales: number | null;
  estimatedDays: number | null;
  leadTimeDays: number | null;
  alertLevel: 'critical' | 'warning' | 'normal' | 'unknown';
  alertReason: string | null;
}

/** 产品总看板行 */
interface ProductOverviewItem {
  productId: string;
  productName: string;
  productCode: string;
  category: string | null;
  safetyStock: number;
  isActive: boolean;
  variantCount: number;               // 关联 SKU 总数
  unmatchedVariantCount: number;       // 未匹配 SKU 数
  markets: MarketInventorySummary[];   // 按国家分组
  totalInTransit: number;
  worstAlertLevel: 'critical' | 'warning' | 'normal' | 'unknown';
  domesticStatus: 'unavailable';       // 固定值：国内库存待接入
}

/** 产品总看板筛选 */
interface ProductOverviewFilters {
  search?: string;
  country?: string;                    // 过滤到特定国家
  alertLevel?: 'critical' | 'warning' | 'normal' | 'unknown';
  page: number;
  pageSize: number;
}
```

### 2.4 新 Repository 方法（预估）

在 `src/features/inventory/repository.ts` 新增：

```typescript
getProductOverview(filters: ProductOverviewFilters, userId: string): Promise<PaginatedResult<ProductOverviewItem>>
```

**实现策略**：

1. **分页主表必须是 `product`**：从 `product` 表分页（仅 `is_active = true`，搜索时按 name/code ILIKE），不允许以 `get_overseas_inventory` 返回的 inventory 行作为分页驱动——该 RPC 返回的是变体+仓库粒度行，不是 Product 粒度行，按它分页会导致同一个 Product 的多个变体分散在不同页，Product 维度分页不准确。
2. 通过 `product_variant` LEFT JOIN 获取所有关联 variant
3. 对每个 variant 查询 `inventory`（海外仓）+ 从 `get_in_transit_confirmed_aggregate` RPC 取在途
4. 在应用层按 product_id 分组、按 country 分列
5. alertLevel 复用 `FollowedVariantBasic` 的动态告警规则（estimatedDays < leadTimeDays → critical, quantity < safetyStock → warning）
6. Operator 仓库隔离：复用 `warehouseAccessRepository.getAccessibleWarehouseIds`

**不分页后在前端聚合大量数据**：
- Product 本身分页（服务端 LIMIT/OFFSET）
- 每页 Product 的关联 variant + inventory + in-transit 在服务端一次性拉取后分组
- 单个 product 关联的 variant 数通常 < 10，数据量极小

### 2.5 新 Server Action（预估）

在 `src/features/inventory/actions.ts` 新增：

```typescript
getProductOverview(filters: ProductOverviewFilters): Promise<{
  result: PaginatedResult<ProductOverviewItem>;
  countries: string[];  // 可用国家列表
}>
```

- `requireActiveAuth()` → Admin/Operator 均可查看
- Zod 校验（`productOverviewSchema`）
- 调用 repository 方法
- **错误处理**：DB / RLS / repository 错误必须传递为中文错误状态，页面可展示错误边界或错误提示，但禁止将异常伪装成空数据（如 `catch` 后返回空 markets / worstAlertLevel='unknown'）。真正无数据时才显示空状态。

### 2.6 新 Zod Schema（预估）

在 `src/features/inventory/schema.ts` 新增：

```typescript
productOverviewSchema: z.object({
  search: z.string().optional(),
  country: z.enum(['TH','ID','MY','PH','VN']).optional(),
  alertLevel: z.enum(['critical','warning','normal','unknown']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})
```

### 2.7 是否需要新 Migration

**不需要。** 所有数据从已有表读取：`product` / `product_variant` / `inventory` / `shipment` / `shipment_item` / `warehouse`。不新增表、字段、索引、约束、触发器或 RPC。

### 2.8 是否需要新 RPC

**暂不新增（待验证方案）。** 详见阶段 1.3 节决策理由与验证前提。当前方案以 `product` 表为分页主表 + 已有 RPC 作为变体级数据补充 + 应用层聚合。若实现阶段发现 Product 维度筛选/排序/权限隔离复杂度过高，则重新评估新增只读 RPC `get_product_overview`，不在文档阶段提前封死。

### 2.9 权限与 RLS 风险

| 风险点 | 评估 | 缓解措施 |
|--------|------|----------|
| Operator 仓库隔离 | 新 repository 方法需继承现有隔离逻辑 | 传入 `userId`，复用 `warehouseAccessRepository.getAccessibleWarehouseIds()` |
| 直接 supabase.from() | 必须经过 RLS session（`createClient()`） | 按现有 repository 模式实现 |
| Server Action 权限 | 只读看板，Admin/Operator 均可访问 | `requireActiveAuth()` |
| service_role 泄露 | 不在 P7 范围使用 | 无风险 |
| 新增 RLS 策略 | 不建新表 | 无风险 |

### 2.10 侧边栏入口

在 `src/app/dashboard/_components/sidebar-nav.tsx` 产品分组下新增：

```typescript
{
  label: '产品总看板',
  href: '/dashboard/products/overview',
  icon: LayoutDashboard,  // 或 BarChart3
}
```

### 2.11 P7-MVP 验收标准

| 维度 | 标准 |
|------|------|
| 功能 | Product 列表按标准产品汇总 5 个海外市场库存 + 在途 + 告警状态 |
| 国内库存 | 每行显示「待接入」灰色占位，不展示假数据 |
| 筛选 | 搜索产品名/编码、按国家过滤、按告警等级过滤 |
| 分页 | 复用 Pagination 组件，每页 20/50/100 |
| 跳转 | 点击产品行 → 海外库存页 `?search=${product.code}` |
| 权限 | Admin/Operator 均可访问；Operator 只看到已分配仓库 |
| 边界状态 | 空数据/加载中/错误/筛选无结果/未匹配 SKU 全部处理 |
| 架构合规 | 不绕过 Repository Pattern / Server Actions / RLS |
| 质量门 | `npm run test` / `npm run lint` / `npm run build` 通过 |
| 不新增 | Migration / RPC / RLS / 新表 |
| 技术债 | 国内库存/生产周期/运输周期不实现、不伪造，仅记录 |

### 2.12 P7-MVP 预估文件清单

| # | 文件 | 操作 | 说明 |
|---|------|------|------|
| 1 | `src/features/inventory/types.ts` | 修改 | 新增 ProductOverviewItem / ProductOverviewFilters / MarketInventorySummary |
| 2 | `src/features/inventory/schema.ts` | 修改 | 新增 productOverviewSchema |
| 3 | `src/features/inventory/repository.ts` | 修改 | 新增 getProductOverview() |
| 4 | `src/features/inventory/actions.ts` | 修改 | 新增 getProductOverview() Server Action |
| 5 | `src/app/dashboard/products/overview/page.tsx` | **新建** | Server Component |
| 6 | `src/app/dashboard/products/overview/_components/overview-page-content.tsx` | **新建** | Client Component |
| 7 | `src/app/dashboard/_components/sidebar-nav.tsx` | 修改 | 新增「产品总看板」入口 |
| 8 | `src/features/inventory/p7-product-overview.test.ts` | **新建** | 源码级测试 |

**预估影响**：新建 3 个文件 + 修改 5 个文件，不涉及 Migration/RPC/RLS。

---

## 3. 质量门（全阶段通用）

```bash
npm run test          # 所有测试通过
npm run build         # Turbopack 构建成功
npm run lint          # 0 errors，不新增 warning
git diff --check      # 无 trailing whitespace / 冲突标记
```

---

## 4. 禁止事项（全阶段）

- 不新增 Migration / RPC / RLS（P7-MVP 全部从已有表读取）
- 不修改 BigSeller 同步真实写入流程
- 不实现国内库存真实数据（仅占位）
- 不伪造国内库存假数据（不显示 0 / 假数字 / 假字段）
- 不修改 Product → ProductVariant → Inventory 核心模型
- 不绕过 Repository Pattern / Server Actions / RLS
- 不提交 `.claude/context-status.json`
- 不提交 `.env.local`
- 不使用 `any`
- 不使用 `service_role` 在客户端或业务页面
- 不新建 `domestic_inventory` 假表或假 RPC

---

## 5. 下一步

1. **Codex 独立审查**：本文档 + `docs/current-state.md` 同步更新
2. **P7-MVP 实现**：Codex 审查通过后，按阶段 2 任务包逐步实现
3. **P7-UX 收口**：MVP 完成后评估运营可用性（排序/导出/布局优化）
4. **国内库存独立设计**：不阻塞 P7，后续作为 P8 独立任务
