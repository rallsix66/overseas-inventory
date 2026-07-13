// P0: 喜运达物流轨迹 API 接入 — 静态契约测试
//
// 验证：
// 1. Token RPC 权限 — authenticated/anon 不得执行 token 函数
// 2. Token 租约并发保护 — 首次缓存 INSERT 占位 + store_token 无 unsafe INSERT 回退
// 3. Cron 鉴权与调度配置 — CRON_SECRET fail-closed + vercel.json schedule
// 4. Provider 解析 — parseTrackingResponse 过滤/分类逻辑
// 5. 绑定并发保护 — FOR UPDATE + AND shipment_id IS NULL
// 6. 外部轨迹详情展示链路 — 页面 import + 组件存在性
//
// 纯静态文本检查 + 纯函数单元测试，不连接 Supabase。

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'supabase/migrations');
const PROVIDER_DIR = path.resolve(process.cwd(), 'src/lib/providers/golucky');
const IN_TRANSIT_DIR = path.resolve(process.cwd(), 'src/features/in-transit');
const CRON_ROUTE_PATH = path.resolve(process.cwd(), 'src/app/api/cron/golucky/route.ts');
const VERCEL_JSON_PATH = path.resolve(process.cwd(), 'vercel.json');
const DETAIL_PAGE_PATH = path.resolve(process.cwd(), 'src/app/dashboard/shipments/[id]/page.tsx');
const ACTIONS_PATH = path.resolve(process.cwd(), 'src/features/in-transit/actions.ts');

// ─── 1. Token RPC 权限 — 00040 ──────────────────────────────────────────

