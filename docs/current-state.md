# Current Project State

> 文档导航：[文档树](README.md) · [当前任务包](tasks/current-task.md) · [项目概览](project-overview.md) · [架构](architecture.md) · [数据库设计](database-design.md)

## Current Phase

Phase 5 — 海外库存同步（首仓数据来源确认）

## Current Task

`P5-SY4B` — Migration 00006：事务型海外库存同步 RPC

P5-SY4B 返工完成。Migration 00006（673 行）已修正：`quantity` 严格校验（非 null / JSON number / 严格整数拒绝 bool+float+字符串+超大值 / >= 0）已移至步骤 5b，在所有 Variant/Inventory/Warehouse 写入前完成；SQL 注释测试场景 1 前置条件已修正（WM0074 已有 Inventory qty=21289 → UNCHANGED），可实际验算 inserted=1 / updated=1 / unchanged=1。26/26 纯函数测试通过。禁止执行 Migration、连接 Supabase 执行 SQL 或开始 P5-SY4C。

## Completed Tasks

- Task 0.1 — Next.js 项目初始化（create-next-app + TypeScript + Tailwind + shadcn/ui + 13 个 shadcn 组件）
- Task 0.2 — Supabase 项目连接 + Migration 执行 + 数据库初始化 + 类型生成
- Task 0.3 — Auth 登录 + middleware + Dashboard 布局（Sidebar + Header）
- Task 0.4 — 业务模块骨架（5 个业务模块 + dashboard 占位，共 6 个模块）
- Task 0.4 Architecture Audit — 架构审计（2026-06-10，综合评分 9/10，修复 3 个问题）
- Task 1.1 — Product 产品管理 CRUD（2026-06-11，产品列表 + 详情 + 表单 + 数据层收口 + 错误传播修复 + loading/error 状态）
- ProductVariant Mapping 数据层与安全基础（Migration 00003/00004/00005 + RPC 安全收口 + 函数内去重 + 权限收紧）
- Task 2.1 — 国外库存页面 MVP 初版（2026-06-11，统计卡片 + 筛选 + 表格 + 分页）
- `P2-I1` — 海外库存查询与分页正确性（2026-06-12，独立验收通过）
- `P2-I2` — 海外库存页面交互与响应式验收（2026-06-12，独立验收通过）
- `P2-I3` — 海外库存真实数据走查与使用验收（2026-06-12，确认当前无海外库存，数据来源为 BigSeller 页面抓取）
- `P5-SY1` — BigSeller 抓取器只读试跑与首仓字段确认（2026-06-12，独立验收通过）
- `P5-SY3B` — 菲律宾 Inventory 实际写入与新 SKU 创建（2026-06-12，第四次独立验收通过；91 Variants + 91 Inventory + Warehouse 改名，幂等与执行保护验证通过）
- `P5-SY4A` — SyncLog 与失败保留机制设计及任务拆分（2026-06-12，第七次独立设计验收通过）

## Authentication Status

已完成：

- Supabase Auth（邮箱密码登录）
- Session 管理（`@supabase/ssr`）
- `src/middleware.ts` — 路由守卫（未登录 → `/auth/login`）
- `src/lib/auth.ts` — `getCurrentUser()` / `requireAdmin()` / `requireAuth()`
- `/auth/login` — 登录页（自定义 UI，中文错误提示）
- `/auth/callback` — Auth 回调处理
- Dashboard Header — 用户信息 + 角色标签 + 退出按钮
- 角色体系：admin（管理员）/ operator（运营）
- 管理员账号已创建

## Database Status

| 项目 | 状态 |
|---|---|
| Supabase 项目 | `hzlhqyditalumhnxbaim.supabase.co`（Singapore） |
| 数据表 | 10 张（role, profiles, warehouse, product, product_variant, inventory, shipment, shipment_item, tracking_event, sync_log） |
| RLS | 42 条策略，全部启用 |
| 函数 | `get_user_role` / `handle_new_user` / `update_updated_at_column` / `create_shipment_transactional` / `batch_match_variants` |
| 触发器 | 5 个 updated_at + 1 个 on_auth_user_created |
| Seed 数据 | 2 角色（admin/operator）+ 6 仓库（CN/TH/ID/MY/PH/VN） |
| 类型文件 | `src/types/database.ts`（从 migration DDL 解析生成） |

## Environment Status

| 变量 | 位置 | 状态 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `.env.local` | ✅ 已配置 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env.local` | ✅ 已配置 |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env.local` | ✅ 已配置 |
| 模板 | `.env.example` | ✅ 已创建（仅变量名，无真实值） |

限制：

- `service_role` 禁止前端使用（`createServiceClient()` 含 throw guard）
- `.env.local` 在 `.gitignore` 中，不提交

## Pending Modules

| 模块 | 预计实现 | 当前状态 |
|---|---|---|
| Products CRUD 页面 | Phase 1 | ✅ 已完成（列表 + 详情 + Sheet 表单 + 启停确认） |
| Variants 页面 | Phase 1 | **延期** — 仅骨架，无页面 |
| Dashboard 首页 | Phase 2 | ✅ 已实现（库存概览 + 海外库存入口 + 快捷操作） |
| Overseas Inventory 页面 | Phase 2 | ✅ 查询、交互与响应式已验收；正在确认真实数据可用性 |
| Domestic Inventory 页面 | Phase 2 | 仅骨架，无页面 |
| In-Transit Inventory 页面 | Phase 2 | 仅骨架，无页面 |
| Shipments 页面 | Phase 3 | 仅骨架，无页面 |
| Users 页面 | Phase 4 | 仅骨架，无页面 |
| Sync 脚本 + 页面 | Phase 5 | ✅ P5-SY3B 完成：91 Variants + 91 Inventory + Warehouse 改名，幂等 3 次重跑验证 |

## Deferred Items

以下事项已记录但暂不处理：

