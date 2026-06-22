# P5-SY6 — 定时任务与运行环境评估

> 状态：DONE（Codex 第三次独立设计验收通过，2026-06-19）
>
> 依赖：P5-SY5G（DONE，Codex 独立复验通过）

## 1. 问题陈述

当前海外库存同步存在两条路径：

- **真实生产路径**：Python CLI（`tools/bigseller-scraper/sync/cli_execute.py`）— 手动执行 BigSeller 抓取 + Supabase 写入（P5-SY3B 已验证，含 claim/execute/release 生命周期）
- **Web UI 路径**：`/dashboard/sync` 页面 → Server Action → SyncService — 当前使用 MockRepository / MockArtifactProvider / MockSyncRunner，**不是生产真实同步**

本评估回答：是否应引入定时/自动触发？如应，选什么运行时？如何让 Web UI 路径或定时路径接入真实同步能力？在多大复杂度/成本下达到准生产可用？

## 2. 现有架构约束

```
┌─────────────────────────────────────────────────┐
│  Vercel / Next.js 16                              │
│  ├─ Sync UI (page.tsx)                            │
│  ├─ Server Actions (server-actions.ts)            │
│  ├─ SyncService (sync-service.ts)                 │
│  │   ├─ claim_sync_run RPC (FOR UPDATE 行锁)      │
│  │   ├─ ArtifactProvider (store/load/GC)          │
│  │   ├─ SyncRunner (execute dry_run/real_write)   │
│  │   └─ release_sync_run RPC                      │
│  └─ Route Handlers (可新增)                       │
├─────────────────────────────────────────────────┤
│  Supabase (Singapore)                             │
│  ├─ PostgreSQL + RLS                              │
│  ├─ sync_run / sync_warehouse_lock 表             │
│  ├─ claim/release/heartbeat/cleanup RPC (SECURITY DEFINER) │
│  └─ Migration 00001–00005 已执行                  │
│      Migration 00006–00008 未执行（仅本地测试）   │
├─────────────────────────────────────────────────┤
│  tools/bigseller-scraper/ (Python + Playwright)   │
│  ├─ 抓取 BigSeller 页面 → JSON                    │
│  ├─ 需要真实浏览器（Chromium）                    │
│  ├─ 当前手动执行：py cli_execute.py               │
│  └─ 部署位置：开发机本地                          │
└─────────────────────────────────────────────────┘
```

### 强制不可绕过的边界

| 边界 | 说明 |
|------|------|
| Repository / Server Actions / RLS | 数据库写操作必须经过此链路 |
| SyncService claim/execute/release | 同步生命周期编排由 SyncService 控制 |
| service_role | 仅限 `src/lib/supabase/server.ts` 的 `createServiceClient()`，编译器级 + 运行时双重禁止前端调用 |
| SUPABASE_SERVICE_ROLE_KEY | 仅存在于 `.env.local`，不提交 Git；禁止暴露到 Worker 或外部执行器 |
| FOR UPDATE 行锁 + advisory lock | claim_sync_run 并发保护（Migration 00008 已通过本地 PG 测试） |

### 强制架构规则（P5-SY6 新增）

**所有同步写操作（claim / release / artifact store / sync_log）必须由 Route Handler / SyncService 端（Next.js 服务端）完成。Worker 只能作为无状态外部执行器，由 WorkerSyncRunner.execute() 触发。**

```
正确路径（推荐）：
  Route Handler → SyncService.claim()
    → ArtifactProvider.store(input)
    → WorkerSyncRunner.execute() → HTTP → Worker 抓取 → 返回 result
    → ArtifactProvider.store(plan)
    → SyncService.release(completed/failed)

错误路径（不推荐/违反边界）：
  Worker 直接持有 SUPABASE_SERVICE_ROLE_KEY
  Worker 直接调用 Supabase RPC claim/release
  Worker 直接写入 sync_run / sync_log / inventory
```

**Worker 不持有 SUPABASE_SERVICE_ROLE_KEY，不直接 claim/release，不直接写 sync_run/sync_log。**

### 同步流程关键路径

```
1. 抓取 BigSeller 页面 → 生成 JSON（Playwright，需浏览器）
2. prepare input artifact → SHA-256 hash（在 Route Handler 端完成）
3. claim_sync_run(p_run_id, ...) → 原子获取仓库锁（在 Route Handler 端完成）
4. store artifact → ArtifactProvider（在 Route Handler 端完成）
5. WorkerSyncRunner.execute() → HTTP → Worker 抓取 → 返回结果 → 验证 → 写后核对
6. release_sync_run(completed/failed) → 释放锁 + 写 sync_log（在 Route Handler 端完成）
```

