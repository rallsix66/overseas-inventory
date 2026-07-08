# 页面规格说明书

> 文档导航：[文档树](README.md) · [当前状态](current-state.md) · [项目概览](project-overview.md) · [实施计划](implementation-plan.md) · [数据库设计](database-design.md)

> MVP 开发阶段的唯一页面设计依据。
>
> 基于 `.claude/rules`、`supabase/migrations/00001_initial_schema.sql`、`docs/mvp-roadmap.md`

---

## Phase 0：基础设施

---

### /login

| 项目 | 内容 |
|---|---|
| **页面名称** | 登录页 |
| **路由** | `/auth/login` |
| **开发阶段** | Phase 0 |
| **权限** | 未登录用户可访问；已登录用户重定向到 `/dashboard` |
| **数据来源** | Supabase Auth（`auth.users`） |
| **页面目标** | 用户通过邮箱密码登录进入系统 |

#### 页面组件

- 登录表单（邮箱 + 密码）
- 登录按钮
- 错误提示区

#### 表格字段

无表格。

#### 页面操作

| 操作 | 触发条件 | 权限 |
|---|---|---|
| 登录 | 填写邮箱 + 密码，点击登录 | 无限制 |
| 跳转 Dashboard | 登录成功 | 自动跳转 |

#### 页面状态

| 状态 | 表现 |
|---|---|
| 空输入 | 登录按钮可点击，Supabase Auth 返回验证错误 |
| 加载中 | 登录按钮显示 loading，禁止重复提交 |
| 错误 | 表单上方显示红色错误信息（邮箱不存在 / 密码错误 / 账号已禁用） |
| 已登录 | 直接重定向到 `/dashboard` |

#### 业务规则

- 新用户注册后 `handle_new_user()` 触发器自动创建 `profiles` 记录，角色默认 `operator`
- 首次管理员需手动在 Supabase Dashboard 创建用户后通过 SQL 升级 `role_id`
- 用户 `profiles.is_active = false` 时拒绝登录

---

## Phase 1：产品主数据

---

### /dashboard

| 项目 | 内容 |
|---|---|
| **页面名称** | 首页仪表盘 |
| **路由** | `/dashboard` |
| **开发阶段** | Phase 2（数据依赖 Phase 1 产品 + Phase 2 库存） |
| **权限** | admin、operator |
| **数据来源** | `product`、`product_variant`、`inventory`、`warehouse`、`shipment`、`shipment_item` |
| **页面目标** | 打开系统一眼看清当前缺货情况和在途状态，决定今天要做什么 |

#### 页面组件

- 三张统计卡片（StatCards）
- 缺货列表表格
- 在途追踪表格

#### 统计卡片

| 卡片 | 数据来源 | 计算逻辑 |
|---|---|---|
| 海外低库存 | `inventory` + `warehouse`(type=overseas) + `product_variant` + `product` | `COUNT(DISTINCT product.id) WHERE inventory.quantity <= product.safety_stock AND warehouse.type='overseas' AND product_variant.product_id IS NOT NULL` |
| 国内低库存 | `inventory` + `warehouse`(type=domestic) + `product_variant` + `product` | 同上，`warehouse.type='domestic'` |
| 在途数量 | `shipment` + `shipment_item` | `SUM(shipment_item.quantity - shipment_item.warehoused_quantity) WHERE shipment.status != 'warehoused'` |

#### 缺货列表 — 表格字段

| 字段 | 来源表 | 可编辑 | 显示规则 |
|---|---|---|---|
| 产品名称 | `product.name` | 否 | — |
| 国家 | `warehouse.country` | 否 | 标签显示（TH/ID/MY/PH/VN/CN） |
| 当前库存 | `inventory.quantity` | 否 | 红字 + 红底（低库存） |
| 安全水位 | `product.safety_stock` | 否 | — |
| 缺口 | 计算列 `safety_stock - quantity` | 否 | 正数红字，≤0 显示「正常」绿字 |

#### 在途追踪 — 表格字段

| 字段 | 来源表 | 可编辑 | 显示规则 |
|---|---|---|---|
| 产品名称 | `product.name` | 否 | — |
| 数量 | `shipment_item.quantity` | 否 | — |
| 在途剩余 | `shipment_item.quantity - shipment_item.warehoused_quantity` | 否 | — |
| 船名航次 | `shipment.vessel_name` + `shipment.voyage_number` | 否 | 无数据显示「—」 |
| 目的国 | `shipment.country` | 否 | 标签显示 |
| 状态 | `shipment.status` | 否 | 六色标签 |
| 预计到港 | `shipment.estimated_arrival` | 否 | 无数据显示「—」 |

#### 页面操作

| 操作 | 触发条件 | 权限 |
|---|---|---|
| 点击缺货行 | 任意 | 跳转 `/inventory/overseas` 对应筛选 |
| 点击在途行 | 任意 | 跳转 `/dashboard/shipments/[id]` |
| 查看全部 SKU | 点击按钮 | 展开缺货列表为全量 |

#### 页面状态

| 状态 | 表现 |
|---|---|
| 空数据 | 三卡片显示 0；缺货列表显示「暂无缺货产品」；在途列表显示「暂无在途货物」 |
| 加载中 | 三卡片 Skeleton；缺货列表骨架屏 |
| 错误 | 卡片显示「—」；列表显示「加载失败，点击重试」 |
| 有未匹配 SKU | 卡片上方显示黄色提示「有 N 个 SKU 未匹配，低库存统计可能不准确」→ 点击跳转到 `/variants/unmatched` |

