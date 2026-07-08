'use client';

// BigSeller 风格分页组件
// 显示：总条数 + 页码按钮 + 省略号 + 每页条数选择 + 上一页/下一页
// 最大可见页码数 = 5（两端省略号自动出现）
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

export interface PaginationProps {
  /** 总记录数 */
  total: number;
  /** 当前页码（1-based） */
  page: number;
  /** 每页条数 */
  pageSize: number;
  /** 页码变更回调 */
  onPageChange: (page: number) => void;
  /** 每页条数变更回调 */
  onPageSizeChange: (pageSize: number) => void;
}

/**
 * 生成页码数组，超出 5 个时使用省略号
 *
 * 策略：
 * - 总页数 ≤ 7：全部显示
 * - 总页数 > 7：
 *   - 当前页靠近开头（≤4）：[1,2,3,4,5,...,N]
 *   - 当前页靠近末尾（≥N-3）：[1,...,N-4,N-3,N-2,N-1,N]
 *   - 中间：[1,...,p-1,p,p+1,...,N]
 */
function generatePages(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | 'ellipsis')[] = [];

  if (current <= 4) {
    // 靠近开头
    for (let i = 1; i <= 5; i++) pages.push(i);
    pages.push('ellipsis');
    pages.push(total);
  } else if (current >= total - 3) {
    // 靠近末尾
    pages.push(1);
    pages.push('ellipsis');
    for (let i = total - 4; i <= total; i++) pages.push(i);
  } else {
    // 中间
    pages.push(1);
    pages.push('ellipsis');
    pages.push(current - 1);
    pages.push(current);
    pages.push(current + 1);
    pages.push('ellipsis');
    pages.push(total);
  }

  return pages;
}

export function Pagination({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pages = generatePages(page, totalPages);

  // 边界修正：如果 page 超出范围（例如删除数据后），不做 crash
  const safePage = Math.min(page, totalPages);

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mt-5">
      {/* 左侧：总条数 + 每页条数 */}
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>共 {total} 条</span>
        <div className="flex items-center gap-1.5">
          <span>每页</span>
          <Select
            value={String(pageSize)}
            onValueChange={(v) => onPageSizeChange(Number(v))}
          >
            <SelectTrigger size="sm" className="w-[75px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span>条</span>
        </div>
      </div>

      {/* 右侧：页码按钮 */}
      <div className="flex items-center gap-1">
        {/* 上一页 */}
        <Button
          variant="outline"
          size="icon-sm"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          aria-label="上一页"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>

        {/* 页码按钮 */}
        {pages.map((p, idx) => {
          if (p === 'ellipsis') {
            return (
              <span
                key={`ellipsis-${idx}`}
                className="inline-flex items-center justify-center w-8 h-8 text-xs text-muted-foreground select-none"
              >
                …
              </span>
            );
          }

          const isActive = p === safePage;
          return (
            <Button
              key={p}
              variant={isActive ? 'default' : 'outline'}
              size="icon-sm"
              onClick={() => onPageChange(p)}
              aria-label={`第 ${p} 页`}
              aria-current={isActive ? 'page' : undefined}
            >
              {p}
            </Button>
          );
        })}

        {/* 下一页 */}
        <Button
          variant="outline"
          size="icon-sm"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
          aria-label="下一页"
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