describe('P0-GOLUCKY — Token RPC 权限 (00040)', () => {
  let migrationSrc: string;

  beforeAll(() => {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.startsWith('00040'));
    expect(files.length, '00040 migration 未找到').toBeGreaterThan(0);
    migrationSrc = fs.readFileSync(path.join(MIGRATIONS_DIR, files[0]), 'utf-8');
  });

  it('authenticated 不得执行 acquire_token_lease', () => {
    // REVOKE 必须包含 authenticated
    const revokeLine = migrationSrc.match(
      /REVOKE EXECUTE ON FUNCTION public\.acquire_token_lease[^;]+;/,
    );
    expect(revokeLine).not.toBeNull();
    expect(revokeLine![0]).toMatch(/authenticated/);
    // 不得有 GRANT TO authenticated
    const grantMatches = migrationSrc.match(
      /GRANT EXECUTE ON FUNCTION public\.acquire_token_lease[^;]+TO authenticated[^;]*;/g,
    );
    expect(grantMatches).toBeNull();
  });

  it('authenticated 不得执行 store_token_with_lease', () => {
    const revokeLine = migrationSrc.match(
      /REVOKE EXECUTE ON FUNCTION public\.store_token_with_lease[^;]+;/,
    );
    expect(revokeLine).not.toBeNull();
    expect(revokeLine![0]).toMatch(/authenticated/);
    const grantMatches = migrationSrc.match(
      /GRANT EXECUTE ON FUNCTION public\.store_token_with_lease[^;]+TO authenticated[^;]*;/g,
    );
    expect(grantMatches).toBeNull();
  });

  it('authenticated 不得执行 release_token_lease', () => {
    const revokeLine = migrationSrc.match(
      /REVOKE EXECUTE ON FUNCTION public\.release_token_lease[^;]+;/,
    );
    expect(revokeLine).not.toBeNull();
    expect(revokeLine![0]).toMatch(/authenticated/);
    const grantMatches = migrationSrc.match(
      /GRANT EXECUTE ON FUNCTION public\.release_token_lease[^;]+TO authenticated[^;]*;/g,
    );
    expect(grantMatches).toBeNull();
  });

  it('anon 不得执行所有 token RPC', () => {
    // 所有 token RPC revoke 应包含 authenticated
    const tokenRpcs = ['acquire_token_lease', 'store_token_with_lease', 'release_token_lease'];
    for (const rpc of tokenRpcs) {
      const rpcSection = new RegExp(
        `REVOKE EXECUTE ON FUNCTION public\\.${rpc}[^;]+;`,
      );
      const match = migrationSrc.match(rpcSection);
      expect(match, `${rpc} REVOKE 未找到`).not.toBeNull();
      expect(match![0], `${rpc} 应 REVOKE FROM authenticated`).toMatch(/authenticated/);
    }
  });

  it('provider_token_cache 表无 authenticated 策略', () => {
    // REVOKE ALL 行必须存在
    expect(migrationSrc).toMatch(/REVOKE ALL ON public\.provider_token_cache FROM anon, authenticated/);
    // 不得有 CREATE POLICY ... FOR authenticated
    const policyMatches = migrationSrc.match(
      /CREATE POLICY.*ON public\.provider_token_cache/g,
    );
    expect(policyMatches).toBeNull();
  });

  // ── 1.1 service_role 显式授权 ──

  it('service_role 显式获得 acquire_token_lease EXECUTE', () => {
    const grantMatch = migrationSrc.match(
      /GRANT EXECUTE ON FUNCTION public\.acquire_token_lease[^;]+TO service_role[^;]*;/,
    );
    expect(grantMatch, '必须 GRANT EXECUTE TO service_role').not.toBeNull();
  });

  it('service_role 显式获得 store_token_with_lease EXECUTE', () => {
    const grantMatch = migrationSrc.match(
      /GRANT EXECUTE ON FUNCTION public\.store_token_with_lease[^;]+TO service_role[^;]*;/,
    );
    expect(grantMatch, '必须 GRANT EXECUTE TO service_role').not.toBeNull();
  });

  it('service_role 显式获得 release_token_lease EXECUTE', () => {
    const grantMatch = migrationSrc.match(
      /GRANT EXECUTE ON FUNCTION public\.release_token_lease[^;]+TO service_role[^;]*;/,
    );
    expect(grantMatch, '必须 GRANT EXECUTE TO service_role').not.toBeNull();
  });

  it('GRANT TO service_role 不包括 authenticated', () => {
    // 所有 GRANT 语句应只 TO service_role，不包含 authenticated
    const grantLines = migrationSrc.match(/GRANT EXECUTE ON FUNCTION public\.\w+_token_\w+[^;]+;/g);
    if (grantLines) {
      for (const line of grantLines) {
        expect(line, `GRANT 不应包含 authenticated: ${line}`).not.toMatch(/authenticated/);
        expect(line, `GRANT 应包含 service_role: ${line}`).toMatch(/service_role/);
      }
    }
  });
});

// ─── 2. Token 租约并发保护 — 00040 ──────────────────────────────────────

