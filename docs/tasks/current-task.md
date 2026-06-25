# Current Task Packet

## Task ID

`P5-SY12` — 特别关注阶段 B 最小闭环

## 状态

DONE（2026-06-25 完成）

## 背景

P5-SY11G 已创建 `user_variant_preference` 表（`preference_type IN ('archived')`），个人归档偏好工作正常。用户需要"特别关注"功能：运营在库存列表点星标关注 SKU，Dashboard 首页显示关注列表。

阶段 B 是第一版最小闭环 — 只做关注/取消关注 + Dashboard 基础展示，不引入动态告警字段，不改同步链路。

## 任务目标

1. **Migration 00013**：扩展 `user_variant_preference.preference_type` CHECK 约束，支持 `'favorited'`
2. **类型同步**：`database.ts` `preference_type` 更新为 `'archived' | 'favorited'`
3. **`src/features/preferences/` 模块**：types + schema + repository + actions（Repository Pattern）
4. **库存列表星标按钮**：每行显示星标（⭐），点击切换关注/取消关注
5. **Dashboard 关注区**：首页新增「关注产品动态」区，低库存置顶，告警临时用 `safety_stock`
6. **归档与关注共存**：同一 variant 可同时归档+关注（`preference_type` 不同）
7. **测试**：Migration 静态测试 + Repository 测试 + Actions 测试 + Dashboard 测试 + 非回归
8. **质量门**：`npm run test` / `npm run lint` / `npm run build` 通过

## 强制架构边界

- **不新建 `variant_follows` 表**。关注功能复用 `user_variant_preference`，通过 `preference_type='favorited'` 区分。
- **不修改已执行 Migration 00001~00012**。新建 Migration 00013 仅 ALTER TABLE DROP/ADD CONSTRAINT。
- **不新增 `inventory.daily_sales` / `inventory.est_days` / `warehouse.lead_time_days`**。
- **不改 `sync_warehouse_inventory` RPC、不改 Python 同步透传**。
- **不启动 P5-SY10 Phase B 自动 Real Write**。`WEBSYNC_REAL_WRITE_ENABLED` 保持 `false`。
- Repository Pattern 完整链路：`page → Server Action → repository → Supabase`。
- 页面/组件不得直接调用 `supabase.from()`。
- 关注不影响同步、不影响库存写入、不影响他人视图。
- `requireActiveAuth()`（所有登录用户均可关注/取消关注）。

## 子任务拆分

| Sub-Task ID | 任务 | 依赖 | 状态 |
|---|---|---|---|
| **P5-SY12-1** | Migration 00013：扩展 `preference_type` CHECK 约束 + 静态测试 | — | DONE |
| **P5-SY12-2** | 类型更新：`database.ts` + `preferences/types.ts` + `inventory/types.ts` | P5-SY12-1 | DONE |
| **P5-SY12-3** | `src/features/preferences/` 模块：schema + repository + actions | P5-SY12-2 | DONE |
| **P5-SY12-4** | 库存列表星标按钮（overseas page UI） | P5-SY12-3 | DONE |
| **P5-SY12-5** | Dashboard 关注区 | P5-SY12-3 | DONE |
| **P5-SY12-6** | 测试：migration + repository + actions + dashboard + non-regression | P5-SY12-3~5 | DONE |
| **P5-SY12-7** | 质量门：`npm run test` / `npm run lint` / `npm run build` | P5-SY12-6 | DONE |

## 阶段 B 告警规则（临时，非最终动态告警）

```typescript
/**
 * 阶段 B 临时告警：quantity < product.safety_stock
 * 这不是最终动态告警逻辑，也不是 bug。
 * 阶段 C 完成后升级为：est_days < warehouse.lead_time_days OR quantity < safety_stock
 * 阶段 B 不新增 inventory.daily_sales / inventory.est_days / warehouse.lead_time_days
 */
isLowStock = quantity < product.safety_stock
```

## 归档与关注共存

- 同一用户同一 variant 可同时 archived + favorited（`preference_type` 不同，UNIQUE 约束允许）。
- 海外库存列表默认排除 `preference_type='archived'`，但不过滤 `'favorited'`。
- Dashboard 关注区显示所有 favorited 的 variant（包括同时 archived 的），因为关注区是用户主动选择的高亮视图。

## 停止条件

- P5-SY12 阶段 B 完成。不进入阶段 C/D。
- 不新增 `variant_follows` 表。
- 不新增 `inventory.daily_sales` / `inventory.est_days` / `warehouse.lead_time_days`。
- 不改 `sync_warehouse_inventory` RPC / Python 透传。
- 不启动 P5-SY10 Phase B 自动 Real Write。
- `WEBSYNC_REAL_WRITE_ENABLED` 保持 `false`。
- 不修改已执行 Migration 00001~00012。

## 依赖

- P5-SY11G DONE — `user_variant_preference` 表已存在，RLS 已配置
- Migration 00012 已在生产数据库执行
- 归档功能正常工作（896/896 测试 pass）
