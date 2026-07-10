# Current Task Packet

## Task ID

`P6-OVERSEAS-INVENTORY-UX-V2` — 海外库存完整体验优化

## 状态

**A+B+C+D DONE**（2026-07-08）+ **D 返工 DONE**（2026-07-08）。A（BigSeller 分页）+ B（统计卡片真实联动）+ C（筛选状态可见化）+ D（真实产品绑定 + 字段语义修正 + 分词搜索 + 写后校验）已全部实现并验收。E（产品看板长期方向）仅计划。

**TEAM-ACCOUNTS-INACTIVE-SESSION-GUARD DONE**（2026-07-10）。停用账号 Dashboard 顶层边界收口：Dashboard layout 新增 `getCurrentActiveUser` 活跃校验，停用用户不再渲染业务页面，统一展示阻断页（含退出登录按钮），避免子页面/Server Action 才 throw 导致的 Console Error。不做 P7，不做国内库存方案。

---

## 1. 当前问题复盘

### P6-OVERSEAS-INVENTORY-UI-CLARITY 已完成什么

上一轮 P6 轻量收口（全阶段 A~D DONE）完成了以下 UI 清晰度修正：

| 已完成项 | 内容 |
|----------|------|
| 筛选器中文化 | placeholder "全部国家/全部仓库/全部状态"，不暴露 raw `all` |
| 统计卡片可点击 | 库存总量/SKU → 清除筛选；低库存 → `stockStatus=low` |
| 防页面跳顶 | 所有 `router.push` 统一 `{ scroll: false }` |
| 移除"已确认到仓"列 | 主表 colSpan 13→12，RPC 保留供在途/CSV 使用 |
| 物流更新时间 | 展开行显示 `tracking_event.occurred_at` 或 `shipment.updated_at` |
| 绑定产品占位 | 未匹配行显示"绑定产品"按钮，点击弹出 toast 提示 |

### 为什么这不等于完整体验优化

以上 5 项属于最小可用的 UI 清晰度修正，但运营人员实际使用中仍有以下明显不足：

1. **分页体验差**：当前仅有"上一页/下一页 + 共 N 条第 X/Y 页"，SKU 超过 100 条后翻页效率低，无页码导航、无跳页、无每页条数切换。
2. **统计卡片联动弱**：卡片点击后仅设置筛选参数，页面没有明显的视觉反馈告知用户"当前正在看的范围"（如低库存筛选），用户可能忘记自己处于筛选状态。
3. **筛选状态不可见**：当前筛选栏是纯下拉框，未以标签/摘要形式展示已应用项。用户无法一眼看到当前生效的筛选组合，清除单个筛选需要重新选择下拉"all"。
4. **产品绑定是假入口**：未匹配海外 SKU 的"绑定产品"按钮只弹 toast，运营不能真正建立 DIS 标准产品与海外库存的关联。回到产品列表手动创建 variant 再回来确认，流程割裂。
5. **缺少产品看板长期方向**：标准产品 → 国内外库存 → 在途 → 周期的总览方向已在多次讨论中确认，但尚未固化为开发计划。

### 本轮目标

- 在 P6-OVERSEAS-INVENTORY-UI-CLARITY 基础上，补齐以上缺失的完整体验。
- 本轮 A+B+C+D 已实现并验收（BigSeller 风格分页 + 统计卡片真实联动 + 筛选状态可见化 + 真实产品绑定）。E 仅计划。

---

## 2. 功能拆分

### A. BigSeller 风格分页

#### 目标

海外库存页底部从"上一页/下一页"升级为 BigSeller 类似分页组件。

#### 范围

- 新建 `src/components/ui/pagination.tsx`（通用分页组件，可被其他页面复用）：
  - 上一页/下一页按钮（首页/末页禁用）
  - 页码按钮（当前页高亮）
  - 省略号（`...`）处理前后页码过多时的折叠
  - 每页条数选择器（20/50/100）
  - 可选：跳页输入框
- `overseas-page-content.tsx` 替换底部分页区域为 `<Pagination />` 组件
- 所有分页导航（页码切换/改 pageSize）使用 `router.push(..., { scroll: false })`
- 页面搜索参数 `page` / `pageSize` 与 URL query 同步