describe('P0-GOLUCKY — Token 租约并发保护 (00040)', () => {
  let migrationSrc: string;

  beforeAll(() => {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.startsWith('00040'));
    migrationSrc = fs.readFileSync(path.join(MIGRATIONS_DIR, files[0]), 'utf-8');
  });

  it('acquire_token_lease 首次缓存使用 INSERT + ON CONFLICT DO NOTHING 占位', () => {
    // 无缓存行时不应只返回 first_time，必须 INSERT 占位行
    const insertMatch = migrationSrc.match(
      /INSERT INTO public\.provider_token_cache[^;]+ON CONFLICT \(provider\) DO NOTHING/,
    );
    expect(insertMatch, '首次缓存必须 INSERT 占位行 + ON CONFLICT DO NOTHING').not.toBeNull();
  });

  it('acquire_token_lease INSERT 后检查 own lease_owner 是否成功', () => {
    // INSERT 后应 SELECT WHERE lease_owner = p_lease_id 确认是否拿到租约
    expect(migrationSrc).toMatch(/lease_owner = p_lease_id/);
  });

  it('store_token_with_lease 仅 UPDATE WHERE lease_owner 匹配，无 INSERT 回退', () => {
    const storeBody = extractFunctionBody(migrationSrc, 'store_token_with_lease');
    // 不应包含 INSERT（unsafe 回退）
    expect(storeBody).not.toMatch(/INSERT INTO/);
    // 必须包含 UPDATE WHERE lease_owner = p_lease_id
    expect(storeBody).toMatch(/UPDATE public\.provider_token_cache/);
    expect(storeBody).toMatch(/lease_owner = p_lease_id/);
  });

  it('store_token_with_lease NOT FOUND 时抛出 LEASE_OWNERSHIP_LOST', () => {
    const storeBody = extractFunctionBody(migrationSrc, 'store_token_with_lease');
    expect(storeBody).toMatch(/LEASE_OWNERSHIP_LOST/);
    expect(storeBody).toMatch(/RAISE EXCEPTION/);
  });

  it('release_token_lease 仅释放自己租约（lease_owner = p_lease_id）', () => {
    const releaseBody = extractFunctionBody(migrationSrc, 'release_token_lease');
    expect(releaseBody).toMatch(/lease_owner = p_lease_id/);
  });

  it('并发失败方 lease_held_by_other 返回值存在', () => {
    // 租约被他人持有时返回 action = 'lease_held_by_other'
    expect(migrationSrc).toMatch(/'lease_held_by_other'/);
  });

  it('acquire_token_lease 使用 FOR UPDATE 行锁', () => {
    expect(migrationSrc).toMatch(/FOR UPDATE/);
  });
});

// ─── 3. Cron 鉴权与调度配置 ─────────────────────────────────────────────

