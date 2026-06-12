---
description: Product 与 ProductVariant 双层模型、SKU 映射规则
paths:
  - "src/features/products/**/*"
  - "src/features/variants/**/*"
  - "src/app/dashboard/products/**/*"
  - "src/app/dashboard/variants/**/*"
  - "src/app/api/products/**/*"
---

# Product 与 ProductVariant 规则

## 核心模型

不同国家仓库的 SKU、产品名称和版本可能不同，必须保持：

```text
Product（标准产品）
  → ProductVariant（各国家仓库 SKU）
```

- Product 保存统一产品编码、名称、安全库存、分类和单位
- ProductVariant 保留仓库原始 SKU、名称和国家
- 一个 Product 可以关联多个 ProductVariant
- 禁止使用 SKU 作为全局产品主键
- 禁止删除 ProductVariant 双层模型

## SKU 映射

允许的 `match_status`：

| 数据库值 | 中文显示 | 说明 |
|---|---|---|
| `matched` | 已匹配 | 已关联标准产品 |
| `unmatched` | 未匹配 | 尚未关联标准产品 |
| `pending` | 待确认 | 存在建议但需管理员确认 |

- 数据库存储英文状态，前端展示中文
- 新发现的 SKU 自动创建 ProductVariant，并进入待处理列表
- 映射由管理员确认，不自动推断
- 不允许删除未匹配 SKU，同步过程可能重新创建
- 匹配操作设置 `product_id` 并将状态改为 `matched`
- 待处理列表包含 `unmatched` 和 `pending`

## 权限

- Admin 可以创建、编辑、启停 Product 和执行 SKU 映射
- Operator 只读 Product 和 ProductVariant
- 写操作必须经过 Server Action 权限校验和 RLS