- ProductVariant 页面开发（`/dashboard/variants`、`/dashboard/variants/unmatched`）— 延期，优先交付海外库存 MVP
- 8 个现有 lint warnings — 不影响功能，在最终验收时批量修复
- `middleware.ts` 迁移至 `proxy.ts` — Next.js 16 弃用警告，当前 middleware 仍正常工作
- `profiles.is_active` 接入认证链 — 当前仅校验角色未校验启用状态
- 库存历史快照（`inventory_snapshots` 表）— V1 使用覆盖更新
- 自动同步与部署 — 手动执行同步，无 CI/CD
- 当前使用 Vercel/Next.js 与 Supabase 快速开发；正式部署平台、免费方案和公司内部使用条款待上线前评估

## Current Implementation Limits

- Variants、Domestic Inventory、In-Transit Inventory、Shipments、Users 页面仍为占位实现
- Dashboard 首页数据功能尚未实现
- 侧边栏产品列表和海外库存已启用（Phase 0），SKU 管理与待处理 SKU 仍灰显（Phase 1）
- 海外库存查询为 MVP 临时实现（全量加载 → JS 筛选 → 分页），数据量增大后改为 RPC
- 库存状态规则：quantity=0→缺货，已匹配+0<qty≤safetyStock→低库存，已匹配+qty>safetyStock→正常，未匹配+qty>0→未匹配
- 海外库存查询为 MVP 临时实现：全量加载海外库存数据后在 JS 层执行搜索和 stockStatus 筛选，筛选完成后再分页。数据量增大后需改为数据库 RPC 函数。
- 海外库存搜索不再使用跨表 `.or()` 查询，改为 JS 层 case-insensitive 字符串匹配。
- 海外库存 `stockStatus` 筛选在 JS 层完成（需跨表比较 `quantity <= safety_stock`），筛选完成后 `total` 为真实数量。

## Technical Debt

### 已修复（2026-06-10 Audit）

- ~~Shipment 创建非事务性~~ → 新增 `create_shipment_transactional` PostgreSQL 函数 + migration `00002`
- ~~Inventory 分页 count 不准确~~ → country/warehouseType 过滤下推到 Supabase 查询层
- ~~Supabase join 嵌套类型转换重复 9+ 次~~ → 提取 `lib/supabase/helpers.ts` 的 `unwrapJoin()` 工具函数

### 现存技术债务

- `inventory` 无历史快照（覆盖更新），需要 `inventory_snapshots` 表做趋势
- `stockStatus` 筛选在海外库存中已改为 JS 层全量筛选后分页（MVP 临时方案，数据量大后需数据库 RPC）。其他库存页面待实现时统一处理。
- `getLowStock()` / `getUnmatched()` 无分页，数据量大时需补
- ProductVariant 匹配仍依赖人工（`product_variant.match_status = 'unmatched'`）
- `sync_log` 仅仓库级别，不记录每条 SKU 变更
- Shipment 状态为手动推进，无自动化（`advanceStatus` 中 warehoused 更新为 N+1 循环）
- `database.ts` 从 migration DDL 解析生成，非 `supabase gen types`（缺少 `SUPABASE_ACCESS_TOKEN`）
- `userRepository` email 字段硬编码为空字符串（Phase 4 解决）
- 预览/生产环境尚未建立
- 正式部署平台尚未确定；上线前需评估平台条款、免费额度、Next.js/Supabase 兼容性和迁移成本
- 云供应商轻量隔离已确认为强制架构规则：当前允许 Supabase 与 Vercel/Next.js 生态快速开发，供应商调用集中在 Repository、Service 与 `src/lib/`，不为未来迁移提前建设复杂抽象

## Recent Changes

