# 顺序路线实施、Staging 验证与上线收尾记录

## 记录信息

| 项目 | 内容 |
|---|---|
| 实施日期 | 2026-07-15 至 2026-07-17 |
| 实施分支 | `codex/sequential-roadmap` |
| 路线交付基线 | `194324ce01d0f84ae8eb95f8c9e5a8987f5526b8` |
| 最终主线提交 | `b0d8f152cd3df9b481ae251a495db281afe1a75c` |
| Production 状态 | `READY` |
| Production 地址 | `https://overseas-inventory.vercel.app` |
| Staging 项目 | `DIS Staging`（project ref `hyarhvsjhkjpallbyifn`） |
| 实施顺序 | P0 喜运达绑定闭环 → P1 预测式补货 → P7 全球库存作战室 → 首页决策看板 |

本文是本轮顺序路线开发、数据库部署、Preview 验收、合并和正式上线的历史记录，不作为当前任务状态来源。当前状态仍以 `docs/current-state.md` 和 `docs/tasks/current-task.md` 为准。

## 1. 最终结论

- P0、P1、P7 和首页决策看板已按既定顺序完成。
- Migration `00041` 至 `00047` 已严格按序应用到 Production 数据库。
- `DIS Staging` 已从空数据库连续重放 `00001` 至 `00047`，用于验证完整 migration 链、RLS 和 RPC 权限。
- Vercel Preview 三项 Supabase 变量仅指向 `DIS Staging`；Preview 阶段未修改 Production 环境变量或业务数据。
- Staging 已使用 Production 只读脱敏快照完成 Admin、Operator、页面、RLS 和写入链路验证。
- 路线交付基线 `194324c` 已进入 `master`；后续 BigSeller 会话启动热修复通过 PR #2 合并，最终主线提交为 `b0d8f15`。
- Vercel Production 部署 `dpl_GJicGSq6kduwKzLm57UU3dVw8XeL` 已达到 `READY`。

## 2. 实施内容

### 2.1 P0：喜运达未绑定记录闭环

- 在 `/dashboard/shipments/import/golucky` 展示尚未绑定内部 Shipment 的外部物流记录。
- 根据外部记录的国家和仓库查询同仓同国 Shipment 候选。
- 通过 Server Action 调用既有绑定 RPC，由数据库继续校验登录状态、账号状态、仓库权限、国家/仓库一致性及并发重复绑定。
- UI 明确提示绑定不可逆；绑定完成后刷新并从未绑定列表移除。
- 保留既有换仓保护：已绑定 Shipment 不允许更换仓库。

主要文件：

- `src/features/in-transit/components/golucky-unbound-records.tsx`
- `src/features/in-transit/actions.ts`
- `src/features/in-transit/repository.ts`
- `src/app/dashboard/shipments/import/golucky/page.tsx`

### 2.2 P1：预测式补货引擎

- 为仓库增加 `buffer_ratio`、`target_cover_multiplier` 和 `updated_at` 参数。
- 为计划发货增加 `shipment.cancelled_at` 软取消字段，不扩展原有状态枚举。
- 新增共享数据库函数 `forecast_stockout(...)`，统一处理 ETA 事件、同日到货聚合、晚到不抵扣、无日销、无 lead time 和有效在途数量。
- 新增 `get_in_transit_detail` 与 `get_replenishment_suggestions` 读取 RPC。
- 新增 `/dashboard/replenishment`，包含筛选、分页、紧急度、建议补货量、预计断货日、最晚下单日和 ETA 明细。
- Admin 可维护仓库补货参数、创建 booking 计划发货并软取消；Operator 只读已授权仓库。
- 内部计划单号由服务端生成，唯一约束冲突仅针对 `shipment_no_unique` 最多重试三次。

Migration：

- `00041_replenishment_warehouse_params.sql`
- `00042_replenishment_cancellation.sql`
- `00043_forecast_stockout.sql`
- `00044_replenishment_rpcs.sql`

### 2.3 P7：全球库存作战室