#### 涉及文件

| # | 文件 | 操作 |
|---|------|------|
| 1 | `src/components/ui/pagination.tsx` | **新建** |
| 2 | `src/app/dashboard/inventory/overseas/_components/overseas-page-content.tsx` | 修改：分页区域替换 |
| 3 | `src/app/dashboard/inventory/overseas/page.tsx` | 修改：解析 `pageSize` searchParam |
| 4 | 新增测试文件 | 分页组件行为 + 页面集成 |

#### 风险

- `pageSize` 变更时需重置 `page=1`，避免超出新 pageSize 对应的总页数
- Repository 分页契约（`getOverseasList` 的 `page`/`pageSize` 参数）不变，分页组件仅改变前端 URL 参数
- 不能破坏现有 `getOverseasInventory` Server Action 的 Zod 校验（当前 `pageSize` 固定 20）

#### 验收标准

| 检查项 | 期望 |
|--------|------|
| 分页组件显示页码按钮 + 省略号 | ✅ |
| 当前页高亮、不可点击 | ✅ |
| 每页条数 20/50/100 可选 | ✅ |
| 换页/改 pageSize 不跳顶 | `scroll: false` |
| URL query 保留筛选条件 | `?search=...&country=...&page=3` |
| 首页/末页时上/下一页禁用 | ✅ |
| 不破坏 Repository 分页契约 | ✅ |
| `npm run test` 通过 | ✅ |

---

### B. 统计卡片真实联动列表 ✅ DONE（2026-07-08）+ 在途卡片联动 P6-UX-V2-F（2026-07-09）

**实现状态**：已在 P6-UI-CLARITY 基础上审计强化。handleStatCardClick 行为正确（all→裸路径清空筛选，low→buildUrl({ stockStatus: 'low' })保留 pageSize/page→1）。18 项新测试覆盖卡片绑定/URL/scroll:false/架构合规。

> **更新（P6-UX-V2-F，2026-07-09 DONE）**：在途库存卡片**不再是"不可点击"**——已实现真实联动。点击后跳转 `stockStatus=in_transit`（保留 pageSize、page→1、scroll:false），列表仅显示有在途数量的行，筛选标签显示"状态：有在途"。后端通过 Migration 00037 扩展 `get_overseas_inventory` 的 `p_stock_status` 白名单（新增 `in_transit`），口径与 `get_in_transit_confirmed_aggregate` 一致（非 warehoused shipment 按 variant_id+warehouse_id 判断 `quantity - warehoused_quantity > 0`），在途筛选在 SQL 层分页前生效（不做前端当页过滤，total/page 正确）。**Migration 00037 已在 Supabase SQL Editor 手动执行并验证通过（2026-07-09），运行时验证通过**。

#### 目标

统计卡片点击后，页面列表明确反映筛选范围，并提供视觉反馈。

#### 范围

- 当前卡片行为保持不变：
  - 库存总量/SKU 数量 → `router.push('/', { scroll: false })` 清除筛选
  - 低库存 → `stockStatus=low`
- **新增**：卡片点击后页面上方显示当前筛选状态标签（见功能 C），用户立即感知"正在看低库存范围"
- **在途库存卡片**（P6-UX-V2-F 已实现，2026-07-09）：
  - 在途数据来自 `shipment` 表（通过 `getInTransitConfirmedAggregate`）
  - **已实现后端支持**：Migration 00037 在 `get_overseas_inventory` RPC 内以 `EXISTS(shipment JOIN shipment_item)` 子查询实现 `p_stock_status='in_transit'` 筛选，无需新增 RPC 参数（避免 PostgREST 函数重载歧义），在 SQL 层分页前生效
  - 卡片点击 → `stockStatus=in_transit`，筛选标签"状态：有在途"，`scroll: false`
- 所有交互保持 `scroll: false`

#### 涉及文件

| # | 文件 | 操作 |
|---|------|------|
| 1 | `overseas-page-content.tsx` | 修改：筛选状态标签显示 |
| 2 | `src/features/inventory/actions.ts` | 可能修改：新增 hasInTransit 筛选（如需） |
| 3 | `src/features/inventory/repository.ts` | 可能修改：新增 hasInTransit 过滤（如需） |

