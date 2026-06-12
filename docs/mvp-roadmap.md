# MVP 开发路线图 v1

> 文档导航：[文档树](README.md) · [当前状态](current-state.md) · [项目概览](project-overview.md) · [任务执行体系](tasks/README.md)

> 基于 rules 冻结 + 数据库 Schema 冻结，按优先级排序。
>
> 标记说明：
> - 🔴 必须先完成，阻塞后续开发
> - 🟡 本阶段核心交付
> - 🟢 可延后或简化
> - ⏸️ 第二阶段

---

## Phase 0：基础设施搭建

**目标**：项目能跑，数据库能用，登录能进。

**预计**：一次性完成，后续不再改动

| # | 任务 | 依赖数据表 | 优先级 |
|---|---|---|---|
| 0.1 | `npx create-next-app` + TypeScript + Tailwind + shadcn/ui 初始化 | — | 🔴 |
| 0.2 | Supabase 项目创建 + 执行 `00001_initial_schema.sql` | 全部 | 🔴 |
| 0.3 | `src/lib/supabase/client.ts` + `server.ts` 封装 | — | 🔴 |
| 0.4 | `src/types/database.ts` 类型生成 | 全部 | 🔴 |
| 0.5 | 环境变量配置（`.env.local` + `.env.example`） | — | 🔴 |
| 0.6 | `src/middleware.ts` — 登录校验 + 路由守卫 | `profiles` | 🔴 |
| 0.7 | `/auth/login` — 登录页（Supabase Auth UI 或自定义） | — | 🔴 |
| 0.8 | `/auth/callback` — Auth 回调处理 | — | 🔴 |
| 0.9 | `dashboard/layout.tsx` — 侧边栏 + 顶栏骨架 | — | 🔴 |
| 0.10 | 创建首个管理员账号（SQL 手动升级 role_id） | `role`, `profiles` | 🔴 |

**完成标志**：登录 → 进入空白 Dashboard → 侧边栏可见

---

## Phase 1：产品主数据

**目标**：管理员能管理标准产品和国家 SKU 映射。

**依赖**：Phase 0 完成

| # | 任务 | 页面路由 | 依赖数据表 | 优先级 |
|---|---|---|---|---|
| 1.1 | `features/products/types.ts` | — | `product`, `product_variant` | 🔴 |
| 1.2 | `features/products/repository.ts` + `actions.ts` — 查询与写操作 | — | `product`, `product_variant` | 🔴 |
| 1.3 | `/products` — 产品列表页（表格） | `dashboard/products/page.tsx` | `product`, `product_variant` | 🟡 |
| 1.4 | `/products/[id]` — 产品详情页（含关联 Variant 列表） | `dashboard/products/[id]/page.tsx` | `product`, `product_variant` | 🟡 |
| 1.5 | `ProductForm` — 新增/编辑标准产品 | `features/products/components/product-form.tsx` | `product` | 🟡 |
| 1.6 | `SkuMappingTable` — 待匹配 SKU 列表 + 匹配操作 | `features/products/components/sku-mapping-table.tsx` | `product_variant` | 🟡 |
| 1.7 | 安全库存设置功能 | `features/products/components/safety-stock-config.tsx` | `product` | 🟡 |

**完成标志**：管理员能录入标准产品 → 看到未匹配 SKU → 手动绑定

---

## Phase 2：库存数据

**目标**：运营和管理员都能看到库存，首页卡片工作。

**依赖**：Phase 0 + Phase 1（inventory 必须有 variant_id，variant 必须已匹配才能统计）

| # | 任务 | 页面路由 | 依赖数据表 | 优先级 |
|---|---|---|---|---|
| 2.1 | `features/inventory/types.ts` | — | `inventory`, `product_variant`, `product`, `warehouse` | 🔴 |
| 2.2 | `features/inventory/repository.ts` + `actions.ts` — 库存查询与写操作 | — | `inventory`, `product_variant`, `product`, `warehouse` | 🔴 |
| 2.3 | `features/dashboard/types.ts` | — | — | 🔴 |
| 2.4 | `features/dashboard/repository.ts` — 三卡片数据查询 | — | `inventory`, `product_variant`, `product`, `warehouse` | 🔴 |
| 2.5 | 首页 — 三张统计卡片（海外低库存 / 国内低库存 / 在途数量） | `dashboard/page.tsx` | `inventory`, `warehouse`, `product` | 🟡 |
| 2.6 | 首页 — 缺货列表（表格，低库存标红） | 同上 | `inventory`, `product_variant`, `product`, `warehouse` | 🟡 |
| 2.7 | `/inventory/overseas` — 海外库存页（按国家分组，全量表） | `dashboard/inventory/overseas/page.tsx` | `inventory`, `product_variant`, `product`, `warehouse` | 🟡 |
| 2.8 | `/inventory/domestic` — 国内库存页（占位，后续接聚水潭） | `dashboard/inventory/domestic/page.tsx` | `inventory`, `product_variant`, `warehouse` | 🟢 |
| 2.9 | `InventoryTable` + `InventoryFilter` + `StockStatusBadge` | `features/inventory/components/` | — | 🟡 |

**完成标志**：首页三卡片显示正确数字 → 缺货列表标红 → 库存页可浏览

---

## Phase 3：在途库存 + 物流节点

