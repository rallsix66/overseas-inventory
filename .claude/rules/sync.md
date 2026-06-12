---
description: 海外仓库存同步、异常处理和 SyncLog 规则
paths:
  - "src/features/sync/**/*"
  - "src/app/dashboard/sync/**/*"
  - "src/app/api/sync/**/*"
  - "scripts/**/*sync*"
---

# 数据同步规则

- 海外仓库存通过页面抓取同步
- 同一仓库同一 SKU 以最新同步结果为准
- 同步写入 Inventory 时覆盖 quantity
- 新 SKU 自动创建 ProductVariant，状态为 `unmatched`
- 同步失败时保留上次成功库存，不覆盖为错误数据
- 同步失败必须记录错误原因和起止时间
- `sync_log` 记录仓库、状态、新 SKU 数量、错误和时间
- 管理员可以手动触发重新同步
- 同步脚本可在服务端使用 service role，禁止向客户端暴露