步骤 1 当前仅能由 Python + Playwright 完成，无法在 Vercel serverless 或 Supabase Edge Function 中运行。

## 3. 候选方案评估

### 3.1 Vercel Cron Jobs

**机制**：`vercel.json` 定义 cron → 按 schedule 调用指定 Route Handler。

```json
{
  "crons": [
    {
      "path": "/api/cron/sync",
      "schedule": "0 */4 * * *"
    }
  ]
}
```

| 维度 | 评估 |
|------|------|
| 触发可靠性 | ✅ Vercel 原生支持，all plans 可用；Hobby: 100 cron jobs、once per day、hourly precision |
| 执行时长 | ⚠️ Vercel Functions: Hobby 最大 300s, Pro 默认 300s / 最大 800s；BigSeller 抓取 2 页约 15-30s |
| 浏览器环境 | ❌ Serverless 函数无 Chromium；Playwright 无法运行 |
| 密钥存储 | ✅ Vercel Environment Variables |
| service_role 使用 | ✅ Route Handler 内安全（服务端） |
| RLS 边界 | ✅ 通过 SyncService 调用，路径完整 |
| 并发锁 | ✅ claim_sync_run RPC 已通过 PG 双事务并发测试 |
| 失败重试 | ⚠️ 需应用层自实现或待官方能力确认；不视为已确认内置重试 |
| 日志脱敏 | ✅ Vercel Logs，需确保不 log 密钥 |
| 部署复杂度 | ✅ 零额外部署，与 Next.js 同仓库 |
| 免费额度 | ⚠️ Hobby: 100 cron jobs、once per day、hourly precision |
| 成本 | Pro $20/月（如需更小粒度 + 更多 cron） |

**结论**：Vercel Cron 本身可用作**调度触发器**，但不能直接执行 BigSeller 抓取（缺少 Chromium）。适合作为编排层：cron → Route Handler → 触发外部 Worker → 等待结果 → release。调度触发本身 <5s，不超任何 Functions tier timeout。

### 3.2 Supabase Edge Functions / pg_cron

**机制**：
- `pg_cron`：PostgreSQL 扩展，在数据库内运行定时任务
- Edge Functions：Deno 运行时，可通过 cron 触发

| 维度 | 评估 |
|------|------|
| 触发可靠性 | ✅ pg_cron 数据库级，不依赖外部调度器 |
| 执行时长 | ⚠️ Edge Functions: Free 150s wall-clock / CPU 2s / idle timeout 150s；Paid 400s wall-clock |
| 浏览器环境 | ❌ Deno 无 Chromium；Playwright 不支持 |
| 密钥存储 | ✅ Supabase Vault / Edge Function secrets |
| service_role 使用 | ✅ DB 函数内可直接使用（SECURITY DEFINER） |
| RLS 边界 | ✅ 可通过 RPC 调用（pg_net 或 direct） |
| 并发锁 | ✅ 与 claim_sync_run RPC 同数据库，锁竞争更可控 |
| 失败重试 | ⚠️ pg_cron 无内置重试；需自行实现 |
| 日志脱敏 | ✅ Supabase Logs（PG Audit、Edge Function logs） |
| 部署复杂度 | ⚠️ 需管理 Edge Function 代码 + migration |
| 免费额度 | ❌ pg_cron 仅 Pro/Team 及以上可用 |
| 成本 | Pro $25/月（含 pg_cron + Edge Functions） |

**结论**：pg_cron 适合纯粹的数据库维护任务（如 `cleanup_expired_sync_runs`），但不适合触发需要浏览器的 Python 抓取器。Edge Functions 同样缺少 Chromium。

### 3.3 GitHub Actions

**机制**：`.github/workflows/sync.yml` + `schedule` 或 `workflow_dispatch`

```yaml
on:
  schedule:
    - cron: '0 */4 * * *'
  workflow_dispatch:
```