**目标**：运营能录入在途、推进状态；首页在途卡片联动。

**依赖**：Phase 1（ShipmentItem 关联 variant_id）

| # | 任务 | 页面路由 | 依赖数据表 | 优先级 |
|---|---|---|---|---|
| 3.1 | `features/shipments/types.ts` | — | `shipment`, `shipment_item`, `tracking_event` | 🔴 |
| 3.2 | `features/shipments/repository.ts` + `actions.ts` — 查询与状态流转 | — | `shipment`, `shipment_item`, `tracking_event` | 🔴 |
| 3.3 | `/shipments` — 在途列表页（表格，按状态分组） | `dashboard/shipments/page.tsx` | `shipment`, `shipment_item`, `product_variant` | 🟡 |
| 3.4 | `ShipmentForm` — 新建在途记录（船名/航次/产品/数量） | `features/shipments/components/shipment-form.tsx` | `shipment`, `shipment_item` | 🟡 |
| 3.5 | `StatusFlow` — 状态推进按钮（订舱→装柜→...→入仓） | `features/shipments/components/status-flow.tsx` | `shipment`, `tracking_event` | 🟡 |
| 3.6 | `ShipmentTimeline` — 时间线展示物流轨迹 | `features/shipments/components/shipment-timeline.tsx` | `tracking_event` | 🟡 |
| 3.7 | 首页 — 在途追踪列表 | `dashboard/page.tsx` | `shipment`, `shipment_item` | 🟡 |
| 3.8 | 入仓自动联动：status=warehoused → 更新 inventory.quantity | — | `shipment`, `shipment_item`, `inventory` | 🟡 |

**完成标志**：运营能录入在途 → 推进状态 → 入仓后库存自动增加 → 首页在途卡片联动

---

## Phase 4：团队账号管理

**目标**：管理员能管理用户账号和角色。

**依赖**：Phase 0（Auth 就绪）

| # | 任务 | 页面路由 | 依赖数据表 | 优先级 |
|---|---|---|---|---|
| 4.1 | `features/users/types.ts` | — | `profiles`, `role` | 🔴 |
| 4.2 | `features/users/repository.ts` + `actions.ts` — 查询与角色更新 | — | `profiles`, `role` | 🔴 |
| 4.3 | `/users` — 用户列表页（表格，仅管理员可见） | `dashboard/users/page.tsx` | `profiles`, `role` | 🟡 |
| 4.4 | 修改角色功能（管理员→运营互切） | 同上 | `profiles`, `role` | 🟡 |
| 4.5 | 禁用/启用用户 | 同上 | `profiles` | 🟢 |
| 4.6 | `RoleBadge` — 角色标签组件 | `features/users/components/role-badge.tsx` | — | 🟢 |

**完成标志**：管理员能看用户列表 → 能改角色 → 能禁用

---

## Phase 5：数据同步（V1）

**目标**：海外仓库存能通过页面抓取更新。

**依赖**：Phase 1（product_variant 就绪）+ Phase 2（inventory 就绪）

| # | 任务 | 依赖数据表 | 优先级 |
|---|---|---|---|
| 5.1 | 同步脚本框架（调用页面抓取 → 解析 → 写库） | `product_variant`, `inventory`, `sync_log`, `warehouse` | 🟡 |
| 5.2 | 新 SKU 自动创建 ProductVariant（match_status=unmatched） | `product_variant` | 🟡 |
| 5.3 | 同步结果写 sync_log | `sync_log` | 🟡 |
| 5.4 | 同步失败处理（保留旧数据 + 记录错误 + 页面警告） | — | 🟡 |
| 5.5 | 管理员手动触发同步按钮 | `warehouse` | 🟢 |

**完成标志**：同步脚本运行 → inventory 更新 → sync_log 有记录 → 失败有警告

---

## 依赖关系总图

```
Phase 0（基础设施）
    ↓
Phase 1（产品主数据） ← 库存和在途都依赖 variant
    ↓
    ├─→ Phase 2（库存数据） ← 首页卡片核心
    │       ↓
    ├─→ Phase 3（在途 + 物流） ← 首页在途卡片
    │
    └─→ Phase 4（团队账号） ← 与库存/在途无依赖，可并行
                ↓
Phase 5（数据同步） ← 依赖 Phase 1 + Phase 2
```

---

## 第二阶段（⏸️ 本次不做）

| 功能 | 原因 |
|---|---|
| 预计到港 + 超时提醒 | Phase 2 需求，数据模型已支持（`estimated_arrival`） |
| 库存预警（自动通知） | Phase 2 需求 |
| 库存趋势报表（ECharts 折线图） | 需 `inventory_snapshots` 表 |
| 自动补货建议 | Phase 3 需求 |
| AI 需求预测 | Phase 3 需求 |
| 自动生成采购单 | Phase 3 需求 |
| 国内仓接聚水潭 | 需聚水潭 API 对接 |
| 手机端适配 | design.md 明确只做桌面端 |
| 自动 SKU 匹配引擎 | SKU 量 < 100 人工足够 |

---

当前 Phase、已完成范围和下一步任务统一以 `current-state.md` 为准，本路线图不重复维护实时进度。
模块内的小任务顺序和单次会话范围分别以 `tasks/phase-*.md` 与 `tasks/current-task.md` 为准。