#### 风险

- 在途筛选涉及跨表查询（inventory + shipment），可能需要 RPC 或复杂 join，不可轻率新增
- 状态标签与筛选栏的视觉层级需仔细处理，避免页面头重脚轻

#### 验收标准

| 检查项 | 期望 |
|--------|------|
| 点击低库存卡片 → 列表显示 stockStatus=low | ✅ |
| 筛选生效时有可见状态标签 | ✅（见功能 C）|
| 在途卡片是否可点击 | ✅ P6-UX-V2-F 已实现真实联动（stockStatus=in_transit，Migration 00037）|
| 所有导航 `scroll: false` | ✅ |

---

### C. 筛选状态可见化

#### 目标

当前筛选栏是纯下拉框，用户无法一眼看到"当前应用了什么筛选"。需要以标签/摘要形式将筛选条件可视化。

#### 范围

- 在表格上方新增筛选标签行（`FilterTagBar` 或内联在表格区域顶部）：
  - 国家筛选 → 显示"泰国"标签 + × 清除按钮
  - 仓库筛选 → 显示仓库名标签 + × 清除按钮
  - 状态筛选 → 显示"低库存 / 缺货"标签 + × 清除按钮
  - 搜索词 → 显示"搜索：xxx"标签 + × 清除按钮（或作为搜索框内的可清除值）
- 每个标签 × 点击后：
  - 移除对应筛选参数
  - `router.push(buildUrl({ ... }), { scroll: false })`
- "清空筛选"按钮（当前已存在）— 确认在所有筛选标签旁边或筛选栏末端可见
- 下拉框内部值仍使用中文（当前已完成），不暴露 `all`
- 筛选标签样式：shadcn/ui Badge 或自定义 rounded 标签

#### 涉及文件

| # | 文件 | 操作 |
|---|------|------|
| 1 | `overseas-page-content.tsx` | 修改：新增筛选标签行 |
| 2 | 新增测试 | 标签渲染 / 单清 / 全清 / URL 同步 |

#### 风险

- 搜索词清空后 Input 组件需要通过 `key` 重置（当前已在使用 `key={`search-${filters.search}`}`，可直接复用模式）
- 标签数量多时移动端可能溢出，但当前只做桌面端（≥1024px），风险可控

#### 验收标准

| 检查项 | 期望 |
|--------|------|
| 选择泰国 → 筛选标签"泰国 ×"出现 | ✅ |
| 选择低库存 → 筛选标签"低库存 ×"出现 | ✅ |
| 点击标签 × → 该筛选清除，列表刷新，不跳顶 | ✅ |
| 点击"清空筛选" → 所有标签消失，恢复默认 | ✅ |
| 无筛选时标签行不显示或显示空状态 | ✅ |
| URL query 与筛选标签始终同步 | ✅ |
| 下拉框不显示 raw `all` | ✅ |

---

### D. 产品绑定真实功能 ✅ DONE（2026-07-08）

**实现状态**：已完成真实绑定闭环。`searchProducts` Server Action（requireActiveAuth）搜索启用产品；`bindOverseasVariant` Server Action（requireActiveAdmin + Zod variantMatchSchema → variantRepository.match → revalidatePath overseas）；`BindProductDialog` 组件（搜索→选择→确认，loading/empty/error 中文状态）；`overseas-page-content.tsx` 替换 toast 占位为真实 Dialog + router.refresh 保留筛选/分页/pageSize/滚动位置。49 项新测试。不新增 Migration/RPC/RLS。

**已知残余风险**：
- Operator 角色无法执行绑定（限制与 variantRepository.match 的 requireAdmin 一致，符合 products-variants.md 规则）。
- 绑定后需手动刷新或导航才能看到海外库存页的更新（router.refresh 保留当前 URL 含筛选/分页参数）。
- 搜索产品无防抖（每次键入触发 Server Action），产品数量较小时影响可忽略。

#### 目标

从占位按钮升级为真实可用的产品绑定流程，让运营人员直接从未匹配海外库存行绑定到 DIS 标准产品。

#### 功能流程