- 新增唯一路由 `/dashboard/products/overview`。
- 新增唯一列表 RPC `get_product_overview`，以 Inventory 为驱动表，在数据库内完成仓库权限、聚合、搜索、国家筛选、断货风险、稳定排序、分页和总数统计。
- 新增唯一详情 RPC `get_war_room_variant_detail`，只返回当前用户可见仓库。
- 逐仓补货建议复用 P1 的 `get_replenishment_suggestions`，没有复制补货公式。
- 页面包含决策队列、库存表、国内库存待接入占位、KPI、分国 burn-down、详情弹窗和仓库级补货行动。
- `stockout_urgency` 与 P1 的 `replenishment_urgency` 保持独立，`partial_data` 保持独立布尔值。

Migration：

- `00045_product_overview_rpc.sql`
- `00046_war_room_variant_detail_rpc.sql`

### 2.4 首页决策看板

- 新增 `get_warehouse_health_overview` RPC，以 Warehouse 与 Variant 库存位置为统计粒度。
- 归档 SKU 在分类和汇总前排除；Operator 仅统计已授权仓库。
- 首页使用六路独立加载：库存健康、ETA 已知计划及在途、低库存、关注产品、未来七日到港和同步状态。
- KPI 统一使用 P1 有效在途口径，不再使用旧的全量在途聚合。
- 未来七日到港展示 Top 4，但总数来自完整在途明细去重。
- 增加仓库健康详情、低库存 Top 5、关注 Top 4，以及同步、补货和全球库存快捷入口。

Migration：

- `00047_dashboard_warehouse_health_overview.sql`

## 3. 架构与安全检查

- 读取链保持 `Server Component → Repository → Supabase → PostgreSQL RLS`。
- 客户端懒加载保持 `Client → Server Action → Repository → RPC/RLS`。
- 新增 UI 中没有直接使用 `createClient`、`supabase.from()`、`.rpc()` 或 `service_role`。
- 未使用 `any`，未改变 Product → ProductVariant → Inventory 核心模型。
- P1、P7 和首页 RPC 均绑定 `auth.uid()` 与服务端传入的 `p_user_id`，并校验活动账号和角色。
- 新 RPC 均使用 `SECURITY INVOKER`、空 `search_path`，撤销 PUBLIC/anon 执行权限，仅授权 authenticated。
- 未修改已经执行的 Migration；数据库结构变化全部通过 `00041` 至 `00047` 新 Migration 完成。
- Staging 的 18 个 public 基础表均启用 RLS；安全与性能顾问未发现本批新增对象相关 error。

## 4. 验证记录

### 4.1 顺序路线本地质量门

- 目标功能测试：P0、P1、P7 和首页共 `200/200` 通过。
- 受影响旧契约回归：`235/235` 通过。
- 两轮全量测试均为 `3879/3879`，87 个测试文件，0 失败。
- ESLint：0 errors / 31 warnings；本批次没有新增 error。
- `next build`、TypeScript 和静态页面生成通过，新路由进入构建产物。
- `git diff --check` 通过，无尾随空格或冲突标记。
- 未登录浏览器冒烟通过：受保护路由正确返回登录页，最终控制台 0 error/warn。

### 4.2 Supabase Production 与 Staging

- Production 已按 `00041 → 00042 → 00043 → 00044 → 00045 → 00046 → 00047` 执行并登记七条 migration。
- `DIS Staging` 从空库连续重放 `00001 → 00047`，47 条 migration 历史完整。
- 新增 4 个列、2 个约束、2 个索引、1 个触发器和 6 个 RPC 均已核对存在。
- 六个 P1、P7、首页 RPC 均为 `SECURITY INVOKER`、空 `search_path`、anon 无执行权、authenticated 有执行权。
- Admin/Operator 的补货、在途、P7 列表/详情和首页健康度 RPC 均返回正确契约。
- Operator 只看到一个已分配仓库；补货、P7、首页和详情的跨仓库泄露断言均通过。

### 4.3 Preview 真实数据验证

Staging 使用 Production 只读脱敏业务快照替换早期 `CODEX-SMOKE` 数据：

| 数据对象 | 数量 |
|---|---:|
| Product | 1 |
| ProductVariant | 341 |
| Inventory | 341 |
| Warehouse | 6 |
| Shipment | 2 |
| 手工物流事件 | 5 |
| 外部物流事件 | 11 |

