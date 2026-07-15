import type { ReplenishmentSuggestion } from '@/features/replenishment/types';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const URGENCY_LABELS = {
  critical: '立即下单',
  warning: '尽快下单',
  ok: '正常',
  data_incomplete: '数据不足',
} as const;

export function ProductReplenishmentCard({ rows }: { rows: ReplenishmentSuggestion[] }) {
  return (
    <section className="mb-5">
      <h2 className="mb-3 text-base font-semibold text-gray-900">补货建议</h2>
      {rows.length === 0 ? (
        <p className="rounded-lg border py-8 text-center text-sm text-muted-foreground">
          暂无可见库存位置的补货建议
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead>SKU / 仓库</TableHead>
              <TableHead className="text-right">日均销</TableHead>
              <TableHead className="text-right">在手</TableHead>
              <TableHead className="text-right">有效补给</TableHead>
              <TableHead className="text-right">建议补货</TableHead>
              <TableHead>最晚下单</TableHead>
              <TableHead>紧急度</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={`${row.variantId}-${row.warehouseId}`}>
                <TableCell>
                  <p className="font-medium">{row.sku}</p>
                  <p className="text-xs text-muted-foreground">{row.warehouseName}</p>
                </TableCell>
                <TableCell className="text-right">{row.avgDailySales ?? '—'}</TableCell>
                <TableCell className="text-right">{row.onHand}</TableCell>
                <TableCell className="text-right">{row.effectiveInbound}</TableCell>
                <TableCell className="text-right font-semibold">{row.suggestQty}</TableCell>
                <TableCell>{row.latestOrderDate ?? '—'}</TableCell>
                <TableCell>
                  <Badge variant={row.urgency === 'critical' ? 'destructive' : 'outline'}>
                    {URGENCY_LABELS[row.urgency]}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

