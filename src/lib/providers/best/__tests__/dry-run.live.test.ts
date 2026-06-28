// 百世 API 真实只读 Dry Run — 仅在显式运行 test:best-live 时执行
//
// 安全约束：不输出凭证、签名、完整测试号、地址、姓名、电话或完整原始响应。

import { describe, it } from 'vitest';
import { BestClient } from '../client';

function mask(s: string): string {
  if (s.length <= 8) return '****';
  return s.slice(0, 4) + '****' + s.slice(-4);
}

function checkEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`环境变量 ${name} 缺失`);
  return val;
}

describe('Best API Live Dry Run', () => {
  it(
    '双端点探测',
    async () => {
      const baseUrl = checkEnv('BEST_OPEN_BASE_URL');
      const partnerId = checkEnv('BEST_OPEN_PARTNER_ID');
      const secret = checkEnv('BEST_OPEN_SECRET');
      const testNo = checkEnv('BEST_TEST_NO');

      console.log(`测试号: ${mask(testNo)}`);

      const client = new BestClient({ baseUrl, partnerId, secret });

      // ── 订单查询 ──
      console.log('\n── 订单查询 queryOrderInfoByOrderNo ──');
      try {
        const r = await client.queryOrderInfoByOrderNo({ nos: [testNo] });
        console.log(`Success: ${r.success}`);
        console.log(`Message: ${r.message}`);
        console.log(`Total: ${r.data.total ?? '-'}`);
        console.log(`List: ${r.data.list?.length ?? 0}`);
      } catch (err) {
        const e = err as Error & { code?: string; httpStatus?: number };
        console.log(`ERROR [${e.constructor.name}] code=${e.code} httpStatus=${e.httpStatus ?? '-'} msg=${e.message}`);
      }

      // ── 物流轨迹查询 ──
      console.log('\n── 物流查询 trackingQuery ──');
      try {
        const r = await client.queryLogisticsTrace({ nos: [testNo] });
        console.log(`Success: ${r.success}`);
        console.log(`Message: ${r.message || '(empty)'}`);
        const items = r.data?.Items;
        console.log(`Items: ${items?.length ?? 0}`);
      } catch (err) {
        const e = err as Error & { code?: string; httpStatus?: number };
        console.log(`ERROR [${e.constructor.name}] code=${e.code} httpStatus=${e.httpStatus ?? '-'} msg=${e.message}`);
      }

      console.log('\n═══ Done ═══');
    },
    30_000,
  );
});