| 日期 | 变更 |
|---|---|
| 2026-06-12 | P5-SY4B 返工完成：`quantity` 严格校验（4 层：非 null / JSON number / 严格整数 / >= 0）移至步骤 5b（所有 Variant/Inventory/Warehouse 写入前），步骤 8 复用已校验 quantity；SQL 注释测试场景 1 修正 WM0074 前置条件（已有 Inventory qty=21289 → UNCHANGED），可实际验算 inserted=1 / updated=1 / unchanged=1；新增场景 16b（5 子场景覆盖非严格整数）。673 行，26/26 测试通过。未执行 Migration，未发生数据库写入。等待独立验收。 |
| 2026-06-12 | P5-SY4B 第一次独立验收未通过：`quantity` 严格校验仍位于 Variant INSERT 之后，不符合关键输入校验先于全部业务写入的验收条件；SQL 注释测试场景 1 的前置条件实际产生 2 个 Inventory INSERT，与预期 `inserted=1 / unchanged=1` 冲突。26/26 纯函数测试通过；未执行 Migration，未发生数据库写入。 |
| 2026-06-12 | P5-SY4B Migration 00006 创建完成：`supabase/migrations/00006_sync_warehouse_inventory.sql`（642 行）— 完整 13 步事务 RPC（统一快照时间解析与全量一致性校验在所有业务写入前完成）+ SECURITY INVOKER + SET search_path = '' + 所有对象 public. 限定 + REVOKE/GRANT 权限收口 + 23 个注释形式 SQL 测试场景。26/26 纯函数测试通过。未执行 Migration，未发生数据库写入。等待独立验收。 |
| 2026-06-12 | P5-SY4A 第七次独立设计验收通过：SQL 草案执行顺序已调整为统一快照时间解析与全量一致性校验先于所有业务写入；26/26 纯函数测试通过；未创建 00006 Migration，未发生数据库写入。完整设计归档至 `docs/tasks/archive/p5-sy4a-design-review.md`，当前任务切换至 P5-SY4B。 |
| 2026-06-12 | P5-SY4A 第六次返工完成：SQL 执行顺序修正确保统一快照时间校验在所有业务写入之前。步骤 6a/6b（解析统一快照时间 + 全量一致性校验）移至步骤 7（Variant INSERT）之前；步骤 8（Inventory 写入）/ 步骤 10（写后核对）/ 步骤 11（Warehouse 改名）/ 步骤 12（Warehouse 写后核对）/ 步骤 13（返回摘要）同步重编号。流程描述、P5-SY4B 验收要求（22 项更新）、验收清单（17 项）已同步修正。未创建 00006 Migration，未发生数据库写入。 |
| 2026-06-12 | P5-SY4A 第六次独立验收未通过：CLI 空快照拒绝与 26/26 纯函数测试通过，统一 v_sync_at 已用于 Inventory 三向写入和写后核对；但 SQL 步骤 6 先执行 Variant INSERT，步骤 7a/7b 才校验统一快照时间，与”任何业务写入前完成校验”的要求不一致。未创建 00006 Migration，未发生数据库写入。 |
| 2026-06-12 | P5-SY4A 第五次返工完成：修复 2 项设计与真实实现不一致 — (1) 真实 `validate_json()` 新增 `len(rows)==0` → ValidationError，新增纯函数测试验证空 rows 被拒绝；(2) SQL 步骤 7a/7b/7c 重写：在任何业务写入前解析首条 last_sync_at 为统一 v_sync_at，遍历全部条目强制一致（任一条不同→回滚），全部 INSERT/UPDATE/UNCHANGED 和写后核对使用统一 v_sync_at。P5-SY4B 必须包含从 21 项扩展至 22 项，SQL 测试方案从 16+ 扩展至 17+ 场景，测试矩阵从 23 扩展至 24 场景。 |
| 2026-06-12 | P5-SY4A 第五次独立验收未通过：真实 `validate_json()` 仍接受空 rows，与文档描述不一致；SQL 草案逐条接受不同 `last_sync_at`，未落实同一快照统一同步时间约束。 |
| 2026-06-12 | P5-SY4A 第四次返工完成：修复 2 项可信度阻塞 — (1) RPC 步骤 3 新增 `jsonb_array_length(p_inventory) = 0` → RAISE EXCEPTION，CLI 同步拒绝空快照，防止抓取异常误记 success；(2) UNCHANGED 分支改为 metadata-only UPDATE 刷新 `inventory.last_sync_at`，新增 last_sync_at 非空/可解析校验，写后核对同时验证 quantity 与 last_sync_at。测试矩阵从 21 扩展至 23 场景，P5-SY4B 必须包含从 19 项扩展至 21 项，SQL 测试方案从 14+ 扩展至 16+ 场景。 |
| 2026-06-12 | P5-SY4A 第三次返工完成：修复 2 项正常业务缺口 + 1 项文档修正 — (1) p_inventory 为本次来源完整库存快照（合并全部四类），RPC 内三向分类写入（INSERT/UPDATE/UNCHANGED），返回摘要区分 inventory_received/inserted/updated/unchanged；(2) 新增步骤 4c：每个 p_variants 的 (sku,country) 必须存在于 p_inventory，缺失则 RAISE EXCEPTION；(3) 修正 service_role key 安全描述。测试矩阵从 19 扩展至 21 场景，P5-SY4B 必须包含从 17 项扩展至 19 项，SQL 测试方案从 12+ 扩展至 14+ 场景。 |
| 2026-06-12 | P5-SY4A 第二次返工完成：修复 4 项细节阻塞 — (1) 去重从 `jsonb_agg(DISTINCT value)` 改为 `GROUP BY (sku,country) HAVING COUNT(*)>1`；(2) 新增 Warehouse country='PH' 校验 + 名称白名单 + 逐条 Variant/Inventory country 一致性校验；(3) 新增事务内写后逐 SKU SELECT 核对 + Warehouse 写后 SELECT 核对；(4) 新增显式 `GRANT ... TO service_role`。测试矩阵从 11 扩展至 19 场景，P5-SY4B 必须包含从 12 项扩展至 17 项，SQL 测试方案从 8+ 扩展至 12+ 场景。 |
| 2026-06-12 | P5-SY4A 第二次独立验收未通过：SQL 草案使用整段 JSON 去重而非 `(sku,country)` 业务键；未限制 Inventory/Variant country 与 Warehouse country 一致；未验证允许的 Warehouse 名称及写后逐项状态；REVOKE 后缺少显式 `GRANT ... TO service_role`。 |
| 2026-06-12 | P5-SY4A 返工完成：修复 4 项阻塞 — RPC 输入改用 sku+country+quantity、事务内解析 variant_id、全部关键验证在事务内提交前、SELECT FOR UPDATE 串行化、SECURITY INVOKER + search_path='' + REVOKE 权限收口、SyncLog 规则统一（仅记录已尝试写入的运行、--no-sync-log 仅 Dry Run 可用、success 写入失败 → sys.exit(2)）、新增 network_timeout_unknown 分类与恢复策略。任务拆分 P5-SY4B/C/D/E 已更新，测试矩阵扩展至 11 场景。 |
| 2026-06-12 | P5-SY4A 设计审查完成：确认 4 处部分写入风险位置，判定当前 REST-only 架构无法满足"失败保留上次成功数据"，设计事务 RPC 方案、sync_log 写入时机与自保机制，拆分 P5-SY4B/C/D/E 四个子任务，产出 9 场景测试矩阵。未发生数据库写入。 |
| 2026-06-12 | P5-SY3B 第四次独立验收通过：确认 Phase E fail-fast、Phase I Warehouse 最终状态验证及真实模式计划漂移阻断；83 项 Python 测试、语法检查、lint 与 build 独立通过。切换至 P5-SY4。 |
| 2026-06-12 | P5-SY3B 菲律宾首次真实录入完成：91 ProductVariants 创建（product_id=null, match_status=unmatched）+ 91 Inventory UPSERT（quantity=available_quantity）+ Warehouse 改名（"菲律宾仓"→"菲律宾-新创启辰自建仓"）。幂等验证：3 次连续重跑，0 重复 Variant，91→91→91 核对一致。14 项 executor 测试通过。|
| 2026-06-12 | P5-SY3A 独立验收返工完成：新增 inventory_after_variant_create（91 条）、未知 Warehouse 必须失败、严格 int 校验（拒绝 bool/float 1.0）、product_name 非空、逐行 warehouse 校验、25 项测试、分离分类与动作计数核对 |
| 2026-06-12 | P5-SY3A 菲律宾库存写入映射 Dry Run 完成：sync/ 模块搭建（Supabase 只读网关 + 输入校验 + 计划生成 + CLI）+ 17 项测试 + Dry Run 报告（91→91 全部新 SKU + warehouse rename 计划）|
| 2026-06-12 | P5-SY2 测试与文档收尾：FakePage 测试覆盖 VXE 容器绑定失败和容器标记丢失（10/10 通过）+ README 删除旧回退/跳过/column_mismatch 描述，改为 fail-fast + data 属性绑定 |
| 2026-06-12 | P5-SY2 第二次独立验收返工完成：删除所有 table 回退 + VXE 容器 data 属性绑定 + 列数不匹配/容器绑定失败均明确失败 + 纯函数提取 + 8 项结构保护测试 + 统计公式修正 |
| 2026-06-12 | P5-SY1 独立验收通过并切换至 P5-SY2；发现抓取器会过滤 available=0 且 transit=0 的真正缺货 SKU，正式写入前必须修复 |
| 2026-06-12 | P5-SY2 菲律宾单仓抓取加固完成：91条（98原始-1组合-6无SKU-0重复），零库存13条全保留，表头适配新版13列，遮罩仅处理已知引导层 |
| 2026-06-12 | P5-SY1 BigSeller 只读试跑完成：5仓182条（PH 79/VN 62/TH 19/MY 17/ID 5），available=cur-locked，autoid 仍有效，需处理 language_switch_guide_mask 遮罩；首仓确认为菲律宾 |
| 2026-06-12 | 确认当前无海外库存数据，数据来源为 BigSeller 页面抓取；旧抓取器以只读 JSON 试跑方式归档到 `tools/bigseller-scraper/`，切换至 P5-SY1 |
| 2026-06-12 | P2-I2 独立验收通过：筛选与分页 URL 行为正确，移动端表格可横向滚动，loading 布局一致；切换至 P2-I3 |
| 2026-06-12 | P2-I2 交互与响应式验收完成：搜索输入 key 强制重新挂载、表格 overflow-x-auto、loading 骨架布局对齐 |
| 2026-06-12 | P2-I1 独立验收通过：国家/仓库/搜索/状态筛选在分页前完成，错误页不泄露数据库文本；切换至 P2-I2 |
| 2026-06-12 | P2-I1 返工完成：国家筛选从 DB 层 .eq() 移至 JS 层过滤 + 错误页改为固定中文提示 |
| 2026-06-12 | P2-I1 独立验收未通过：国家筛选关联未使用 inner，可能混入其他国家主记录；错误页直接展示数据库错误文本 |
| 2026-06-12 | P2-I1 海外库存查询与分页正确性 — lint 0 errors + build 通过，等待独立验收 |
| 2026-06-12 | 撤销正式免费部署平台指定：当前仅使用 Vercel/Next.js + Supabase 快速开发，正式部署方案待上线前评估 |
| 2026-06-12 | 明确云服务原则：当前使用 Supabase 与 Vercel/Next.js 生态快速开发，但供应商依赖必须集中封装，页面与核心业务不得深度绑定 |
| 2026-06-12 | 新增强制架构规则：数据库、认证、存储、同步与部署能力必须通过轻量封装使用，为迁移其他平台保留替换空间 |
| 2026-06-11 | 国外库存 MVP 功能修正：重构海外库存查询（全量加载 + JS 筛选分页 + 搜索去 .or() + stockStatus 筛选后分页 + 未匹配状态规则 + loading.tsx/error.tsx） + Dashboard 首页入口 |
| 2026-06-11 | 开发优先级调整：ProductVariant 页面延期，优先交付国外库存看板 MVP |
| 2026-06-11 | ProductVariant Mapping 数据层：Migration 00003/00004/00005 最终修复 + 已执行通过验收（RPC 安全收口 + 函数内去重 + p_items 校验 + public. schema） |
| 2026-06-11 | Task 1.1 — 最终验收修复：关联查询全部 throw ProductError、getByCode DB_ERROR 不静默、eslint exit 0、database.ts 生成类型忽略 |
| 2026-06-11 | Task 1.1 — Product CRUD 验收修复：Repository ProductError 精确错误传播、23505 唯一约束识别、toggleActive 行存在性检测、编辑模式 code 修复、关联 SKU 列名修正、loading.tsx + error.tsx |
| 2026-06-11 | Task 1.1 — Product CRUD 完成：产品列表页 + 详情页 + Sheet 表单 + 数据层收口（UUID 校验/错误日志/code 重复检测/库存关联） |
| 2026-06-11 | 文档与 Claude 配置治理 — 建立按路径 rules、项目文档树并清理冲突规则 |
| 2026-06-10 | Task 0.4 Architecture Audit — 综合评分 9/10，修复 3 个架构问题 |
| 2026-06-10 | Fix — Shipment 创建事务化（新增 migration 00002 + PostgreSQL 函数 + RPC 调用） |
| 2026-06-10 | Fix — Inventory country/warehouseType 过滤下推到 Supabase 查询层 |
| 2026-06-10 | Fix — 提取 `unwrapJoin()` 工具函数，消除 9 处重复类型转换 |
| 2026-06-10 | Task 0.4 完成 — 建立 6 个 feature 模块骨架（30 个文件） |
| 2026-06-10 | Zod v4 `.errors` → `.issues` 修复（3 个文件） |
| 2026-06-10 | Zod v4 `z.enum` `errorMap` → `error` 修复 |
| 2026-06-10 | `common.ts` `ReactNode` import 修复 |
| 2026-06-10 | Task 0.3 完成 — Auth + Dashboard 布局 |
| 2026-06-10 | Task 0.2 完成 — Migration 执行 + 类型生成 |
| 2026-06-10 | Task 0.1 完成 — 项目初始化 |