#### 业务规则

- `product_variant.product_id IS NULL` 的库存不参与低库存统计
- `shipment.status = 'warehoused'` 的不出现在在途列表
- 缺货列表默认只显示低库存产品，正常产品折叠

---

### /products

| 项目 | 内容 |
|---|---|
| **页面名称** | 产品管理 |
| **路由** | `/dashboard/products` |
| **开发阶段** | Phase 1 |
| **权限** | admin 全部操作；operator 只读 |
| **数据来源** | `product`、`product_variant` |
| **页面目标** | 管理员维护标准产品主数据（编码、名称、安全库存），查看各国 SKU 关联情况 |

#### 页面组件

- 搜索筛选栏
- 产品表格
- 新增产品侧边面板（Sheet）
- 编辑产品侧边面板（Sheet）

#### 表格字段

| 字段 | 来源表 | 可编辑 | 显示规则 |
|---|---|---|---|
| 产品编码 | `product.code` | 是（编辑面板） | — |
| 产品名称 | `product.name` | 是（编辑面板） | — |
| 分类 | `product.category` | 是（编辑面板） | 无数据显示「—」 |
| 安全库存 | `product.safety_stock` | 是（编辑面板） | — |
| 关联 SKU 数 | `COUNT(product_variant.id) WHERE product_id = product.id` | 否 | 显示数字，点击跳转 `/variants?product=xxx` |
| 状态 | `product.is_active` | 是（停用/启用） | 绿色「启用」/ 灰色「停用」 |
| 操作 | — | — | 编辑、停用/启用 |

#### 页面操作

| 操作 | 触发条件 | 权限 |
|---|---|---|
| 新增产品 | 点击「新增产品」按钮 | admin |
| 编辑产品 | 点击行操作→编辑 | admin |
| 停用/启用 | 点击行操作→停用/启用 | admin |
| 搜索 | 输入框输入产品编码或名称 | admin / operator |
| 点击关联 SKU 数 | 任意 | admin / operator → 跳转 `/variants?product=xxx` |

#### 页面状态

| 状态 | 表现 |
|---|---|
| 空数据 | 「暂无产品，点击新增产品开始」+ 新增按钮 |
| 加载中 | 表格骨架屏 |
| 错误 | 「加载失败，点击重试」 |
| 新增/编辑 | 右侧滑入 Sheet 面板（`w-[480px]`） |
| 停用确认 | Dialog 弹窗「确定停用该产品？停用后不影响历史库存」 |

#### 业务规则

- `product.code` 唯一，新增时需校验
- `product.safety_stock >= 0`
- 停用产品（`is_active = false`）不影响已有 `product_variant` 关联和库存统计
- 编辑产品不改变已有数据关联

---

### /products/[id]

| 项目 | 内容 |
|---|---|
| **页面名称** | 产品详情 |
| **路由** | `/dashboard/products/[id]` |
| **开发阶段** | Phase 1 |
| **权限** | admin、operator |
| **数据来源** | `product`、`product_variant`、`inventory`、`warehouse` |
| **页面目标** | 查看单个产品的完整信息：基本信息 + 各国 SKU 映射 + 各仓库存分布 |

#### 页面组件

- 产品基本信息区
- 关联 SKU 表格
- 各仓库存表格

#### 产品基本信息区

| 字段 | 来源表 | 可编辑 | 显示规则 |
|---|---|---|---|
| 产品编码 | `product.code` | 是（admin） | — |
| 产品名称 | `product.name` | 是（admin） | — |
| 分类 | `product.category` | 是（admin） | 无数据显示「—」 |
| 安全库存 | `product.safety_stock` | 是（admin） | — |
| 单位 | `product.unit` | 是（admin） | — |
| 状态 | `product.is_active` | 是（admin） | 绿色/灰色标签 |

#### 关联 SKU 表格 — 字段

| 字段 | 来源表 | 可编辑 | 显示规则 |
|---|---|---|---|
| 国家 | `product_variant.country` | 否 | 标签 |
| 仓库 SKU | `product_variant.sku` | 否 | — |
| 仓库产品名 | `product_variant.name` | 否 | — |
| 匹配状态 | `product_variant.match_status` | 否 | 中文标签（已匹配/未匹配/待确认） |
| 最后同步 | `product_variant.last_sync_at` | 否 | 无数据显示「—」 |

#### 各仓库存表格 — 字段

| 字段 | 来源表 | 可编辑 | 显示规则 |
|---|---|---|---|
| 仓库 | `warehouse.name` | 否 | — |
| 国家 | `warehouse.country` | 否 | 标签 |
| 库存数量 | `inventory.quantity` | 否 | 低库存标红 |
| 状态 | 计算 | 否 | `quantity <= safety_stock` → 红「低库存」，否则绿「正常」 |
| 最后同步 | `inventory.last_sync_at` | 否 | 无数据显示「—」 |

#### 页面操作

| 操作 | 触发条件 | 权限 |
|---|---|---|
| 编辑基本信息 | 点击编辑按钮 | admin |
| 返回列表 | 点击返回按钮 | 任意 |