| 维度 | 评估 |
|------|------|
| 触发可靠性 | ⚠️ 公开仓库免费；schedule 在低活跃期可能延迟；60 天无仓库活动自动禁用 schedule；最短 5 分钟间隔 |
| 执行时长 | ✅ 6 小时 max（private repo 含额度限制） |
| 浏览器环境 | ✅ 可安装 Python + Playwright + Chromium |
| 密钥存储 | ✅ GitHub Secrets（SUPABASE_SERVICE_ROLE_KEY 等） |
| service_role 使用 | ❌ 如 Worker 直连 Supabase → 违反强制架构；如按推荐路径 Worker 不持有 service_role key |
| RLS 边界 | ❌ 如 Worker 直连 Supabase → 绕过 Repository/Server Actions/SyncService；按推荐路径不绕过 |
| 并发锁 | ❌ 如 Worker 直连 → 需在 Python 侧重复实现 claim（当前 executor 无 PG 双事务并发测试验证）；按推荐路径由 Route Handler 端 RPC 完成 |
| 失败重试 | ⚠️ workflow rerun 手动；GHA 无内置 schedule 重试；schedule 可能被 GitHub 静默丢弃 |
| 日志脱敏 | ⚠️ GitHub Actions logs 默认公开（public repo）；需确保不 echo 密钥 |
| 部署复杂度 | ✅ 零额外部署（GitHub 内置） |
| 免费额度 | ✅ 公开仓库无限；私有 2,000 min/month |
| 成本 | 公开仓库 $0；私有 $0（2,000 min 内） |
| 网络可达性 | ⚠️ GitHub Actions runners（US/EU）→ BigSeller（推测国内/东南亚）；可能网络限制 |

**结论**：GitHub Actions 是唯一能**零成本**运行 Playwright + Python 抓取器的托管方案。但存在四个核心问题：(1) 如 Worker 直连 Supabase → 直接绕过 Next.js 的 Repository/Server Actions/SyncService 强制边界（不推荐）；(2) network 可能无法稳定访问 BigSeller；(3) schedule 有延迟/丢弃/60 天无活动禁用风险；(4) 如按正确路径仅作为执行器 → 需要 Route Handler 端控制整个 claim/artifact/runner/release 生命周期（额外复杂度）。**仅列为备选，不作为中期推荐路径。**

### 3.4 独立 VPS / 容器

**机制**：小型 VPS（AWS Lightsail / Vultr / 阿里云 ECS）+ cron/systemd timer。

| 维度 | 评估 |
|------|------|
| 触发可靠性 | ✅ cron/systemd timer，操作系统级 |
| 执行时长 | ✅ 无限制 |
| 浏览器环境 | ✅ 可安装完整 Chromium |
| 密钥存储 | ⚠️ 需自行管理（`.env` 文件 + 文件权限） |
| service_role 使用 | ⚠️ 密钥存储在 VPS 文件系统中，需要 OS 级安全 |
| RLS 边界 | ❌ 直接调用 Supabase REST API + service_role → 完全绕过 Repository/Server Actions/SyncService |
| 并发锁 | ⚠️ 需在 Python 侧实现（当前 executor 无 claim，直接写入） |
| 失败重试 | ⚠️ 需自行实现 |
| 日志脱敏 | ⚠️ 需自行实现日志轮转和脱敏 |
| 部署复杂度 | ❌ 需要管理 OS/依赖/安全补丁/网络/监控 |
| 成本 | ~$3-6/month（Lightsail / Vultr 最低配）；阿里云 ECS 类似 |
| 网络可达性 | ✅ 可选新加坡/香港/马尼拉节点，靠近 BigSeller |

**结论**：最灵活但运维成本最高。适合生产环境长期方案，但当前阶段过度。

### 3.5 保持手动执行（现状）

**两条手动路径现状：**

| | Python CLI 生产路径 | Web UI 路径 |
|---|---|---|
| 触发方式 | `py cli_execute.py` 终端执行 | `/dashboard/sync` 页面点击 |
| 抓取器 | 真实 Playwright + BigSeller | N/A（MockInputArtifactSource 返回空 rows） |
| Repository | 真实 `supabase_gateway.py` 只读 | MockRepository（内存） |
| ArtifactProvider | N/A（CLI 不通过 SyncService） | MockArtifactProvider（内存） |
| SyncRunner | Executor 直接写 Supabase | MockSyncRunner（模拟） |
| service_role | ✅ CLI 持有 | ✅ Server Action 持有 |
| 生产可用 | ✅ P5-SY3B 已验证 91 Variants + 91 Inventory | ❌ Mock 流程，不产生真实数据 |

**Web UI 路径要成为生产真实入口，需要后续任务补齐：真实 Repository / ArtifactProvider / SyncRunner / InputArtifactSource 接入（见 §8 拆分建议）。**

