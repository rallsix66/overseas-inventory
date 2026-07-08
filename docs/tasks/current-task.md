# Current Task Packet

## Task ID

`NEXTJS16-PROXY-MIGRATION` — `middleware.ts` 迁移至 `proxy.ts`

## 状态

**DONE**（2026-07-08）。

## 功能概述

将 `src/middleware.ts` 迁移到 Next.js 16 推荐的 `src/proxy.ts`，消除 middleware deprecation warning，保持现有登录拦截和 Supabase session 刷新行为完全不变。

## 核心设计

### 迁移策略

手动迁移（不使用 codemod），保持完全控制：

1. 创建 `src/proxy.ts`，函数 `middleware` → `proxy`，其余完全不变
2. 删除 `src/middleware.ts`
3. 更新 `src/lib/supabase/middleware.ts` 和 `server.ts` 中的注释
4. 新增结构测试覆盖 proxy 存在、matcher 完整、认证逻辑未丢失

### Proxy 文件

`src/proxy.ts`：

- `export async function proxy(request: NextRequest)` 替代 `middleware`
- `return updateSession(request)` 调用不变
- `config.matcher: ['/dashboard/:path*', '/auth/login']` 不变

### updateSession 逻辑

`src/lib/supabase/middleware.ts` 中的 `updateSession()` 完全不变：

- `createServerClient` + cookies `getAll`/`setAll` session 刷新
- `supabase.auth.getUser()` 获取当前用户
- 未登录 `/dashboard/*` → redirect `/auth/login?redirect=...`
- 已登录 `/auth/login` → redirect `/dashboard`

## 修改文件清单

| # | 文件 | 变更 |
|---|------|------|
| 1 | `src/proxy.ts` | 新增：`middleware.ts` → `proxy.ts`，函数 `middleware` → `proxy` |
| 2 | `src/middleware.ts` | 删除：已迁移至 `proxy.ts` |
| 3 | `src/lib/supabase/middleware.ts` | 修改：注释"用于 Next.js middleware.ts"→"用于 Next.js proxy.ts" |
| 4 | `src/lib/supabase/server.ts` | 修改：注释"在 middleware 或 route handler"→"在 proxy 或 route handler" |
| 5 | `src/proxy.test.ts` | 新增：21 项测试 |
| 6 | `docs/current-state.md` | 更新 Phase / Task / Completed Tasks / Authentication / Deferred / Technical Debt |
| 7 | `docs/tasks/current-task.md` | 本文件（NEXTJS16-PROXY-MIGRATION 任务包） |
| 8 | `docs/architecture.md` | 更新认证层描述 + 移除旧迁移注释 |

## 未修改

- 登录页面 UI
- 认证业务语义
- 数据库、Migration、RPC、RLS
- 同步真实写入逻辑
- 国内库存页面

## 测试

`src/proxy.test.ts` — 21 项测试

| # | 类别 | 测试数 |
|---|------|--------|
| 1 | 文件存在性（proxy.ts 存在 / middleware.ts 已删除） | 2 |
| 2 | proxy.ts 导出（函数名 proxy / config / named export） | 3 |
| 3 | matcher 配置（/dashboard/:path* / /auth/login / 数组 / 数量=2） | 4 |
| 4 | 认证保护逻辑（import updateSession / 调用 updateSession / NextRequest 签名） | 3 |
| 5 | updateSession 逻辑完整性（getUser / 未登录重定向 / 已登录重定向 / cookie / 注释） | 5 |
| 6 | server.ts 注释更新 | 1 |
| 7 | 架构合规（无直接 supabase / 无 service_role / 无 Migration/RLS） | 3 |
| **Total** | | **21** |

## 验收

| 检查项 | 结果 |
|--------|------|
| `npm run test -- proxy.test.ts` | 21/21 ✅ |
| `npm run test`（全量非并发） | 3018/3019 ✅（1 预存失败：WEBSYNC_REAL_WRITE_ENABLED=true） |
| `npm run build` | Turbopack ✓ 通过，middleware deprecation warning **已消失** ✅ |
| `npm run lint` | **0 errors** / 25 warnings（均为既有）✅ |
| `git diff --check` | 通过（仅 LF/CRLF warning）✅ |

## 功能验证

| 场景 | 预期 | 验证方式 |
|------|------|----------|
| `/dashboard` 未登录 | 重定向 `/auth/login?redirect=...` | proxy.ts → updateSession 逻辑不变 |
| `/dashboard` 已登录 | 正常放行 | proxy.ts → updateSession 逻辑不变 |
| `/auth/login` 已登录 | 重定向 `/dashboard` | proxy.ts → updateSession 逻辑不变 |
| 退出登录后访问 `/dashboard` | 重定向 `/auth/login` | proxy.ts → updateSession 逻辑不变 |
| Session cookie 刷新 | Supabase SSR cookie 自动刷新 | createServerClient + cookies 逻辑不变 |

## middleware.ts 删除原因

Next.js 16 中 `middleware.ts` 文件约定已弃用并重命名为 `proxy.ts`。保留 `middleware.ts` 会导致 build 输出 deprecation warning。删除后 `build` 中 middleware deprecation warning 完全消失。

## 下一步

可选择推进新 Phase 或 P3-S1B 恢复（百世 API，仍在 BLOCKED_EXTERNAL 状态）。
