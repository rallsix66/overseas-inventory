# Current Task Packet

## Task ID

`PERF-C2B` — 产品页查询编排优化

## 状态

**DONE**（2026-07-04）。

### 背景

PERF-C1（Dashboard 首页并行重排）和 PERF-C2A（海外库存 getOverseasInventory 查询编排）已完成。本轮只优化产品相关页面的数据加载编排：产品列表页、产品详情页、productRepository.getById。

### 实现

**src/app/dashboard/products/page.tsx（产品列表页）：**
- `searchParams` 仍先 await 解析
- `page` 计算后，`getCurrentUser()` 与 `productRepository.list(...)` 通过 `Promise.all` 并行执行（两者互不依赖）
- `isAdmin = user?.roleName === 'admin'` 语义不变
- 传给 `ProductsPageContent` 的 props 不变

**src/app/dashboard/products/[id]/page.tsx（产品详情页）：**
- `params` 仍先 await 解析
- `id` 提取后，`getCurrentUser()` 与 `productRepository.getById(id)` 通过 `Promise.all` 并行执行
- `notFound()` 行为不变
- 传给 `ProductDetailClient` 的 props 不变

**src/features/products/repository.ts — getById(id)：**
- `validateUUID(id)` 行为不变
- product 主查询仍先执行；product 不存在时仍直接返回 `null`（不查 variants/inventory）
- product 存在后，variants 查询与 inventory 查询改为 `Promise.all` 并行执行
- 错误语义不变：
  - product 查询 DB error → `ProductError('查询产品详情失败', 'DB_ERROR')`
  - variants 查询 DB error → `ProductError('查询产品关联 SKU 失败', 'DB_ERROR')`
  - inventory 查询 DB error → `ProductError('查询产品库存失败', 'DB_ERROR')`
- 返回结构不变：`variants` / `inventory` / `inventory.safetyStock = product.safety_stock`

**编排对比：**

```
产品列表页:
  Before: searchParams → getCurrentUser → productRepository.list
  After:  searchParams → [getCurrentUser | productRepository.list] (Promise.all)

产品详情页:
  Before: params → getCurrentUser → productRepository.getById
  After:  params → [getCurrentUser | productRepository.getById] (Promise.all)

repository.getById:
  Before: product → variants (串行) → inventory (串行)
  After:  product → [variants | inventory] (Promise.all)
```

**src/features/products/perf-c2b-orchestration.test.ts（新文件）：**
- 20 项源码级静态测试，覆盖 4 个 describe 块：
  1. 产品列表页并行编排（5 项）：Promise.all 含 getCurrentUser + list、searchParams 先 await、isAdmin 语义、props 不变、无 supabase.from
  2. 产品详情页并行编排（5 项）：Promise.all 含 getCurrentUser + getById、params 先 await、notFound、props 不变、无 supabase.from
  3. repository.getById 并行编排（8 项）：product 先查、null 早返回、variants/inventory Promise.all、各错误分支、safetyStock 来源
  4. 架构合规（2 项）：列表页/详情页无直接 Supabase 调用

### 禁止事项（已遵守）

- 不新增/修改 Migration、RPC、RLS、索引
- 不改 product / product_variant / inventory 数据模型
- 不改产品 UI、表格列、详情页展示、分页行为
- 不改产品 actions 的写入逻辑
- 不改 Dashboard 首页、海外库存页、同步页
- 不改 `.claude/`
- 不改 package.json
- 不使用 `any`

### 验收

| 检查项 | 结果 |
|--------|------|
| `src/features/products` 测试 | **20/20** 通过 ✅ |
| `npm run build` | ✓ Compiled + TypeScript ✅ |
| `npm run lint` | 5 errors / 25 warnings（仅 `smoke-test-00025.ts` 既有）✅ |
| `git diff --check` | 通过 ✅ |
| 不新增 Migration | ✅ |
| 不改产品/海外库存/同步页/权限 | ✅ |

### 修改文件清单

| # | 文件 | 变更 |
|---|------|------|
| 1 | `src/app/dashboard/products/page.tsx` | getCurrentUser() + list 改为 Promise.all 并行 |
| 2 | `src/app/dashboard/products/[id]/page.tsx` | getCurrentUser() + getById 改为 Promise.all 并行 |
| 3 | `src/features/products/repository.ts` | getById 内 variants + inventory 改为 Promise.all 并行 |
| 4 | `src/features/products/perf-c2b-orchestration.test.ts` | 新增 20 项 PERF-C2B 并行编排测试 |

### 范围说明

本轮只做产品页查询编排优化。Phase C 其余内容：
- Dashboard 首页（PERF-C1）— 已完成
- 海外库存 actions（PERF-C2A）— 已完成
- 同步页分页（Phase D）— 未开始
- 索引优化（Phase E）— 未开始

### 残余风险

- 产品列表页 `getCurrentUser()` 与 `productRepository.list()` 并行：如果 Supabase auth cookie 失效但 product 查询成功，会出现 user 为 null 但 result 有数据的情况。当前代码 `user?.roleName === 'admin'` 已安全处理 null → false。产品列表页本身不需要 user 信息来过滤数据（非 Admin 权限限制在其他层面），无实质性风险
- 产品详情页同理：getById 失败会抛 ProductError，与 getCurrentUser 失败（返回 null）不会互相影响
- repository.getById 中 variants/inventory 并行：两个查询互不依赖，无风险

### 下一步

PERF-C2B 完成。Phase C 性能优化（PERF-C1/C2A/C2B）全部完成。可推进 Phase D（同步页分页）或 Phase E（索引优化）。P3-S1B 仍 BLOCKED_EXTERNAL。
