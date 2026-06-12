---
description: Shipment 状态流转、在途库存和入仓规则
paths:
  - "src/features/shipments/**/*"
  - "src/app/dashboard/shipments/**/*"
  - "src/app/api/shipments/**/*"
  - "supabase/migrations/**/*shipment*.sql"
---

# Shipment 与在途库存规则

## 状态流转

```text
booking → loading → departed → arrived → customs → warehoused
```

- 状态只能按顺序手动推进，不允许跳过或回退
- 每次状态推进必须创建 tracking_event
- ShipmentItem 关联 ProductVariant

## 在途数量

```text
SUM(quantity - warehoused_quantity)
WHERE shipment.status != 'warehoused'
```

- 全部入仓时：`warehoused_quantity = quantity`
- 部分入仓时：记录实际入仓数，状态保持 `arrived` 或 `customs`
- 完成入仓后增加目标仓库 Inventory，并将 Shipment 标记为 `warehoused`
- Shipment 创建与明细创建必须保持事务性