## Current Build Status

✅ 通过 — `npm run lint`（0 errors, 8 pre-existing warnings）+ `npm run build` 均通过；P5-SY3B 当前 25 plan + 14 executor + 44 verifier = 83 项测试通过（2026-06-12）

## Known Limitations

- `profiles.is_active` 尚未接入认证与权限校验链 — 当前仅校验角色（admin/operator），未校验账户启用状态。后续 Phase 需在 `getCurrentUser()` / `requireAuth()` 中补充。
- `middleware.ts` 尚未迁移为 Next.js 16 的 `proxy.ts`

## Current Database Migration

- `supabase/migrations/00001_initial_schema.sql` — 初始 schema（10 表 + 42 RLS）✅ 已执行
- `supabase/migrations/00002_create_shipment_transaction.sql` — Shipment 创建事务函数 ✅ 已执行
- `supabase/migrations/00003_tighten_variant_rls.sql` — 删除 operator_update_variant_match 策略，收紧 ProductVariant RLS ✅ 已执行
- `supabase/migrations/00004_batch_match_variants.sql` — SECURITY INVOKER + admin 校验 + 函数内去重 + FOR UPDATE + count 验证 + REVOKE/GRANT ✅ 已执行
- `supabase/migrations/00005_fix_shipment_rpc.sql` — DROP 旧版 10 参数函数 + SECURITY INVOKER + 角色校验 + p_items 输入校验 + auth.uid() + REVOKE/GRANT ✅ 已执行

