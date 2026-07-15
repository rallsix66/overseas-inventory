import { Badge } from '@/components/ui/badge';
import { TableCell, TableRow } from '@/components/ui/table';
import type {
  BaseStockStatus,
  ProductOverviewRow as ProductOverviewRowType,
  StockoutUrgency,
} from '../types';

const STATUS_LABELS: Record<BaseStockStatus, string> = {
  out_of_stock: '缺货',
  low: '低库存',
  normal: '正常',
  unmatched: '未匹配',
};

const URGENCY_LABELS: Record<StockoutUrgency, string> = {
  critical: '紧急',
  warning: '预警',
  ok: '正常',
  data_incomplete: '数据不足',
};

export function ProductOverviewRow({
  row,
  onSelect,
}: {
  row: ProductOverviewRowType;
  onSelect: (row: ProductOverviewRowType) => void;
}) {
  return (
    <TableRow
      className="cursor-pointer"
      tabIndex={0}
      aria-label={`查看 ${row.sku} 全球库存详情`}
      onClick={() => onSelect(row)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(row);
        }
      }}
    >
      <TableCell>
        <p className="font-medium text-gray-900">{row.productName ?? row.variantName}</p>
        <p className="mt-0.5 font-mono text-xs text-muted-foreground">{row.sku}</p>
      </TableCell>
      <TableCell>
        <div className="flex max-w-[220px] flex-wrap gap-1">
          {row.perWarehouse.map((warehouse) => (
            <Badge key={warehouse.warehouseId} variant="outline" className="font-normal">
              {warehouse.country} · {warehouse.onHand}
            </Badge>
          ))}
        </div>
      </TableCell>
      <TableCell className="text-right font-mono">{row.visibleOnHand}</TableCell>
      <TableCell className="text-right font-mono">{row.visibleInboundQuantity}</TableCell>
      <TableCell className="text-right font-mono font-semibold">
        {row.visibleTotalQuantity}
      </TableCell>
      <TableCell>
        <Badge
          variant={
            row.baseStockStatus === 'out_of_stock' || row.baseStockStatus === 'low'
              ? 'destructive'
              : 'outline'
          }
        >
          {STATUS_LABELS[row.baseStockStatus]}
        </Badge>
      </TableCell>
      <TableCell>
        <p className="text-sm">{row.earliestStockout ?? '—'}</p>
        {row.partialData && <p className="text-xs text-amber-700">部分仓缺日销</p>}
      </TableCell>
      <TableCell>
        <Badge variant={row.stockoutUrgency === 'critical' ? 'destructive' : 'outline'}>
          {URGENCY_LABELS[row.stockoutUrgency]}
        </Badge>
      </TableCell>
    </TableRow>
  );
}
