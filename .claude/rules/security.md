---
description: 密钥、认证授权、输入校验与数据库安全规则
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
  - "supabase/migrations/**/*.sql"
  - ".env.example"
  - "next.config.ts"
---

# 安全规则

## 密钥

- `SUPABASE_SERVICE_ROLE_KEY`、数据库连接和第三方秘密密钥仅限服务端
- 前端仅允许使用 Supabase anon key
- 秘密密钥禁止使用 `NEXT_PUBLIC_` 前缀
- `.env.local` 不提交 Git，`.env.example` 不包含真实值
- 禁止在日志、错误响应或客户端代码中暴露秘密
- service role 仅用于受控服务端同步任务，禁止用于普通前端或业务页面

## 认证与授权

- 受保护路由必须校验登录状态
- Server Action 和 Route Handler 必须自行校验身份、启用状态和角色
- 客户端隐藏按钮只用于 UX，不构成安全边界
- 管理类操作必须要求 Admin
- 权限必须由应用层校验和 Supabase RLS 双重保障

## 输入与输出

- 所有外部输入使用 Zod 校验，包括 URL 参数和 Server Action 参数
- 数量和安全库存不得为负数
- 禁止直接渲染未经清洗的外部 HTML
- Production 错误不得暴露密钥、堆栈或内部系统细节

## 数据库

- 所有业务表必须启用 RLS
- 数据库结构变更必须新增 Migration
- 禁止修改已执行 Migration 或手动修改生产数据库
- 禁止字符串拼接 SQL
- 新增表或权限能力时必须同时审查 RLS

## 敏感操作

- 危险或不可逆操作必须提供明确确认
- 批量操作必须展示影响范围
- 新增 Server Action 或 Route Handler 时必须声明并校验所需角色