#### 页面状态

| 状态 | 表现 |
|---|---|
| 产品不存在 | 404 页面「产品不存在，返回列表」 |
| 加载中 | 骨架屏 |
| 无关联 SKU | 关联 SKU 区显示「暂无关联 SKU」 |
| 无库存数据 | 库存区显示「暂无库存数据」 |

---

### /variants

| 项目 | 内容 |
|---|---|
| **页面名称** | SKU 管理 |
| **路由** | `/dashboard/variants` |
| **开发阶段** | Phase 1 |
| **权限** | admin 全部操作；operator 只读 |
| **数据来源** | `product_variant`、`product`、`user_variant_preference` |
| **页面目标** | 管理各国家 ProductVariant，负责绑定/解除绑定内部 Product、SKU 归档与恢复 |

#### 业务定位

- 管理各国家 ProductVariant。
- 展示国家 SKU、来源品名、所属国家和匹配状态。
- 负责绑定/解除绑定内部 Product。
- 负责 SKU 归档与恢复。
- **归档语义**：归档基于 `user_variant_preference` 表，为当前用户个人偏好。归档操作不影响其他用户、不影响库存同步、不修改底层 SKU 数据。同一 SKU 可被用户 A 归档而用户 B 正常查看。

#### 页面组件

- 筛选栏（按国家、匹配状态）
- SKU 表格

#### 表格字段

| 字段 | 来源表 | 可编辑 | 显示规则 |
|---|---|---|---|
| 仓库 SKU | `product_variant.sku` | 否 | — |
| 仓库产品名 | `product_variant.name` | 否 | — |
| 国家 | `product_variant.country` | 否 | 标签 |
| 匹配状态 | `product_variant.match_status` | 否 | 中文标签（绿=已匹配 / 红=未匹配 / 黄=待确认） |
| 标准产品 | `product.name`（通过 `product_variant.product_id`） | 否 | 未匹配显示「—」 |
| 最后同步 | `product_variant.last_sync_at` | 否 | 无数据显示「—」 |
| 操作 | — | — | 匹配/重新匹配（仅 admin） |

#### 页面操作

| 操作 | 触发条件 | 权限 |
|---|---|---|
| 筛选 | 选择国家/状态 | admin / operator |
| 匹配产品 | 点击未匹配行→选择 Product | admin |
| 重新匹配 | 点击已匹配行→更换 Product | admin |

#### 页面状态

| 状态 | 表现 |
|---|---|
| 空数据 | 「暂无 SKU 数据」 |
| 加载中 | 表格骨架屏 |
| 筛选无结果 | 「无匹配结果的 SKU」 |
| 匹配操作 | 弹出下拉选择框列出所有 Product |

---

### /variants/unmatched

| 项目 | 内容 |
|---|---|
| **页面名称** | 待处理 SKU |
| **路由** | `/dashboard/variants/unmatched` |
| **开发阶段** | Phase 1 |
| **权限** | admin 全部操作；operator 可查看但不可操作 |
| **数据来源** | `product_variant`(match_status IN ('unmatched', 'pending'))、`product` |
| **页面目标** | 集中处理尚未匹配内部 Product 的国家 SKU |

#### 业务定位

- 集中处理尚未匹配内部 Product 的国家 SKU。
- 未来外部供应商（如百世）返回但无法自动匹配的 SKU 也进入该流程。
- 人工可以选择已有 Product/ProductVariant；确实不存在时再创建对应国家 ProductVariant。
- 外部 SKU 映射键至少区分：`provider + country + external_sku`。
- 人工匹配完成后，相同供应商、国家和外部 SKU 可以复用已确认的映射。

#### 页面组件

- 提示横幅「以下 SKU 未匹配到标准产品，其库存不参与低库存统计」
- SKU 匹配表格

#### 表格字段

| 字段 | 来源表 | 可编辑 | 显示规则 |
|---|---|---|---|
| 仓库 SKU | `product_variant.sku` | 否 | — |
| 仓库产品名 | `product_variant.name` | 否 | — |
| 国家 | `product_variant.country` | 否 | 标签 |
| 状态 | `product_variant.match_status` | 否 | 红「未匹配」/ 黄「待确认」 |
| 抓取时间 | `product_variant.last_sync_at` | 否 | — |
| 操作 | — | — | 匹配 |

#### 页面操作

| 操作 | 触发条件 | 权限 |
|---|---|---|
| 匹配 | 点击「匹配」→ 选择已有 Product 或新建 Product | admin |
| 批量匹配 | 勾选多行→批量选择 Product | admin |

#### 页面状态

| 状态 | 表现 |
|---|---|
| 空数据 | 「所有 SKU 已匹配 ✅」 |
| 加载中 | 表格骨架屏 |
| 匹配操作 | 每个 SKU 旁边的「匹配」按钮 → 下拉框选择 Product → 确认 |

#### 业务规则

- 匹配操作：设置 `product_variant.product_id` + `match_status = 'matched'`
- 不允许直接删除未匹配 SKU（同步会重新创建），只能匹配或保留
- 未匹配 SKU 对应的 `inventory` 存在但 `product_id` 为 NULL，不参与低库存统计

---

## Phase 2：库存数据

---

### /inventory