## Current Blockers

- P5-SY4B Migration 00006 返工完成，等待独立验收。通过前禁止执行 Migration、开始 P5-SY4C 或发生真实数据库写入。

## Next Step

等待 P5-SY4B 独立验收（返工后）。通过后执行 P5-SY4C（Executor 适配 RPC 与 sync_log 写入）。禁止在验收通过前执行 Migration 或开始 P5-SY4C。

## P5-SY3A Dry Run 结果摘要（返工后）

| 指标 | 值 |
|------|-----|
| 输入行数 | 91 |
| Warehouse 改名计划 | `rename`: "菲律宾仓" → "菲律宾-新创启辰自建仓"（复用 ID adc5ec45） |
| 新 SKU (new_variants) | 91 |
| Inventory 新增 (inserts) | 0（现有 variant 无库存记录的场景，当前 DB 无 variant） |
| Inventory 更新 (updates) | 0 |
| Inventory 不变 (unchanged) | 0 |
| Inventory 后建 (after_variant_create) | **91**（P5-SY3B 创建 Variant 后必须执行的 Inventory INSERT） |
| 拒绝行 | 0 |
| **输入行分类总计** | **91 == 91** ✓ |
| **Inventory 动作总计** | **91 == 91** ✓ |
| 数据库 PH variants | 0（首次同步） |
| 数据库仓库名 | "菲律宾仓"（旧名） |

### 返工修复项

| # | 修复项 | 实现 |
|---|--------|------|
| 1 | 显式 Inventory 写入动作 | 新增 `inventory_after_variant_create`，每条含 sku/warehouse_id/new_quantity/depends_on，明确 P5-SY3B 创建 Variant 后必须 INSERT Inventory |
| 2 | 分离计数核对 | 输入行分类总计（91）与 Inventory 动作总计（91）分别核验 |
| 3 | 未知 Warehouse 必须失败 | `_plan_warehouse_rename()` 对旧名/正式名外的任何名称抛出 RuntimeError，不再自动规划改名 |
| 4 | 严格 int 校验 | `type(available) is not int` 拒绝 bool（int 子类）和 float（含 1.0） |
| 5 | product_name 非空 | 逐行校验 product_name 必须非空（product_variant.name 为 NOT NULL） |
| 6 | 逐行 warehouse 校验 | 每行 warehouse 必须精确等于 "菲律宾-新创启辰自建仓" |

### sync/ 模块结构

```text
tools/bigseller-scraper/sync/
├── __init__.py          # 模块标识
├── config.py            # 常量（仓库名、国家代码、新 SKU 默认值）
├── supabase_gateway.py  # Supabase REST API 只读网关（urllib，无额外依赖）
├── input_validator.py   # 输入校验纯函数（仓库名、计数、SKU 唯一性、数量合法性）
├── plan_generator.py    # 写入计划生成纯函数（供应商无关）
├── cli.py               # CLI 入口（argparse --json，显式路径，分离分类计数与 Inventory 动作计数）
└── test_plan.py         # 25 项不依赖 Supabase 的测试
```

### 验证状态

- P5-SY2 结构保护测试: 10/10 PASS
- P5-SY3A 计划生成测试: **25/25 PASS**（含 8 项新增：float 1.0 / bool / 空 product_name / 逐行 warehouse / 未知 warehouse 失败 / inventory_after_variant_create / 动作计数分离 / 混合场景核对）
- ESLint: 0 errors (8 pre-existing warnings)
- `npm run build`: PASS
- Dry Run 报告: `tools/bigseller-scraper/runtime/p5-sy3a-dry-run-*.json`
- 无数据库写入

## P5-SY3B 执行结果（2026-06-12）

### 写入摘要

| 指标 | 值 |
|------|-----|
| 执行批次 | 3 次（首次创建 + 2 次幂等重跑） |
| Warehouse ID | `adc5ec45-cd98-42a8-a1d1-26600e80d481` |
| Warehouse 改名 | "菲律宾仓" → "菲律宾-新创启辰自建仓" |
| 首次 Variant 创建 | 91 |
| 首次 Inventory UPSERT | 91 |
| 第 2 次: Variant 重复创建 | 0（91 跳过） |
| 第 2 次: Inventory 更新 | 91 |
| 第 3 次: Variant 重复创建 | 0（91 跳过） |
| 第 3 次: Inventory 更新 | 91 |
| 幂等验证 | ✅ 3/3 重跑一致，无重复数据 |

