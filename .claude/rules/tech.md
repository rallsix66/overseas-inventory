---
description: TypeScript、Next.js 与应用数据访问规则
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
  - "package.json"
  - "tsconfig.json"
  - "next.config.ts"
---

# 技术规则

## TypeScript

- 使用 TypeScript strict，禁止新增 `.js` 或 `.jsx`
- 禁止使用 `any`；不确定类型使用 `unknown`
- 函数和组件 props 必须具有明确类型
- 数据库类型来自 `src/types/database.ts`
- 模块业务类型放在 `src/features/<module>/types.ts`

## Next.js 16

- 使用 App Router，Server Component 优先
- 仅在需要交互或浏览器 API 时使用 Client Component
- `middleware.ts` 已弃用，后续迁移到 `proxy.ts`

## 组件与状态

- 优先复用现有组件和 shadcn/ui
- 页面组件放在对应 `src/app/` 路由
- 业务组件放在对应模块的 `components/`
- 客户端局部状态使用 React 内置能力
- 跨页面筛选优先使用 URL search params
- 未经确认禁止引入 Redux、Zustand、MobX 等全局状态库

## 云服务隔离

- 当前允许使用 Supabase 与 Vercel/Next.js 生态快速开发
- Supabase、Vercel 等云平台 SDK 应集中在 Repository、Service 或 `src/lib/` 封装中
- 页面、组件与核心业务规则只能依赖项目封装和业务类型
- 简单功能优先复用现有封装；真实迁移或出现多个实现时再抽取 Provider Adapter
- 禁止让供应商专有响应结构穿透到页面或业务公共契约
