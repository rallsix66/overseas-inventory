import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ProductVariantDetail } from '../types';

export function KpiGrid({ detail }: { detail: ProductVariantDetail }) {
  const items = [
    { label: '可见在手', value: detail.visibleOnHand },
    { label: '全部有效在途', value: detail.visibleInboundQuantity },
    { label: '断货前有效补给', value: detail.effectiveInbound },
    { label: '可见总量', value: detail.visibleTotalQuantity },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {items.map((item) => (
        <Card key={item.label} className="gap-1 py-3 shadow-none">
          <CardHeader className="px-4 py-0">
            <CardTitle className="text-xs font-normal text-muted-foreground">
              {item.label}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 py-0 font-mono text-xl font-semibold">
            {item.value}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