### 执行报告

- `tools/bigseller-scraper/runtime/p5-sy3b-execute-20260612-141445.json`（第 2 次 — 完成改名）
- `tools/bigseller-scraper/runtime/p5-sy3b-execute-20260612-143059.json`（第 3 次 — 幂等验证）

### sync/ 模块结构（更新后）

```text
tools/bigseller-scraper/sync/
├── __init__.py          # 模块标识
├── config.py            # 常量（仓库名、国家代码、新 SKU 默认值）
├── supabase_gateway.py  # Supabase REST API 只读网关（urllib，无额外依赖）
├── input_validator.py   # 输入校验纯函数
├── plan_generator.py    # 写入计划生成纯函数（供应商无关）
├── executor.py          # P5-SY3B 执行器（幂等 Variant INSERT + Inventory INSERT/UPDATE + Warehouse 改名，含重试 + Phase G 完整逐项验证）
├── verifier.py          # P5-SY3B 验证器（compare_plans 计划漂移比较 + verify_inventory_post_write 写后逐项验证）
├── cli.py               # P5-SY3A CLI（Dry Run 模式）
├── cli_execute.py       # P5-SY3B CLI（--input-json + --dry-run-report + --execute --confirm P5-SY3B-PH 安全门 + 执行前计划漂移检测）
├── test_plan.py         # 25 项计划生成/校验测试
├── test_executor.py     # 14 项执行器纯函数测试
└── test_verifier.py     # 24 项验证器纯函数测试（15 compare_plans + 9 verify_inventory_post_write）
```

### 约束遵守

- [x] 必须 --execute --confirm P5-SY3B-PH 安全门
- [x] 禁止覆盖已匹配 Variant 的 product_id / match_status
- [x] 复用原 Warehouse ID adc5ec45，不创建新 Warehouse
- [x] Inventory 核验通过后改名 Warehouse
- [x] 幂等可重跑：3 次连续执行无重复数据
- [x] 执行报告不含密钥（supabase_url/service_role_key）
- [x] 不写 sync_log
- [x] 不开始 P5-SY4

### 独立验收返工（2026-06-12）

返工修复项：

| # | 修复项 | 实现 |
|---|--------|------|
| 1 | 完整写后逐项验证 | Phase G 逐 SKU 验证 quantity、检测缺记录/计划外记录/总量不一致，任一差异 fail-fast 阻止 Warehouse 改名 |
| 2 | CLI 显式接收输入 JSON | `--input-json` 与 `--dry-run-report` 均为必需参数 |
| 3 | 执行前计划漂移检测 | 重新查询 Supabase + 从输入 JSON 重新生成计划 + `compare_plans()` 逐项比较 SKU/quantity/Warehouse ID/改名目标 |
| 4 | 漂移检测分级处理 | Dry-run 模式漂移仅警告继续；`--no-dry-run` 模式漂移立即 fail-fast |
| 5 | 补充验证测试 | `test_verifier.py`: 15 项 compare_plans + 9 项 verify_inventory_post_write = 24 项纯函数测试 |

新增/修改文件：

| 文件 | 说明 |
|------|------|
| `sync/verifier.py` | 纯函数验证器：`compare_plans()` 计划漂移比较 + `verify_inventory_post_write()` 写后逐项验证 |
| `sync/executor.py` | Phase G 替换为完整逐项验证，fail-fast 阻止 Phase H；移除弱校验 `_validate_execution()` |
| `sync/cli_execute.py` | 新增 `--input-json` 必需参数；执行前计划漂移检测（dry-run 警告，no-dry-run 阻止） |
| `sync/test_verifier.py` | 24 项纯函数测试（15 compare + 9 verify） |

测试结果：

- `test_plan.py`: 25/25 PASS
- `test_executor.py`: 14/14 PASS
- `test_verifier.py`: 24/24 PASS
- **总计: 63/63 PASS**
- Python 语法: 全部通过
- ESLint: 0 errors (8 pre-existing warnings)
- `npm run build`: PASS

只读验证 CLI 运行结果：

- 计划漂移检测: 6 项差异（预期 — DB 已写入数据，与原始 Dry Run 报告状态不同）
- Dry-run 执行: 91 variants 已存在全部跳过，91 inventory UPDATE 核对一致
- 写后核对: Inventory 计划 91 == 实际 91 [OK]
- Warehouse: 已是目标名称 "菲律宾-新创启辰自建仓"

### P5-SY3A Dry Run 结果摘要（返工后）

（见上方 P5-SY3A 相关章节）

## P5-SY2 加固成果（首次）

### 关键修复

| 修复项 | 变更 |
|--------|------|
| 仓库范围 | 5仓 → 菲律宾单仓（名称过滤 + 反选非目标仓） |
| 零库存保留 | 删除 `available=0 && transit=0` 过滤，13条零库存全部保留 |
| 表头校验 | 新增 `_validate_headers()`，全文档搜索 thead th + VXE 回退，13列按关键词校验 |
| 遮罩处理 | 仅处理 `.language_switch_guide_mask`，不通用删除 `.ant-modal-mask` |
| 统计输出 | 原始行数→非目标仓→组合SKU→无效SKU→去重→最终行数，全链可解释 |

### 表头适配

BigSeller 表头已从旧版更新，`EXPECTED_HEADERS` 同时兼容新旧两套关键词：

| 列 | 旧关键词 | 新关键词 |
|----|----------|----------|
| 3 | 当前库存 | **现有库存** |
| 4 | 锁定库存 | **订单已锁** |
| 5 | 可用库存 | **整仓可用** |
| 6 | 在途库存 | **在途中** |
| 8 | 预警库存 | **警戒库存** |
| 9 | 日均销量 | **预测日销量** |

