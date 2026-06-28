'use client';

// P3-S3: 手动创建在途记录表单
import { useState, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchIcon, XIcon, Trash2Icon, Loader2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { createShipment, searchVariants } from '@/features/shipments/actions';
import { cn } from '@/lib/utils';
import type { VariantSelectorItem, WarehouseSelectorItem } from '@/features/shipments/types';
import type { CurrentActiveUser } from '@/lib/auth';

const COUNTRIES = [
  { value: 'TH', label: '泰国 (TH)' },
  { value: 'ID', label: '印尼 (ID)' },
  { value: 'MY', label: '马来西亚 (MY)' },
  { value: 'PH', label: '菲律宾 (PH)' },
  { value: 'VN', label: '越南 (VN)' },
  { value: 'CN', label: '中国 (CN)' },
] as const;

const MAX_ITEMS = 50;

interface ItemRow {
  key: string;
  variantId: string;
  variantLabel: string;
  quantity: number;
}

let itemKeyCounter = 0;
function nextItemKey(): string {
  return `item-${++itemKeyCounter}`;
}

interface Props {
  user: CurrentActiveUser;
  warehouses: WarehouseSelectorItem[];
}

export function ShipmentCreateForm({ user, warehouses }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  // 主单字段
  const [vesselName, setVesselName] = useState('');
  const [voyageNumber, setVoyageNumber] = useState('');
  const [originPort, setOriginPort] = useState('');
  const [destinationPort, setDestinationPort] = useState('');
  const [country, setCountry] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [estimatedArrival, setEstimatedArrival] = useState('');
  const [note, setNote] = useState('');

  // 产品明细
  const [items, setItems] = useState<ItemRow[]>([]);

  // Variant 服务端搜索
  const [variantSearch, setVariantSearch] = useState('');
  const [variantDropdownOpen, setVariantDropdownOpen] = useState(false);
  const [variantResults, setVariantResults] = useState<VariantSelectorItem[]>([]);
  const [variantLoading, setVariantLoading] = useState(false);
  const variantSearchRef = useRef<HTMLInputElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeqRef = useRef(0);

  // 按国家过滤仓库
  const filteredWarehouses = useMemo(
    () => (country ? warehouses.filter((w) => w.country === country) : warehouses),
    [country, warehouses],
  );

  // 选中 variant ID 集合
  const selectedVariantIds = useMemo(() => new Set(items.map((i) => i.variantId)), [items]);

  const doVariantSearch = useCallback(
    (c: string, q: string) => {
      if (!c) {
        setVariantResults([]);
        return;
      }
      const seq = ++searchSeqRef.current;
      setVariantLoading(true);
      searchVariants(c, q || undefined)
        .then((result) => {
          if (searchSeqRef.current !== seq) return;
          setVariantLoading(false);
          if (!result.success) {
            toast.error(result.error ?? '搜索 SKU 失败');
            setVariantResults([]);
            return;
          }
          setVariantResults(
            (result.data ?? []).filter((v) => !selectedVariantIds.has(v.id)),
          );
        })
        .catch(() => {
          if (searchSeqRef.current !== seq) return;
          setVariantLoading(false);
          toast.error('搜索 SKU 失败，请稍后重试');
          setVariantResults([]);
        });
    },
    [selectedVariantIds],
  );

  const scheduleVariantSearch = useCallback(
    (c: string, q: string) => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      searchTimerRef.current = setTimeout(() => doVariantSearch(c, q), 250);
    },
    [doVariantSearch],
  );

  const handleVariantSearchChange = useCallback(
    (value: string) => {
      setVariantSearch(value);
      setVariantDropdownOpen(true);
      scheduleVariantSearch(country, value);
    },
    [country, scheduleVariantSearch],
  );

  // 国家变化时清空已选明细（variant 国家绑定）并重新搜索
  const handleCountryChange = useCallback((v: string | null) => {
    const c = v ?? '';
    setCountry(c);
    setWarehouseId('');
    setItems([]);
    setVariantSearch('');
    setVariantResults([]);
    doVariantSearch(c, '');
  }, [doVariantSearch]);

  const handleSelectVariant = useCallback(
    (v: VariantSelectorItem) => {
      if (items.length >= MAX_ITEMS) {
        toast.error(`最多添加 ${MAX_ITEMS} 个产品`);
        return;
      }
      const label = v.productName ? `${v.sku} — ${v.productName}` : v.sku;
      setItems((prev) => [
        ...prev,
        { key: nextItemKey(), variantId: v.id, variantLabel: label, quantity: 1 },
      ]);
      setVariantSearch('');
      setVariantDropdownOpen(false);
    },
    [items.length],
  );

  const handleRemoveItem = useCallback((key: string) => {
    setItems((prev) => prev.filter((i) => i.key !== key));
  }, []);

  const handleQuantityChange = useCallback((key: string, value: number) => {
    setItems((prev) =>
      prev.map((i) => (i.key === key ? { ...i, quantity: Math.max(1, value | 0) } : i)),
    );
  }, []);

  const isOperator = user.roleName === 'operator';

  const canSubmit =
    !submitting &&
    country !== '' &&
    items.length >= 1 &&
    items.length <= MAX_ITEMS &&
    items.every((i) => Number.isInteger(i.quantity) && i.quantity >= 1) &&
    (!isOperator || warehouseId !== '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);

    try {
      const result = await createShipment({
        vesselName: vesselName.trim() || undefined,
        voyageNumber: voyageNumber.trim() || undefined,
        originPort: originPort.trim() || undefined,
        destinationPort: destinationPort.trim() || undefined,
        country,
        warehouseId: warehouseId || undefined,
        estimatedArrival: estimatedArrival || undefined,
        note: note.trim() || undefined,
        items: items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
      });

      if (!result.success) {
        toast.error(result.error ?? '创建失败');
        return;
      }

      toast.success('在途记录创建成功');
      router.push('/dashboard/shipments');
    } catch {
      toast.error('创建在途记录失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5 max-w-3xl" aria-label="新建在途记录表单">
      {/* 基本信息 */}
      <fieldset className="space-y-4">
        <legend className="text-base font-semibold">基本信息</legend>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="vesselName">船名</Label>
            <Input
              id="vesselName"
              value={vesselName}
              onChange={(e) => setVesselName(e.target.value)}
              placeholder="例：EVER FORTUNE"
              maxLength={200}
              aria-label="船名"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="voyageNumber">航次</Label>
            <Input
              id="voyageNumber"
              value={voyageNumber}
              onChange={(e) => setVoyageNumber(e.target.value)}
              placeholder="例：V1234-567E"
              maxLength={100}
              aria-label="航次"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="originPort">起运港</Label>
            <Input
              id="originPort"
              value={originPort}
              onChange={(e) => setOriginPort(e.target.value)}
              placeholder="例：上海港"
              maxLength={100}
              aria-label="起运港"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="destinationPort">目的港</Label>
            <Input
              id="destinationPort"
              value={destinationPort}
              onChange={(e) => setDestinationPort(e.target.value)}
              placeholder="例：曼谷港"
              maxLength={100}
              aria-label="目的港"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="country">
              目的国 <span className="text-destructive">*</span>
            </Label>
            <Select value={country || '__none__'} onValueChange={handleCountryChange}>
              <SelectTrigger id="country" className="w-full" aria-label="选择目的国">
                <SelectValue placeholder="选择国家" />
              </SelectTrigger>
              <SelectContent>
                {COUNTRIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="warehouseId">
              仓库{isOperator ? ' *' : ''}
            </Label>
            <Select
              value={warehouseId || '__none__'}
              onValueChange={(v) => setWarehouseId(v === '__none__' || !v ? '' : v)}
              disabled={!country}
            >
              <SelectTrigger id="warehouseId" className="w-full" aria-label="选择仓库">
                <SelectValue placeholder={country ? '选择仓库' : '请先选择国家'} />
              </SelectTrigger>
              <SelectContent>
                {!isOperator && (
                  <SelectItem value="__none__">不指定仓库</SelectItem>
                )}
                {filteredWarehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
                {filteredWarehouses.length === 0 && country && (
                  <div className="px-2 py-4 text-sm text-muted-foreground text-center">
                    暂无可用仓库
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="estimatedArrival">预计到仓日期</Label>
            <Input
              id="estimatedArrival"
              type="date"
              value={estimatedArrival}
              onChange={(e) => setEstimatedArrival(e.target.value)}
              aria-label="预计到仓日期"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="note">备注</Label>
          <Textarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="内部备注（可选）"
            maxLength={500}
            rows={2}
            aria-label="备注"
          />
        </div>
      </fieldset>

      {/* 产品明细 */}
      <fieldset className="space-y-3">
        <legend className="text-base font-semibold">
          产品明细 <span className="text-destructive">*</span>
          {items.length > 0 && (
            <span className="text-sm font-normal text-muted-foreground ml-2">
              ({items.length}/{MAX_ITEMS})
            </span>
          )}
        </legend>

        {/* Variant 搜索添加 */}
        {country ? (
          <div className="relative">
            <Label htmlFor="variantSearch">添加 SKU</Label>
            <div className="mt-2 relative">
              <div
                className={cn(
                  'flex items-center rounded-lg border border-input bg-transparent px-2.5 h-9',
                  variantDropdownOpen && 'ring-2 ring-ring/20 border-ring',
                )}
              >
                <SearchIcon className="size-4 text-muted-foreground shrink-0" />
                <input
                  ref={variantSearchRef}
                  id="variantSearch"
                  className="w-full text-sm outline-none bg-transparent ml-2"
                  placeholder="搜索 SKU 或产品名称..."
                  value={variantSearch}
                  onChange={(e) => handleVariantSearchChange(e.target.value)}
                  onFocus={() => setVariantDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setVariantDropdownOpen(false), 200)}
                  aria-label="搜索 SKU 或产品名称"
                  disabled={items.length >= MAX_ITEMS}
                />
                {variantLoading && (
                  <Loader2Icon className="size-4 text-muted-foreground shrink-0 animate-spin" />
                )}
                {variantSearch && !variantLoading && (
                  <button
                    type="button"
                    onClick={() => setVariantSearch('')}
                    className="p-0.5 hover:bg-muted rounded"
                    aria-label="清除搜索"
                  >
                    <XIcon className="size-3.5 text-muted-foreground" />
                  </button>
                )}
              </div>

              {variantDropdownOpen && (
                <div className="absolute z-50 mt-1 w-full rounded-lg border bg-popover shadow-md max-h-60 overflow-y-auto">
                  {variantResults.length === 0 ? (
                    <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                      {variantLoading
                        ? '搜索中...'
                        : variantSearch
                          ? '无匹配结果'
                          : items.length >= MAX_ITEMS
                            ? `已达到上限 ${MAX_ITEMS} 个产品`
                            : '输入关键词搜索'}
                    </div>
                  ) : (
                    variantResults.slice(0, 50).map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-accent cursor-pointer"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSelectVariant(v);
                        }}
                        aria-label={`添加 ${v.sku}`}
                      >
                        <span className="font-medium">{v.sku}</span>
                        {v.productName && (
                          <span className="text-muted-foreground ml-2">{v.productName}</span>
                        )}
                        <span className="text-xs text-muted-foreground ml-2">({v.country})</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">请先选择目的国</p>
        )}

        {/* 已选明细表格 */}
        {items.length > 0 ? (
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm min-w-[320px]" aria-label="产品明细列表">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">SKU</th>
                  <th className="text-left px-3 py-2 font-medium w-24">数量</th>
                  <th className="w-10 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.key} className="border-t">
                    <td className="px-3 py-2">{item.variantLabel}</td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) => handleQuantityChange(item.key, Number(e.target.value))}
                        className="h-8 w-20"
                        aria-label={`${item.variantLabel} 数量`}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => handleRemoveItem(item.key)}
                        aria-label={`移除 ${item.variantLabel}`}
                      >
                        <Trash2Icon className="size-3.5 text-muted-foreground" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">尚未添加产品，请在搜索框中搜索并添加</p>
        )}
      </fieldset>

      {/* 提交 */}
      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={!canSubmit} aria-label="创建在途记录">
          {submitting ? (
            <>
              <Loader2Icon className="size-4 animate-spin mr-1" />
              提交中...
            </>
          ) : (
            '创建在途记录'
          )}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()} aria-label="取消并返回">
          取消
        </Button>
      </div>
    </form>
  );
}
