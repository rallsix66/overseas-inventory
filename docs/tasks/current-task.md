# Current Task Packet

## Task ID

`P6-OVERSEAS-INVENTORY-UI-CLARITY` — 海外库存 UI 清晰度优化

## 状态

**全阶段 A~D DONE**（2026-07-08）。

---

## 总体目标

让运营人员在海量海外库存数据中快速定位关键信息，明确库存归属（BigSeller 原始品名 vs DIS 标准产品），消除"已确认到仓"在主表的误导，补齐物流时效感知，让筛选和导航交互更直观。

---

## 阶段划分

| 阶段 | 内容 | 依赖 | 状态 |
|------|------|------|------|
| 0 | 需求固化 + 文档 | 无 | ✅ DONE |
| A | 筛选器中文化 + 统计卡片可点击 + 防跳顶 | 0 | ✅ DONE |
| B | 移除"已确认到仓"列 | 0 | ✅ DONE |
| C | 展开物流明细增加"最近物流更新时间" | 0 | ✅ DONE |
| D | 未匹配行预留"绑定产品"入口 | 0 | ✅ DONE |

全阶段 A~D 已实现并验收通过（3090/3091 测试、build pass、lint 0/26）。

---

## 已确认的业务决策

### 1. 产品绑定长期方向

**当前状态**：
- `/dashboard/products` = DIS 标准产品主数据
- `/dashboard/inventory/overseas` = BigSeller 原始品名
- 两者通过 `product_variant.match_status` 标记匹配关系

**长期方向**：
- 标准产品名 → 国内库存 → 各海外市场库存 → 在途库存 → 国内生产周期 → 各市场运输周期
- 未匹配海外 SKU 可被绑定到产品列表中的标准产品 → 创建 ProductVariant 记录
- 绑定操作走 `Product → ProductVariant → Inventory` 模型，不绕路

**本任务范围**：
- 阶段 D：仅预留"绑定产品"UI 入口（按钮占位 + 点击弹出空状态提示"产品绑定功能即将上线"）
- 真实产品绑定（搜索产品列表 / 创建 ProductVariant / 回写 match_status）另开后续任务
- 不修改 Product → ProductVariant → Inventory 模型

### 2. "已确认到仓"字段移除

**原因**：
- BigSeller 抓取的 `inventory.quantity` 已包含所有已入库库存
- 海外库存主表同时展示"当前库存"和"已确认到仓"容易让运营误以为两者是独立库存来源
- 实际上"已确认到仓"的货物在被 BigSeller 同步后已经体现在 `inventory.quantity` 中
- 主表移除该列消除重复信息源的误解

**保留范围**：
- `/dashboard/shipments` 在途管理详情页保留已确认到仓数量
- `/dashboard/shipments/batch` 批量入仓列表保留该口径
- RPC `get_in_transit_confirmed_aggregate` 不修改（`actions.ts` 仍调用用于统计卡片和导出 CSV 的在途聚合，但不再传给页面表格渲染）

**实现要点**：
- `overseas-page-content.tsx` 移除"已确认到仓"列头、列表格、`confirmedMap` prop
- `page.tsx` 不再将 `confirmedMap` 传递给 `OverseasPageContent`
- `getOverseasInventory` action 可精简返回值类型（移除 confirmedMap，可选项——不强制）
- 展开行 `colSpan` 同步更新（从 13→12）

### 3. 物流更新时间

**新增字段**：展开行底部显示"最近物流更新时间"

**数据来源（优先级）**：
1. `tracking_event.occurred_at` — 最近一条 tracking 事件的实际发生时间，最精确反映物流动态
2. `shipment.updated_at` — 如无 tracking_event，fallback 到 shipment 最近一次编辑/状态推进时间
3. `—` — 如该 (variantId, warehouseId) 下无任何在途 shipment

**实现方式**：
- 在 `shipmentRepository.getInTransitDetailsByVariantAndWarehouse()` 返回类型中新增 `latestTrackingAt: string | null`
- SQL 层：在查询 shipment_item 关联数据时，子查询 `tracking_event` 表取 `MAX(occurred_at)`，或 COALESCE 到 `shipment.updated_at`
- 不新增独立 RPC，不改 Migration

**UI 展示**：
- 展开行底部新增一行 "最近物流更新 2025-07-08 14:30"（使用 `formatTime` 函数）
- 样式与同步更新时间一致（小号 muted 文字）

### 4. 筛选与交互

#### 4a. 筛选器中文化

```text
当前: <SelectItem value="all">全部国家</SelectItem> → 已正确显示中文
      但 SelectValue placeholder 和触发按钮在值为默认时的显示需要确认

目标: 筛选器 unselected 状态显示 "全部国家" / "全部仓库" / "全部状态"
      确保不出现裸 "all" 字样
```

当前海外库存页的 SelectItem 已经有中文标签（"全部国家"/"全部仓库"/"全部状态"），需确认：
- `SelectTrigger` 内的 `SelectValue` placeholder 在各筛选器首次加载时是否展示中文
- 筛选值切换回默认值时是否正确回显中文

#### 4b. 统计卡片可点击

```text
低库存卡片 点击 → stockStatus='low'
在途库存卡片 点击 → 无对应筛选（在途不是库存状态），暂不实现该卡片点击
SKU 数量 / 库存总量卡片 → 清除筛选 / 展示全部
```