| 项目 | 内容 |
|---|---|
| **页面名称** | 库存总览 |
| **路由** | `/dashboard/inventory` |
| **开发阶段** | Phase 2 |
| **权限** | admin、operator |
| **数据来源** | `inventory`、`product_variant`、`product`、`warehouse` |
| **页面目标** | 全部仓库全部产品的库存一览表，支持筛选和排序 |

#### 页面组件

- 筛选栏（国家、库存状态、产品搜索）
- 库存表格
- 分页器

#### 表格字段

| 字段 | 来源表 | 可编辑 | 显示规则 |
|---|---|---|---|
| 产品名称 | `product.name` | 否 | 未匹配显示 `product_variant.name` + 灰色「未匹配」标签 |
| 国家 | `warehouse.country` | 否 | 标签 |
| 仓库 | `warehouse.name` | 否 | — |
| 仓库 SKU | `product_variant.sku` | 否 | — |
| 库存数量 | `inventory.quantity` | 否 | 低库存红字红底 |
| 安全水位 | `product.safety_stock` | 否 | 未匹配显示「—」 |
| 状态 | 计算 | 否 | 绿色「正常」/ 红色「低库存」 |
| 缺口 | `safety_stock - quantity` | 否 | 正数红字，≤0 绿字「正常」 |
| 最后同步 | `inventory.last_sync_at` | 否 | 无数据显示「—」 |

#### 页面操作

| 操作 | 触发条件 | 权限 |
|---|---|---|
| 筛选 | 选择国家/状态/搜索产品 | admin / operator |
| 排序 | 点击库存数量列头 | admin / operator |
| 点击产品名 | 任意 | 跳转 `/products/[id]` |
| 分页 | 底部翻页 | admin / operator |

#### 页面状态

| 状态 | 表现 |
|---|---|
| 空数据 | 「暂无库存数据」 |
| 加载中 | 表格骨架屏 |
| 筛选无结果 | 「无匹配结果的库存记录」 |
| 同步失败 | 仓库名旁黄色警告图标 + hover 显示最后成功时间 |

---

### /inventory/domestic

| 项目 | 内容 |
|---|---|
| **页面名称** | 国内库存 |
| **路由** | `/dashboard/inventory/domestic` |
| **开发阶段** | Phase 2 |
| **权限** | admin、operator |
| **数据来源** | `inventory` + `product_variant` + `product` + `warehouse`(type='domestic') |
| **页面目标** | 查看国内仓库存（第一阶段占位，后续接聚水潭） |

#### 页面组件

- 提示横幅「国内库存数据来源：手动录入。后续将对接聚水潭自动同步。」
- 筛选栏
- 库存表格
- 分页器

#### 表格字段

与 `/inventory` 相同，但数据限定 `warehouse.type = 'domestic'`。

#### 页面操作

| 操作 | 触发条件 | 权限 |
|---|---|---|
| 筛选 | 搜索产品 | admin / operator |
| 点击产品名 | 任意 | 跳转 `/products/[id]` |

#### 页面状态

| 状态 | 表现 |
|---|---|
| 空数据 | 「国内仓暂无库存数据，等待聚水潭对接」 |
| 加载中 | 表格骨架屏 |

---

### /inventory/overseas

| 项目 | 内容 |
|---|---|
| **页面名称** | 海外库存 |
| **路由** | `/dashboard/inventory/overseas` |
| **开发阶段** | Phase 2 |
| **权限** | admin、operator |
| **数据来源** | `inventory` + `product_variant` + `product` + `warehouse`(type='overseas') + `shipment_item`（在途数量汇总） |
| **页面目标** | 运营日常使用的核心工作台，查看海外仓库存与在途状态 |

#### 页面定位

- 海外库存为运营日常核心工作台。
- 保留关注星标功能。
- 归档/恢复按钮统一在 SKU 管理页处理，本页面不放。
- 默认隐藏当前用户已归档的 SKU（`user_variant_preference` 表，按用户隔离）。
- 不显示"预计库存"（当前库存和在途数量分开显示，不做合并预估）。

#### 页面组件

- 筛选栏（国家、库存状态、产品搜索）
- 按国家分组的库存表格（每个国家一个区块）
- 分页器

#### 表格字段（P6-UX-V2 已实现）

| 字段 | 来源 | 可编辑 | 显示规则 |
|---|---|---|---|
| 展开/折叠 | — | 否 | 展开显示在途明细（船名航次/在途数量/预计到仓） |
| 关注星标 | `user_variant_preference`（preference_type='favorited'） | 是（乐观更新） | 已关注填充星标，未关注空心 |
| 国家 | `warehouse.country` | 否 | 标签 |
| 仓库 | `warehouse.name` | 否 | — |
| 产品名称 | BigSeller 原始品名（`variantName`）+ DIS 标准品名（`standardProductName`）辅助行 | 否 | 未匹配显示「未匹配」黄色 Badge + 「绑定产品」按钮（Admin） |
| SKU | `product_variant.sku` | 否 | 等宽字体 |
| 当前库存 | `inventory.quantity` | 否 | 低库存红色加粗 |
| 在途 | `SUM(shipment_item.quantity - warehoused_quantity)` 按 (variantId, warehouseId) | 否 | 0 显示「—」 |
| 库存+在途 | `quantity + inTransitQuantity` | 否 | — |
| 安全库存 | `product.safety_stock` | 否 | 未匹配显示「—」 |
| 库存状态 | 计算（缺货/低库存/正常/未匹配） | 否 | 四色 Badge |
| 同步状态 | `sync_run` 最近一次状态 | 否 | 成功绿/失败红/同步中蓝/未同步灰 |