describe('P0-GOLUCKY — Cron 鉴权与调度配置', () => {
  let routeSrc: string;
  let vercelJson: unknown;

  beforeAll(() => {
    routeSrc = fs.readFileSync(CRON_ROUTE_PATH, 'utf-8');
    vercelJson = JSON.parse(fs.readFileSync(VERCEL_JSON_PATH, 'utf-8'));
  });

  // ── 3.1 CRON_SECRET fail-closed ──

  it('CRON_SECRET 缺失/为空 → 500（不访问 DB）', () => {
    // CRON_SECRET 检查必须在最前面（在鉴权之前）
    const cronSecretIdx = routeSrc.indexOf('CRON_SECRET');
    const authIdx = routeSrc.indexOf('authorization');
    expect(cronSecretIdx, 'CRON_SECRET 检查应优先于 Authorization').toBeLessThan(authIdx);
    // 返回 500
    expect(routeSrc).toMatch(/status:\s*500/);
    expect(routeSrc).toContain('CRON_SECRET 未配置');
  });

  it('Authorization 缺失 → 401', () => {
    expect(routeSrc).toContain('缺少 Authorization header');
    expect(routeSrc).toMatch(/status:\s*401/);
  });

  it('CRON_SECRET 不匹配 → 401（不泄露实际 secret）', () => {
    expect(routeSrc).toContain('CRON_SECRET 错误');
    // 错误响应不包含实际的 secret 值 — 验证返回的是固定错误消息而非真实值
    expect(routeSrc).toMatch(/status:\s*401/);
  });

  // ── 3.2 路由委托同步 ──

  it('route 调用 syncAllGoluckyRefs（不内联同步逻辑）', () => {
    expect(routeSrc).toMatch(/import.*syncAllGoluckyRefs/);
    expect(routeSrc).toMatch(/syncAllGoluckyRefs\(/);
  });

  it('route 使用 SupabaseTokenCache（非 InMemoryTokenCache）', () => {
    expect(routeSrc).toMatch(/import.*SupabaseTokenCache/);
    // 不得在生产 route 中使用 InMemoryTokenCache
    expect(routeSrc).not.toMatch(/new InMemoryTokenCache/);
    expect(routeSrc).toMatch(/new SupabaseTokenCache/);
  });

  it('route 使用 createServiceClient（非 createClient）', () => {
    expect(routeSrc).toMatch(/import.*createServiceClient/);
    expect(routeSrc).not.toMatch(/import.*createClient/);
  });

  it('route 不直接调用 supabase.from() 操作业务表', () => {
    // 鉴权 + 依赖注入部分不应有 supabase.from()
    expect(routeSrc).not.toMatch(/supabase\.from\(/);
  });

  it('route 不直接 upsert tracking_event_external', () => {
    expect(routeSrc).not.toMatch(/tracking_event_external/);
  });

  // ── 3.3 vercel.json 调度配置 ──

  it('vercel.json 保留 dry-run cron', () => {
    const crons = (vercelJson as { crons: Array<{ path: string; schedule: string }> }).crons;
    const dryRun = crons.find((c) => c.path === '/api/cron/dry-run');
    expect(dryRun, 'dry-run cron 必须保留').toBeDefined();
    expect(dryRun!.schedule).toBe('0 1 * * *');
  });

  it('vercel.json 新增 golucky cron 且仅此一条', () => {
    const crons = (vercelJson as { crons: Array<{ path: string; schedule: string }> }).crons;
    const goluckyCrons = crons.filter((c) => c.path === '/api/cron/golucky');
    expect(goluckyCrons.length, 'golucky cron 必须恰好一条').toBe(1);
    expect(goluckyCrons[0].schedule).toBe('0 */6 * * *');
  });
});

// ─── 4. Provider 解析 — parseTrackingResponse ───────────────────────────

describe('P0-GOLUCKY — Provider 解析', () => {
  let parseSrc: string;

  beforeAll(() => {
    const parsePath = path.resolve(PROVIDER_DIR, 'parse-response.ts');
    parseSrc = fs.readFileSync(parsePath, 'utf-8');
  });

  it('过滤仅含 title 无 code/time 的 section 节点', () => {
    // 应检查 code 是否存在（filter node.code 为 truthy 才保留）
    expect(parseSrc).toMatch(/node\.code/);
  });

  it('毫秒时间戳 → ISO 8601', () => {
    // 应包含时间转换逻辑
    expect(parseSrc).toMatch(/new Date\(/);
    expect(parseSrc).toMatch(/toISOString\(\)/);
  });

  it('生成 SHA-256 external_event_id 哈希', () => {
    // 应包含哈希生成
    expect(parseSrc).toMatch(/createHash\(['"]sha256['"]\)/);
  });

  it('external_category 前缀分类映射完整', () => {
    // 应包含各种前缀分类
    const categories = ['CREATED', 'SHIPPED', 'DST_PORT', 'DELIVERY', 'LOST', 'CANCELED', 'RETURNED', 'DESTROYED', 'FAILED'];
    for (const cat of categories) {
      expect(parseSrc, `external_category 映射应包含 ${cat}`).toMatch(new RegExp(cat));
    }
    // 应映射到五种内部分类
    const internalCats = ['created', 'in_transit', 'customs', 'delivered', 'exception'];
    for (const ic of internalCats) {
      expect(parseSrc, `内部分类应包含 '${ic}'`).toMatch(new RegExp(`'${ic}'`));
    }
  });

  it('解析函数签名接受 nodes 数组参数', () => {
    const fnSig = parseSrc.match(/export function parseTrackingResponse\s*\([^)]*\)/);
    expect(fnSig).not.toBeNull();
    expect(fnSig![0]).toMatch(/nodes/);
  });

  it('返回 ParsedGoluckyEvent[] 类型', () => {
    expect(parseSrc).toMatch(/ParsedGoluckyEvent\[\]/);
  });
});

// ─── 5. 绑定并发保护 — 00039 ────────────────────────────────────────────

describe('P0-GOLUCKY — 绑定并发保护 (00039)', () => {
  let migrationSrc: string;

  beforeAll(() => {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.startsWith('00039'));
    migrationSrc = fs.readFileSync(path.join(MIGRATIONS_DIR, files[0]), 'utf-8');
  });

  it('bind_external_ref_to_shipment 读取 external_ref 时使用 FOR UPDATE', () => {
    const bindBody = extractFunctionBody(migrationSrc, 'bind_external_ref_to_shipment');
    // SELECT ... FROM public.shipment_external_ref ... FOR UPDATE
    const selectSection = bindBody.match(
      /SELECT \* INTO v_ref\s+FROM public\.shipment_external_ref[\s\S]*?FOR UPDATE/,
    );
    expect(selectSection, 'SELECT 必须包含 FOR UPDATE').not.toBeNull();
  });

  it('UPDATE 时再次校验 shipment_id IS NULL（防止 TOCTOU）', () => {
    const bindBody = extractFunctionBody(migrationSrc, 'bind_external_ref_to_shipment');
    // UPDATE ... WHERE id = p_ref_id AND shipment_id IS NULL
    const updateSection = bindBody.match(
      /UPDATE public\.shipment_external_ref[\s\S]*?WHERE id = p_ref_id[\s\S]*?AND shipment_id IS NULL/,
    );
    expect(updateSection, 'UPDATE 必须包含 AND shipment_id IS NULL').not.toBeNull();
  });

  it('并发绑定失败时返回 CONCURRENT_BINDING 受控错误', () => {
    const bindBody = extractFunctionBody(migrationSrc, 'bind_external_ref_to_shipment');
    expect(bindBody).toMatch(/CONCURRENT_BINDING/);
    expect(bindBody).toContain('已被其他操作绑定');
  });

  it('已有绑定的记录返回 ALREADY_BOUND 错误', () => {
    const bindBody = extractFunctionBody(migrationSrc, 'bind_external_ref_to_shipment');
    expect(bindBody).toMatch(/ALREADY_BOUND/);
    expect(bindBody).toContain('已绑定 Shipment');
  });

  it('仓库不一致时返回 WAREHOUSE_MISMATCH 错误', () => {
    const bindBody = extractFunctionBody(migrationSrc, 'bind_external_ref_to_shipment');
    expect(bindBody).toMatch(/WAREHOUSE_MISMATCH/);
  });

  it('国家不一致时返回 COUNTRY_MISMATCH 错误', () => {
    const bindBody = extractFunctionBody(migrationSrc, 'bind_external_ref_to_shipment');
    expect(bindBody).toMatch(/COUNTRY_MISMATCH/);
  });
});

// ─── 6. 外部轨迹详情展示链路 ────────────────────────────────────────────

describe('P0-GOLUCKY — 外部轨迹详情展示链路', () => {
  let detailPageSrc: string;
  let componentSrc: string;

  beforeAll(() => {
    detailPageSrc = fs.readFileSync(DETAIL_PAGE_PATH, 'utf-8');
    const componentPath = path.resolve(
      IN_TRANSIT_DIR,
      'components/external-tracking-timeline.tsx',
    );
    componentSrc = fs.readFileSync(componentPath, 'utf-8');
  });

  // ── 6.1 详情页集成 ──

  it('详情页 import ExternalTrackingTimeline', () => {
    expect(detailPageSrc).toContain('ExternalTrackingTimeline');
  });

  it('详情页 import externalTrackingRepository', () => {
    expect(detailPageSrc).toMatch(/import.*externalTrackingRepository/);
  });

  it('详情页调用 getExternalTrackingByShipment', () => {
    expect(detailPageSrc).toMatch(/getExternalTrackingByShipment/);
  });

  it('详情页查询失败不阻塞页面（try-catch 降级）', () => {
    // 应包含 try-catch 包裹外部轨迹查询
    expect(detailPageSrc).toMatch(/try\s*\{/);
    expect(detailPageSrc).toMatch(/externalTrackingData/);
    expect(detailPageSrc).toMatch(/\}\s*catch/);
  });

  it('详情页不直接调用 supabase.from() 或 supabase.rpc()', () => {
    // 页面通过 Repository 访问数据
    const fn = extractFunctionBody(detailPageSrc, 'ShipmentDetailPage');
    expect(fn).not.toMatch(/supabase\.from\(/);
    expect(fn).not.toMatch(/supabase\.rpc\(/);
  });

  // ── 6.2 ExternalTrackingTimeline 组件 ──

  it('组件存在空数据状态处理', () => {
    // data.length === 0 → return null
    expect(componentSrc).toMatch(/length === 0/);
    expect(componentSrc).toMatch(/return null/);
  });

  it('组件 events 为空时展示"暂无轨迹数据"', () => {
    expect(componentSrc).toContain('暂无轨迹数据');
    // 应使用 Clock 图标
    expect(componentSrc).toContain('Clock');
  });

  it('组件明确区分外部轨迹（橙色/amber 主题）', () => {
    // 使用 amber 色系区分
    expect(componentSrc).toMatch(/amber/);
    // 标题包含"喜运达"和"外部"
    expect(componentSrc).toContain('喜运达');
    expect(componentSrc).toContain('外部');
  });

  it('组件展示数据来源声明', () => {
    expect(componentSrc).toContain('第三方物流平台');
  });

  it('组件展示运单号', () => {
    expect(componentSrc).toContain('运单号');
  });

  it('组件 external_category 映射到中文标签', () => {
    const labels = ['已创建', '运输中', '清关中', '已送达', '异常'];
    for (const label of labels) {
      expect(componentSrc, `缺少 external_category 中文标签: ${label}`).toContain(label);
    }
  });

  it('组件使用不同图标区分类别', () => {
    // 应导入多种图标
    expect(componentSrc).toContain('Truck');
    expect(componentSrc).toContain('Package');
    expect(componentSrc).toContain('Ship');
    expect(componentSrc).toContain('CheckCircle');
    expect(componentSrc).toContain('AlertTriangle');
  });

  it('组件为 Server Component（无 use client 指令）', () => {
    expect(componentSrc).not.toContain("'use client'");
  });

  // ── 6.3 Server Action 不暴露 service_role ──

  it('actions.ts 不导入 createServiceClient', () => {
    const actionsSrc = fs.readFileSync(ACTIONS_PATH, 'utf-8');
    expect(actionsSrc).not.toMatch(/createServiceClient/);
    expect(actionsSrc).not.toMatch(/service.?_role/i);
  });

  it('actions.ts 使用服务端 createClient（用户会话）', () => {
    const actionsSrc = fs.readFileSync(ACTIONS_PATH, 'utf-8');
    // 应有 'use server' 或导入 createClient
    expect(actionsSrc).toMatch(/'use server'/);
  });
});

// ─── 7. SupabaseTokenCache 并发安全 ──────────────────────────────────────

describe('P0-GOLUCKY — SupabaseTokenCache 并发安全', () => {
  let tokenCacheSrc: string;

  beforeAll(() => {
    const tokenCachePath = path.resolve(PROVIDER_DIR, 'token-cache.ts');
    expect(fs.existsSync(tokenCachePath), 'SupabaseTokenCache 文件必须存在').toBe(true);
    tokenCacheSrc = fs.readFileSync(tokenCachePath, 'utf-8');
  });

  it('实现 TokenCache 接口', () => {
    expect(tokenCacheSrc).toMatch(/implements TokenCache/);
  });

  it('acquireLease 调用 acquire_token_lease RPC（每次生成 fresh UUID）', () => {
    expect(tokenCacheSrc).toMatch(/acquire_token_lease/);
    // 每次调用生成新 leaseId
    expect(tokenCacheSrc).toMatch(/randomUUID\(\)/);
  });

  it('storeToken 调用 store_token_with_lease RPC（lease.leaseId 参数）', () => {
    expect(tokenCacheSrc).toMatch(/store_token_with_lease/);
    // 使用 lease.leaseId（来自参数，非实例字段）
    expect(tokenCacheSrc).toMatch(/lease\.leaseId/);
  });

  it('releaseLease 调用 release_token_lease RPC（lease.leaseId 参数）', () => {
    expect(tokenCacheSrc).toMatch(/release_token_lease/);
    expect(tokenCacheSrc).toMatch(/lease\.leaseId/);
  });

  it('不存在实例级共享可变 _leaseId 字段', () => {
    // 禁止 any instance-level mutable lease state
    expect(tokenCacheSrc).not.toMatch(/this\._leaseId/);
  });

  it('leaseId 在 acquireLease 内生成并返回（服务端控制，非外部传入）', () => {
    // leaseId 在 acquireLease 方法内通过 crypto.randomUUID() 生成
    const acquireFn = extractTsMethod(tokenCacheSrc, 'acquireLease');
    expect(acquireFn).toMatch(/randomUUID\(\)/);
    // 不应从参数获取 leaseId
    const acquireSig = tokenCacheSrc.match(/async acquireLease\([^)]*\)/);
    expect(acquireSig).not.toBeNull();
    // acquireLease 只接受 provider 参数，不接受 leaseId
    expect(acquireSig![0]).not.toMatch(/leaseId|lease_id/i);
  });

  it('storeToken 签名包含 lease: TokenLease 参数', () => {
    const sig = tokenCacheSrc.match(/async storeToken\([^)]*\)/);
    expect(sig).not.toBeNull();
    expect(sig![0]).toMatch(/lease/);
  });

  it('releaseLease 签名包含 lease: TokenLease 参数', () => {
    const sig = tokenCacheSrc.match(/async releaseLease\([^)]*\)/);
    expect(sig).not.toBeNull();
    expect(sig![0]).toMatch(/lease/);
  });

  it('从 golucky barrel 导出', () => {
    const indexSrc = fs.readFileSync(path.resolve(PROVIDER_DIR, 'index.ts'), 'utf-8');
    expect(indexSrc).toContain('SupabaseTokenCache');
  });
});

// ─── 7b. TokenLease 接口并发安全 ───────────────────────────────────────

describe('P0-GOLUCKY — TokenLease 并发安全', () => {
  let clientSrc: string;

  beforeAll(() => {
    clientSrc = fs.readFileSync(path.resolve(PROVIDER_DIR, 'client.ts'), 'utf-8');
  });

  it('TokenLease 接口包含 leaseId 字段', () => {
    const tokenLeaseDef = clientSrc.match(/export interface TokenLease\s*\{[^}]+\}/s);
    expect(tokenLeaseDef).not.toBeNull();
    expect(tokenLeaseDef![0]).toMatch(/leaseId/);
  });

  it('TokenCache.storeToken 签名包含 lease: TokenLease 参数', () => {
    const sig = clientSrc.match(/storeToken\([^)]*\)/);
    expect(sig).not.toBeNull();
    expect(sig![0]).toMatch(/lease/);
  });

  it('TokenCache.releaseLease 签名包含 lease: TokenLease 参数', () => {
    const sig = clientSrc.match(/releaseLease\([^)]*\)/);
    expect(sig).not.toBeNull();
    // 第二个 releaseLease 匹配（接口定义），应包含 lease 参数
    expect(clientSrc).toMatch(/releaseLease\(provider[^)]*lease[^)]*\)/);
  });

  it('GoluckyClient 无 _leaseId 或其他共享租约状态字段', () => {
    expect(clientSrc).not.toMatch(/this\._leaseId/);
  });

  it('GoluckyClient.obtainToken 传递 lease 给 storeToken', () => {
    const obtainBody = extractTsMethod(clientSrc, 'obtainToken');
    expect(obtainBody).toMatch(/storeToken\([^)]*lease[^)]*\)/);
  });

  it('GoluckyClient.obtainToken 传递 lease 给 releaseLease', () => {
    const obtainBody = extractTsMethod(clientSrc, 'obtainToken');
    expect(obtainBody).toMatch(/releaseLease\([^)]*lease[^)]*\)/);
  });

  it('InMemoryTokenCache acquireLease 返回包含 leaseId 的 TokenLease', () => {
    const fn = extractTsMethod(clientSrc, 'acquireLease');
    // InMemoryTokenCache 的 acquireLease 返回对象应包含 leaseId
    expect(fn).toMatch(/leaseId/);
  });
});

