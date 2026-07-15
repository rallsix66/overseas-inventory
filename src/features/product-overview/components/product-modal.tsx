'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getProductVariantDetailAction } from '../actions';
import type { ProductOverviewRow, ProductVariantDetail } from '../types';
import { CountryBurnDown } from './country-burn-down';
import { DomesticJudge } from './domestic-judge';
import { KpiGrid } from './kpi-grid';
import { WarehouseMiniTable } from './warehouse-mini-table';

export function ProductModal({
  row,
  open,
  onOpenChange,
}: {
  row: ProductOverviewRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [detail, setDetail] = useState<ProductVariantDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getProductVariantDetailAction({ variantId: row.variantId }).then((result) => {
      if (!active) return;
      if (result.success && result.data) {
        const loadedDetail = result.data;
        setDetail(loadedDetail);
        setSelectedCountry(
          loadedDetail.countryAgg.find(
            (country) => country.earliestStockout === loadedDetail.earliestStockout,
          )?.country ?? loadedDetail.countryAgg[0]?.country ?? null,
        );
      } else {
        setError(result.error ?? '产品详情加载失败，请稍后重试');
      }
    });
    return () => {
      active = false;
    };
  }, [row.variantId]);

  const selectedAggregate = detail?.countryAgg.find(
    (country) => country.country === selectedCountry,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{row.productName ?? row.variantName}</DialogTitle>
          <DialogDescription>
            {row.sku} · 全球库存详情仅包含当前账号有权查看的仓库
          </DialogDescription>
        </DialogHeader>

        {!detail && !error && (
          <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> 正在加载仓库级预测与补货建议…
          </div>
        )}

        {error && (
          <div className="flex min-h-56 flex-col items-center justify-center gap-3 text-center">
            <AlertTriangle className="size-8 text-destructive" />
            <div>
              <p className="font-medium">详情加载失败</p>
              <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            </div>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              关闭后重试
            </Button>
          </div>
        )}

        {detail && (
          <div className="space-y-4">
            <KpiGrid detail={detail} />

            {detail.etaMissingQuantity > 0 && (
              <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                有 {detail.etaMissingQuantity} 件在途尚未录入 ETA，已计入可见总量，但不计入断货前有效补给。
              </div>
            )}

            <DomesticJudge status={detail.domesticStatus} />

            <section>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">分国库存投影</h3>
                  <p className="text-xs text-muted-foreground">各国家独立预测，不暗示跨国调拨</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {detail.countryAgg.map((country) => (
                    <Button
                      key={country.country}
                      type="button"
                      size="sm"
                      variant={selectedCountry === country.country ? 'default' : 'outline'}
                      onClick={() => setSelectedCountry(country.country)}
                    >
                      {country.country}
                    </Button>
                  ))}
                </div>
              </div>
              {selectedAggregate && <CountryBurnDown country={selectedAggregate} />}
            </section>

            <section>
              <div className="mb-2">
                <h3 className="text-sm font-semibold">仓库级补货行动</h3>
                <p className="text-xs text-muted-foreground">
                  建议数量按仓库独立展示，不汇总为“全球补货量”
                </p>
              </div>
              <WarehouseMiniTable rows={detail.assignedWarehouseDetail} />
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