- 跨库业务内容哈希逐表一致。
- 未复制 Production Auth、用户偏好、同步历史、Token Cache、Warehouse `sync_url` 或 Provider `raw_payload`。
- Staging Admin 可见 341 个 SKU、5 个海外仓和 34 条有效补货建议。
- Staging Operator 仅分配 ID 仓，通过 RLS 只可见 40 个 SKU。
- Preview 首页、全球库存作战室和补货建议页均完成真实快照复验。
- Admin/Operator 页面权限、仓库隔离和既有写入链路完成验证。

### 4.4 Vercel 上线状态

- 分支提交通过 Git Integration 生成 Preview 部署。
- Preview 三项 Supabase 环境变量仅指向 `DIS Staging`，Production 同名变量未在 Preview 接线过程中修改。
- 路线交付基线 `194324c` 已进入 `master` 并完成 Production 部署。
- PR #2 将会话启动热修复合并为主线提交 `b0d8f15`。
- 正式域名 `https://overseas-inventory.vercel.app` 当前指向 Production 部署 `dpl_GJicGSq6kduwKzLm57UU3dVw8XeL`，状态为 `READY`。

## 5. 合并后的 BigSeller 会话启动热修复

- 修复 `/dashboard/sync` 点击“重新建立登录会话”后，`spawn python ENOENT` 冒泡为 Server Components 生产错误的问题。
- Vercel 环境在文件系统和子进程操作前返回明确不可用提示，不再尝试启动 Python 或创建锁文件。
- 桌面同步主机改为等待 child process 的 `spawn` 事件后才返回启动成功。
- 支持通过 `PYTHON_EXECUTABLE` 指定 Python 路径；启动失败时清理锁文件和日志句柄。
- 新增 Admin 权限、Vercel 环境、Python ENOENT 和成功启动四项回归测试。
- 热修复质量门：`3883/3883`（88 files，0 failures），lint 0 errors / 31 warnings，build 与 TypeScript 通过。
- 分支提交 `71d3b89` 已通过 PR #2 合并到 `master`，对应合并提交 `b0d8f15` 已正式部署。

## 6. 已知限制与后续风险

- Production 的早期 Migration `00001` 至 `00040` 曾通过 SQL Editor 执行但未完整登记；当前远端 migration 历史只登记 `00041` 至 `00047`。
- Staging 按仓库 migration 链生成后，比 Production 多出 `product_variant.is_archived/archived_at/archived_by`、对应索引和外键，以及 `claim_sync_run_system(...)`。这些对象来自 `00010/00011`，说明 Production 存在历史漂移。
- 在启用 Supabase CLI `db push` 或补齐 Production 对象前，必须先完成 migration history baseline/repair 和对象级影响评审；禁止直接重跑旧 Migration。
- Vercel 无法提供交互式桌面 Chrome；BigSeller 交互登录会话仍需在安装 Python、Playwright 和 Chrome 的桌面同步主机建立。
- P8 国内库存接入及其国内补给判断仍待独立立项。
- 百世 API 的 partnerId 权限仍是外部阻塞，不影响本轮路线交付。
- 构建仍有两个既有非阻塞 warning：多 lockfile 根目录推断，以及同步 Cron 链的 NFT 动态文件追踪提示。

## 7. Git 记录

| 提交 | 内容 |
|---|---|
| `7bca325` | 顺序路线功能实现 |
| `db847f8` | Supabase Migration 部署记录 |
| `ce924fa` | Staging 环境验证记录 |
| `4ca4d18` | Preview 指向 Staging |
| `a4c5648` | Preview 冒烟结果 |
| `9efeb4a` | Preview Service Role 接线状态 |
| `194324c` | Production 脱敏快照 Preview 验证与路线交付基线 |
| `71d3b89` | BigSeller 会话启动错误热修复 |
| `b0d8f15` | PR #2 合并提交及最终 Production 基线 |

## 8. 报告边界

本报告截至主线提交 `b0d8f15` 和对应 Production 部署 `dpl_GJicGSq6kduwKzLm57UU3dVw8XeL`。后续任务、未合并改动或环境变更不计入本报告结论，应在新的实施记录中单独维护。
