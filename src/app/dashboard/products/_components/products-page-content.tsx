'use client';

// 产品列表页 — 客户端交互层
// 处理 Sheet 表单、停用确认 Dialog、搜索表单、表格渲染和展开行
import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, Search, Pencil, Ban, Circle, ChevronRight, ChevronDown } from 'lucide-react';
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
import type { ProductItem, ProductVariantBindingBrief } from '@/features/products/types';

const MATCH_STATUS_LABEL: Record<string, string> = {
  matched: '已匹配',
  unmatched: '未匹配',
  pending: '待确认',
};

const MATCH_STATUS_CLASS: Record<string, string> = {
  matched: 'bg-green-50 text-green-700',
  unmatched: 'bg-gray-100 text-gray-600',
  pending: 'bg-yellow-50 text-yellow-700',
};

const OVERSEAS_COUNTRIES = ['TH', 'ID', 'MY', 'PH', 'VN'] as const;

const COUNTRY_LABEL: Record<string, string> = {
  TH: '泰国',
  ID: '印尼',
  MY: '马来西亚',
  PH: '菲律宾',
  VN: '越南',
};

interface Props {
  data: ProductItem[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
  isAdmin: boolean;
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
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
  const [editingVariants, setEditingVariants] = useState<ProductVariantBindingBrief[] | undefined>();

  // 停用确认 Dialog 状态
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablingProduct, setDisablingProduct] = useState<ProductItem | null>(null);
  const [disabling, setDisabling] = useState(false);

  // 展开行状态
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // 切换展开/收起
  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // 获取编辑时传入的 variant 绑定数据
  const getVariantsForEdit = useCallback(
    (product: ProductItem): ProductVariantBindingBrief[] => {
      const bindings = product.bindings;
      if (!bindings) return [];
      const all: ProductVariantBindingBrief[] = [...bindings.domestic];
      for (const countryVariants of Object.values(bindings.overseas)) {
        all.push(...countryVariants);
      }
      return all;
    },
    []
  );

  // 打开新增表单
  const openAdd = useCallback(() => {
    setFormMode('add');
    setEditingProduct(undefined);
    setEditingVariants(undefined);
    setFormOpen(true);
  }, []);

  // 打开编辑表单
  const openEdit = useCallback(
    (product: ProductItem) => {
      setFormMode('edit');
      setEditingProduct(product);
      setEditingVariants(getVariantsForEdit(product));
      setFormOpen(true);
    },
    [getVariantsForEdit]
  );

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

