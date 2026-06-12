# 实施计划 — Phase 0 & Phase 1

> 文档导航：[文档树](README.md) · [当前状态](current-state.md) · [页面规格](page-specification.md) · [架构](architecture.md) · [路线图](mvp-roadmap.md)

> 基于适用的 `.claude/rules/`、`supabase/migrations/`、`docs/mvp-roadmap.md`、`docs/page-specification.md`
>
> **原则**：只拆解任务，不写代码。每个任务写到开发者可直接执行的程度。

---

## 总览

| Phase | 任务数 | 涉及页面 | 核心交付 |
|---|---|---|---|
| Phase 0 | 10 | `/auth/login`、`/auth/callback`、`/dashboard`(骨架) | 项目能跑、数据库能用、登录能进 |
| Phase 1 | 11 | `/dashboard/products`、`/products/[id]`、`/variants`、`/variants/unmatched` | 管理员能管产品、能匹配 SKU |
| **合计** | **21** | **5 个路由** | |

---

## 全局依赖关系

```
0.1 (create-next-app) ──────────────────────────┐
                                                  ├─→ 0.3 (Supabase 客户端)
0.2 (Supabase 建库 + Migration) ─→ 0.5 (环境变量) ─┘
                                                  │
0.2 ──→ 0.4 (数据库类型生成) ─────────────────────┘
                                                  │
0.3 ──→ 0.6 (中间件) ──→ 0.9 (Dashboard 布局)     │
0.3 ──→ 0.7 (登录页)                               │
0.3 ──→ 0.8 (Auth 回调)                            │
0.2 ──→ 0.10 (创建管理员)                           │
                                                  │
==================== Phase 0 完成 ====================
                                                  │
0.9 ──→ 所有 Phase 1 页面                          │
0.4 ──→ 1.1 (类型) ──→ 1.2 (服务) ──→ 1.3~1.11     │
```

---

# Phase 0：基础设施搭建

**目标**：`npm run dev` 能访问 → 登录 → 进入空白 Dashboard → 侧边栏可见。

---

## 0.1 — 项目初始化

| 项目 | 内容 |
|---|---|
| **依赖** | 无 |
| **优先级** | 🔴 阻塞所有后续任务 |
| **预计文件** | `package.json`、`tsconfig.json`、`next.config.ts`、`tailwind.config.ts`、`src/app/globals.css`、`src/app/layout.tsx`、`src/app/page.tsx` 等 |

### 描述

