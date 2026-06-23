// Python Bridge — 从 Next.js Server Action 调用 Python 同步脚本
//
// 通过 child_process.spawn 执行 web_bridge.py，
// 传递仓库参数，捕获 stdout JSON 并解析返回。
// 仅限服务端使用。

import { spawn } from 'node:child_process';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(process.cwd());
const PYTHON_MODULE = 'tools.bigseller-scraper.sync.web_bridge';

export interface PythonBridgeParams {
  warehouseId: string;
  warehouseName: string;
  oldName: string;
  country: string;
  token: string;
  mode: 'dry_run' | 'real_write';
  /** P5-SY9D: real_write 模式下的前一次 Dry Run 基线 JSON 文件路径（用于计划漂移比较） */
  priorDryRunPath?: string;
}

export interface PythonBridgeResult {
  success: boolean;
  exit_code: number;
  warehouse_id: string;
  warehouse_name: string;
  country: string;
  mode: string;
  started_at: string;
  finished_at: string | null;
  errors: string[];
  summary: {
    variants_created: number;
    variants_skipped: number;
    inventory_inserted: number;
    inventory_updated: number;
    inventory_unchanged: number;
    warehouse_renamed: boolean;
  };
  plan_drift_check: 'PASS' | 'DRIFT_DETECTED' | null;
  plan_drift_count: number;
  plan_drift_differences: string[];
  /** P5-SY9D rework: 完整 Dry Run plan artifact（含元数据）。
   *  dry_run 完成时 web_bridge.py 输出 plan_summary；
   *  real_write 时为 null（无需 plan，使用绑定的 Dry Run plan）。 */
  plan: Record<string, unknown> | null;
  /** 抓取元数据（BigSeller scraper 输出） */
  raw_row_count: number;
  valid_sku_count: number;
  invalid_sku_count: number;
}

/** SIGKILL 前等待 SIGTERM 优雅退出的宽限期（毫秒） */
const SIGKILL_GRACE_MS = 5_000;

/**
 * 调用 Python web_bridge.py 执行完整同步流程。
 * 返回解析后的 JSON 结果。
 *
 * @param timeoutMs 可选超时（毫秒）。超时后 SIGTERM → 5s grace → SIGKILL。
 *                  超时时 reject，调用方应在 sync-service 层 release 为 failed。
 */
export async function callPythonBridge(
  params: PythonBridgeParams,
  signal?: AbortSignal,
  timeoutMs?: number,
): Promise<PythonBridgeResult> {
  const args = [
    '-m', PYTHON_MODULE,
    '--warehouse-id', params.warehouseId,
    '--warehouse-name', params.warehouseName,
    '--old-name', params.oldName,
    '--country', params.country,
    '--token', params.token,
    '--mode', params.mode,
  ];
  if (params.priorDryRunPath) {
    args.push('--prior-dry-run-path', params.priorDryRunPath);
  }

  return new Promise<PythonBridgeResult>((resolve, reject) => {
    const proc = spawn('python', args, {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });

    if (signal) {
      signal.addEventListener('abort', () => {
        proc.kill('SIGTERM');
      }, { once: true });
    }

    // ── P5-SY9E: timeout — SIGTERM → grace → SIGKILL ─────
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let sigkillId: ReturnType<typeof setTimeout> | undefined;

    const clearTimers = () => {
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = undefined; }
      if (sigkillId) { clearTimeout(sigkillId); sigkillId = undefined; }
    };

    if (timeoutMs && timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        proc.kill('SIGTERM');
        sigkillId = setTimeout(() => {
          if (proc.exitCode === null && !proc.killed) {
            proc.kill('SIGKILL');
          }
        }, SIGKILL_GRACE_MS);
      }, timeoutMs);
    }

    proc.on('close', (code: number | null) => {
      clearTimers();

      // P5-SY9E: 检测 timeout/SIGTERM 终止
      const wasKilled = code === null && proc.killed;

      // Try to parse the last non-empty line as JSON
      const lines = stdout
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      const lastJsonLine = lines.at(-1);
      if (!lastJsonLine) {
        if (stderr) {
          console.error('[python-bridge] stderr:', stderr);
        }
        if (wasKilled) {
          reject(new Error(`Python bridge 超时被终止（timeout=${timeoutMs}ms, exit=${code}）`));
        } else {
          reject(new Error(`Python bridge 无输出（exit=${code}）`));
        }
        return;
      }

      try {
        const result = JSON.parse(lastJsonLine) as PythonBridgeResult;
        if (stderr) {
          // Log stderr for debugging (Python prints progress to stderr)
          console.log('[python-bridge]', stderr.split('\n').slice(-5).join('\n'));
        }
        resolve(result);
      } catch {
        reject(new Error(
          `Python bridge JSON 解析失败（exit=${code}）: ${lastJsonLine.slice(0, 500)}`,
        ));
      }
    });

    proc.on('error', (err: Error) => {
      clearTimers();
      reject(new Error(`Python bridge 启动失败: ${err.message}`));
    });
  });
}