### 数据概况

| 指标 | 值 |
|------|-----|
| 抓取时间 | 2026-06-12 10:31 CST |
| 原始行数 | 98 |
| 非目标仓库 | 0 |
| 组合SKU排除 | 1 |
| 无效SKU | 6 |
| 去重去除 | 0 |
| **最终行数** | **91** |
| 零可用库存 | 13（含12条纯零库存） |
| 页数 | 2 |

### 字段关系验证

- `cur_stock - locked == available` 91/91 ✅
- SKU 提取成功率: 85/91 (93.4%，6条无SKU码)
- 仓库唯一性: 仅菲律宾-新创启辰自建仓 ✅

## P5-SY2 独立验收返工（2026-06-12 10:46 CST）

### 验收未通过原因

1. 6 条无效 SKU 被 `invalid_sku_count += 1` 后静默丢弃，无法追溯具体内容
2. 仓库选择仍以硬编码 `warehouse_option_6` 为主要定位方式，未真正实现名称优先
3. 表头与表体从分离的 `<table>` 元素独立获取，未绑定同一 VXE 容器；`tds.length < 7` 允许后半字段静默缺失

### 返工修复

| # | 修复项 | 实现 |
|---|--------|------|
| 1 | 无效 SKU 可追溯 | `invalid_sku_rows` 列表收集完整字段（sku_info/warehouse/cur_stock/locked/available/transit），保存到 `runtime/debug/invalid_sku_rows.json` 和 `runtime/output/invalid-sku-rows-*.json` |
| 2 | 仓库名称优先 | 打开下拉后枚举所有 `label.ant-checkbox-wrapper` 的 autoid + text，严格按 `TARGET_WAREHOUSE_NAME` 精确文字匹配；名称匹配失败时回退 `warehouse_option_6` 并验证其文字一致，不一致则抛出 RuntimeError |
| 3 | 表头表体绑定 | `_validate_headers()` 优先在 `.vxe-table` 容器内同时定位 `.vxe-table--header table` 和 `.vxe-table--body table`，通过 xid 返回绑定信息；行提取时 `tds.length === header_count` 严格校验（不再 `< 7`），列数不匹配行单独计数并跳过 |

### 返工后数据概况

| 指标 | 首次 (10:31) | 返工后 (10:46) |
|------|-------------|---------------|
| 原始行数 | 98 | 98 |
| 列数不匹配 | N/A（未校验） | **0** |
| 非目标仓库 | 0 | 0 |
| 组合SKU排除 | 1 | 1 |
| 无效SKU | 6 | 6（**已保存完整记录**） |
| 去重去除 | 0 | 0 |
| **最终行数** | **91** | **91** |
| 零可用库存 | 13 | 13 |
| 表头来源 | N/A | vxe-container（thead th） |

### 无效 SKU 记录（6 条）

| sku_info | 可用库存 | 在途 | 日销 | 原因 |
|----------|---------|------|------|------|
| 硅胶刷头-暗紫色 Brush-darkpurple | 0 | 0 | 0 | 无 SKU 码 |
| 硅胶按摩刷头-绿色 Brush-Green | 0 | 0 | 0 | 无 SKU 码 |
| 硅胶刷头-粉色 Brush-Pink | 0 | 0 | 0 | 无 SKU 码 |
| 硅胶刷头-紫色 Brush-Purple | 0 | 0 | 0 | 无 SKU 码 |
| 硅胶美容刷（菲律宾）--颜色随机 Brush | 0 | 0 | 0.03 | 无 SKU 码 |
| 清洁刷 clean brush | 10,531 | 0 | 17.09 | 无 SKU 码 |

## P5-SY2 第二次独立验收（2026-06-12）

数据结果核对通过：91 条正式结果、6 条无效 SKU 可追溯、13 条零可用库存保留、仓库唯一、91/91 库存关系成立、未发现 Supabase 写入。

第二次验收仍未通过：

1. `_validate_headers()` 仍可回退到任意表头，行提取最终仍可回退到任意含数据行的表格，无法保证同一 VXE 容器绑定。
2. `column_mismatch` 当前只跳过异常行并继续输出，页面结构变化时可能生成不完整 JSON。
3. `raw_row_count` 已排除异常行，但统计公式再次减去 `column_mismatch_count`，异常场景统计不可核对。

## P5-SY2 第二次独立验收返工（2026-06-12 11:07 CST）

### 返工内容

| # | 修复项 | 实现 |
|---|--------|------|
| 1 | 删除所有 table 回退 | `_validate_headers()` 仅通过 `.vxe-table` 容器 + `table.vxe-table--header` / `table.vxe-table--body` 定位，无 thead th 全文档搜索、无 `.vxe-cell--title` 回退。行提取仅通过 `data-bigseller-scraper` 标记属性定位，无任意 VXE 容器搜索、无任意 table 回退 |
| 2 | VXE 绑定失败明确失败 | 无法找到同时含 header/body table 的 VXE 容器时抛出 RuntimeError；行提取时标记属性未找到时抛出 RuntimeError。无静默降级 |
| 3 | 列数不匹配明确失败 | `_extract_page_rows()` 内任意一行 `tds.length !== header_count` 立即抛出 RuntimeError，不生成 JSON。异常详情包含行号、实际列数、期望列数和预览数据 |
| 4 | 修复统计公式 | 删除 `column_mismatch_count`（fail-fast 下始终为 0），公式简化为 `raw - other_wh - combo - invalid - dup = final` |
| 5 | 纯函数提取 | `_validate_header_keywords(headers)` 和 `_parse_cell_rows(cell_rows, header_count)` 提取为纯函数，供测试直接调用 |
| 6 | 最小结构保护测试 | `test_structural_protection.py`：8 项测试，不依赖 BigSeller 登录 — 正常表头通过/关键词失败/列数不足失败/正常数据解析/12列失败/14列失败/混合列失败/字段映射正确 |