| 维度 | 评估 |
|------|------|
| 生产功能完整 | ✅ Python CLI 路径已验证（P5-SY3B） |
| Mock 功能完整 | ✅ Web UI Mock 流程已验证（P5-SY5F） |
| 架构边界差异 | ⚠️ 两条路径当前不是同一条生产架构边界：Python CLI 经 executor → Supabase gateway → RPC → DB 约束，不经过 Next.js Server Actions / SyncService；Web UI Mock 经 Server Actions → SyncService → MockRepository/MockArtifactProvider/MockSyncRunner，不产生真实写入 |
| 统一生产入口 | ❌ 待 P5-SY6F 接入真实 Repository / ArtifactProvider / SyncRunner / InputArtifactSource，使 Web UI / 定时路径收敛到同一生产架构 |
| 运维成本 | ✅ 零 |
| 人员依赖 | ❌ 均需管理员手动操作（终端或页面） |

## 4. 综合对比

| 维度 | Vercel Cron | Supabase Cron | GitHub Actions | VPS/容器 | 手动 (CLI) |
|------|:-----------:|:-------------:|:--------------:|:--------:|:--------:|
| 可运行 Playwright 抓取 | ❌ | ❌ | ✅ | ✅ | ✅ |
| 经过 Server Actions 边界 | ✅ | ⚠️ | ❌ 绕过 | ❌ 绕过 | ❌ 不经过 |
| 经过 SyncService 编排 | ✅ | ⚠️ | ❌ 绕过 | ❌ 绕过 | ❌ 不经过 |
| Worker 不持有 service_role | ✅ | N/A | ⚠️ 需约束 | ⚠️ 需约束 | ✅ |
| 零额外部署 | ✅ | ⚠️ | ✅ | ❌ | ✅ |
| 执行时长足够 | ⚠️ 300s/800s | ⚠️ 150s/400s | ✅ 6h | ✅ ∞ | ✅ |
| 免费可用 | ⚠️ once/day | ❌ Pro 付费 | ✅ 公开仓库 | ❌ 付费 | ✅ |
| 并发锁完整 | ✅ claim RPC | ✅ claim RPC | ❌ 需重复实现 | ❌ 需重复实现 | ✅ claim RPC |
| 失败重试 | ⚠️ 需自实现 | ⚠️ 需自实现 | ⚠️ 无内置 | ⚠️ 需自实现 | 手动 |
| 日志脱敏 | ✅ | ✅ | ⚠️ | ⚠️ | N/A |

## 5. 推荐路线

### 短期（Phase 5 MVP，即当前阶段）

**保持 Python CLI 手动执行**。当前存在两条手动路径：

- **生产可用路径**：Python CLI（`cli_execute.py`）— P5-SY3B 已验证 91 Variants + 91 Inventory，含完整 claim/execute/release 生命周期
- **Mock 验收路径**：Web UI（`/dashboard/sync`）— MockRepository/MockArtifactProvider/MockSyncRunner，用于端到端流程验证，不产生真实数据

**Web UI 路径要成为生产真实手动入口，需要后续任务补齐：真实 Repository / ArtifactProvider / SyncRunner / InputArtifactSource 接入。** 无需定时需求压力前，不引入调度复杂度。

### 中期（Phase 5 闭环后，准生产）

**推荐：Vercel Cron（调度层）+ 专用 Worker（执行层），Route Handler / SyncService 拥有完整生命周期**

```
Vercel Cron
  │
  └─ GET /api/cron/sync?warehouse=PH
       │
       ├─ 1. Route Handler 验证 API key
       ├─ 2. SyncService.claim()      ← claim_sync_run RPC（FOR UPDATE 行锁）
       ├─ 3. ArtifactProvider.store(input)
       ├─ 4. WorkerSyncRunner.execute()
       │      └─ HTTP POST → Worker → Python + Playwright 抓取 BigSeller
       │                     Worker 返回 raw result（不写数据库）
       ├─ 5. prepare plan artifact → ArtifactProvider.store(plan)
       └─ 6. SyncService.release(completed/failed) ← release_sync_run RPC
```

**Worker 不持有 SUPABASE_SERVICE_ROLE_KEY。Worker 不调用 Supabase RPC。Worker 不写 sync_run / sync_log / inventory。**

**关键决策理由**：

1. **Route Handler 端拥有完整生命周期**：
   - claim / artifact store / runner execute / release 全部在 Next.js 服务端完成
   - Worker 只是 WorkerSyncRunner 的外部执行后端（类似子进程），返回抓取结果后由 SyncService 完成写操作
   - claim/release 经 RPC，FOR UPDATE 行锁 + advisory lock 完整保护

2. **Vercel Cron 作为调度层**：
   - 与 Next.js 同仓库、同部署、零额外运维
   - 调度触发 <5s（仅发 HTTP 请求），不超任何 Functions tier timeout
   - 使用 API key 认证（非 user session），安全可控
   - Hobby 限制：100 cron jobs / once per day / hourly precision

