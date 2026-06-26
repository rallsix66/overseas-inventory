# Current Task Packet

## Task ID

`P5-SY12D` — Dashboard 关注产品动态运营可用性收口

## 状态

**DONE**（2026-06-26）

## 任务目标

P5-SY12C 阶段 C 动态告警已上线生产，Dashboard 关注产品动态区已显示日销/可售天数/补货周期/状态 badge。阶段 D 在不改数据模型的前提下增加运营可用性：

1. **状态筛选**：全部 / 紧急 / 低库存 / 正常 / 数据不足（客户端筛选，pills）
2. **每行跳转入口**：ExternalLink 跳转 `/dashboard/inventory/overseas?search=<SKU>`，复用现有路由
3. **未匹配说明**：tooltip 提示 "该 SKU 未匹配产品，不参与安全库存判断。仍可通过预计可售天数进行动态告警。"；数据不足 + 未匹配状态 badge 旁显示 `?` 辅助图标
4. **边界状态**：
   - 加载失败 → "关注产品加载失败" + 错误消息
   - 空关注 → "暂无关注产品" + 引导去海外库存列表星标
   - 筛选无结果 → "当前筛选条件下无匹配的关注产品" + "查看全部" 重置按钮
5. **不新建复杂页面**，跳转复用现有 `/dashboard/inventory/overseas` 的 `?search=` 参数
6. **不改 Migration**、不新增数据库表、不改数据模型

## 实现方式

- **新增** `src/features/preferences/components/followed-products-section.tsx` — Client Component
  - `'use client'` 声明
  - `useState<AlertFilter>('all')` 管理筛选状态
  - FILTER_OPTIONS: 全部/紧急/低库存/正常/数据不足（pill 按钮，含各状态计数）
  - 跳转：`<Link href={/dashboard/inventory/overseas?search=${encodeURIComponent(v.sku)}}>`
  - 未匹配 tooltip：`title={UNMATCHED_HINT}` 常量
  - 告警摘要条：前 3 条 critical/warning + "等 N 项"
- **修改** `src/app/dashboard/page.tsx` — Server Component
  - 数据获取链路不变（preferencesRepository.getFollowedVariantsBasic）
  - 渲染替换为 `<FollowedProductsSection variants={followedVariants} error={followedError} />`
  - 移除已迁移到组件的 import（Star）
- **更新** `src/features/preferences/p5-sy12-dashboard.test.ts` — 新增 P5-SY12D 测试
  - Dashboard 数据获取链路（Repository Pattern）
  - FollowedProductsSection 组件源码检查（use client / 筛选 / 跳转 / 未匹配 / 边界状态）
  - 阶段 C 动态告警规则保留验证
  - product null 关注项不丢弃（防回归）

## 强制架构边界

- ✅ 页面和客户端组件不直接调用 `supabase.from()`
- ✅ 数据获取通过 Repository → Server Component → Client Component props
- ❌ 不新建表、不改 Migration
- ❌ 不做 Product 自动生成、不做 SKU 自动匹配
- ❌ 不启用 P5-SY10 自动 Real Write
- ❌ 不新建复杂页面（跳转复用现有路由）

## 质量门

| 门 | 结果 |
|---|---|
| `npm run test` | 1014/1014 pass（35 files） |
| `npm run lint` | 0 errors, 24 warnings（all pre-existing） |
| `npm run build` | ✓ Compiled successfully |

## 依赖

- P5-SY12C DONE + RUNTIME VERIFIED — 阶段 C 动态告警（Migration 00014 已执行，Dashboard 已显示动态告警）
- Migration 00013 已在生产数据库执行（preference_type `'favorited'`）

## 停止条件

**P5-SY12D DONE。等待用户确认下一任务。** 不自动进入相邻任务。
