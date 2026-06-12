'use client';

// 产品详情页 — 客户端交互层
// 处理编辑 Sheet 和 admin/operator 权限控制
import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ProductForm } from '@/features/products/components/product-form';
import type { ProductDetail } from '@/features/products/types';

const MATCH_STATUS_LABEL: Record<string, string> = {
  matched: '已匹配',
  unmatched: '未匹配',
  pending: '待确认',
};

interface Props {
  product: ProductDetail;
  isAdmin: boolean;
}

export function ProductDetailClient({ product, isAdmin }: Props) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);

  const handleFormClose = useCallback(
    (open: boolean) => {
      setFormOpen(open);
      if (!open) router.refresh();
    },
    [router]
  );

  return (
    <div className="px-6 py-6">
      {/* 返回 */}
      <Button
        variant="ghost"
        size="sm"
        className="mb-4 -ml-2"
        onClick={() => router.push('/dashboard/products')}
      >
        <ArrowLeft className="w-4 h-4" />
        返回产品列表
      </Button>

      {/* 基本信息 */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{product.name}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            编码 {product.code}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {product.is_active ? (
            <Badge variant="default" className="bg-green-50 text-green-700 hover:bg-green-50">
              启用
            </Badge>
          ) : (
            <Badge variant="secondary">停用</Badge>
          )}
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={() => setFormOpen(true)}>
              <Pencil className="w-3.5 h-3.5" />
              编辑
            </Button>
          )}
        </div>
      </div>

      {/* 基本信息卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5 p-4 rounded-lg border bg-white">
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">分类</p>
          <p className="text-sm font-medium">{product.category || '—'}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">单位</p>
          <p className="text-sm font-medium">{product.unit}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">安全库存</p>
          <p className="text-sm font-medium">{product.safety_stock}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">关联 SKU</p>
          <p className="text-sm font-medium">{product.variants.length} 个</p>
        </div>
      </div>

      {/* 关联 SKU 表 */}
      <div className="mb-5">
        <h2 className="text-base font-semibold text-gray-900 mb-3">关联 SKU</h2>
        {product.variants.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center border rounded-lg">
            暂无关联 SKU
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead>SKU</TableHead>
                <TableHead>国家</TableHead>
                <TableHead>仓库产品名</TableHead>
                <TableHead>匹配状态</TableHead>
                <TableHead>最后同步</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {product.variants.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-medium">{v.sku}</TableCell>
                  <TableCell>{v.country}</TableCell>
                  <TableCell>{v.name}</TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        v.matchStatus === 'matched'
                          ? 'bg-green-50 text-green-700'
                          : v.matchStatus === 'pending'
                            ? 'bg-yellow-50 text-yellow-700'
                            : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {MATCH_STATUS_LABEL[v.matchStatus] ?? v.matchStatus}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {v.lastSyncAt
                      ? new Date(v.lastSyncAt).toLocaleString('zh-CN', {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* 各仓库存表 */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-3">各仓库存</h2>
        {product.inventory.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center border rounded-lg">
            暂无库存数据
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead>SKU</TableHead>
                <TableHead>国家</TableHead>
                <TableHead>仓库</TableHead>
                <TableHead className="text-right">库存数量</TableHead>
                <TableHead className="text-right">安全库存</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>最后同步</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {product.inventory.map((inv) => {
                const isLow = inv.quantity <= inv.safetyStock;
                const gap = inv.safetyStock - inv.quantity;
                return (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">{inv.sku}</TableCell>
                    <TableCell>{inv.country}</TableCell>
                    <TableCell>{inv.warehouseName}</TableCell>
                    <TableCell className="text-right">{inv.quantity}</TableCell>
                    <TableCell className="text-right">{inv.safetyStock}</TableCell>
                    <TableCell>
                      {isLow ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700">
                          缺口 {gap}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700">
                          正常
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {inv.lastSyncAt
                        ? new Date(inv.lastSyncAt).toLocaleString('zh-CN', {
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* 编辑 Sheet 表单 */}
      {isAdmin && (
        <ProductForm
          open={formOpen}
          onOpenChange={handleFormClose}
          mode="edit"
          defaultValues={{
            id: product.id,
            code: product.code,
            name: product.name,
            safety_stock: product.safety_stock,
            category: product.category,
            unit: product.unit,
            is_active: product.is_active,
            created_at: product.created_at,
            updated_at: product.updated_at,
            skuCount: product.variants.length,
          }}
        />
      )}
    </div>
  );
}
