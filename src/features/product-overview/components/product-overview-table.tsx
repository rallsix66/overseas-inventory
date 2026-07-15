import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ProductOverviewRow as ProductOverviewRowType } from '../types';
import { ProductOverviewRow } from './product-overview-row';

export function ProductOverviewTable({
  rows,
  onSelect,
}: {
  rows: ProductOverviewRowType[];
  onSelect: (row: ProductOverviewRowType) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <Table>
        <TableHeader>
          <TableRow className="bg-gray-50">
            <TableHead>产品 / SKU</TableHead>
            <TableHead>可见仓库</TableHead>
            <TableHead className="text-right">在手</TableHead>
            <TableHead className="text-right">在途</TableHead>
            <TableHead className="text-right">可见总量</TableHead>
            <TableHead>库存状态</TableHead>
            <TableHead>最早断货</TableHead>
            <TableHead>风险</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <ProductOverviewRow key={row.variantId} row={row} onSelect={onSelect} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
