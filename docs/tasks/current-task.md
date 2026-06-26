# Current Task Packet

## Task ID

`P5-SY12C` — 特别关注阶段 C Dashboard 动态告警

## 状态

DONE（2026-06-26 完成）

## 背景

P5-SY12 阶段 B 已完成：用户可以星标关注 SKU，Dashboard 有基础「关注产品动态」区，但告警只用 `product.safety_stock` 做临时判断。阶段 C 将告警升级为基于 BigSeller 已抓取字段的动态告警：
- `estimated_days < warehouse.lead_time_days` → 紧急（需补货）
- `quantity < product.safety_stock` → 低库存（低于安全线）
- 未匹配 Product 的 SKU 不参与 safety_stock 判断

## 任务目标

1. ✅ **Migration 00014**：新增 `inventory.daily_sales / estimated_days`、`warehouse.lead_time_days` + `CREATE OR REPLACE sync_warehouse_inventory` 扩展支持写入 daily_sales/estimated_days
2. ✅ **类型同步**：`database.ts` 更新 inventory/warehouse 类型
3. ✅ **Python sync 链路**：plan_generator 透传 daily_sales/estimated_days + executor `_build_rpc_payload` 校验（None/'-'/''→omit, NaN/Infinity→reject, valid→include）
4. ✅ **FollowedVariantBasic 扩展**：dailySales/estimatedDays/leadTimeDays/alertLevel/alertReason
5. ✅ **getFollowedVariantsBasic() 升级**：动态告警规则 + 多级排序
6. ✅ **Dashboard UI 更新**：日销/可售天数/补货周期列 + alertLevel 状态 badge + 告警摘要
7. ✅ **测试**：Migration 00014 静态契约 + Dashboard 源码检查 + Repository 检查 + 非回归
8. ✅ **质量门**：1006/1006 TS 测试，lint 0 errors，build pass，Python compileall pass

## 强制架构边界

- ❌ 不新建 `variant_follows` 表。✅
- ❌ 不修改已执行 Migration 00001~00013。✅（新建 00014）
- ❌ 不改变 Quantity 语义。✅
- ❌ 不改 Product → ProductVariant → Inventory 模型。✅
- ❌ 不让页面或客户端组件直接调用 `supabase.from()`。✅
- ❌ 不做 P5-SY10 自动 Real Write。✅

## 质量门

| 门 | 结果 |
|---|---|
| `npm.cmd run test` | 1006/1006 pass（35 files） |
| `npm.cmd run lint` | 0 errors, 24 warnings（all pre-existing） |
| `npm.cmd run build` | ✓ Compiled successfully |
| Python compileall | pass |

## 依赖

- P5-SY12 DONE — 星标关注 + 阶段 B 关注区基础功能
- Migration 00013 已在生产数据库执行
- ⚠️ Migration 00014 需用户在 Supabase SQL Editor 手动执行
