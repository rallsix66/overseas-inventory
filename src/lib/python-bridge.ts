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
}

/**
 * 调用 Python web_bridge.py 执行完整同步流程。
 * 返回解析后的 JSON 结果。
 */
export async function callPythonBridge(
  params: PythonBridgeParams,
  signal?: AbortSignal,
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

    proc.on('close', (code: number | null) => {
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
        reject(new Error(`Python bridge 无输出（exit=${code}）`));
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
      reject(new Error(`Python bridge 启动失败: ${err.message}`));
    });
  });
}
