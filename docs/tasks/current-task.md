# Current Task Packet

## Task ID

`P3-S6` — 在途模块权限、RLS 与端到端验收

## 状态

**DONE**（2026-06-30）

## 背景

P3-S1A ~ P3-S5A 已全部完成：内部在途数据模型（Migration 00017）、手动补录（P3-S3）、只读页面/维护收口（P3-S2A/B）、库存视图在途聚合（P3-S2C/D）、入口收口+采购单号+海外库存展开（P3-S2E）、状态流转规则收口（P3-S4A，Migration 00022）、确认入仓事务与库存联动（P3-S5A，Migration 00023）。

P3-S1B（百世 API Client）CODE COMPLETE / BLOCKED_EXTERNAL，百世路径任务（P3-S1C/D、P3-S2、P3-S4）待解除阻塞后实施。

P3-S6 对已完成链路做权限、RLS 与端到端全链路复核，确保 Admin/Operator 权限边界正确、Server Action/Repository/RLS 三层一致、边界状态覆盖完整。

## 依赖

- P3-S5A DONE（Migration 00023 已执行并验证）
- P3-S4A DONE（Migration 00022 已执行并验证）
- P3-S2E DONE（入口收口 + 采购单号 + 海外库存展开）
- P3-S3 DONE（手动补录）
- P5-SY13A DONE（仓库分配权限：user_warehouses 表 + get_assigned_warehouse_ids()）

## 范围

### 1. 权限链路矩阵复核

逐条验证以下权限边界：

| 操作 | Admin | Operator | 备注 |
|---|---|---|---|
| 查看在途列表 | ✅ 全部 | ✅ 仅已分配仓库 | `getShipments()` warehouseAccessRepository 隔离 |
| 查看在途详情 | ✅ 全部 | ✅ 仅已分配仓库 | `getShipmentDetail()` 仓库权限校验 |
| 创建在途记录 | ✅ | ❌ Action 拒绝（P3-S2E 收紧） | `createShipment()` → `roleName !== 'admin'` |
| 编辑在途基本信息 | ✅ | ❌ Action 拒绝（P3-S2E 收紧） | `updateShipment()` → `roleName !== 'admin'` |
| 手动推进状态 | ✅ | ❌ Action 拒绝 | `changeShipmentStatus()` / `advanceShipmentStatus()` |
| 确认入仓 | ✅ | ❌ Action 拒绝 | `warehouseShipment()` |
| 海外库存查看在途明细 | ✅ 全部 | ✅ 仅已分配仓库 | `getInTransitDetailsByVariantAndWarehouse()` |
| 在途统计卡片/聚合 | ✅ 全部 | ✅ 仅已分配仓库 | `getInTransitByVariant()` / `getInTransitByVariantAndWarehouse()` |

### 2. Server Action 权限复核

每个 Server Action 必须满足：
- `requireActiveAuth()` 或等价显式 session 校验
- Admin-only 操作使用 `if (user.roleName !== 'admin') return { success: false, error: '仅管理员可...' }`（当前写操作全部 Admin-only，Operator 不允许写）
- Zod schema 校验所有外部参数
- 错误返回中文可理解消息

涉及 Actions：
- `src/features/shipments/actions.ts` — getShipments / getShipmentDetail / createShipment / updateShipment / changeShipmentStatus / advanceShipmentStatus / warehouseShipment / searchVariants / getInTransitDetailsByVariantAndWarehouse

### 3. Repository 权限与错误处理复核

每个 Repository 方法必须满足：
- 查询通过 `createClient()` 使用 RLS 会话
- DB/RLS 错误抛为 `ShipmentError`（含中文消息）
- Admin/Operator 仓库隔离：Operator 通过 `warehouseAccessRepository` 限定读仓库范围；写操作在 Action 层已由 `roleName !== 'admin'` 拒绝，Repository 内 Operator 分支为防御性代码
- 不绕过 RLS（不使用 `service_role` 客户端）

涉及 Repository：
- `src/features/shipments/repository.ts` — 全部方法

### 4. RLS 策略完整性复核

检查现有 RLS 策略是否覆盖：
- `shipment` 表：authenticated SELECT/INSERT/UPDATE（Admin 全部 / Operator 已分配仓库）
- `shipment_item` 表：authenticated SELECT/INSERT/UPDATE（通过 shipment 级联权限）
- `tracking_event` 表：authenticated SELECT/INSERT（通过 shipment 级联权限）
- `inventory` 表：入仓写入权限（仅 Admin，通过 RPC 间接写）
- `profiles` 表：读取权限