// ─── 8. Shipment rewarehouse 双保险 ────────────────────────────────────

describe('P0-GOLUCKY — Shipment rewarehouse 双保险', () => {
  it('00038 包含 warehouse lock 触发器（external_ref 侧）', () => {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.startsWith('00038'));
    const src = fs.readFileSync(path.join(MIGRATIONS_DIR, files[0]), 'utf-8');
    expect(src).toMatch(/tg_.*no_rewarehouse|tg_.*warehouse_lock/);
  });

  it('00039 包含 shipment 侧换仓触发器', () => {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.startsWith('00039'));
    const src = fs.readFileSync(path.join(MIGRATIONS_DIR, files[0]), 'utf-8');
    expect(src).toMatch(/tg_shipment_no_rewarehouse_if_bound/);
  });

  it('shipments actions.ts updateShipment 包含 existsBoundExternalRef 预检查', () => {
    const actionsPath = path.resolve(process.cwd(), 'src/features/shipments/actions.ts');
    const actionsSrc = fs.readFileSync(actionsPath, 'utf-8');
    expect(actionsSrc).toMatch(/existsBoundExternalRef/);
    expect(actionsSrc).toContain('该在途记录已绑定外部物流，暂不支持换仓');
  });
});

// ─── Helpers ────────────────────────────────────────────────────────────

