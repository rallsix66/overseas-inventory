import type { ProductOverviewCountryAggregate } from '../types';

export function CountryBurnDown({
  country,
}: {
  country: ProductOverviewCountryAggregate;
}) {
  const hasSuppliedStockout = country.earliestStockout !== null;

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="font-medium">{country.country} 库存消耗投影</p>
          <p className="text-xs text-muted-foreground">
            使用数据库预测的最早断货日绘制，不在前端重算预测结果
          </p>
        </div>
        <p className="font-mono text-sm">{country.earliestStockout ?? '日销数据不足'}</p>
      </div>
      <svg viewBox="0 0 320 112" role="img" aria-label={`${country.country} 库存消耗投影`} className="w-full">
        <line x1="18" y1="94" x2="304" y2="94" stroke="currentColor" className="text-gray-200" />
        <line x1="18" y1="12" x2="18" y2="94" stroke="currentColor" className="text-gray-200" />
        {!hasSuppliedStockout ? (
          <line x1="20" y1="34" x2="300" y2="34" stroke="currentColor" strokeDasharray="6 5" className="text-gray-400" />
        ) : (
          <polyline points="20,20 250,94 300,94" fill="none" stroke="currentColor" strokeWidth="3" className="text-gray-900" />
        )}
        <text x="22" y="18" fontSize="10" fill="currentColor" className="text-gray-500">
          当前在手 {country.onHand}
        </text>
        <text x="22" y="108" fontSize="10" fill="currentColor" className="text-gray-500">
          今天
        </text>
        <text x="258" y="108" fontSize="10" fill="currentColor" className="text-gray-500">
          预测区间
        </text>
      </svg>
      <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
        <span>日均销：{country.dailySales ?? '—'}</span>
        <span>可见在途：{country.visibleInboundQuantity}</span>
        <span>缺 ETA：{country.etaMissingQuantity}</span>
      </div>
    </div>
  );
}