### 5. 边界状态覆盖

逐页面验证以下边界：

**列表页 `/dashboard/shipments`**：
- 空数据（无在途记录）
- 加载中（loading.tsx）
- 查询错误（error.tsx）
- Operator 仅见已分配仓库
- 无分配仓库的 Operator 见空列表

**详情页 `/dashboard/shipments/[id]`**：
- 记录不存在 → notFound()
- 无权限（Operator 访问未分配仓库）→ 错误提示
- 数据库错误 → error.tsx 捕获
- 已入仓状态：操作区隐藏
- customs + 有仓库：入仓按钮可见（Admin）
- customs + 无仓库：显示"未指定仓库，无法入仓"
- 非 customs：显示"当前状态为「XX」，清关后方可确认入仓"
- Operator：写按钮全部隐藏

**创建页 `/dashboard/shipments/new`**：
- 表单验证（必填项、仓库一致性）
- Operator 无分配仓库 → 仓库下拉为空或受限
- 创建成功 → 跳转列表
- 创建失败 → 中文错误提示

**海外库存展开在途明细**：
- 该 variant+warehouse 无在途 → 空提示
- 加载失败 → 错误提示
- Operator 仅见已分配仓库的在途

### 6. 页面与组件直接数据库访问检查

确认所有页面和客户端组件不直接调用 `supabase.from()` 或 `createClient()`，全部通过 Server Action → Repository 链路。

### 7. 测试

新增以下测试类别：
- **权限链路测试**：Admin vs Operator 各操作的权限边界
- **RLS 策略存在性测试**：关键表策略覆盖检查（源码级别，不连接 Supabase）
- **边界状态测试**：空数据/not-found/无权限/错误状态的组件行为
- **仓库隔离测试**：Operator 跨仓访问拒绝验证
- **Arch 合规测试**：页面/组件不直接访问 supabase

质量门：
- `npm run test` 全部通过
- `npm run lint` 0 errors
- `npm run build` 通过
- `git diff --check` 通过

## 禁止

- 不新增业务功能（不新增状态/入仓/批量操作/百世集成）
- 不新增 Migration
- 不修改数据库模型或 RLS 策略（仅复核）
- 不重构已有功能
- 不在页面或客户端组件直接访问 Supabase
- 不修改已执行的 Migration（00001~00023）

## 停止条件（全部满足）

1. 权限链路矩阵逐条验证通过（Admin/Operator 边界正确）
2. 所有 Server Action 有显式角色校验 + Zod + 中文错误
3. 所有 Repository 方法通过 RLS 会话 + ShipmentError 错误传播
4. RLS 策略覆盖率确认
5. 边界状态：空数据/not-found/无权限/DB error/loading/error 全覆盖
6. 页面和客户端组件无直接 supabase.from() 调用
7. `npm run test` 全部通过
8. `npm run lint` 0 errors
9. `npm run build` 通过
10. `git diff --check` 通过

## 输出

- 权限链路矩阵（表格）
- 新增/修改测试清单
- 发现并修复的问题列表
- 剩余风险与建议

## 执行结果（2026-06-30）

### 权限链路矩阵

| 操作 | Admin | Operator | 验证方式 |
|---|---|---|---|
| 查看在途列表 | ✅ 全部 | ✅ 仅已分配仓库 | Action: requireActiveAuth → Repository: warehouseAccessRepository.getAccessibleWarehouseIds() → `.in('warehouse_id', ...)` → RLS: operator_select_shipment |
| 查看在途详情 | ✅ 全部 | ✅ 仅已分配仓库 | Action: requireActiveAuth → Repository: RLS PGRST116 → app-level canAccessWarehouse() → RLS 兜底 |
| 创建在途记录 | ✅ | ❌ Action 拒绝（P3-S2E 收紧） | Action: `roleName !== 'admin'` → "仅管理员可创建在途记录" → Repository: create_shipment_transactional RPC |
| 编辑在途基本信息 | ✅ | ❌ Action 拒绝（P3-S2E 收紧） | Action: `roleName !== 'admin'` → "仅管理员可编辑在途记录" → Repository: RLS 兜底 |
| 手动推进状态 | ✅ | ❌ Action 拒绝 | Action: `roleName !== 'admin'` → "仅管理员可变更物流状态" → Repository: change_shipment_status_transactional RPC |
| 确认入仓 | ✅ | ❌ Action 拒绝 | Action: `roleName !== 'admin'` → "仅管理员可确认入仓" → RPC: get_user_role() = admin |
| 海外库存查看在途明细 | ✅ 全部 | ✅ 仅已分配仓库 | Action: requireActiveAuth → Repository: `!ids.has(warehouseId) → return []` → RLS 兜底 |
| 在途统计卡片/聚合 | ✅ 全部 | ✅ 仅已分配仓库 | Repository: getAccessibleWarehouseIds → `.in('warehouse_id', ...)` / 空分配 → 空 Map |
| 搜索 Variant | ✅ 全部 | ✅ 全部（operator_select_variant RLS） | Action: requireActiveAuth → Repository: country filter + user archived filter |

