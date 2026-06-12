---
description: Dashboard 首页统计和展示规则
paths:
  - "src/app/dashboard/page.tsx"
  - "src/app/dashboard/_components/**/*"
  - "src/features/dashboard/**/*"
---

# Dashboard 业务规则

- 首页目标是让运营快速识别低库存和在途状态
- 顶部展示海外低库存、国内低库存、在途数量三项指标
- 下方使用表格展示缺货清单和在途追踪
- 低库存统计必须通过 ProductVariant 映射到 Product
- 未匹配 ProductVariant 不参与低库存统计
- 在途数量使用 `quantity - warehoused_quantity`
- `warehoused` 状态 Shipment 不出现在在途列表
- 存在未匹配 SKU 时显示统计可能不准确的提示
- 首页只负责展示和跳转，不直接访问 Supabase
- 具体字段和页面状态以 `docs/page-specification.md` 为准