1. 海外库存未匹配行（`matchStatus !== 'matched'`）点击"绑定产品"
2. 打开 Dialog 或 Sheet，显示可搜索的 DIS 标准产品列表（数据来自 `/dashboard/products` 或对应 Server Action）
3. 搜索 / 选择标准产品后确认 → 创建或更新 `product_variant` 绑定关系
4. 绑定成功后刷新当前行或局部更新（优先不整页 `router.refresh()`）
5. 绑定失败显示中文错误提示并回滚

#### 需要提前确认的事项（实现前）

- [ ] 现有 `product_variant` 表结构（`product_id` / `variant_id` / `match_status` 等）是否支持本绑定流程？
- [ ] `product_variant.match_status` 的值域：当前 `'matched'` / `'unmatched'`，绑定后写入 `'matched'` 是否符合现有查询逻辑？
- [ ] 是否需要新增 Migration？如需要：只能新增，不修改已执行 migration
- [ ] 现有 variantRepository / productRepository 是否已有可复用方法？
- [ ] RLS：Operator 是否允许创建/更新 `product_variant`？还是仅 Admin？
- [ ] Server Action 权限范围

#### 权限设计（待确认）

| 角色 | 绑定产品 | 依据 |
|------|----------|------|
| Admin | 允许 | 产品管理权限 |
| Operator | 待确认 | 如果允许，需 RLS + Server Action 双认证 |

- 如果仅 Admin 允许：UI 隐藏 Operator 的绑定按钮；Server Action 包含 `requireActiveAdmin()`
- 如果 Operator 允许：Server Action 使用 `requireActiveAuth()`；RLS 策略需支持 Operator 对 `product_variant` 的 INSERT/UPDATE

#### 数据流

```text
海外库存未匹配行 "绑定产品" 按钮
  → BindProductDialog / BindProductSheet（Client Component）
    → 搜索标准产品：调用 listProducts Server Action
    → 用户选择产品后确认
      → bindProductToVariant(variantId, productId) Server Action
        → requireActiveAuth / requireActiveAdmin（按权限决策）
        → Zod 校验（variantId: UUID, productId: UUID）
        → variantRepository.upsertMatch(variantId, productId)
          → INSERT ... ON CONFLICT (variant_id) DO UPDATE SET product_id, match_status='matched'
          → 或 UPDATE + INSERT（取决于现有 schema）
        → revalidatePath('/dashboard/inventory/overseas')
        → 返回 { success: true, productName: string }
  → 成功：关闭 Dialog + 局部刷新行（或 router.refresh 备选）
  → 失败：中文 toast + Dialog 保持打开
```

#### 涉及文件（预估）

| # | 文件 | 操作 |
|---|------|------|
| 1 | `src/features/products/actions.ts` | 可能修改：确认 `listProducts` 或新增搜索接口 |
| 2 | `src/features/variants/repository.ts` | 可能修改：新增 `upsertMatch` 或 `bindProduct` |
| 3 | `src/features/variants/actions.ts` | **新建或修改**：`bindProductToVariant` Server Action |
| 4 | `src/features/inventory/components/bind-product-dialog.tsx` | **新建**：Dialog/Sheet 组件 |
| 5 | `overseas-page-content.tsx` | 修改：替换 `handleBindProduct` toast 为真实 Dialog |
| 6 | 新增 Migration（如需要） | 仅新增，不修改已执行 migration |
| 7 | 新增 RLS 策略（如需要） | 仅 Operator 绑定场景 |
| 8 | 新增测试 | Dialog 行为 / Server Action / 权限 / 失败回滚 |

#### 风险

- 当前 `product_variant` 表结构需先审查：如果 `match_status` 是生成列或依赖其他字段，绑定流程可能比预期复杂
- 如果 Operator 允许绑定，需新增 RLS 策略 + Server Action 权限校验，开发量翻倍
- `revalidatePath` 是整页标签，可能引起不必要的刷新。优先探索 `router.refresh()` 或 `startTransition` + 重新 fetch 单行（需新增轻量 Server Action 获取单个 InventoryItem）

#### 验收标准