实现方式：
- 卡片 `onClick` 设置对应筛选参数 → `router.push(buildUrl({...}))`
- 卡片添加 `cursor-pointer` + `hover:shadow` 提示可点击
- 在途库存卡片暂不实现点击（在途数量从 shipment 表来，不直接对应 inventory 行筛选）

#### 4c. 防页面跳顶

```text
router.push(url, { scroll: false })
```

- `buildUrl` 调用 `router.push` 时传入 `{ scroll: false }` 选项
- 筛选变更、分页切换时均不滚动到页面顶部
- 在 OverseasPageContent 内全局搜索 `router.push` 调用点统一处理

### 5. 分页 UI（后续独立优化项）

BigSeller 风格分页（页码按钮行 + 省略号 + 跳转输入框）作为后续独立 UI 优化项：
- 当前分页 UI（"上一页/下一页" + "共 N 条，第 X/Y 页"）暂时保留
- 原因：当前数据量较小（< 500 条），现有分页够用
- 后续如单仓数据增大或用户反馈翻页不便，再评估引入 BigSeller 风格分页
- 不在本任务 P6-OVERSEAS-INVENTORY-UI-CLARITY 各阶段中实现

---

## 阶段 A 实现计划（筛选+交互）

### 目标

筛选器中文化确认 + 统计卡片可点击 + 防跳顶。

### 范围

- 确认 `SelectTrigger` placeholder 中文显示
- 低库存/在途/SKU/总量统计卡片添加 onClick
- `router.push` 统一添加 `{ scroll: false }`
- 补测试

### 验收

| 检查项 | 期望 |
|--------|------|
| 筛选器未选择时显示 "全部国家/全部仓库/全部状态" | ✅ |
| 点击低库存卡片 → stockStatus='low' 筛选 | ✅ |
| 点击 SKU 数量卡片 → 清除筛选 | ✅ |
| 换页后页面不跳顶 | `scroll: false` |
| `npm run test` 通过 | ✅ |
| `npm run build` 通过 | ✅ |
| `npm run lint` 0 errors | ✅ |

---

## 阶段 B 实现计划（移除已确认到仓列）

### 目标

海外库存主表移除"已确认到仓"列，消除运营对库存数量的误解。

### 范围

- `overseas-page-content.tsx`：移除表头/表体/confirmedMap prop
- `page.tsx`：移除 confirmedMap 数据获取和传递
- colSpan 更新 13→12
- 补测试

### 验收

| 检查项 | 期望 |
|--------|------|
| 主表无"已确认到仓"列 | ✅ |
| colSpan=12 且与表头列数一致 | ✅ |
| `/dashboard/shipments` 仍展示已确认到仓 | ✅ |
| 不修改 RPC / Migration | ✅ |
| `npm run test` 通过 | ✅ |

---

## 阶段 C 实现计划（物流更新时间）

### 目标

展开行内新增"最近物流更新时间"，让运营了解在途动态的时效。

### 范围

- `shipmentRepository.getInTransitDetailsByVariantAndWarehouse` 新增 `latestTrackingAt` 字段
- `InTransitDetailRow` UI 展示最近物流更新时间
- `InTransitDetail` 类型新增 `latestTrackingAt: string | null`
- SQL 查询：子查询 `tracking_event` 取 `MAX(occurred_at)` + COALESCE `shipment.updated_at`
- 补测试

### 验收

| 检查项 | 期望 |
|--------|------|
| 有 tracking_event 时显示 occurred_at | ✅ |
| 无 tracking 但有 shipment 时显示 shipment.updated_at | ✅ |
| 无在途数据时显示 "—" | ✅ |
| 不新增 RPC / Migration | ✅ |
| `npm run test` 通过 | ✅ |

---

## 阶段 D 实现计划（预留绑定产品入口）

### 目标

未匹配海外库存行旁添加"绑定产品"按钮占位，让运营意识到此功能即将上线。

### 范围

- 未匹配行（`item.matchStatus !== 'matched'`）在操作区显示"绑定产品"按钮
- 按钮点击弹出空状态提示（`toast.info` 或小型 Dialog）
- 不调用任何 binding API / 不创建 variant / 不修改 match_status
- 按钮样式：outline + 小号
- 补测试

### 验收

| 检查项 | 期望 |
|--------|------|
| 未匹配行显示"绑定产品"按钮 | ✅ |
| 已匹配行不显示 | ✅ |
| 点击提示"产品绑定功能即将上线" | ✅ |
| 不修改数据库 / 不创建 variant | ✅ |
| `npm run test` 通过 | ✅ |

---

## 禁止事项（全阶段）

- 不新增 Migration / RPC / RLS
- 不实现真实产品绑定（仅 UI 占位）
- 不修改 BigSeller 同步真实写入流程
- 不做国内库存页面
- 不修改 Product → ProductVariant → Inventory 模型
- 不提交 `.claude/context-status.json`

---

## 验收命令（全阶段通用）

```bash
npm run test
npm run build
npm run lint
git diff --check
```

---

## 下一步

P6-OVERSEAS-INVENTORY-UI-CLARITY 已完成。下一步待用户确认新任务（可选项：继续完成剩余 2 天手动真实同步观察后评估 Cron/自动同步；或推进新 Phase；或 P3-S1B 百世 API 恢复（仍 BLOCKED_EXTERNAL））。