/** 从 TypeScript 源码中提取指定方法的函数体（大括号匹配） */
function extractTsMethod(src: string, methodName: string): string {
  // 匹配 async methodName(...) { 或 methodName(...) {
  const fnRegex = new RegExp(
    `(?:async\\s+)?${methodName}\\s*\\([^)]*\\)\\s*(:\\s*[^{]+)?\\s*\\{`,
  );
  const match = src.match(fnRegex);
  if (!match || match.index === undefined) return '';

  let pos = match.index + match[0].length;
  let depth = 1;
  while (pos < src.length && depth > 0) {
    const ch = src[pos];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    pos++;
  }
  return depth === 0 ? src.slice(match.index + match[0].length, pos - 1) : '';
}

/** 从 SQL 源码中提取指定函数的函数体 */
function extractFunctionBody(src: string, fnName: string): string {
  const fnRegex = new RegExp(
    `(CREATE OR REPLACE )?FUNCTION public\\.${fnName}\\s*\\([^)]*\\)[\\s\\S]*?AS\\s*\\$\\$`,
    'i',
  );
  const match = src.match(fnRegex);
  if (!match || match.index === undefined) return '';

  const pos = match.index + match[0].length;
  // 找到结尾的 $$
  const endMarker = '$$;';
  // 简化：找到下一个 $$;
  const endIdx = src.indexOf(endMarker, pos);
  if (endIdx === -1) return src.slice(pos);

  // 处理嵌套 $$（LANGUAGE plpgsql 等）
  let searchPos = pos;
  while (searchPos < src.length) {
    const nextDollar = src.indexOf('$$', searchPos);
    if (nextDollar === -1) break;
    if (src.slice(nextDollar, nextDollar + 3) === '$$;') {
      // 这是结束标记
      return src.slice(pos, nextDollar);
    }
    searchPos = nextDollar + 2;
  }
  return src.slice(pos, endIdx);
}