| 检查项 | 期望 |
|--------|------|
| 未匹配行"绑定产品"按钮可点击 → 打开 Dialog/Sheet | ✅ |
| Dialog 内可搜索标准产品 | ✅ |
| 选择产品后确认 → 创建/更新 product_variant | ✅ |
| 绑定后 matchStatus 变为 'matched' | ✅ |
| 绑定后当前行局部更新（或至少当前页） | 优先局部 |
| 绑定失败 → 中文 toast + 不关闭 Dialog | ✅ |
| 权限：Admin 允许 / Operator 按决策 | ✅ |
| 不绕过 Product → ProductVariant → Inventory 模型 | ✅ |
| 不走 `service_role`；走 RLS session | ✅ |
| 如新增 Migration → 仅新增，不改已执行 | ✅ |

---

### E. 产品看板长期方向（仅规划，不实现）

#### 方向（已确认）

```text
标准产品名 → 国内库存 → 各海外市场库存 → 在途库存 → 国内生产周期 → 各市场运输周期
```

#### 本轮处理

- **不实现**任何总看板页面、国内库存、运输周期计算
- 在 `docs/current-state.md` 中记录此方向为后续独立任务（如 `P7-PRODUCT-DASHBOARD`）
- P6-UX-V2 中产品绑定（功能 D）为总看板的前置基础——绑定关系建立后，后续总看板才能按标准产品名汇总

---

### F. 明确不做项

- 不做国内库存页（用户已确认目前没有实现方式）
- 不开启自动同步（仍在 3/5 天手动验证阶段）
- 不修改真实同步写入流程
- 不绕过 Repository / Server Actions / RLS
- 不直接在页面或客户端组件调用 `supabase.from()`
- 不提交 `.claude/context-status.json`
- 不提交 `.env.local`
- 不修改 Product → ProductVariant → Inventory 核心模型（绑定在现有模型内完成）
- 不做总看板、运输周期等长期方向（仅记录）

---

## 3. 推荐实施顺序

### 第一阶段：BigSeller 分页 + 筛选状态可见化（A + C）

- **原因**：这两个功能独立于后端变更，纯前端 UI 组件，风险最低
- **依赖**：无
- **预估影响**：3~4 个文件（新建 1 个分页组件 + 修改 overseas-page-content.tsx）
- **可独立验收**：分页组件可独立测试；筛选标签可用现有筛选参数验证

### 第二阶段：统计卡片真实联动（B）

- **原因**：依赖 C 的筛选标签显示才有良好体验；在途卡片联动已由 P6-UX-V2-F 实现（Migration 00037，后端 EXISTS 子查询）
- **依赖**：C（筛选状态可见化）
- **预估影响**：1~2 个文件（overseas-page-content.tsx，可能 actions.ts）
- **可独立验收**：卡片点击 → 筛选标签出现 → 列表筛选

### 第三阶段：产品绑定真实功能（D）

- **原因**：涉及数据库写入、可能的 Migration、权限决策，开发量和风险最大
- **依赖**：无硬依赖，但建议先完成 A+C+B 让页面整体可用性提升后再做
- **预估影响**：5~7 个文件（可能含 Migration + RLS）
- **可独立验收**：绑定 Dialog → 搜索产品 → 确认绑定 → 行状态更新

---

## 4. 质量门（全阶段通用）

```bash
npm run test          # 所有测试通过（允许 1 预存 WEBSYNC_REAL_WRITE_ENABLED 失败）
npm run build         # Turbopack 构建成功
npm run lint          # 0 errors，不新增 warning
git diff --check      # 无 trailing whitespace / 冲突标记
```

---

## 5. 禁止事项（全阶段）

- 不新增 Migration / RPC / RLS（除非功能 D 确实需要，且只能新增，不修改已执行 migration）
- 不修改 BigSeller 同步真实写入流程
- 不做国内库存页面
- 不修改 Product → ProductVariant → Inventory 核心模型
- 不绕过 Repository Pattern / Server Actions / RLS
- 不提交 `.claude/context-status.json`
- 不提交 `.env.local`
- 不使用 `any`
- 不使用 `service_role` 在客户端或业务页面

---

**A+B+C+D 已实现并验收**（2026-07-08）。E 仍为计划，按用户指令激活。

---

## D 返工（2026-07-08）— 字段语义 + 搜索增强 + 写后校验

