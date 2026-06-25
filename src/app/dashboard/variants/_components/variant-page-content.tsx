'use client';

// SKU 管理页 — 客户端交互层
// 处理归档筛选标签、搜索、复选框批量选择、归档/恢复操作
import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { variantColumns } from '@/features/variants/columns';
import { ArchiveControls } from '@/features/variants/components/archive-controls';
import type { VariantItem, VariantArchiveStatus } from '@/features/variants/types';
import type { PaginatedResult } from '@/types/common';

interface VariantPageContentProps {
  result: PaginatedResult<VariantItem>;
  isAdmin: boolean;
  archiveStatus: VariantArchiveStatus;
  search: string;
}

const ARCHIVE_TABS: { value: VariantArchiveStatus; label: string }[] = [
  { value: 'active', label: '活跃' },
  { value: 'archived', label: '已归档' },
  { value: 'all', label: '全部' },
];

/** 构建查询字符串，保留 archiveStatus 和 search */
function buildQuery(params: {
  archiveStatus: VariantArchiveStatus;
  search: string;
  page?: number;
}): string {
  const qs = new URLSearchParams();
  if (params.archiveStatus !== 'active') qs.set('archiveStatus', params.archiveStatus);
  if (params.search) qs.set('search', params.search);
  if (params.page && params.page > 1) qs.set('page', String(params.page));
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export function VariantPageContent({
  result,
  isAdmin,
  archiveStatus,
  search,
}: VariantPageContentProps) {
  const router = useRouter();
  const { data: items, total, page, pageSize } = result;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const searchInputRef = useRef<HTMLInputElement>(null);

  const allSelected =
    items.length > 0 && items.every((item) => selectedIds.has(item.id));
  const someSelected = items.some((item) => selectedIds.has(item.id));

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((item) => item.id)));
    }
  }, [allSelected, items]);

  const toggleOne = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectedItems = items.filter((item) => selectedIds.has(item.id));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // indeterminate state for partial selection
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected && !allSelected;
    }
  }, [someSelected, allSelected]);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = searchInputRef.current?.value?.trim() ?? '';
    router.push(
      `/dashboard/variants${buildQuery({ archiveStatus, search: trimmed })}`
    );
  }

  function handleClearSearch() {
    router.push(
      `/dashboard/variants${buildQuery({ archiveStatus, search: '' })}`
    );
  }

  return (
    <div>
      {/* 搜索 + 归档筛选标签 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1 border-b">
          {ARCHIVE_TABS.map((tab) => {
            // Operator 只能看活跃标签
            if (!isAdmin && tab.value !== 'active') return null;

            const isActive = archiveStatus === tab.value;
            return (
              <Link
                key={tab.value}
                href={`/dashboard/variants${buildQuery({ archiveStatus: tab.value, search })}`}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-gray-300'
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>

        {/* 搜索框 — key 确保 URL search 变更时 remount 重置 defaultValue */}
        <form key={search} onSubmit={handleSearchSubmit} className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              type="text"
              placeholder="搜索 SKU / 名称…"
              defaultValue={search}
              className="w-56 pl-8 pr-8 h-9 text-sm"
            />
            {search && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <Button type="submit" variant="outline" size="sm" className="h-9">
            搜索
          </Button>
        </form>
      </div>

      {/* 空数据状态 */}
      {items.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg mb-2">
            {search ? '未找到匹配的 SKU' : '暂无 SKU 数据'}
          </p>
          <p className="text-sm">
            {search
              ? `没有 SKU 或名称包含 "${search}" 的记录`
              : archiveStatus === 'archived'
                ? '没有已归档的 SKU'
                : archiveStatus === 'all'
                  ? '系统中尚无任何 SKU 记录'
                  : '所有 SKU 均处于活跃状态，等待海外仓同步创建'}
          </p>
        </div>
      ) : (
        <>
          {/* 批量操作栏 — 仅 Admin */}
          {isAdmin && (
            <ArchiveControls
              selectedItems={selectedItems}
              archiveStatus={archiveStatus}
              onClearSelection={() => setSelectedIds(new Set())}
            />
          )}

          {/* 数据表格 */}
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  {/* 复选框列 — 仅 Admin */}
                  {isAdmin && (
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        ref={selectAllRef}
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="全选"
                        className="w-4 h-4 rounded border-gray-300 cursor-pointer"
                      />
                    </TableHead>
                  )}
                  {variantColumns.map((col) => (
                    <TableHead key={col.key}>{col.header}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id} className="hover:bg-gray-50">
                    {isAdmin && (
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(item.id)}
                          onChange={() => toggleOne(item.id)}
                          aria-label={`选择 ${item.sku}`}
                          className="w-4 h-4 rounded border-gray-300 cursor-pointer"
                        />
                      </TableCell>
                    )}
                    {variantColumns.map((col) => (
                      <TableCell key={col.key}>
                        {col.render
                          ? col.render(item)
                          : String(item[col.key as keyof VariantItem] ?? '—')}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
              <span>
                共 {total} 条，第 {page} / {totalPages} 页
              </span>
              <div className="flex gap-1">
                {page > 1 && (
                  <Link
                    href={`/dashboard/variants${buildQuery({ archiveStatus, search, page: page - 1 })}`}
                    className="px-3 py-1 border rounded hover:bg-gray-50"
                  >
                    上一页
                  </Link>
                )}
                {page < totalPages && (
                  <Link
                    href={`/dashboard/variants${buildQuery({ archiveStatus, search, page: page + 1 })}`}
                    className="px-3 py-1 border rounded hover:bg-gray-50"
                  >
                    下一页
                  </Link>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
