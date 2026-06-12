---
description: 库存分类、低库存、安全库存和库存统计规则
paths:
  - "src/features/inventory/**/*"
  - "src/app/dashboard/inventory/**/*"
  - "src/app/api/inventory/**/*"
  - "src/features/dashboard/**/*"
  - "src/app/dashboard/page.tsx"
---

# 库存业务规则

## 库存分类

- 国内库存：国内仓现有库存，V1 手动维护，后续接聚水潭
- 海外库存：五个海外仓现有库存，由页面抓取同步
- 在途库存：已发货但尚未入仓的数量

Inventory 必须关联 ProductVariant，禁止直接关联 Product。

## 海外库存同步数量口径

- BigSeller `available_quantity` 正式映射为 `inventory.quantity`
- `available_quantity` 表示扣除订单锁定后的整仓可用库存
- BigSeller `current_quantity` 与 `locked_quantity` 仅用于校验，不写入 `inventory.quantity`
- Warehouse 正式名称跟随 BigSeller；菲律宾仓正式名称为 `菲律宾-新创启辰自建仓`
- 数据库旧名称 `菲律宾仓` 必须复用原记录并改名，禁止创建第二条菲律宾仓库记录
- 禁止因 BigSeller 仓库显示名称变化自动创建 Warehouse；名称变化必须先审计并明确改名

## 低库存

```text
当前库存 <= Product.safety_stock → 低库存
缺口 = safety_stock - quantity
```

- 低库存按 ProductVariant → Product 映射后参与统计
- 未匹配 ProductVariant 的库存不参与低库存统计
- 每个标准 Product 维护安全库存
- 缺口为正数时显示红色；零或负数显示绿色“正常”

## V1 限制

- `inventory.quantity` 使用覆盖更新，不保留历史快照
- 不为库存趋势功能提前创建 `inventory_snapshots`
