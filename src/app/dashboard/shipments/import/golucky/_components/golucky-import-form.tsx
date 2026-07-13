'use client';

// P0: 喜运达运单导入表单
//
// 支持文本粘贴和 CSV 文件上传两种方式。
// P0 仅支持文本 + CSV；Excel 推迟为独立增强项。

import { useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Upload, FileText } from 'lucide-react';
import { importGoluckyRefs } from '@/features/in-transit/actions';
import { parseWaybillInput, parseWaybillsInline } from '@/features/in-transit/golucky-import';

interface Warehouse {
  id: string;
  name: string;
  country: string;
}

interface Props {
  warehouses: Warehouse[];
  isAdmin: boolean;
}

type ImportMode = 'paste' | 'csv';

interface ImportResultItem {
  index?: number;
  waybill_no: string;
  error?: string;
}

interface ImportResult {
  succeeded: number;
  duplicated: number;
  failed: ImportResultItem[];
}

export function GoluckyImportForm({ warehouses }: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<ImportMode>('paste');
  const [input, setInput] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [country, setCountry] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');

  const selectedWarehouse = warehouses.find((w) => w.id === warehouseId);

  const handleWarehouseSelect = useCallback(
    (value: string | null) => {
      const id = value ?? '';
      setWarehouseId(id);
      const wh = warehouses.find((w) => w.id === id);
      if (wh) {
        setCountry(wh.country);
      }
    },
    [warehouses],
  );

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result;
        if (typeof text === 'string') {
          setInput(text);
        }
      };
      reader.readAsText(file);
    },
    [],
  );

  const handleSubmit = useCallback(async () => {
    if (!warehouseId) {
      setError('请选择目标仓库');
      return;
    }

    if (!input.trim()) {
      setError('请输入运单号');
      return;
    }

    setIsSubmitting(true);
    setError('');
    setResult(null);

    try {
      // 按行解析
      const { items, errors: parseErrors } = parseWaybillInput(input, warehouseId, country);

      if (items.length === 0 && parseErrors.length > 0) {
        setError(`解析失败: ${parseErrors.map((e) => e.error).join('; ')}`);
        setIsSubmitting(false);
        return;
      }

      const response = await importGoluckyRefs(items);

      if (response.success && response.data) {
        setResult(response.data as ImportResult);
      } else {
        setError(response.error ?? '导入失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败');
    } finally {
      setIsSubmitting(false);
    }
  }, [input, warehouseId, country]);

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {/* 仓库选择 */}
      <div className="flex flex-col gap-2">
        <Label>
          目标仓库 <span className="text-red-500">*</span>
        </Label>
        <Select value={warehouseId} onValueChange={handleWarehouseSelect}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="选择海外仓库..." />
          </SelectTrigger>
          <SelectContent>
            {warehouses.map((wh) => (
              <SelectItem key={wh.id} value={wh.id}>
                {wh.name}
                <Badge variant="outline" className="ml-2 text-xs">
                  {wh.country}
                </Badge>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedWarehouse && (
          <p className="text-xs text-muted-foreground">
            运单将导入至 {selectedWarehouse.country} 仓库「{selectedWarehouse.name}」
          </p>
        )}
      </div>

      {/* 导入方式切换 */}
      <div className="flex gap-2">
        <Button
          variant={mode === 'paste' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('paste')}
        >
          <FileText className="w-4 h-4 mr-1" />
          文本粘贴
        </Button>
        <Button
          variant={mode === 'csv' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('csv')}
        >
          <Upload className="w-4 h-4 mr-1" />
          CSV 上传
        </Button>
      </div>

      {/* 输入区域 */}
      {mode === 'paste' ? (
        <div className="flex flex-col gap-2">
          <Label>
            运单号列表 <span className="text-red-500">*</span>
          </Label>
          <Textarea
            placeholder={'每行一个运单号，或用逗号、空格、分号分隔\n\n示例：\nGLLAN26062906249PHE\nGLLAN26070100001TH\n...'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={10}
            className="font-mono text-sm"
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Label>
            CSV 文件 <span className="text-red-500">*</span>
          </Label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt"
            onChange={handleFileUpload}
            className="text-sm"
          />
          {input && (
            <p className="text-xs text-muted-foreground">
              已加载文件（{input.split('\n').length} 行）
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            CSV 第一列为运单号，支持表头行（自动跳过）。
          </p>
        </div>
      )}

      {/* 提交 */}
      <div className="flex gap-3">
        <Button onClick={handleSubmit} disabled={isSubmitting || !warehouseId || !input.trim()}>
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              导入中...
            </>
          ) : (
            '导入运单'
          )}
        </Button>
        <Button variant="outline" onClick={() => router.push('/dashboard/shipments')}>
          取消
        </Button>
      </div>

      {/* 错误 */}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 结果 */}
      {result && (
        <div className="rounded-md border p-4 space-y-2">
          <h3 className="font-medium">导入结果</h3>
          <div className="flex gap-4 text-sm">
            <span className="text-green-600">成功 {result.succeeded} 条</span>
            <span className="text-amber-600">重复 {result.duplicated} 条</span>
            {result.failed.length > 0 && (
              <span className="text-red-600">失败 {result.failed.length} 条</span>
            )}
          </div>
          {result.failed.length > 0 && (
            <div className="mt-2 text-sm space-y-1">
              <p className="font-medium text-red-700">失败详情：</p>
              {result.failed.map((f, i) => (
                <div key={i} className="text-red-600 pl-2 border-l-2 border-red-200">
                  运单号「{f.waybill_no}」: {f.error}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
