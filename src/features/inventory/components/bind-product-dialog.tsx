'use client';

// P6-UX-V2-D: 产品绑定 Dialog — 未匹配海外库存行绑定到标准产品
//
// Admin-only 操作。通过搜索选择标准 Product → Server Action 绑定到 ProductVariant。
// 绑定后 variant.match_status → 'matched'，product_id → 目标产品。
// 保持 Product → ProductVariant → Inventory 三层模型。

import { useState, useCallback } from 'react';
import { Loader2, Package } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { searchProducts } from '@/features/products/actions';
import { bindOverseasVariant } from '@/features/inventory/actions';
import type { ProductItem } from '@/features/products/types';

interface Props {
  open: boolean;
  variantId: string;
  sku: string;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function BindProductDialog({ open, variantId, sku, onOpenChange, onSuccess }: Props) {
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [binding, setBinding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const selectedProduct = products.find((p) => p.id === selectedProductId) ?? null;

  /** 搜索产品（防抖由调用方控制） */
  const handleSearch = useCallback(async (value: string) => {
    setQuery(value);
    if (!value.trim()) {
      setProducts([]);
      setHasSearched(false);
      setError(null);
      return;
    }

    setSearching(true);
    setError(null);
    try {
      const result = await searchProducts(value.trim());
      setHasSearched(true);
      if (result.success && result.data) {
        setProducts(result.data);
        if (result.data.length === 0) {
          setSelectedProductId(null);
        }
      } else {
        setProducts([]);
        setError(result.error ?? '搜索失败');
      }
    } catch {
      setProducts([]);
      setError('搜索产品失败，请稍后重试');
    } finally {
      setSearching(false);
    }
  }, []);

  /** 确认绑定 */
  async function handleConfirm() {
    if (!selectedProductId) return;

    setBinding(true);
    setError(null);
    try {
      const result = await bindOverseasVariant(variantId, selectedProductId);
      if (result.success) {
        toast.success(
          selectedProduct
            ? `已将 ${sku} 绑定到 ${selectedProduct.name}`
            : '产品绑定成功',
        );
        resetAndClose();
        onSuccess();
      } else {
        setError(result.error ?? '绑定失败');
      }
    } catch {
      setError('绑定失败，请稍后重试');
    } finally {
      setBinding(false);
    }
  }

  function resetAndClose() {
    setQuery('');
    setProducts([]);
    setSelectedProductId(null);
    setSearching(false);
    setBinding(false);
    setError(null);
    setHasSearched(false);
    onOpenChange(false);
  }

  function handleOpenChange(open: boolean) {
    if (!open) resetAndClose();
    else onOpenChange(true);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px]" showCloseButton>
        <DialogHeader>
          <DialogTitle>绑定产品</DialogTitle>
          <DialogDescription>
            将 SKU <span className="font-mono text-foreground">{sku}</span> 绑定到 DIS
            标准产品。绑定后库存状态将参与低库存统计。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* 搜索框 */}
          <Input
            placeholder="搜索产品编码或名称…"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            autoFocus
          />

          {/* 搜索结果 */}
          <div className="border rounded-md">
            {searching && (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                搜索中…
              </div>
            )}

            {!searching && error && (
              <div className="py-6 text-center text-sm text-destructive">{error}</div>
            )}

            {!searching && !error && hasSearched && products.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
                未找到匹配的产品
              </div>
            )}

            {!searching && products.length > 0 && (
              <Command>
                <CommandList>
                  <CommandEmpty>未找到匹配的产品</CommandEmpty>
                  <CommandGroup heading="标准产品">
                    {products.map((p) => (
                      <CommandItem
                        key={p.id}
                        value={p.id}
                        onSelect={() => setSelectedProductId(p.id)}
                        data-checked={selectedProductId === p.id}
                      >
                        <div className="flex flex-col">
                          <span className="font-medium">{p.name}</span>
                          <span className="text-xs text-muted-foreground">
                            编码：{p.code} · SKU 数：{p.skuCount}
                          </span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            )}
          </div>

          {/* 已选产品提示 */}
          {selectedProduct && (
            <p className="text-sm text-muted-foreground">
              已选择：<span className="font-medium text-foreground">{selectedProduct.name}</span>
              （{selectedProduct.code}）
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={resetAndClose} disabled={binding}>
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedProductId || binding}>
            {binding && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            确认绑定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