### 三层防御验证

| 层 | 机制 | 覆盖 |
|---|---|---|
| 1. Server Action | requireActiveAuth + `roleName !== 'admin'` + Zod safeParse | 9/9 Actions |
| 2. Repository | createClient() RLS session + warehouseAccessRepository 仓库隔离 + ShipmentError 错误码 | 13/13 方法 |
| 3. PostgreSQL | RLS policies (46 条) + RPC SECURITY INVOKER + get_user_role() | shipment / shipment_item / tracking_event / inventory |

### 新增测试

`src/features/shipments/p3-s6-permission-audit.test.ts` — 161 项测试，9 个 describe 块：
1. Actions 权限链路（58 tests）：requireActiveAuth / Admin-only / 读操作 / Zod / 中文错误 / ShipmentError 传播
2. Repository 仓库隔离（27 tests）：warehouseAccessRepository import / list 过滤 / getById 隔离 / update 拒绝 / getInTransit* 过滤 / ShipmentError 错误码 / error 检查覆盖率
3. RLS 策略存在性（27 tests）：shipment/shipment_item/tracking_event/inventory 四表 policy 关键词 + 收紧版 EXIST/IN 断言 + 策略总数
4. Arch 合规（30 tests）：3 页面 + 5 组件 无 supabase import/.from()/.rpc() + 5 组件 import actions
5. 边界状态（14 tests）：error.tsx/loading.tsx/Skeleton 存在 + notFound + 已入仓隐藏 + canWarehouseShipment/warehouseBlockReason + 未登录/非 Admin 拒绝 + 空分配空结果
6. 权限链路矩阵完整性（8 tests）：9 export async function 全 requireActiveAuth / 5 admin-only / RPC 参数化 / 三层防御
7. 入仓权限三层一致（3 tests）：Action/RPC/Inventory RLS
8. 创建页 Server Component 权限（4 tests）：getCurrentActiveUser / 未登录文案 / 非 Admin 拒绝 / 无 supabase
9. 详情页入仓条件收口（8 tests）：canWarehouseShipment 条件 / warehouseBlockReason 判断

### 质量门

- `npm run test` — **1955/1955**（52 文件，concurrency/best live 排除）
- `npm run lint` — **0 errors / 25 warnings**（all pre-existing）
- `npm run build` — **PASS**
- `git diff --check` — **pass**（仅 LF 换行符预存差异）

### 发现与修复

无阻塞问题。本次审计为**源码级权限/RLS/架构审计 + mock 行为测试**，未连接生产 Supabase 执行真实 RLS 行为测试。P3-S2A~S5A 实现的权限链已经三层一致，本次复核确认无缺口。

### 剩余风险

1. Operator RLS 对 `shipment.warehouse_id IS NULL` 的行不可见（Migration 00015），但 `getById` 也有应用层 `return null` 守卫 — 安全。
2. `createShipment` 现在是 Admin-only（P3-S2E 限制），Repository 的 `update()` 仍保留了 Operator 仓库校验分支 — 这是防御性代码，因为 Action 层已拦截 Operator。
3. `inventory` 没有独立的 INSERT policy — admin_all_inventory FOR ALL 覆盖 INSERT（入仓 RPC 仅 Admin 调用），operator 不可 INSERT。
4. **未执行生产库真实 RLS 行为测试**（仅源码级策略关键词检查）。生产 RLS 策略实际行为依赖 Supabase Dashboard 已验证的 46 条策略。如需，可在用户授权后以只读方式在生产库逐条验证关键 RLS 策略。

## 下一步

- P3-S5B（部分入仓/批量入仓/Operator 确认入仓）或 P3-S1B 恢复（百世 API 授权后）
- Phase 4（用户管理）或 Phase 6（国内库存）