**已实现功能**：
- BigSeller 风格分页（页码按钮 + 省略号 + 每页 20/50/100）
- 筛选状态标签（国家/仓库/状态/搜索各带 × 清除 + 清空筛选）
- 统计卡片真实联动（库存总量/SKU 清除筛选；低库存 → stockStatus=low；在途不可点击）
- 列宽拖拽（可见分隔线，hover 蓝色，双击恢复默认）
- 产品绑定 Dialog（搜索 DIS 标准产品 → 确认绑定 → 写后校验）
- CSV 导出（含在途数据回填）
- 搜索：连续子串 ILIKE + 分词 AND（00035）+ pg_trgm trigram 索引（00036，未执行）

**字段命名规则**：使用供应商中立命名（`variantName` / `standardProductName`），禁止命名为 `bigSellerProductName`。

**在途数量规则**：
- 剩余在途数量 = `shipment_item.quantity - shipment_item.warehoused_quantity`，按 `warehouse_id + variant_id` 聚合。
- 没有目标 `warehouse_id` 的在途记录显示为"待分配"，不计入具体仓库的在途数量。
- 在途货物到仓前不得提前增加 `inventory.quantity`。

#### 后续规划（不在 P6 范围）

| 项目 | 说明 |
|---|---|
| 日均销量 | 计算字段，依赖 BigSeller 抓取数据中的 daily_sales |
| 可售天数 | estimated_days = quantity / daily_sales，依赖日均销量 |
| 补货周期 | `warehouse.lead_time_days`，已写入但前端未展示 |
| 产品看板 | 标准产品 → 国内外库存 → 在途 → 周期的总览方向，独立任务（P7+） |

#### 页面操作

| 操作 | 触发条件 | 权限 |
|---|---|---|
| 筛选 | 选择国家/仓库/状态/搜索产品 | admin / operator |
| 筛选标签清除 | 点击标签 × / 「清空筛选」 | admin / operator |
| 分页导航 | 点击页码 / 每页条数切换 | admin / operator |
| 导出 CSV | 点击「导出 CSV」 | admin / operator |
| 点击展开行 | 点击行 | admin / operator |
| 点击在途明细 | 展开行中点击详情链接 | admin / operator |
| 星标关注 | 点击星标图标 | admin / operator（个人偏好） |
| 绑定产品 | 未匹配行点击「绑定产品」→ Dialog 搜索确认 | **仅 Admin** |
| 列宽拖拽 | 拖拽表头分隔线 / 双击恢复默认 | 任意（本地存储） |

#### 页面状态

| 状态 | 表现 |
|---|---|
| 空数据（无筛选） | 「暂无海外库存数据，请执行数据同步以导入库存数据」 |
| 空数据（有筛选） | 「未找到匹配的库存记录，请尝试调整筛选条件」 |
| 加载中 | 骨架屏（Skeleton） |
| 查询错误 | error.tsx 边界捕获 |
| 导出失败 | Toast 错误提示 |

---

### /warehouses

| 项目 | 内容 |
|---|---|
| **页面名称** | 仓库管理 |
| **路由** | `/dashboard/warehouses` |
| **开发阶段** | Phase 2 |
| **权限** | admin 全部操作；operator 只读 |
| **数据来源** | `warehouse` |
| **页面目标** | 查看和管理 6 个仓库的基本信息和同步状态 |

#### 页面组件

- 仓库卡片列表（非表格，卡片展示）

#### 卡片字段

| 字段 | 来源表 | 可编辑 | 显示规则 |
|---|---|---|---|
| 仓库名称 | `warehouse.name` | 是（admin） | 卡片标题 |
| 国家 | `warehouse.country` | 否 | 标签 |
| 类型 | `warehouse.type` | 否 | `domestic`=蓝 / `overseas`=绿 |
| 状态 | `warehouse.is_active` | 是（admin） | 绿色「启用」/ 灰色「停用」 |
| 最后同步 | `warehouse.last_sync_at` | 否 | 超过 24h 黄字警告 |
| 抓取地址 | `warehouse.sync_url` | 是（admin） | 无数据显示「未配置」 |

#### 页面操作

| 操作 | 触发条件 | 权限 |
|---|---|---|
| 编辑仓库信息 | 点击卡片→编辑 | admin |
| 手动触发同步 | 点击「立即同步」按钮 | admin |
| 启用/停用 | 点击开关 | admin |

#### 页面状态

| 状态 | 表现 |
|---|---|
| 空数据 | 不应出现（初始化已插入 6 个仓库） |
| 同步中 | 卡片显示「同步中…」loading |
| 同步失败 | 红色警告文字 + 错误信息 |

---

## Phase 3：在途库存 + 物流节点

---

### /dashboard/shipments

| 项目 | 内容 |
|---|---|
| **页面名称** | 在途管理 |
| **路由** | `/dashboard/shipments` |
| **开发阶段** | Phase 3 |
| **权限** | admin、operator |
| **数据来源** | `shipment`、`shipment_item`、`product_variant`、`product`、`tracking_event` |
| **页面目标** | 查看内部手动在途记录（P3-S3 数据），查看详情和物流轨迹 |