### VXE 容器绑定机制

BigSeller 实际 VXE 结构：
```html
<div class="vxe-table">
  <div class="vxe-table--header-wrapper">
    <table class="vxe-table--header"><thead><tr><th>...</th></tr></thead></table>
  </div>
  <div class="vxe-table--body-wrapper">
    <table class="vxe-table--body"><tbody><tr><td>...</td></tr></tbody></table>
  </div>
</div>
```

绑定流程：
1. `_validate_headers()` 在 `.vxe-table` 容器内同时定位 `table.vxe-table--header` 和 `table.vxe-table--body`，在容器上设置 `data-bigseller-scraper="target"` 标记
2. `_extract_page_rows()` 仅通过 `[data-bigseller-scraper="target"]` 定位同一容器，无回退
3. 翻页时 VXE 容器 DOM 复用，标记属性保持有效

### 结构保护测试结果

```
10/10 通过 (0 失败):
  PASS: 正常 13 列表头通过校验
  PASS: 正常 13 列数据行通过解析
  PASS: 表头关键词不匹配时抛出 RuntimeError
  PASS: 表头列数不足时抛出 RuntimeError
  PASS: 任意行少于表头列数(12列)时抛出 RuntimeError
  PASS: 任意行超过表头列数(14列)时抛出 RuntimeError
  PASS: 混合行(13列+12列)中任意一行不匹配即抛出 RuntimeError
  PASS: 解析后的字段映射正确
  PASS: _validate_headers() VXE_CONTAINER_NOT_FOUND 时抛出 RuntimeError
  PASS: _extract_page_rows() CONTAINER_NOT_FOUND 时抛出 RuntimeError
```

## P5-SY2 第三次独立验收（2026-06-12）

生产实现与最新抓取结果通过：任意表格回退已删除，VXE 同容器绑定和列数异常均 fail-fast；最新输出 91 条，统计一致，未发现 Supabase 写入。

## P5-SY2 测试与文档收尾（2026-06-12）

已完成：

1. **FakePage 测试**：新增 2 项测试覆盖 VXE 容器绑定失败和容器标记丢失场景。通过 FakePage 类模拟 `page.evaluate()` 返回值，验证 `_validate_headers()` 在 VXE_CONTAINER_NOT_FOUND 时抛出 RuntimeError，`_extract_page_rows()` 在 CONTAINER_NOT_FOUND 时抛出 RuntimeError。总测试数 10/10 通过。
2. **README 修正**：删除 `column_mismatch_count` 元数据字段、`column_mismatch` 统计项、xid 回退描述、"列数不匹配跳过"描述；改为 `data-bigseller-scraper` 标记属性绑定同一 VXE 容器 + fail-fast + 不生成正式 JSON。

### 返工后数据概况（2026-06-12 11:07 CST）

| 指标 | 值 |
|------|-----|
| 原始行数（全部通过列数校验） | 98 |
| VXE 容器绑定 | ✅ `data-bigseller-scraper` 标记 |
| 表头来源 | `table.vxe-table--header` (VXE 容器内) |
| 非目标仓库 | 0 |
| 组合SKU排除 | 1 |
| 无效SKU | 6（已保存完整记录） |
| 去重去除 | 0 |
| **最终行数** | **91** |
| 零可用库存 | 13 |
| 统计公式 | `98 - 0 - 1 - 6 - 0 = 91` |

> 6 条无效 SKU 均无标准 SKU 码（非 WM/ICEWM/条码格式）。其中 `clean brush` 库存 10,531 为真实库存但无法匹配到 product_variant.sku，后续 P5-SY3 需处理。

## P5-SY1 试跑发现

### 数据概况

| 仓库 | 国家 | 行数 | 可用库存总量 |
|------|------|------|-------------|
| 菲律宾-新创启辰自建仓 | PH | 79 | 806,626 |
| 越南青林湾仓库 | VN | 62 | 348,010 |
| DEE-龙仔厝（ICE专属） | TH | 19 | 565,199 |
| 喜运达MY仓 | MY | 17 | 95,194 |
| 印尼-DEE仓库 | ID | 5 | 74,766 |

### 字段验证

- `cur_stock - locked == available` 全部 182 条成立
- `available_quantity` 已由业务确认作为 `inventory.quantity`
- SKU 提取成功率 100%，产品名称提取 0 缺失
- 182/182 条有日销字段，其中 172 条大于 0
- 现有抓取结果不能证明缺货 SKU 完整：页面读取阶段会过滤 `available=0 && transit=0` 的行

### 选择器状态

| 选择器 | 状态 |
|--------|------|
| `warehouse_option_0/3/4/6/7` (5 仓 autoid) | ✅ 全部有效 |
| `.inp_box` (仓库下拉) | ✅ 有效 |
| `.ant-pagination-next` (翻页) | ✅ 有效 |
| `[autoid="single_sku"]` (单个SKU筛选) | ✅ 有效 |
| `.language_switch_guide_mask` (新增遮罩) | ⚠️ 需在操作前移除（脚本已添加 JS 层关闭逻辑） |

### 首仓推荐

**菲律宾-新创启辰自建仓 (PH)** — 数据量最大（79 条），日销数据完整，包含零库存边界，建议作为首个单仓闭环目标。

## Current Task References

当前 P5-SY4B 按需读取：

- `docs/tasks/current-task.md`：当前唯一执行范围、验收与停止条件
- `docs/tasks/archive/p5-sy4a-design-review.md`：事务 RPC 完整设计与历次独立审查记录
- `docs/tasks/phase-5-sync.md`：海外库存同步任务顺序
- `docs/database-design.md`：数据库与 Migration 约束

## Last Updated

2026-06-12（P5-SY4B 返工完成，等待独立验收）
