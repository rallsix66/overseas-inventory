---
description: 文件放置、模块边界与目录命名规则
paths:
  - "src/**/*"
---

# 文件与模块结构规则

## 业务模块

```text
src/features/<module>/
├── types.ts
├── schema.ts
├── repository.ts
├── actions.ts
├── columns.tsx
└── components/
```

- 页面放在 `src/app/dashboard/<route>/`
- 模块业务组件放在 `src/features/<module>/components/`
- 业务模块通过 Repository / Service 封装访问云能力
- Server Actions 放在模块 `actions.ts`
- Zod Schema 放在模块 `schema.ts`
- 模块类型放在模块 `types.ts`

## 共享代码

- 通用 UI 使用 `src/components/ui/`
- Supabase 客户端和共享封装放在 `src/lib/supabase/`
- 需要正式多供应商适配时，再创建 `src/lib/providers/<provider>/`
- 全局工具放在 `src/lib/`
- 跨模块共享类型放在 `src/types/common.ts`
- 数据库生成类型放在 `src/types/database.ts`

## 模块边界

- 禁止跨模块直接引用业务组件
- 跨模块可以共享稳定类型
- 跨模块业务操作通过 Server Action 或明确的公共接口完成
- 新文件优先遵循真实代码中的现有模式
- 页面、组件和核心业务逻辑禁止直接依赖 Supabase、Vercel 或其他云平台 SDK
- 数据库、认证、对象存储和同步任务必须保留可替换接口
- Repository 与 `src/lib/` 内允许使用当前供应商 SDK，不要求为简单功能提前创建复杂 Adapter

## 命名限制

- 文件和目录使用 kebab-case
- 禁止创建 `temp`、`tmp`、`backup`、`deprecated`
- 禁止创建 `_v2`、`_new`、`_old` 等版本目录
- 无法明确文件归属时，先确认再创建
