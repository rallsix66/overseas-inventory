'use client';

// SKU 管理共享布局 — 统一标题 + 全部 SKU / 待处理 SKU 视图标签
// 两个子路由复用此布局，避免重复标题
import { usePathname } from 'next/navigation';
import Link from 'next/link';

const TABS = [
  { label: '全部 SKU', href: '/dashboard/variants' },
  { label: '待处理 SKU', href: '/dashboard/variants/unmatched' },
];

export default function VariantsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="px-6">
      <h1 className="text-xl font-semibold mb-5">SKU 管理</h1>

      {/* 视图标签 — 与现有活跃/已归档/全部筛选标签样式一致 */}
      <div className="flex items-center gap-1 border-b mb-4">
        {TABS.map((tab) => {
          const isActive =
            tab.href === '/dashboard/variants'
              ? pathname === '/dashboard/variants'
              : pathname.startsWith(tab.href);

          return (
            <Link
              key={tab.href}
              href={tab.href}
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

      {children}
    </div>
  );
}
