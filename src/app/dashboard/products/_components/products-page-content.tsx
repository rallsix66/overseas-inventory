'use client';

// 产品列表页 — 客户端交互层
// 处理 Sheet 表单、停用确认 Dialog、搜索表单和表格渲染
import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, Search, Pencil, Ban, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { ProductForm } from '@/features/products/components/product-form';
import { toggleProductActive } from '@/features/products/actions';
import type { ProductItem } from '@/features/products/types';

interface Props {
  data: ProductItem[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
  isAdmin: boolean;
}

export function ProductsPageContent({
  data,
  total,
  page,
  pageSize,
  search,
  isAdmin,
}: Props) {
  const router = useRouter();

  // Sheet 表单状态
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'add' | 'edit'>('add');
  const [editingProduct, setEditingProduct] = useState<ProductItem | undefined>();

  // 停用确认 Dialog 状态
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablingProduct, setDisablingProduct] = useState<ProductItem | null>(null);
  const [disabling, setDisabling] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // 打开新增表单
  const openAdd = useCallback(() => {
    setFormMode('add');
    setEditingProduct(undefined);
    setFormOpen(true);
  }, []);

  // 打开编辑表单
  const openEdit = useCallback((product: ProductItem) => {
    setFormMode('edit');
    setEditingProduct(product);
    setFormOpen(true);
  }, []);

  // 关闭表单并刷新
  const handleFormClose = useCallback(
    (open: boolean) => {
      setFormOpen(open);
      if (!open) router.refresh();
    },
    [router]
  );

  // 打开停用确认
  const openDisable = useCallback((product: ProductItem) => {
    setDisablingProduct(product);
    setDisableOpen(true);
  }, []);

  // 执行启停切换
  const confirmDisable = useCallback(async () => {
    if (!disablingProduct) return;
    setDisabling(true);

    const result = await toggleProductActive(
      disablingProduct.id,
      !disablingProduct.is_active
    );

    setDisabling(false);
    setDisableOpen(false);
    setDisablingProduct(null);

    if (result.success) {
      toast.success(
        disablingProduct.is_active ? '产品已停用' : '产品已启用'
      );
      router.refresh();
    } else {
      toast.error(result.error ?? '操作失败');
    }
  }, [disablingProduct, router]);

  // 搜索提交
  function handleSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const q = (formData.get('search') as string)?.trim() ?? '';
    if (q) {
      router.push(`/dashboard/products?search=${encodeURIComponent(q)}`);
    } else {
      router.push('/dashboard/products');
    }
  }

  // 分页导航
  function goToPage(p: number) {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (p > 1) params.set('page', String(p));
    const qs = params.toString();
    router.push(`/dashboard/products${qs ? `?${qs}` : ''}`);
  }

  return (
    <div className="px-6 py-6">
      {/* 页头 */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">产品列表</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            管理标准产品，{isAdmin ? '可新增、编辑和启停产品' : '只读查看'}
          </p>
        </div>
        {isAdmin && (
          <Button onClick={openAdd}>
            <Plus className="w-4 h-4" />
            新增产品
          </Button>
        )}
      </div>

      {/* 搜索栏 */}
      <form onSubmit={handleSearch} className="flex gap-2 mb-5">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            name="search"
            defaultValue={search}
            placeholder="搜索产品编码或名称..."
            className="pl-8"
          />
        </div>
        <Button type="submit" variant="outline" size="sm">
          搜索
        </Button>
        {search && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => router.push('/dashboard/products')}
          >
            清除
          </Button>
        )}
      </form>

      {/* 表格 */}
      {data.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-sm text-muted-foreground">
            {search ? '未找到匹配的产品' : '暂无产品数据'}
          </p>
          {!search && isAdmin && (
            <Button variant="outline" className="mt-3" onClick={openAdd}>
              <Plus className="w-4 h-4" />
              创建第一个产品
            </Button>
          )}
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead>产品编码</TableHead>
                <TableHead>产品名称</TableHead>
                <TableHead>分类</TableHead>
                <TableHead className="text-right">安全库存</TableHead>
                <TableHead className="text-center">关联 SKU</TableHead>
                <TableHead>状态</TableHead>
                {isAdmin && <TableHead className="text-right">操作</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.code}</TableCell>
                  <TableCell className="max-w-[240px] truncate">
                    <a
                      href={`/dashboard/products/${item.id}`}
                      className="text-primary hover:underline"
                    >
                      {item.name}
                    </a>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.category || '—'}
                  </TableCell>
                  <TableCell className="text-right">{item.safety_stock}</TableCell>
                  <TableCell className="text-center">{item.skuCount}</TableCell>
                  <TableCell>
                    {item.is_active ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700">
                        启用
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                        停用
                      </span>
                    )}
                  </TableCell>
                  {isAdmin && (
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openEdit(item)}
                          title="编辑"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openDisable(item)}
                          title={item.is_active ? '停用' : '启用'}
                        >
                          {item.is_active ? (
                            <Ban className="w-3.5 h-3.5" />
                          ) : (
                            <Circle className="w-3.5 h-3.5" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-5">
              <p className="text-sm text-muted-foreground">
                共 {total} 条，第 {page} / {totalPages} 页
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => goToPage(page - 1)}
                >
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => goToPage(page + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* 新增/编辑 Sheet 表单 */}
      <ProductForm
        open={formOpen}
        onOpenChange={handleFormClose}
        mode={formMode}
        defaultValues={editingProduct}
      />

      {/* 停用/启用确认 Dialog */}
      <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {disablingProduct?.is_active ? '确认停用' : '确认启用'}
            </DialogTitle>
            <DialogDescription>
              {disablingProduct?.is_active
                ? `确定要停用产品「${disablingProduct?.name}」吗？停用后该产品仍可在已有记录中查看，但不能再用于新的操作。`
                : `确定要启用产品「${disablingProduct?.name}」吗？`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDisableOpen(false)}
              disabled={disabling}
            >
              取消
            </Button>
            <Button
              variant={disablingProduct?.is_active ? 'destructive' : 'default'}
              onClick={confirmDisable}
              disabled={disabling}
            >
              {disabling ? '处理中...' : disablingProduct?.is_active ? '确认停用' : '确认启用'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
