# Current Task Packet

## Task ID

`P3-S1B` — 百世 API Client、签名与 Dry Run 拉取

## 状态

**REWORK**（2026-06-28，独立验收未通过）

## 背景

P3-S1A 数据模型已就绪，Migration 00017 已于 2026-06-28 由用户在 Supabase SQL Editor 成功执行。`shipment_external_ref` / `shipment_external_item` / `tracking_event_external`（路径 B）三张表已存在于生产数据库。

P3-S1B 是 Phase 3 的第二个任务，负责实现百世开放平台只读 API Client。百世是首个有 API 的外部在途数据供应商。

**允许**：`src/lib/providers/best/` 模块（API Client + MD5 签名 + queryOrderInfoByOrderNo + 物流轨迹查询 + Dry Run 入口）、单元测试（fake credentials + mock fetch）。

**禁止**：Migration、Repository、Server Action、UI 页面/组件、库存联动、写 DIS 数据库、百世写接口、P3-S1C 范围。

## 范围

### 1. 环境变量读取

从 `process.env` 读取三个环境变量，缺失时 fail-fast：

- `BEST_OPEN_BASE_URL` — 百世开放平台 API 基础 URL
- `BEST_OPEN_PARTNER_ID` — 百世开放平台合作商 ID
- `BEST_OPEN_SECRET` — 百世开放平台签名密钥

### 2. MD5 签名

按百世开放平台签名规范实现：

- 稳定的 JSON 序列化（sorted keys）：`bizData` 参数先转为确定性的 JSON 字符串。
- `sign = MD5(bizDataJson + secret)`
- 使用 Node.js `crypto.createHash('md5')`。

### 3. API Client 封装

`src/lib/providers/best/client.ts`：

- POST 请求到 `BEST_OPEN_BASE_URL`。
- 请求体：`{ partnerID: string, bizData: string, sign: string }`，其中 `bizData` 为稳定 JSON。
- 超时控制（可配置，默认 30s）。
- HTTP 错误 → typed error。
- 百世业务错误（response code ≠ success）→ typed error。
- 非法 JSON 响应 → typed error。
- 结构异常 / 空结果 → typed error。

### 4. queryOrderInfoByOrderNo

按运单号或订单号查询运单信息：

- 输入：`orderNo` / `waybillNo`（至少一个）。
- 输出：类型化的查询结果（仅 best 私有模块内可见，外层按 unknown 处理）。

### 5. 物流轨迹查询

按运单号查询物流轨迹：

- 输入：`waybillNo`。
- 输出：类型化的轨迹列表（仅 best 私有模块内可见）。

### 6. Dry Run 入口

`src/lib/providers/best/dry-run.ts`：

- 调用 queryOrderInfoByOrderNo，解析响应。
- 调用物流轨迹查询，解析响应。
- 将原始响应按 `unknown` 或 `Record<string, unknown>` 处理。
- 通过 Zod/显式解析转换为结构化 Dry Run 结果。
- 返回 `BestDryRunResult`（仅 best 私有模块内可见）。
- **不写任何 DIS 数据库表**。

### 7. 安全红线

- 日志、错误消息、测试快照、文档不含 secret、签名原文或真实凭证。
- 测试全部使用假凭证和 mock fetch。
- `.env.example` 新增三行空白占位（不含真实值）。

### 8. 测试覆盖

- 稳定 JSON 序列化（sorted keys）。
- 固定输入的签名结果。
- 请求参数结构（partnerID / bizData / sign）。
- 请求方法为 POST。
- 超时与网络错误传播。
- HTTP 错误（4xx/5xx）传播。
- 百世业务错误（非成功 code）传播。
- 非法 JSON 响应处理。
- 结构异常处理。
- 空结果处理。
- 分页边界处理。
- 凭证缺失时 fail-fast。
- 全部测试使用假凭证和 mock fetch，不访问真实服务。

## 不在范围内

- 不新增或修改 Migration。
- 不实现 Repository、Server Action 或 UI。
- 不写 `shipment_external_ref`、`shipment_external_item`、`tracking_event_external`。
- 不修改 `inventory`。
- 不下单、不做送货预报、不调用任何百世写接口。
- 不提前实施 P3-S1C。

## 停止条件

1. `src/lib/providers/best/` 模块就绪（types.ts / signature.ts / client.ts / dry-run.ts / index.ts + 测试文件）。
2. MD5 签名算法正确（固定输入断言固定输出）。
3. `queryOrderInfoByOrderNo` 与物流轨迹查询均可调用并返回结构化数据（mock fetch）。
4. Dry Run 入口可完整执行 fake 数据拉取 → 解析 → 返回结构化结果。
5. 所有测试使用假凭证和 mock fetch。
6. 日志、错误、测试快照不含 secret 或签名原文。
7. `npm run test` 所有测试通过（不破坏现有测试）。
8. `npm run lint` 0 errors。
9. `npm run build` 通过。
10. 不写 DIS 数据库。

**P3-S1B 完成后停止，等待 Codex 独立验收，不自动进入 P3-S1C。**

## 依赖

- P3-S1A DONE（Migration 00017 已在生产数据库执行）
- 百世开放平台 API 文档（签名规范：MD5(bizData + secret)）
- Node.js crypto 模块（内建，无需额外依赖）

## 风险

1. **百世 API 响应结构不确定**：当前仅从文档推断响应结构。真实 Dry Run 可能发现文档与实际响应差异，需记录为技术债务。
2. **分页机制未知**：百世 API 分页参数在真实调用前无法确定，先预留接口。
3. **物流轨迹接口独立**：与 queryOrderInfoByOrderNo 可能返回不同格式，需分别处理。
4. **签名规范严格性**：JSON 序列化必须稳定（sorted keys），任何空白字符差异都会导致签名失败。
