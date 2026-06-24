// P5-SY10E: Vercel Cron Route Handler — 定时自动预审
//
// GET /api/cron/dry-run
// Authorization: Bearer <CRON_API_KEY>
//
// Vercel Cron 定时调用此端点，触发全海外仓自动 Dry Run + 规则预审。
// 使用 CRON_API_KEY 鉴权（不依赖用户 session），
// 仅执行 Dry Run + 规则评估，不触发 Real Write。
//
// 安全边界：
// - API key 必须与 CRON_API_KEY 环境变量完全匹配
// - 仅调用 runScheduledAutoPreReview，不调用批量真实写入
// - 不绕过 Repository / Server Action / feature gate / sync_run 审计链
// - WEBSYNC_REAL_WRITE_ENABLED 保持 disabled

import { NextRequest } from 'next/server';
import { runScheduledAutoPreReview } from '@/features/sync/server-actions';

export async function GET(request: NextRequest) {
  // ── 提取 Bearer token ────────────────────────────────────────
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) {
    return Response.json(
      { error: '缺少 API key' },
      { status: 401 },
    );
  }

  // ── 调用自动预审编排 ────────────────────────────────────────
  try {
    const result = await runScheduledAutoPreReview(token);
    return Response.json(result);
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes('CRON_API_KEY')) {
      return Response.json(
        { error: message },
        { status: 401 },
      );
    }
    return Response.json(
      { error: `自动预审执行失败: ${message}` },
      { status: 500 },
    );
  }
}