  // 表格总列数（展开按钮 + 产品编码 + 产品名称 + 分类 + 安全库存 + 关联SKU + 状态 + 操作）
  const colSpan = isAdmin ? 8 : 7;

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
                <TableHead className="w-10">{/* 展开按钮 */}</TableHead>
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
              {data.map((item) => {
                const isExpanded = expandedIds.has(item.id);
                const bindings = item.bindings;
                const hasBindings =
                  bindings &&
                  (bindings.domestic.length > 0 ||
                    Object.values(bindings.overseas).some((arr) => arr.length > 0));

                return (
                  <TableRowListWithExpand
                    key={item.id}
                    item={item}
                    isAdmin={isAdmin}
                    isExpanded={isExpanded}
                    onToggleExpand={() => toggleExpand(item.id)}
                    onEdit={() => openEdit(item)}
                    onDisable={() => openDisable(item)}
                    colSpan={colSpan}
                    hasBindings={hasBindings}
                    bindings={bindings}
                  />
                );
              })}
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
        variants={editingVariants}
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

/** 含展开行的一行产品 */
function TableRowListWithExpand({
  item,
  isAdmin,
  isExpanded,
  onToggleExpand,
  onEdit,
  onDisable,
  colSpan,
  hasBindings,
  bindings,
}: {
  item: ProductItem;
  isAdmin: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onDisable: () => void;
  colSpan: number;
  hasBindings: boolean | undefined;
  bindings: ProductItem['bindings'];
}) {
  return (
    <>
      {/* 产品行 */}
      <TableRow>
        <TableCell>
          <button
            type="button"
            onClick={onToggleExpand}
            className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
            aria-label={isExpanded ? '收起' : '展开'}
            title={isExpanded ? '收起 SKU 明细' : '展开 SKU 明细'}
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
        </TableCell>
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
                onClick={onEdit}
                title="编辑"
              >
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onDisable}
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

      {/* 展开行：SKU 绑定明细 */}
      {isExpanded && (
        <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
          <TableCell colSpan={colSpan} className="p-0">
            <ExpandRowContent hasBindings={hasBindings} bindings={bindings} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/** 展开行内容：SKU 绑定明细 */
function ExpandRowContent({
  hasBindings,
  bindings,
}: {
  hasBindings: boolean | undefined;
  bindings: ProductItem['bindings'];
}) {
  if (!hasBindings) {
    return (
      <div className="px-8 py-4 border-t border-gray-100">
        <p className="text-xs text-muted-foreground">暂无 SKU 绑定数据</p>
      </div>
    );
  }

  const domestic = bindings?.domestic ?? [];
  const overseas = bindings?.overseas ?? {};

  return (
    <div className="px-6 py-3 border-t border-gray-100">
      {/* 标题 */}
      <p className="text-xs font-medium text-gray-700 mb-3">SKU 绑定明细</p>

      <div className="border rounded border-gray-200 overflow-hidden">
        {/* 国内 SKU */}
        <div className="px-3 py-2">
          <h4 className="text-xs font-medium text-gray-500 mb-1.5">国内 SKU</h4>
          {domestic.length === 0 ? (
            <p className="text-xs text-muted-foreground py-1">
              暂无国内 SKU 绑定 / 国内库存待接入
            </p>
          ) : (
            <table className="w-full text-xs border border-gray-100">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left px-2 py-1 font-medium text-gray-600">SKU</th>
                  <th className="text-left px-2 py-1 font-medium text-gray-600">仓库产品名</th>
                  <th className="text-left px-2 py-1 font-medium text-gray-600">匹配状态</th>
                  <th className="text-left px-2 py-1 font-medium text-gray-600">最后同步</th>
                </tr>
              </thead>
              <tbody>
                {domestic.map((v) => (
                  <tr key={v.id} className="border-t border-gray-100">
                    <td className="px-2 py-1 font-medium">{v.sku}</td>
                    <td className="px-2 py-1 text-gray-600">{v.name}</td>
                    <td className="px-2 py-1">
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${MATCH_STATUS_CLASS[v.matchStatus] ?? 'bg-gray-100 text-gray-600'}`}
                      >
                        {MATCH_STATUS_LABEL[v.matchStatus] ?? v.matchStatus}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-gray-500">{formatTime(v.lastSyncAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 海外仓 SKU */}
        <div className="px-3 py-2 border-t border-gray-200">
          <h4 className="text-xs font-medium text-gray-500 mb-1.5">海外仓 SKU</h4>
          {OVERSEAS_COUNTRIES.every((c) => (overseas[c] ?? []).length === 0) ? (
            <p className="text-xs text-muted-foreground py-1">
              暂无海外仓 SKU 绑定
            </p>
          ) : (
            <div className="space-y-2">
              {OVERSEAS_COUNTRIES.map((country) => {
                const list = overseas[country] ?? [];
                if (list.length === 0) return null;
                return (
                  <div key={country}>
                    <h5 className="text-xs font-medium text-gray-500 mb-1">
                      {COUNTRY_LABEL[country] ?? country}
                    </h5>
                    <table className="w-full text-xs border border-gray-100">
                      <thead>
                        <tr className="bg-gray-50">
                          <th className="text-left px-2 py-1 font-medium text-gray-600">SKU</th>
                          <th className="text-left px-2 py-1 font-medium text-gray-600">仓库产品名</th>
                          <th className="text-left px-2 py-1 font-medium text-gray-600">匹配状态</th>
                          <th className="text-left px-2 py-1 font-medium text-gray-600">最后同步</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((v) => (
                          <tr key={v.id} className="border-t border-gray-100">
                            <td className="px-2 py-1 font-medium">{v.sku}</td>
                            <td className="px-2 py-1 text-gray-600">{v.name}</td>
                            <td className="px-2 py-1">
                              <span
                                className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${MATCH_STATUS_CLASS[v.matchStatus] ?? 'bg-gray-100 text-gray-600'}`}
                              >
                                {MATCH_STATUS_LABEL[v.matchStatus] ?? v.matchStatus}
                              </span>
                            </td>
                            <td className="px-2 py-1 text-gray-500">{formatTime(v.lastSyncAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