#### P3-S2 范围说明

- P3-S2（DESIGN COMPLETE / AWAITING CODE）：列表与详情只读展示，数据来源为内部手动 shipment（P3-S3 已建数据）。
- 不做外部 supplier 双源展示（P3-S1C/D 暂停，外部供应商为独立扩展线）。
- 不做新建（P3-S3 已完成，来自已完成的 P3-S3）。

#### 页面组件

- 筛选栏（国家、状态）
- 在途表格
- 新增在途按钮（功能来自已完成的 P3-S3，跳转 `/dashboard/shipments/new`）

#### 表格字段（P3-S2 只读）

| 字段 | 来源表 | 可编辑 | 显示规则 |
|---|---|---|---|
| 船名航次 | `shipment.vessel_name` + `shipment.voyage_number` | 否 | 无数据显示「—」 |
| 目的国 | `shipment.country` | 否 | 标签 |
| 目标仓库 | `shipment.warehouse_id` → `warehouse.name` | 否 | null 时显示「待分配」 |
| 当前状态 | `shipment.status` | **否（只读）** | 六色标签 |
| 产品行数 | `COUNT(shipment_item)` | 否 | — |
| 发运总数量 | `SUM(shipment_item.quantity)` | 否 | — |
| 剩余在途数量 | `SUM(quantity - warehoused_quantity)` | 否 | — |
| 预计到仓 | `shipment.estimated_arrival` | 否 | 无数据显示「—」 |
| 创建人 | `profiles.display_name`（通过 `shipment.created_by`） | 否 | — |
| 创建时间 | `shipment.created_at` | 否 | — |
| 操作 | — | — | 查看详情（跳转 `/dashboard/shipments/[id]`） |

#### 页面操作（P3-S2 仅查看详情，其余为后续阶段）

| 操作 | 触发条件 | 权限 | 所属阶段 |
|---|---|---|---|
| 新增在途 | 点击「新增在途」→ 跳转 `/dashboard/shipments/new` | admin / operator | P3-S3（已完成） |
| 查看详情 | 点击行 → 跳转 `/dashboard/shipments/[id]` | admin / operator | P3-S2 |
| 筛选 | 选择国家/状态 | admin / operator | P3-S2 |
| 推进状态 | 选择下一状态 | admin / operator | **P3-S4（未来）** |

#### 页面状态

| 状态 | 表现 |
|---|---|
| 空数据 | 「暂无在途货件，点击新增在途开始」+ 新增按钮 |
| 加载中 | 表格骨架屏 |
| 筛选无结果 | 「无匹配结果的在途记录」 |

#### 业务规则

- `shipment.status = 'warehoused'` 的不出现在此列表（已入仓归档）
- 状态推进由 P3-S4 负责，P3-S2 仅只读展示
- 入仓操作由 P3-S5 独占，不在列表页提供入口

---

### /dashboard/shipments/new

| 项目 | 内容 |
|---|---|
| **页面名称** | 新增在途 |
| **路由** | `/dashboard/shipments/new` |
| **开发阶段** | Phase 3 |
| **权限** | admin、operator |
| **数据来源** | `shipment`(INSERT)、`shipment_item`(INSERT)、`product_variant`、`product`、`warehouse` |
| **页面目标** | 录入新在途记录的主单和明细 |

#### 页面组件

- 表单（船名/航次/起运港/目的港/目的国/预计到港/备注）
- 产品明细子表单（选择产品 + 数量，可添加多行）
- 提交按钮

#### 表单字段（Shipment 层）

| 字段 | 目标表 | 必填 | 输入类型 |
|---|---|---|---|
| 船名 | `shipment.vessel_name` | 否 | 文本输入 |
| 航次 | `shipment.voyage_number` | 否 | 文本输入 |
| 起运港 | `shipment.origin_port` | 否 | 文本输入 |
| 目的港 | `shipment.destination_port` | 否 | 文本输入 |
| 目的国 | `shipment.country` | 是 | 下拉选择（TH/ID/MY/PH/VN） |
| 入仓目标仓库 | `shipment.warehouse_id` | 否 | 下拉选择该国家对应的仓库 |
| 预计到港 | `shipment.estimated_arrival` | 否 | 日期选择 |
| 备注 | `shipment.note` | 否 | 文本输入 |

#### 表单字段（ShipmentItem 层，每行）

| 字段 | 目标表 | 必填 | 输入类型 |
|---|---|---|---|
| 产品 | `shipment_item.variant_id` | 是 | 搜索选择 ProductVariant（显示标准产品名 + 国家 + SKU） |
| 数量 | `shipment_item.quantity` | 是 | 数字输入，≥1 |

#### 页面操作

| 操作 | 触发条件 | 权限 |
|---|---|---|
| 添加产品行 | 点击「添加产品」 | admin / operator |
| 删除产品行 | 点击行末删除按钮 | admin / operator |
| 提交 | 填写完毕点击「提交」 | admin / operator |
| 取消 | 点击「取消」→ 返回 `/dashboard/shipments` | admin / operator |

#### 页面状态