3. **Worker 独立运行 Playwright**：
   - Vercel serverless 和 Supabase Edge Functions 均无法运行 Chromium
   - Worker 可部署在 GitHub Actions（零成本）或最小 VPS（新加坡节点，~$5/month）
   - 与 Next.js 通过 HTTP callback 通信，Worker 仅返回抓取原始数据

4. **不推荐 Worker 直连 Supabase（明确否定）**：
   - 违反强制架构边界（绕过 Repository/Server Actions/SyncService/RLS）
   - Worker 持有 service_role key 扩大泄露面
   - 需在 Python 侧重复实现 claim/release 锁逻辑（当前 executor 未通过 PG 双事务并发测试验证）
   - **仅列为不推荐备选风险，不作为中期推荐路径**

### 长期（生产正式上线）

待以下条件全部满足后再做最终选型：
- BigSeller 页面结构长期稳定
- 已明确同步频率需求（每小时 vs 每日 vs 按需）
- 已确认部署平台（Vercel / 阿里云 / 其他）
- 已评估 BigSeller 网络可达性（从各候选 Worker 位置）
- 已有监控和告警基础设施

## 6. 安全考虑

### service_role 使用边界（定时任务场景）

定时同步与手动同步在权限模型上有本质差异：

| | 手动同步 | 定时同步 |
|---|---|---|
| 触发者 | 登录 Admin 用户（auth.uid()） | 系统服务账号（service_role） |
| Auth session | JWT from Supabase Auth | 无 session |
| claim_sync_run triggered_by | 真实 Admin UUID | 需定义系统账号 UUID |
| RLS 经过 | auth.uid() = Admin | service_role 绕过 RLS |
| 审计追踪 | 可追溯到操作人 | 仅记录为系统操作 |

**必须满足的安全约束**：

1. **系统账号**：在 `profiles` 表中创建专用系统账号（如 `sync-system`），`triggered_by` 写入该系统账号 UUID，确保审计日志可追踪
2. **API 认证**：Route Handler 使用预共享密钥（HMAC 或 Bearer token）+ IP 白名单，禁止无认证调用
3. **密钥隔离**：worker ↔ Next.js 回调使用独立 API key（非 SUPABASE_SERVICE_ROLE_KEY），降低泄露半径
4. **日志脱敏**：Worker 和 Route Handler 的日志不得包含密钥、完整 password hash、用户 PII；仅记录 runId + warehouseId + status
5. **失败安全**：Worker 崩溃不泄露内存中的密钥；所有外部 HTTP 调用强制 HTTPS
6. **并发锁不变**：定时同步与手动同步走同一个 `claim_sync_run` RPC，同一仓库同一时间只有一个运行

## 7. 未完问题（P5-SY6 后解决）

| 问题 | 当前回答 | 何时决定 |
|------|---------|---------|
| Worker 选 GitHub Actions 还是 VPS？ | 待工作负载 + 网络可达性实测 | P5-SY7 前 |
| 同步频率？ | 待业务需求确认（每日？每 4 小时？） | P5-SY7 前 |
| 系统账号 UUID | 需创建并 Migration | P5-SY7 前 |
| 回调安全模型 | HMAC vs Bearer token vs mTLS | P5-SY7 前 |
| 定时同步是否需要 confirm token？ | 暂定不需要（系统账号豁免） | P5-SY7 前 |
| 告警（同步失败通知） | Slack / Email / 钉钉？ | 生产上线前 |

## 8. P5-SY6 推荐拆分（供参考，不在本 Task 实现）

如后续决定实施自动同步，建议拆分为：

| Sub-Task | 内容 | 依赖 |
|----------|------|------|
| **P5-SY6A** | 系统账号创建 + Migration | P5-SY6 |
| **P5-SY6B** | Route Handler `/api/cron/sync`（Vercel Cron 触发入口，claim/artifact/runner/release 完整生命周期） | P5-SY6A |
| **P5-SY6C** | WorkerSyncRunner + Worker（Python scraper 服务化 + HTTP API，Worker 仅返回抓取结果，不写数据库） | P5-SY6B |
| **P5-SY6D** | 回调 + 端到端集成测试（验证 claim→Worker→release 完整链路） | P5-SY6C |
| **P5-SY6E** | 日志脱敏、监控、告警 | P5-SY6D |
| **P5-SY6F** | Web UI 真实接入（真实 Repository / ArtifactProvider / SyncRunner / InputArtifactSource 替换 Mock） | P5-SY5D, P5-SY6B |
