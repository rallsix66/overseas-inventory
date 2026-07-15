import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { AssignedWarehouseDetail } from '../types';

export function WarehouseMiniTable({ rows }: { rows: AssignedWarehouseDetail[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="bg-gray-50">
            <TableHead>仓库</TableHead>
            <TableHead className="text-right">在手 / 在途</TableHead>
            <TableHead className="text-right">安全 / 目标</TableHead>
            <TableHead className="text-right">建议补货</TableHead>
            <TableHead>最晚下单</TableHead>
            <TableHead>补货紧迫度</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.warehouseId}>
              <TableCell>
                <p className="font-medium">{row.warehouseName}</p>
                <p className="text-xs text-muted-foreground">{row.country}</p>
              </TableCell>
              <TableCell className="text-right font-mono">
                {row.onHand} / {row.visibleInboundQuantity}
                {row.etaMissingQuantity > 0 && (
                  <p className="text-xs text-amber-700">{row.etaMissingQuantity} 缺 ETA</p>
                )}
              </TableCell>
              <TableCell className="text-right font-mono">
                {row.safetyStock ?? '—'} / {row.targetStock ?? '—'}
              </TableCell>
              <TableCell className="text-right font-mono font-semibold">
                {row.suggestQty}
              </TableCell>
              <TableCell>{row.latestOrderDate ?? '—'}</TableCell>
              <TableCell>
                <Badge variant={row.replenishmentUrgency === 'critical' ? 'destructive' : 'outline'}>
                  {row.replenishmentUrgency === 'data_incomplete'
                    ? '数据不足'
                    : row.replenishmentUrgency}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