| 状态 | 表现 |
|---|---|
| 必填字段为空 | 提交按钮禁用，标签显示红色 |
| 提交中 | 按钮 loading |
| 提交成功 | Toast「在途记录已创建」→ 跳转 `/dashboard/shipments/[new_id]` |
| 提交失败 | Toast 显示错误原因 |

#### 业务规则

- 提交后自动创建 `tracking_event`（status='booking', occurred_at=now()）
- `shipment.created_by = auth.uid()`
- `shipment.status = 'booking'`
- 产品行至少 1 行后才能提交

---

### /dashboard/shipments/[id]

| 项目 | 内容 |
|---|---|
| **页面名称** | 在途详情 |
| **路由** | `/dashboard/shipments/[id]` |
| **开发阶段** | Phase 3 |
| **权限** | admin、operator |
| **数据来源** | `shipment`、`shipment_item`、`product_variant`、`product`、`tracking_event`、`warehouse` |
| **页面目标** | 查看单个在途记录的完整信息和物流轨迹 |

#### 页面组件

- 主单基本信息区
- 产品明细表格
- 物流时间线（Timeline）
- 返回按钮

#### 主单基本信息区（P3-S2 只读）

| 字段 | 来源表 | 可编辑 | 显示规则 |
|---|---|---|---|
| 船名航次 | `shipment.vessel_name` + `shipment.voyage_number` | 否 | 无数据显示「—」 |
| 起运港 | `shipment.origin_port` | 否 | 无数据显示「—」 |
| 目的港 | `shipment.destination_port` | 否 | 无数据显示「—」 |
| 目的国 | `shipment.country` | 否 | 标签 |
| 目标仓库 | `warehouse.name` | 否 | null 时显示「待分配」 |
| 当前状态 | `shipment.status` | **否（只读）** | 六色标签 |
| 预计到仓 | `shipment.estimated_arrival` | 否 | 无数据显示「—」 |
| 备注 | `shipment.note` | 否 | 无数据显示「—」 |
| 创建人 | `profiles.display_name` | 否 | — |
| 创建时间 | `shipment.created_at` | 否 | — |

#### 产品明细表格（P3-S2 只读）

| 字段 | 来源表 | 可编辑 | 显示规则 |
|---|---|---|---|
| 来源品名 | `product_variant.name` | 否 | — |
| 内部产品 | `product.name`（通过 `product_variant.product_id`） | 否 | 未绑定显示「未匹配内部产品」提示 |
| 仓库 SKU | `product_variant.sku` | 否 | — |
| 发运数量 | `shipment_item.quantity` | 否 | — |
| 已入仓 | `shipment_item.warehoused_quantity` | 否 | `warehoused == quantity` 绿字「已入仓」 |
| 待入仓 | `quantity - warehoused_quantity` | 否 | >0 显示 |

#### 物流时间线（P3-S2 只读）

| 字段 | 来源表 | 显示规则 |
|---|---|---|
| 状态 | `tracking_event.status` | 六色标签 |
| 说明 | `tracking_event.description` | 无数据显示「—」 |
| 时间 | `tracking_event.occurred_at` | 按时间倒序 |
| 操作人 | `profiles.display_name`（通过 `created_by`） | — |

#### 页面操作

| 操作 | 触发条件 | 权限 | 所属阶段 |
|---|---|---|---|
| 返回列表 | 点击返回 | 任意 | P3-S2 |
| 推进状态 | 点击「推进到下一状态」按钮 | admin / operator | **P3-S4（未来）** |
| 确认入仓 | 点击入仓确认按钮 | admin / operator | **P3-S5（未来）** |

**注意**：「编辑基本信息」不在当前计划范围，如需新增请单独评估。

#### 页面状态

| 状态 | 表现 |
|---|---|
| 记录不存在 | 404「在途记录不存在」 |
| 加载中 | 骨架屏 |
| 已入仓 | 显示「已完成入仓」绿标签（P3-S5 负责将 shipment.status 推进到 warehoused） |

#### 业务规则

- P3-S4 手动推进仅允许：booking → loading → departed → arrived → customs（P3-S4 不得推进 warehoused）
- P3-S5 独占 warehoused：用户确认入仓后通过同一数据库事务完成库存联动、warehoused_quantity 更新、入仓 tracking_event 创建和 shipment.status 推进
- 部分入仓时 shipment 不得标记 warehoused
- 不允许回退状态

---

## Phase 4：团队账号

---

### /users

| 项目 | 内容 |
|---|---|
| **页面名称** | 用户管理 |
| **路由** | `/dashboard/users` |
| **开发阶段** | Phase 4 |
| **权限** | admin 全部操作；operator 无权限（导航项隐藏） |
| **数据来源** | `profiles`、`role` |
| **页面目标** | 管理员管理所有用户账号和角色 |

#### 页面组件

- 用户表格

#### 表格字段

| 字段 | 来源表 | 可编辑 | 显示规则 |
|---|---|---|---|
| 显示名 | `profiles.display_name` | 否 | — |
| 邮箱 | `auth.users.email`（通过 `profiles.id` 关联） | 否 | — |
| 角色 | `role.name`（通过 `profiles.role_id`） | 是（下拉切换） | 紫色「管理员」/ 蓝色「运营」 |
| 状态 | `profiles.is_active` | 是（启用/禁用） | 绿色「启用」/ 灰色「禁用」 |
| 创建时间 | `profiles.created_at` | 否 | — |