### 返工背景

初次 D 实现存在三项关键问题：

1. **字段语义错误**：`productName` 映射为 DIS 标准产品名（`product.name`），而非 BigSeller 原始品名（`product_variant.name`）。运营人员看到的是标准产品名，无法识别 BigSeller 中的实际商品。
2. **搜索要求精准全名**：`searchProducts` 使用简单 `ilike` 子串匹配，不支持分词和多 token 搜索。输入"水杯 玻璃"无法找到"玻璃水杯"。
3. **绑定后无校验**：`bindOverseasVariant` 写入后直接返回成功，未验证数据库实际落盘结果。

### D 返工修正

| 修正项 | 内容 |
|--------|------|
| 字段语义 | 新增 `variantName`(BigSeller) / `standardProductName`(DIS) / `standardProductCode`(DIS)。`productName` 语义改为 BigSeller 品名保持向后兼容。主品名列显示 BigSeller 品名。 |
| Migration 00034 | `get_overseas_inventory` / `get_low_stock` RPC 新增 `v.name AS variant_name` 字段 |
| 搜索增强 | `productRepository.search` 分词搜索：trim→分 token（空格/连字符/下划线/斜杠/括号）→去重→code+name ILIKE + product_variant.sku 反向查找 |
| 写后校验 | 绑定后 read-back 校验 product_id / match_status / product 可读，失败返回中文错误 |
| 质量门 | 3269/3270 tests、build pass、lint 0 errors / 25 warnings（all pre-existing） |

### 向后兼容

- `productName` 值等同于 `variantName`（BigSeller 品名）
- `productCode` 值等同于 `standardProductCode`（DIS 标准编码）
- 旧的 `matchStatus` 判断逻辑不变
- E 仍为 PLAN ONLY，不实现

---

## 搜索性能 + 列宽拖拽修复（2026-07-08）

### 搜索性能优化决策

- **00035** 解决搜索准确性：连续子串 + 分词 AND 语义
- **00036** 通过 pg_trgm GIN trigram index 优化 ILIKE 模糊搜索性能（product_variant.sku/name + product.name/code）
- 不修改 00034/00035，不改变 RPC 函数签名/搜索逻辑/RLS/权限模型
- **注意**：00036 的 product_variant.name 索引不用于绑定产品搜索（绑定搜索仅使用 code/name/sku）。name 索引仍服务于 RPC 00035 的库存列表 p_search
- **未来**：如果数据量继续增大，再考虑 dedicated search_vector / materialized search_text，不在本轮实现

### 绑定搜索语义收口审查（2026-07-08）

- **搜索字段**：绑定产品搜索最终确认为 product.code / product.name / product_variant.sku（三个字段）
- **移除字段**：product_variant.name 已从绑定搜索中移除（BigSeller 原始品名非标准变体名称）
- **variantName**：仅作为 query seed，打开弹窗时用当前行 BigSeller 原始品名预填搜索关键词，在 DIS 标准产品库中搜索候选
- **UI 文案**：搜索框 placeholder「搜索标准产品名称、编码或 SKU」；空结果「未找到匹配的标准产品」
- **后续**：如需 BigSeller 品名提升召回，应独立实现 alias / keyword mapping / search_document

### 列宽拖拽修复

- Table 改为 `tableLayout: 'fixed'` + `totalTableWidth`（columnWidths 累加）
- ResizeHandle 组件：可见分隔线（w-6 命中区 + w-px 竖线，默认灰 hover/drag 蓝，title/aria-label）
- activeResizeKey 追踪拖拽中列，高亮对应 divider
- 未匹配分支保持 flex w-full min-w-0 + badge/button shrink-0

### 列宽防重叠修复（2026-07-08）

- 仓库列 TableCell：`overflow-hidden truncate`（根因：shadcn TableCell 无 overflow 包容，长仓库名溢出到产品名列）
- COL_MIN.warehouse：110 → 140；COL_MIN.productName：260 → 280
- localStorage key 版本：`overseasInventoryColumnWidths:v2`（旧 key 坏列宽不污染）
- 列结构核对：colgroup/TableHead/TableRow 均为 12 列，展开行 colSpan=12