1. 在项目根目录执行 `npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"`（当前目录初始化，非新文件夹）
2. 按 [shadcn/ui 官方文档](https://ui.shadcn.com/docs/installation/next) 初始化 shadcn/ui（`npx shadcn@latest init`，选默认配置）
3. 安装以下 shadcn/ui 组件（Phase 0–1 全部所需）：

| 组件 | 用途 | 用到阶段 |
|---|---|---|
| `Button` | 所有按钮 | Phase 0 |
| `Input` | 所有输入框 | Phase 0 |
| `Label` | 表单标签 | Phase 1 |
| `Table` | 所有数据表格 | Phase 1 |
| `Badge` | 状态标签（角色/国家/匹配状态） | Phase 1 |
| `Dialog` | 确认弹窗（停用、删除） | Phase 1 |
| `Sheet` | 侧边编辑面板 | Phase 1 |
| `Skeleton` | 加载骨架屏 | Phase 1 |
| `Sonner` (Toast) | 操作反馈 | Phase 1 |
| `DropdownMenu` | 更多操作菜单 | Phase 1 |
| `Select` | 下拉选择（国家、角色） | Phase 1 |
| `Card` | 统计卡片 | Phase 2 |
| `Command` | 可搜索选择（SKU 匹配时选 Product） | Phase 1 |

4. 在 `src/app/globals.css` 末尾添加设计系统 CSS 变量（品牌色、状态色等），移除 shadcn/ui 默认的暗色模式变量（design.md 明确「无暗色模式」）
5. 验证 `npm run dev` 正常启动，访问 `http://localhost:3000` 看到 Next.js 默认页

### 验收标准

- [ ] `npm run dev` 启动无错误
- [ ] `npx shadcn add button -o`（或其他组件）能正常添加
- [ ] 以上 13 个 shadcn/ui 组件全部安装完毕、可 import
- [ ] 项目目录结构符合 `architecture.md` 的模块边界（`src/app/`、`src/components/ui/`、`src/lib/` 等）

---

## 0.2 — Supabase 项目创建 + 数据库初始化

| 项目 | 内容 |
|---|---|
| **依赖** | 无（与 0.1 并行） |
| **优先级** | 🔴 阻塞 0.3, 0.4, 0.5, 0.10 |
| **涉及文件** | `supabase/migrations/00001_initial_schema.sql`（已存在） |

### 描述

1. 在 [supabase.com](https://supabase.com) 创建新项目（项目名建议：`inventory-dashboard`），选择最近的 AWS 区域
2. 项目创建完成后，进入 Supabase Dashboard → SQL Editor
3. 复制 `supabase/migrations/00001_initial_schema.sql` 全部内容，粘贴到 SQL Editor 中执行
4. 执行后验证：

| 验证项 | 方法 |
|---|---|
| 10 张表全部创建 | SQL Editor 执行 `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;` |
| RLS 全部启用 | `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = true;`（应返回 10 行） |
| Seed 数据正确 | `SELECT * FROM role;`（2 行）、`SELECT * FROM warehouse;`（6 行） |
| 触发器存在 | `SELECT trigger_name FROM information_schema.triggers WHERE event_object_schema = 'public';`（应含 5 个 updated_at + 1 个 on_auth_user_created） |
| 函数存在 | `SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'public';`（应含 `get_user_role`、`handle_new_user`、`update_updated_at_column`） |

5. 记录 Supabase 项目的 `URL` 和 `anon key`（Project Settings → API），用于 0.5

### 验收标准

- [ ] 10 张表存在且表结构符合 migration 文件定义
- [ ] 42 条 RLS 策略全部生效
- [ ] `role` 表含 `admin` 和 `operator` 两条记录
- [ ] `warehouse` 表含 6 个仓库（CN/TH/ID/MY/PH/VN）
- [ ] 6 个触发器、3 个函数全部存在

---

## 0.3 — Supabase 客户端封装

| 项目 | 内容 |
|---|---|
| **依赖** | 0.1 + 0.5（需要环境变量才能连接） |
| **优先级** | 🔴 阻塞 0.6, 0.7, 0.8, 0.9 |
| **涉及文件** | `src/lib/supabase/client.ts`、`src/lib/supabase/server.ts` |

### 描述

1. 安装 Supabase JS SDK：`npm install @supabase/supabase-js @supabase/ssr`
2. 创建 `src/lib/supabase/client.ts` — 浏览器端客户端：

```
功能：导出 createClient() 函数
实现：使用 @supabase/ssr 的 createBrowserClient
参数：NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY（从环境变量读取）
```

3. 创建 `src/lib/supabase/server.ts` — 服务端客户端：

```
功能：导出 createClient() 函数
实现：使用 @supabase/ssr 的 createServerClient
参数：同上，但通过 cookies() 管理 session
```

4. 两个文件都不做单例缓存（Next.js 的 cookie 机制要求每次请求创建新实例）

### 验收标准

- [ ] `client.ts` 在 `'use client'` 组件中能正常 import 和调用
- [ ] `server.ts` 在 Server Component 和 Route Handler 中能正常 import 和调用
- [ ] 连接成功后能执行 `.from('warehouse').select('*')` 返回 6 行数据
- [ ] 未登录状态下 `.auth.getUser()` 返回 `null`（不抛错）

---

## 0.4 — 数据库类型生成

| 项目 | 内容 |
|---|---|
| **依赖** | 0.2（Supabase 项目已有表结构） |
| **优先级** | 🔴 阻塞所有 services.ts（1.2 等） |
| **涉及文件** | `src/types/database.ts` |

### 描述

1. 安装 Supabase CLI（如未安装）：`npm install -D supabase`
2. 在项目根目录执行类型生成（需先登录 Supabase CLI）：

```bash
npx supabase login
npx supabase gen types typescript --project-id <PROJECT_ID> > src/types/database.ts
```

3. 在 `package.json` 的 `scripts` 中添加：

```json
"gen-types": "supabase gen types typescript --project-id <PROJECT_ID> > src/types/database.ts"
```

4. 验证 `src/types/database.ts` 文件包含完整的 `Database` 接口，含 `Tables`、`Enums`、`Functions` 三个子类型
5. 关键验证：`Database['public']['Tables']` 下能找到全部 10 张表的类型定义

### 验收标准

- [ ] `src/types/database.ts` 自动生成，未手动修改
- [ ] `Tables<'product'>` 类型包含 `code`、`name`、`safety_stock` 等字段
- [ ] `Tables<'product_variant'>` 类型包含 `match_status` 字段（类型为 union: `'matched' | 'unmatched' | 'pending'`）
- [ ] `Functions<'get_user_role'>` 类型存在

---

## 0.5 — 环境变量配置

| 项目 | 内容 |
|---|---|
| **依赖** | 0.2（需要 Supabase 项目 URL + Key） |
| **优先级** | 🔴 阻塞 0.3 |
| **涉及文件** | `.env.local`、`.env.example` |

### 描述

1. 创建 `.env.local`（已在 `.gitignore` 中）：

```
NEXT_PUBLIC_SUPABASE_URL=https://<PROJECT_ID>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon_key>
```

2. 创建 `.env.example`：

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

3. 确认 `.gitignore` 忽略 `.env.local`（Next.js 默认已配置）
4. 重启 `npm run dev` 使环境变量生效

### 验收标准

- [ ] `.env.local` 中的变量在 `process.env.NEXT_PUBLIC_SUPABASE_URL` 可读取
- [ ] `.env.example` 只含变量名，不含真实值
- [ ] `.env.local` 未被 Git 跟踪（`git status` 不显示）

---

## 0.6 — 中间件（路由守卫）

| 项目 | 内容 |
|---|---|
| **依赖** | 0.3（需要 Supabase server client） |
| **优先级** | 🔴 阻塞 0.9 |
| **涉及文件** | `src/middleware.ts` |

### 描述

1. 使用 `@supabase/ssr` 的 `createServerClient` 在 middleware 中校验 session
2. 路由判断逻辑：

| 路由 | 未登录 | 已登录 |
|---|---|---|
| `/auth/login` | 放行 | 重定向到 `/dashboard` |
| `/auth/callback` | 放行 | 放行 |
| `/dashboard/*` | 重定向到 `/auth/login` | 放行 |
| 根路径 `/` | 重定向到 `/dashboard` | 重定向到 `/dashboard` |

3. middleware 中不校验角色（角色校验在 layout.tsx 和各 API 中做）
4. `config.matcher` 排除静态资源和 API routes：

```
matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)']
```

5. 注意：middleware 在 Edge Runtime 运行，不能使用 Node.js API

### 验收标准

- [ ] 未登录访问 `/dashboard` → 重定向到 `/auth/login`
- [ ] 未登录访问 `/dashboard/products` → 重定向到 `/auth/login`
- [ ] 已登录访问 `/auth/login` → 重定向到 `/dashboard`
- [ ] 未登录访问 `/` → 重定向到 `/dashboard` → 再重定向到 `/auth/login`
- [ ] 已登录访问 `/dashboard` → 正常渲染（不无限重定向）

---

## 0.7 — 登录页

| 项目 | 内容 |
|---|---|
| **依赖** | 0.3（需要 Supabase browser client） |
| **优先级** | 🔴 核心交付 |
| **涉及文件** | `src/app/auth/login/page.tsx` |

### 描述

参考 `docs/page-specification.md` 的 `/login` 页面规格。

1. 页面为 Client Component（需要 `'use client'`）
2. UI 构成：
   - 居中卡片（`max-w-sm`），包含系统名称「库存看板系统」
   - 邮箱输入框（`h-9`）
   - 密码输入框（`h-9`）
   - 登录按钮（全宽，`h-9`）
   - 错误信息区（红色文字，登录失败时显示）
3. 交互：
   - 点击登录 → 调用 `supabase.auth.signInWithPassword({ email, password })`
   - 登录中按钮显示 loading（`disabled` + spinner）
   - 登录成功 → `router.push('/dashboard')`
   - 登录失败 → 显示错误信息（中文：账号或密码错误 / 账号已被禁用 / 服务器错误）

4. 页面状态覆盖：

| 状态 | 表现 |
|---|---|
| 空输入 | 按钮可点击，Supabase Auth 返回验证错误 |
| 加载中 | 按钮显示 loading，禁止重复点击 |
| 错误 | 卡片上方显示红色错误信息 |
| 已登录 | 0.6 middleware 已处理重定向 |

5. 不引入 Supabase Auth UI 组件库，使用自定义 UI 以匹配设计系统

### 验收标准

- [ ] 有效邮箱+密码可成功登录并跳转 `/dashboard`
- [ ] 错误密码显示红色错误提示
- [ ] 不存在的邮箱显示红色错误提示
- [ ] 登录中按钮 disabled，不能重复提交
- [ ] 已登录用户访问 `/auth/login` 自动跳转 `/dashboard`（0.6 middleware 验证）

---

## 0.8 — Auth 回调处理

| 项目 | 内容 |
|---|---|
| **依赖** | 0.3（需要 Supabase server client） |
| **优先级** | 🔴 核心交付 |
| **涉及文件** | `src/app/auth/callback/route.ts` |

### 描述

1. 创建 Route Handler（`GET` 方法）
2. 处理 Supabase Auth 的回调场景：
   - 邮箱确认（`token_hash` + `type` query params）
   - OAuth 登录（code exchange）
   - 密码重置确认
3. 使用 `supabase.auth.verifyOtp()` 或 `supabase.auth.exchangeCodeForSession()`
4. 成功后重定向到 `/dashboard`，失败重定向到 `/auth/login?error=<message>`

### 验收标准

- [ ] Auth callback 正常处理 session 交换
- [ ] 成功后重定向到 `/dashboard`
- [ ] 失败后重定向到 `/auth/login` 并显示错误信息

---

## 0.9 — Dashboard 布局骨架

| 项目 | 内容 |
|---|---|
| **依赖** | 0.6（中间件就绪）+ 0.3（Supabase 客户端） |
| **优先级** | 🔴 阻塞所有 Phase 1 页面 |
| **涉及文件** | `src/app/dashboard/layout.tsx`、`src/app/dashboard/_components/sidebar-nav.tsx`、`src/app/dashboard/_components/dashboard-header.tsx`、`src/app/dashboard/page.tsx` |

### 描述

参考 `docs/page-specification.md` 和 `design.md` 的 Dashboard 布局规则。

#### A. Layout（`dashboard/layout.tsx`）

1. Server Component，在渲染前校验用户登录 + 角色（读 `profiles` 表取 `role_id`）
2. 校验失败 → 重定向到 `/auth/login`
3. 布局结构：

```
┌──────────────────────────────────────┐
│  Sidebar (w-[220px], 固定)  │  Main  │
│                             │        │
│  navigation                 │ {children} │
│                             │        │
└──────────────────────────────────────┘
```

4. 使用 `flex h-screen` 实现全高布局
5. Sidebar 和 Header 作为 layout 的子组件

#### B. Sidebar（`_components/sidebar-nav.tsx`）

1. Client Component（需要交互：高亮当前页、折叠）
2. 宽度固定 `w-[220px]`，背景 `bg-gray-900`（深色侧边栏）
3. 导航项（Phase 0 时只有首页可点击，其余灰显或占位）：

| 导航项 | 路由 | Phase 0 状态 | 对应阶段 |
|---|---|---|---|
| 首页 | `/dashboard` | ✅ 可点击 | Phase 2（数据） |
| 库存管理 | 折叠组 | 展开但子项灰显 | Phase 2 |
| ├ 国内库存 | `/dashboard/inventory/domestic` | 灰显 | Phase 2 |
| ├ 海外库存 | `/dashboard/inventory/overseas` | 灰显 | Phase 2 |
| 产品管理 | 折叠组 | ✅ 可点击 | Phase 1 |
| ├ 产品列表 | `/dashboard/products` | ✅ 可点击 | Phase 1 |
| ├ SKU 管理 | `/dashboard/variants` | ✅ 可点击 | Phase 1 |
| ├ 待处理 SKU | `/dashboard/variants/unmatched` | ✅ 可点击 | Phase 1 |
| 在途管理 | `/dashboard/shipments` | 灰显 | Phase 3 |
| 团队账号 | `/dashboard/users` | 灰显 | Phase 4 |
| 同步管理 | `/dashboard/sync` | 灰显 | Phase 5 |

4. 当前页面高亮（`bg-gray-800`），用 Next.js `usePathname()` 判断
5. 侧边栏顶部显示系统名称/logo
6. 图标使用 `lucide-react`（shadcn/ui 默认图标库，已随 shadcn 安装）

> **注意**：Phase 0 导航项中包含 Phase 1 的产品管理子项。这是故意的——导航结构一次建好，仅路由对应的页面在 Phase 1 才实现。Phase 0 时 `/dashboard/products` 等路径返回 404 或占位页。

#### C. Header（`_components/dashboard-header.tsx`）

1. Client Component
2. 显示当前用户 display_name（从 `profiles` 表读取）
3. 右侧：退出登录按钮（调用 `supabase.auth.signOut()` → 跳转 `/auth/login`）
4. 高度 `h-14`，下边框 `border-b`

#### D. 首页占位（`dashboard/page.tsx`）

1. 显示页面标题「首页」
2. 内容区显示占位文字「仪表盘将在 Phase 2 中实现」（此时 inventory / shipment 表为空）
3. 结构预留：三个卡片占位区 + 表格占位区（只是空 div，不渲染数据）

### 验收标准

- [ ] 登录后看到完整布局：左侧深色侧边栏 + 右侧主内容区
- [ ] 侧边栏宽度 220px，高度全屏
- [ ] 点击「首页」可跳转（实际就是 `/dashboard`）
- [ ] 点击退出登录按钮，session 清除，跳转回 `/auth/login`
- [ ] 当前用户名显示在 header
- [ ] 未登录直接访问 `/dashboard` 时重定向到登录页（0.6 已验证）
- [ ] 页面最小宽度 ≥ 1024px（桌面端专属，不做响应式）

---

## 0.10 — 创建管理员账号

| 项目 | 内容 |
|---|---|
| **依赖** | 0.2（数据库就绪） |
| **优先级** | 🔴 阻塞 Phase 1 产品管理（operator 不能 CRUD 产品） |

### 描述

1. 在 Supabase Dashboard → Authentication → Users → Add User 创建第一个用户（邮箱 + 密码）
2. 创建后，用户自动获得 `operator` 角色（`handle_new_user()` 触发器）
3. 在 SQL Editor 中手动升级为 admin：

```sql
UPDATE profiles
SET role_id = (SELECT id FROM role WHERE name = 'admin')
WHERE id = '<用户 UUID>';
```

4. 验证：用该账号登录，可在 SQL Editor 执行 `SELECT get_user_role();` 返回 `admin`

### 验收标准

- [ ] 管理员账号登录成功
- [ ] `get_user_role()` 返回 `admin`
- [ ] RLS 策略允许管理员对所有表执行 ALL 操作

---

## Phase 0 完成标志

- 浏览器访问 `http://localhost:3000` → 未登录 → 重定向 `/auth/login`
- 输入管理员账号密码 → 登录成功 → 进入 Dashboard 布局
- 左侧深色侧边栏可见，导航项结构完整（部分灰显）
- 右侧显示空白首页占位内容
- 点击退出 → 回到登录页

---

# Phase 1：产品主数据

**目标**：管理员能管理标准产品和国家 SKU 映射。

**依赖**：Phase 0 全部完成。

---

## 1.1 — 产品模块类型定义

| 项目 | 内容 |
|---|---|
| **依赖** | 0.4（数据库类型已生成） |
| **优先级** | 🔴 阻塞 1.2 |
| **涉及文件** | `src/features/products/types.ts` |

### 描述

基于 `src/types/database.ts` 中的 `Tables` 类型，定义产品模块的业务类型：

| 类型名 | 用途 | 来源/字段要点 |
|---|---|---|
| `ProductItem` | 产品列表行数据 | `product` 全部字段 + `variant_count: number`（关联 SKU 数） |
| `ProductVariantItem` | SKU 列表行数据 | `product_variant` 全部字段 + `product_name: string \| null`（JOIN `product.name`） |
| `ProductDetail` | 产品详情页数据 | `product` 全部字段 + `variants: ProductVariantItem[]` + `inventory: InventoryBrief[]` |
| `InventoryBrief` | 产品详情中的库存摘要 | `warehouse_name`、`warehouse_country`、`quantity`、`last_sync_at` |
| `ProductFormData` | 新增/编辑产品表单 | `code`、`name`、`category`、`safety_stock`、`unit` |
| `VariantMatchInput` | SKU 匹配操作输入 | `variant_id`、`product_id` |
| `ProductFilters` | 产品列表筛选条件 | `search?: string` |

### 验收标准

- [ ] 所有类型基于 `Database['public']['Tables']` 派生，不重复定义列字段
- [ ] `ProductItem.variant_count` 带类型注解（`number`）
- [ ] `ProductFormData.safety_stock` 类型为 `number`（非 `string`）
- [ ] `InventoryBrief.quantity` 类型为 `number`（非 `string`）

---

## 1.2 — 产品与 Variant 数据访问层

| 项目 | 内容 |
|---|---|
| **依赖** | 0.3（Supabase 客户端）+ 0.4（数据库类型）+ 1.1（业务类型） |
| **优先级** | 🔴 阻塞 1.3~1.11 |
| **涉及文件** | `src/features/products/repository.ts`、`actions.ts`、`src/features/variants/repository.ts`、`actions.ts` |

### 描述

Repository 封装 Supabase 查询，Server Actions 负责写操作、Zod 校验、身份和角色校验，并返回统一 `ActionResult`。

#### 产品 CRUD

| 函数 | 返回类型 | 说明 |
|---|---|---|
| `productRepository.list(filters)` | `PaginatedResult<ProductItem>` | 分页列表，含 SKU 数量，支持搜索和状态筛选 |
| `productRepository.getById(id)` | `ProductDetail \| null` | 单个产品详情，含关联 variants |
| `createProduct(data)` | `ActionResult<ProductItem>` | Admin 新增产品 |
| `updateProduct(id, data)` | `ActionResult<ProductItem>` | Admin 更新产品 |
| `toggleProductActive(id, isActive)` | `ActionResult` | Admin 启用或停用产品 |

#### Variant 查询 + 匹配

| 函数 | 返回类型 | 说明 |
|---|---|---|
| `variantRepository.list(filters)` | `PaginatedResult<VariantItem>` | 分页列表，支持国家、状态、产品和搜索筛选 |
| `variantRepository.getUnmatched()` | `VariantItem[]` | `match_status IN ('unmatched', 'pending')` |
| `matchVariant(variantId, productId)` | `ActionResult` | Admin 设置 Product 映射 |
| `unmatchVariant(variantId)` | `ActionResult` | Admin 取消映射 |

#### 服务端校验

| 函数 | 校验内容 |
|---|---|
| `createProduct` | `code` 非空；`name` 非空；`safety_stock >= 0`；`unit` 默认 `'件'` 若非必填 |
| `updateProduct` | ID 合法；表单字段合法；`safety_stock >= 0` |
| `matchVariant` | `variant_id`、`product_id` 合法且调用者为 Admin |

#### 实现注意

- 页面和组件不直接调用 Supabase
- Supabase 查询仅在 Repository 中实现
- 写操作必须通过 Server Action，并同时依赖应用权限校验和 RLS
- 查询使用 Supabase JS SDK，禁止拼接 SQL

### 验收标准

- [ ] `productRepository.list()` 返回正确分页和 SKU 数量
- [ ] 重复 `product.code` 返回明确可读错误
- [ ] `matchVariant()` 成功将 unmatched variant 变为 matched
- [ ] `variantRepository.getUnmatched()` 只返回 unmatched + pending 状态
- [ ] Operator 直接调用写 Action 时被拒绝
- [ ] 所有函数有明确的返回类型注解（无 `any`）

---

## 1.3 — 产品列表页 `/dashboard/products`

| 项目 | 内容 |
|---|---|
| **依赖** | 0.9（Dashboard 布局）+ 1.1（类型）+ 1.2（服务） |
| **优先级** | 🟡 核心交付 |
| **涉及文件** | `src/app/dashboard/products/page.tsx`、`src/features/products/components/product-table.tsx` |

### 描述

参考 `docs/page-specification.md` 的 `/products` 页面规格。

#### 页面结构

```
┌──────────────────────────────────────────────┐
│  页面标题「产品管理」                [新增产品] │
│  mb-5                                         │
│  ┌──────────────────────────────────────┐     │
│  │  搜索框（按编码或名称）               │     │
│  └──────────────────────────────────────┘     │
│  mb-4                                         │
│  ┌──────────────────────────────────────┐     │
│  │  ProductTable                         │     │
│  │  ┌────────┬──────┬────┬────┬────┬──┐ │     │
│  │  │产品编码 │产品名 │分类 │安全 │关联 │…│ │     │
│  │  │        │      │    │库存 │SKU数│  │ │     │
│  │  ├────────┼──────┼────┼────┼────┼──┤ │     │
│  │  │        │      │    │    │    │  │ │     │
│  │  └────────┴──────┴────┴────┴────┴──┘ │     │
│  │                   [分页器]             │     │
│  └──────────────────────────────────────┘     │
└──────────────────────────────────────────────┘
```

#### A. 页面组件（`page.tsx`）

1. Server Component，直接调 `getProducts()`
2. 读取当前用户角色（`get_user_role()`），admin 显示新增/编辑/停用按钮，operator 只读
3. 搜索功能：URL search params（`?search=xxx`），修改 search param 触发页面重新 fetch

#### B. 产品表格（`product-table.tsx`）

1. Client Component（需要交互：排序、hover、点击行）
2. 表格列（参考 page-spec）：

| 列 | 来源 | 显示规则 |
|---|---|---|
| 产品编码 | `product.code` | 纯文本 |
| 产品名称 | `product.name` | 纯文本，点击跳转到 `/products/[id]` |
| 分类 | `product.category` | 无数据显示「—」 |
| 安全库存 | `product.safety_stock` | 数字，低库存时红字显示（需交叉 inventory 数据判断？Phase 1 时 inventory 表为空，暂不标红） |
| 关联 SKU 数 | `variant_count` | 可点击，跳转 `/variants?product=xxx` |
| 状态 | `product.is_active` | 绿色 Badge「启用」/ 灰色 Badge「停用」 |
| 操作 | — | admin：编辑、停用/启用。operator：仅查看 |

3. 表头 `bg-gray-50`，行 `py-2.5`，hover `bg-gray-50`
4. 操作列右对齐
5. 分页：每页 20 条，底部居中

#### C. 新增/编辑产品面板（Sheet）

本部分在 1.5 中详细拆解，页面层面只需：
- 「新增产品」按钮触发 Sheet 打开
- 编辑按钮触发同一个 Sheet，传入已有产品数据

#### D. 页面状态

| 状态 | 表现 |
|---|---|
| 空数据 | 「暂无产品，点击新增产品开始」+ 新增按钮 |
| 加载中 | 表格骨架屏（5 行占位） |
| 错误 | 「加载失败，点击重试」+ 重试按钮 |
| 无权限 | operator 看不到新增/编辑/停用按钮 |

### 验收标准

- [ ] admin 登录后能看到产品列表（如无产品则显示空状态）
- [ ] admin 点击「新增产品」→ 右侧滑入 Sheet
- [ ] admin 点击行末「编辑」→ Sheet 打开并回填产品数据
- [ ] admin 点击「停用」→ Dialog 确认 → 停用后 Badge 变灰
- [ ] operator 登录后能看到产品列表，但无新增/编辑/停用按钮
- [ ] 搜索框输入编码或名称 → 列表即时筛选
- [ ] 表头灰底，行 hover 灰底，行高 40px
- [ ] 分页器正常工作

---

## 1.4 — 产品详情页 `/dashboard/products/[id]`

| 项目 | 内容 |
|---|---|
| **依赖** | 0.9（Dashboard 布局）+ 1.1（类型）+ 1.2（服务） |
| **优先级** | 🟡 核心交付 |
| **涉及文件** | `src/app/dashboard/products/[id]/page.tsx` |

### 描述

参考 `docs/page-specification.md` 的 `/products/[id]` 页面规格。

#### 页面结构

```
┌──────────────────────────────────────────────┐
│  ← 返回列表          产品详情       [编辑]    │
│  mb-5                                         │
│  ┌─ 基本信息区 ─────────────────────────┐     │
│  │  产品编码 · 产品名称 · 分类 · 安全库存 ·│     │
│  │  单位 · 状态                          │     │
│  └──────────────────────────────────────┘     │
│  mb-5                                         │
│  ┌─ 关联 SKU ───────────────────────────┐     │
│  │  SKU 表格（国家 · 仓库SKU · 仓库名 · │     │
│  │  匹配状态 · 最后同步）                │     │
│  └──────────────────────────────────────┘     │
│  mb-5                                         │
│  ┌─ 各仓库存 ───────────────────────────┐     │
│  │  库存表格（仓库 · 国家 · 数量 ·      │     │
│  │  状态 · 最后同步）                   │     │
│  └──────────────────────────────────────┘     │
└──────────────────────────────────────────────┘
```

#### A. 页面组件

1. Server Component，通过 `params.id` 调用 `getProduct(id)`
2. 产品不存在 → 显示 404 状态（Not Found 页或内联 404 提示）

#### B. 基本信息区

1. 字段列表展示，标签在左，值在右
2. admin 可见「编辑」按钮 → 弹出编辑 Sheet（同 1.5）
3. `is_active` 显示为 Badge（绿色/灰色）

#### C. 关联 SKU 表格

| 列 | 来源 | 显示规则 |
|---|---|---|
| 国家 | `product_variant.country` | Badge（TH=泰/ID=印尼...） |
| 仓库 SKU | `product_variant.sku` | 纯文本 |
| 仓库产品名 | `product_variant.name` | 纯文本 |
| 匹配状态 | `product_variant.match_status` | Badge（绿=已匹配/红=未匹配/黄=待确认） |
| 最后同步 | `product_variant.last_sync_at` | 格式化日期，无数据显示「—」 |

4. 无关联 SKU → 显示「暂无关联 SKU」

#### D. 各仓库存表格

| 列 | 来源 | 显示规则 |
|---|---|---|
| 仓库 | `warehouse.name` | 纯文本 |
| 国家 | `warehouse.country` | Badge |
| 库存数量 | `inventory.quantity` | 数字，低库存标红 |
| 状态 | 计算 | `quantity <= safety_stock` → 红色 Badge「低库存」，否则绿色「正常」 |
| 最后同步 | `inventory.last_sync_at` | 格式化日期，无数据显示「—」 |

5. Phase 1 时 `inventory` 表可能为空 → 显示「暂无库存数据」

#### E. 页面状态

| 状态 | 表现 |
|---|---|
| 产品不存在 | 404 提示「产品不存在，返回列表」+ 返回按钮 |
| 加载中 | 基本信息骨架屏 + 表格骨架屏 |
| 无关联 SKU | 关联 SKU 区显示「暂无关联 SKU」 |
| 无库存数据 | 库存区显示「暂无库存数据」 |

### 验收标准

- [ ] 从产品列表点击产品名 → 进入详情页
- [ ] 基本信息区正确显示所有字段
- [ ] 关联 SKU 表格显示该产品的所有 variant（包括其他国家仓库的）
- [ ] 各仓库存表格能正确显示（即使为空）
- [ ] admin 能看到编辑按钮，operator 看不到
- [ ] 不存在的产品 ID → 显示 404
- [ ] 点击「返回列表」回到 `/dashboard/products`

---

## 1.5 — 产品表单组件（新增/编辑）

| 项目 | 内容 |
|---|---|
| **依赖** | 1.1（类型）+ 1.2（服务） |
| **优先级** | 🟡 被 1.3 和 1.4 引用 |
| **涉及文件** | `src/features/products/components/product-form.tsx` |

### 描述

参考 design.md 表单规则和 page-spec。

#### 组件定义

1. Client Component
2. Props：

```typescript
interface ProductFormProps {
  open: boolean;                    // Sheet 开闭状态
  onOpenChange: (open: boolean) => void;
  product?: ProductItem | null;     // null = 新增模式，有值 = 编辑模式
  onSuccess: () => void;            // 保存成功后的回调（刷新列表）
}
```

3. 组件内部使用 Sheet（`w-[480px]`），右侧滑入

#### 表单字段

| 字段 | 类型 | 必填 | 验证 |
|---|---|---|---|
| 产品编码 | `Input` | ✅ | 非空；编辑时不可修改（code 是唯一标识） |
| 产品名称 | `Input` | ✅ | 非空 |
| 分类 | `Input` | ❌ | 自由文本 |
| 安全库存 | `Input type="number"` | ✅ | ≥0 整数 |
| 单位 | `Input` | ❌ | 默认 `件` |

4. 标签在上方，必填字段标签后红色 `*`
5. 输入框统一 `h-9`
6. 验证错误显示在输入框下方，红色小字
7. 提交按钮在表单底部右对齐

#### 交互逻辑

1. 打开 Sheet：
   - 新增模式：所有字段为空，标题「新增产品」
   - 编辑模式：回填已有数据，标题「编辑产品」，产品编码 disabled
2. 点击「保存」：
   - 前端校验字段 → 不通过则显示错误
   - 通过后调用 `createProduct()` 或 `updateProduct()`
   - 按钮显示 loading
   - 成功 → Toast「产品已保存」→ 关闭 Sheet → 调用 `onSuccess()`
   - 失败 → Toast 显示错误原因（如「产品编码已存在」）
3. 点击「取消」或 Sheet 外部 → 关闭 Sheet（不保存）

### 验收标准

- [ ] 新增模式：Sheet 打开，标题「新增产品」，所有字段为空
- [ ] 编辑模式：Sheet 打开，标题「编辑产品」，字段回填，code 不可修改
- [ ] 编码为空时提交 → 显示错误「请输入产品编码」
- [ ] 安全库存填负数 → 显示错误「安全库存不能为负数」
- [ ] code 重复提交 → Toast 显示服务端错误信息
- [ ] 保存成功 → Sheet 关闭，列表刷新
- [ ] Sheet 宽度 480px，右侧滑入

---

## 1.6 — SKU 管理页 `/dashboard/variants`

| 项目 | 内容 |
|---|---|
| **依赖** | 0.9（Dashboard 布局）+ 1.1（类型）+ 1.2（服务）+ 1.7（SKU 匹配组件） |
| **优先级** | 🟡 核心交付 |
| **涉及文件** | `src/app/dashboard/variants/page.tsx` |

> **注意**：旧目录规划未列出 `/variants` 路径。本计划按 `page-specification.md` 和 `mvp-roadmap.md` 补充该路由。当前路由以真实代码为准，模块边界记录在 `architecture.md`。

### 描述

参考 `docs/page-specification.md` 的 `/variants` 页面规格。

#### 页面结构

```
┌──────────────────────────────────────────────┐
│  页面标题「SKU 管理」                          │
│  mb-4                                         │
│  ┌──────────────────────────────────────┐     │
│  │  筛选：[国家▾] [匹配状态▾]            │     │
│  └──────────────────────────────────────┘     │
│  mb-4                                         │
│  ┌──────────────────────────────────────┐     │
│  │  VariantTable                          │     │
│  │  ┌────┬──────┬────┬────┬──────┬────┐ │     │
│  │  │仓库 │仓库名 │国家 │匹配 │标准  │操作│ │     │
│  │  │SKU │      │    │状态 │产品  │    │ │     │
│  │  ├────┼──────┼────┼────┼──────┼────┤ │     │
│  │  │    │      │    │    │      │    │ │     │
│  │  └────┴──────┴────┴────┴──────┴────┘ │     │
│  │                   [分页器]             │     │
│  └──────────────────────────────────────┘     │
└──────────────────────────────────────────────┘
```

#### A. 页面组件

1. Server Component，调用 `getVariants(filters)`
2. 筛选条件通过 URL search params 传递（`?country=TH&match_status=unmatched`）
3. admin 可匹配/重新匹配，operator 只读

#### B. 筛选栏

1. 国家下拉：`全部` / `TH` / `ID` / `MY` / `PH` / `VN` / `CN`
2. 匹配状态下拉：`全部` / `已匹配` / `未匹配` / `待确认`
3. 选择后即时刷新（修改 URL search params）

#### C. 表格

| 列 | 来源 | 显示规则 |
|---|---|---|
| 仓库 SKU | `product_variant.sku` | 纯文本 |
| 仓库产品名 | `product_variant.name` | 纯文本 |
| 国家 | `product_variant.country` | Badge |
| 匹配状态 | `product_variant.match_status` | Badge（绿=已匹配/红=未匹配/黄=待确认） |
| 标准产品 | `product.name` | 未匹配显示「—」，已匹配显示产品名（可点击跳转） |
| 最后同步 | `product_variant.last_sync_at` | 格式化日期 |
| 操作 | — | admin：匹配（未匹配行）/ 重新匹配（已匹配行）。operator：无操作列 |

#### D. 匹配操作

点击「匹配」→ 弹出下拉/搜索框选择 Product（Command 组件，可搜索已有产品）→ 选择后确认 → 调用 `matchVariant()`
此交互逻辑在 1.7 组件中详细拆解。

#### E. 页面状态

| 状态 | 表现 |
|---|---|
| 空数据 | 「暂无 SKU 数据」 |
| 筛选无结果 | 「无匹配结果的 SKU」 |
| 加载中 | 表格骨架屏 |

### 验收标准

- [ ] 能按国家筛选 SKU
- [ ] 能按匹配状态筛选 SKU
- [ ] 组合筛选正常工作（国家 + 状态）
- [ ] admin 看到操作列（匹配/重新匹配按钮）
- [ ] operator 看不到操作列
- [ ] 分页器正常

---

## 1.7 — SKU 匹配组件

| 项目 | 内容 |
|---|---|
| **依赖** | 1.1（类型）+ 1.2（服务） |
| **优先级** | 🟡 被 1.6 和 1.8 引用 |
| **涉及文件** | `src/features/products/components/sku-matching.tsx` |

> `mvp-roadmap.md` 中称为 `SkuMappingTable`（1.6），旧目录规划中称为 `sku-mapping-table.tsx`，`page-specification.md` 中作为 variants 页面和 unmatched 页面的匹配功能。真实实现统一命名为 `sku-matching.tsx`。

### 描述

#### 组件定义

1. Client Component
2. 提供两种使用方式：

**A. 单行匹配按钮**（在表格操作列中使用）

```
Props:
- variant: ProductVariantItem
- onMatched: () => void
```

交互：点击 → 弹出 Popover/Dialog 内含 Command（可搜索产品列表）→ 选择产品 → 确认 → 调用 `matchVariant()` → Toast「匹配成功」→ `onMatched()`

**B. 批量匹配按钮**（在 unmatched 页面中使用，见 1.8）

```
Props:
- selectedVariantIds: string[]
- onMatched: () => void
```

交互：勾选多行 → 点击「批量匹配」→ 弹出 Command 选择 Product → 确认 → 批量调用 `matchVariant()` → Toast「已匹配 N 个 SKU」

#### Command 组件集成

1. 使用 shadcn/ui 的 `Command` 组件实现可搜索选择
2. 列表数据来自 `getProducts()`，显示 `code - name` 格式
3. 搜索框支持按编码或名称过滤
4. 空结果显示「未找到产品，请先创建产品」

#### 状态处理

| 状态 | 表现 |
|---|---|
| 产品列表加载中 | Command 列表显示 Skeleton |
| 产品列表为空 | 「暂无产品，请先创建产品」 |
| 搜索无结果 | 「未找到匹配的产品」 |
| 匹配中 | 确认按钮 loading |
| 匹配成功 | Toast「已匹配」+ 列表刷新 |
| 匹配失败 | Toast 显示错误 |

### 验收标准

- [ ] 未匹配行点击「匹配」→ 弹出产品选择器
- [ ] 产品选择器可搜索（输入编码或名称过滤）
- [ ] 选择产品后确认 → variant 的 match_status 变为 matched
- [ ] 已匹配行点击「重新匹配」→ 可更换关联产品
- [ ] 批量选择多行 → 批量匹配到一个产品
- [ ] 匹配后表格即时刷新

---

## 1.8 — 待处理 SKU 页 `/dashboard/variants/unmatched`

| 项目 | 内容 |
|---|---|
| **依赖** | 0.9（Dashboard 布局）+ 1.1（类型）+ 1.2（服务）+ 1.7（匹配组件） |
| **优先级** | 🟡 核心交付 |
| **涉及文件** | `src/app/dashboard/variants/unmatched/page.tsx` |

> **注意**：旧目录规划未列出 `/variants/unmatched` 路径。本计划按 `page-specification.md` 补充，当前路由以真实代码为准。

### 描述

参考 `docs/page-specification.md` 的 `/variants/unmatched` 页面规格。

#### 页面结构

```
┌──────────────────────────────────────────────┐
│  ⚠️ 以下 SKU 未匹配到标准产品，               │
│     其库存不参与低库存统计                     │
│  mb-4                                         │
│  ┌──────────────────────────────────────┐     │
│  │  UnmatchedTable                 [批量匹配]│  │
│  │  ┌──┬────┬──────┬────┬──────┬──────┐ │     │
│  │  │☐│仓库 │仓库名 │国家│状态  │操作  │ │     │
│  │  │ │SKU │      │    │      │      │ │     │
│  │  ├──┼────┼──────┼────┼──────┼──────┤ │     │
│  │  │☐│    │      │    │未匹配│[匹配] │ │     │
│  │  └──┴────┴──────┴────┴──────┴──────┘ │     │
│  └──────────────────────────────────────┘     │
└──────────────────────────────────────────────┘
```

#### A. 页面组件

1. Server Component，调用 `getUnmatchedVariants()`
2. admin 可执行匹配；operator 可查看但不可操作
3. 顶部黄色横幅提示（仅在存在未匹配 SKU 时显示）

#### B. 表格

| 列 | 来源 | 显示规则 |
|---|---|---|
| 复选框 | — | admin 可见，用于批量选择 |
| 仓库 SKU | `product_variant.sku` | 纯文本 |
| 仓库产品名 | `product_variant.name` | 纯文本 |
| 国家 | `product_variant.country` | Badge |
| 状态 | `product_variant.match_status` | 红 Badge「未匹配」/ 黄 Badge「待确认」 |
| 抓取时间 | `product_variant.last_sync_at` | 格式化日期 |
| 操作 | — | admin：「匹配」按钮（复用 1.7 单行匹配） |

#### C. 页面状态

| 状态 | 表现 |
|---|---|
| 空数据 | ✅「所有 SKU 已匹配」+ 绿色勾 |
| 加载中 | 表格骨架屏 |
| 批量匹配 | 选中的行高亮 → 点击「批量匹配」→ 产品选择器 |

#### D. 业务规则重申

- 不允许删除未匹配 SKU（同步脚本会重新创建，删除无意义）
- 匹配操作立即生效，该 SKU 的库存从下一轮低库存统计开始参与计算

### 验收标准

- [ ] 有未匹配 SKU 时显示表格 + 黄色横幅
- [ ] 全部已匹配时显示「所有 SKU 已匹配 ✅」
- [ ] 勾选多行 → 点击批量匹配 → 选择产品 → 全部匹配成功
- [ ] operator 登录访问此页面 → 可查看列表，但无匹配和批量操作
- [ ] 没有「删除」按钮
- [ ] 匹配成功后该行从列表消失（因为不再是 unmatched）

---

## 1.9 — 产品模块 Hooks

| 项目 | 内容 |
|---|---|
| **依赖** | 1.1（类型）+ 1.2（服务） |
| **优先级** | 🟡 辅助 1.3, 1.4, 1.6, 1.8 |
| **涉及文件** | `src/features/products/hooks/use-products.ts`、`src/features/products/hooks/use-product-detail.ts` |

### 描述

为 Client Component 提供数据获取 Hook。根据 tech.md 规则，客户端状态使用 `useState` + `useEffect`，不做 SWR/React Query。

#### `useProducts(filters?: ProductFilters)`

```
返回：{ products: ProductItem[], loading: boolean, error: string | null, refetch: () => void }
用途：产品列表页的客户端数据获取（如果页面是 Client Component）
注意：如果 1.3 页面本身就是 Server Component，此 Hook 用于客户端筛选/搜索场景
```

#### `useProductDetail(id: string)`

```
返回：{ product: ProductDetail | null, loading: boolean, error: string | null }
用途：产品详情页的客户端数据获取
```

#### 实现注意

- 数据获取通过 API Route 或 Server Action（不直接在 client hook 中调 Supabase SDK）
- 错误状态包含可读的错误消息
- `refetch` 在匹配/编辑操作后手动触发

### 验收标准

- [ ] `useProducts()` 在组件挂载时自动 fetch
- [ ] filters 变化时自动重新 fetch
- [ ] loading 为 true 时返回 `products: []`
- [ ] error 非 null 时不 crash

---

## 1.10 — 状态标签组件

| 项目 | 内容 |
|---|---|
| **依赖** | 无（纯展示组件） |
| **优先级** | 🟢 可选但推荐提前做 |
| **涉及文件** | `src/features/products/components/match-status-badge.tsx` |

### 描述

虽然 `mvp-roadmap.md` 未单独列出此组件，但 `page-specification.md` 中多个页面需要显示匹配状态和角色标签。为保持一致性，提取为组件。

#### `MatchStatusBadge`

```
Props: { status: 'matched' | 'unmatched' | 'pending' }
显示：绿色 Badge「已匹配」/ 红色 Badge「未匹配」/ 黄色 Badge「待确认」
基于 shadcn/ui Badge 组件
```

### 验收标准

- [ ] 三种状态分别显示正确的中文 + 颜色
- [ ] 作为 Badge 变体，可内联在表格单元格中

---

## 1.11 — 路由连通性验证 + 端到端测试准备

| 项目 | 内容 |
|---|---|
| **依赖** | 1.3~1.10 全部完成 |
| **优先级** | 🟡 确保 Phase 1 交付质量 |

### 描述

不写自动化测试，通过手动走查验证完整流程：

#### 走查路线 A：管理员完整流程

1. 登录管理员账号
2. 进入 `/dashboard/products` — 看到产品列表（初始为空）
3. 点击「新增产品」→ Sheet 打开 → 填写产品编码/名称/分类/安全库存 → 保存
4. 列表出现新产品 → 点击产品名 → 进入详情页
5. 详情页显示基本信息 + 空 SKU 表格 + 空库存表格
6. 返回列表 → 点击编辑 → 修改安全库存 → 保存 → 详情页确认
7. 点击停用 → Dialog 确认 → 产品状态变灰

#### 走查路线 B：Operator 权限验证

1. 登录 operator 账号
2. 进入 `/dashboard/products` — 看到产品列表（只读）
3. 确认无新增/编辑/停用按钮
4. 进入产品详情页 — 能看到信息但无编辑按钮
5. 直接访问 `/dashboard/variants/unmatched` — 可查看列表，但无匹配和批量操作

#### 走查路线 C：SKU 匹配流程

1. 管理员在 Supabase SQL Editor 手动插入一条 unmatchd variant（模拟同步脚本创建）：

```sql
INSERT INTO product_variant (sku, country, name, match_status)
VALUES ('TEST-SKU-001', 'TH', '测试产品（泰国）', 'unmatched');
```

2. 访问 `/dashboard/variants` — 看到新 SKU，状态「未匹配」
3. 访问 `/dashboard/variants/unmatched` — 看到黄色横幅 + 未匹配 SKU
4. 点击「匹配」→ 搜索选择产品 → 确认匹配
5. 该 SKU 从未匹配列表消失，出现在 `/variants` 中状态变为「已匹配」

#### 走查路线 D：错误状态

1. 尝试保存重复的 product.code → Toast 错误提示
2. 安全库存填 -1 → 前端校验拦截
3. 直接访问不存在的 `/dashboard/products/non-existent-uuid` → 404

### 验收标准

- [ ] A 路线全部通过（管理员 CRUD 产品）
- [ ] B 路线全部通过（operator 权限）
- [ ] C 路线全部通过（SKU 匹配）
- [ ] D 路线全部通过（错误状态处理）
- [ ] 无 console 报错（包括 key 警告、hydration 警告）
- [ ] `npm run build` 无错误

---

## Phase 1 完成标志

- 管理员能：新增/编辑/停用产品 ✅
- 管理员能：查看产品详情（含关联 SKU 和库存） ✅
- 管理员能：在 `/variants` 中按条件筛选 SKU ✅
- 管理员能：访问 `/variants/unmatched` 并匹配/批量匹配未匹配 SKU ✅
- Operator 能：查看产品列表、详情、SKU 列表（只读） ✅
- Operator 不能：新增/编辑/停用产品、匹配 SKU ✅
- 所有页面的空/加载/错误/无权限状态正确处理 ✅
- `npm run build` 通过 ✅

---

# 附录

## A. 依赖关系矩阵

```
        0.1  0.2  0.3  0.4  0.5  0.6  0.7  0.8  0.9  0.10
0.1      -    ∥    →    -    -    -    -    -    -    -
0.2      ∥    -    →    →    →    -    -    -    -    →
0.3      ←    ←    -    -    ←    →    →    →    →    -
0.4      -    ←    -    -    -    -    -    -    -    -
0.5      -    ←    -    -    -    -    -    -    -    -
0.6      -    -    ←    -    -    -    -    -    -    -
0.7      -    -    ←    -    -    -    -    ∥    -    -
0.8      -    -    ←    -    -    -    ∥    -    -    -
0.9      -    -    ←    -    -    ←    -    -    -    -
0.10     -    ←    -    -    -    -    -    -    -    -

∥ = 可并行  → = 依赖  ← = 被依赖
```

```
        1.1  1.2  1.3  1.4  1.5  1.6  1.7  1.8  1.9  1.10 1.11
1.1      -    →    →    →    →    →    →    →    →    →    →
1.2      ←    -    →    →    →    →    →    →    →    -    →
1.3      ←    ←    -    ∥    →    -    -    -    -    -    →
1.4      ←    ←    ∥    -    →    -    -    -    -    -    →
1.5      ←    ←    -    -    -    -    -    -    -    -    -
1.6      ←    ←    -    -    -    -    →    -    -    -    →
1.7      ←    ←    -    -    -    ←    -    ←    -    -    -
1.8      ←    ←    -    -    -    -    ←    -    -    -    →
1.9      ←    ←    -    -    -    -    -    -    -    -    -
1.10     -    -    -    -    -    -    -    -    -    -    -
1.11     ←    ←    ←    ←    ←    ←    ←    ←    ←    -    -
```

## B. 实施顺序建议

### 第一轮（Phase 0 基础）

```
Day 1-2:  0.1 (项目初始化) + 0.2 (Supabase 建库)  并行
Day 2:    0.5 (环境变量)
Day 2-3:  0.3 (Supabase 客户端) + 0.4 (类型生成)  可并行
Day 3:    0.6 (中间件) → 0.7 (登录页) + 0.8 (回调) + 0.9 (布局)  顺序
Day 3:    0.10 (创建管理员)
Day 4:    Phase 0 走查验证
```

### 第二轮（Phase 1 核心）

```
Day 4-5:  1.1 (类型) → 1.2 (服务) → 1.5 (表单) + 1.7 (匹配) + 1.10 (标签)
Day 5-6:  1.3 (/products) + 1.4 (/products/[id])
Day 6-7:  1.6 (/variants) + 1.8 (/variants/unmatched)
Day 7:    1.9 (Hooks) — 按需补充
Day 8:    1.11 (走查) → 修复 → Phase 1 完成
```

### 时间估算

| 轮次 | 工作日 | 说明 |
|---|---|---|
| Phase 0 | 3–4 天 | 基础配置为主，blocker 是 Supabase 项目创建等待 |
| Phase 1 | 4–5 天 | 页面开发为主，blocker 是表单和匹配交互的细节 |
| **合计** | **7–9 天** | 一个开发人员的估算 |

## C. 风险与注意事项

| # | 风险/注意 | 应对 |
|---|---|---|
| 1 | 旧目录规划缺少 `/variants` 和 `/variants/unmatched` 路由 | 本计划补充；真实路由以代码为准，架构边界同步到 `architecture.md` |
| 2 | `page-specification.md` 中 Dashboard 列为 Phase 2 | 0.9 中只做空白占位。低库存卡片、在途追踪表格在 Phase 2 实现 |
| 3 | Phase 1 时 `inventory` 表可能为空（同步脚本未就绪） | 产品详情页的库存区显示「暂无库存数据」，不做假数据 |
| 4 | operator 的 `product_variant` UPDATE 策略允许修改 match | 页面规格规定仅 admin 可匹配。进入 SKU 映射开发前，应通过新 Migration 收紧 RLS，并同时保留 Server Action 角色校验。 |
| 5 | 数据库 `sync_log` 的 `new_variants_count` 列在 Phase 1 无用 | 忽略，Phase 5 才用到 |
| 6 | shadcn/ui 的 Command 组件用于可搜索选择 | 确保在 0.1 中已安装。如 Command 组件在最新版 shadcn/ui 中行为有变，用 Dialog + Input + List 替代 |
| 7 | `npm run build` 中的类型错误 | Phase 0 每个子任务完成后都应 `npm run build` 验证，不积压到 Phase 1 |
| 8 | 管理员账号创建需手动 SQL | 在 0.10 中明确操作步骤。第二阶段的 Phase 4 会提供 UI 管理。 |

## D. Phase 1 完成后需要更新的文件

| 文件 | 更新内容 |
|---|---|
| `architecture.md` | 如模块边界发生变化则同步；具体路由和文件以真实代码为准 |
| `mvp-roadmap.md` | 将 Phase 0 和 Phase 1 状态改为 ✅ 已完成 |
| `CLAUDE.md`（项目根目录） | 更新项目状态为「Phase 1 完成，产品主数据可用」 |

## E. non-goals（Phase 0–1 明确不做）

- ❌ 不做任何库存统计功能（Phase 2）
- ❌ 不做在途管理功能（Phase 3）
- ❌ 不做用户管理功能（Phase 4）
- ❌ 不做数据同步功能（Phase 5）
- ❌ 不做 Dashboard 统计卡片和表格（Phase 2）
- ❌ 不做 ECharts 图表（Phase 2 的库存趋势）
- ❌ 不做 `inventory_snapshots` 表（Phase 2 第二阶段）
- ❌ 不写自动化测试（MVP 阶段手动走查）
- ❌ 不做移动端/平板适配（design.md 桌面端专属）
- ❌ 不做 CI/CD 流水线配置（正式部署平台确定后再配）