#### 页面操作

| 操作 | 触发条件 | 权限 |
|---|---|---|
| 切换角色 | 点击角色标签→选择新角色 | admin |
| 启用/禁用 | 点击开关 | admin |

#### 页面状态

| 状态 | 表现 |
|---|---|
| 空数据 | 「暂无用户」（不应出现，首次登录后至少有一个） |
| 加载中 | 表格骨架屏 |
| 切换角色确认 | Dialog「确认将 [用户名] 的角色改为 [新角色]？」 |
| 禁用确认 | Dialog「确认禁用 [用户名]？禁用后该用户将无法登录」 |
| 权限不足 | operator 访问此页面 → 重定向到 `/dashboard` + Toast「无权限」 |

#### 业务规则

- 不允许禁用最后一个管理员
- 不允许将自己的角色改为 operator
- 角色切换后，`get_user_role()` 下次调用时立即生效
- 禁用用户后，活跃 session 不会被强制踢出（Supabase Auth 限制），但新登录会拒绝

---

### /users/[id]

| 项目 | 内容 |
|---|---|
| **页面名称** | 用户详情 |
| **路由** | `/dashboard/users/[id]` |
| **开发阶段** | Phase 4 |
| **权限** | admin；用户本人可看自己的页面 |
| **数据来源** | `profiles`、`role` |
| **页面目标** | 查看单个用户详细信息 |

#### 页面组件

- 用户信息卡片

#### 信息字段

| 字段 | 来源表 | 可编辑 |
|---|---|---|
| 显示名 | `profiles.display_name` | 是（admin） |
| 邮箱 | `auth.users.email` | 否 |
| 角色 | `role.name` | 是（admin） |
| 状态 | `profiles.is_active` | 是（admin） |
| 创建时间 | `profiles.created_at` | 否 |

#### 页面操作

| 操作 | 触发条件 | 权限 |
|---|---|---|
| 编辑显示名 | 点击编辑 | admin |
| 切换角色 | 下拉选择 | admin |
| 启用/禁用 | 点击开关 | admin |

---

## Phase 5：数据同步

---

### /sync

| 项目 | 内容 |
|---|---|
| **页面名称** | 同步管理 |
| **路由** | `/dashboard/sync` |
| **开发阶段** | Phase 5 |
| **权限** | admin 全部操作；operator 只读 |
| **数据来源** | `warehouse`、`sync_log` |
| **页面目标** | 查看各仓库同步状态，手动触发同步 |

#### 页面组件

- 仓库同步状态卡片列表

#### 卡片字段

| 字段 | 来源表 | 显示规则 |
|---|---|---|
| 仓库名称 | `warehouse.name` | 卡片标题 |
| 国家 | `warehouse.country` | 标签 |
| 最后同步 | `warehouse.last_sync_at` | 超过 24h 黄字警告 |
| 最近状态 | 取最新 `sync_log.status` | 绿色「成功」/ 红色「失败」 |
| 最近同步时间 | 取最新 `sync_log.finished_at` | — |
| 新 SKU 数 | 取最新 `sync_log.new_variants_count` | >0 时黄色高亮 + 提示「N 个新 SKU 待匹配」 |

#### 页面操作

| 操作 | 触发条件 | 权限 |
|---|---|---|
| 手动同步 | 点击仓库卡片→「立即同步」 | admin |
| 查看日志 | 点击「查看日志」→ 跳转 `/sync/logs?warehouse=xxx` | admin / operator |

#### 页面状态

| 状态 | 表现 |
|---|---|
| 同步中 | 卡片显示 loading 动画 + 「同步中…」 |
| 同步失败 | 红色文字 + 错误信息 + 「重试」按钮 |
| 全部正常 | 无额外提示 |

---

### /sync/logs

| 项目 | 内容 |
|---|---|
| **页面名称** | 同步日志 |
| **路由** | `/dashboard/sync/logs` |
| **开发阶段** | Phase 5 |
| **权限** | admin、operator |
| **数据来源** | `sync_log`、`warehouse` |
| **页面目标** | 查看所有同步历史记录 |

#### 页面组件

- 筛选栏（仓库、状态）
- 日志表格
- 分页器

#### 表格字段

| 字段 | 来源表 | 可编辑 | 显示规则 |
|---|---|---|---|
| 仓库 | `warehouse.name`（通过 `sync_log.warehouse_id`） | 否 | — |
| 结果 | `sync_log.status` | 否 | 绿色「成功」/ 红色「失败」 |
| 新 SKU | `sync_log.new_variants_count` | 否 | 0 不显示，>0 显示数字 |
| 错误信息 | `sync_log.error_message` | 否 | 失败时显示，成功显示「—」 |
| 开始时间 | `sync_log.started_at` | 否 | — |
| 耗时 | `finished_at - started_at` | 否 | 显示秒数 |

#### 页面操作

| 操作 | 触发条件 | 权限 |
|---|---|---|
| 筛选 | 选择仓库/状态 | admin / operator |
| 分页 | 底部翻页 | admin / operator |

#### 页面状态

| 状态 | 表现 |
|---|---|
| 空数据 | 「暂无同步记录」 |
| 加载中 | 表格骨架屏 |
| 筛选无结果 | 「无匹配结果的同步记录」 |
