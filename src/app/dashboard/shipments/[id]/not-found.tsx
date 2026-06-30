// 在途详情 — 记录不存在或无权访问
import { ArrowLeft, FileQuestion } from 'lucide-react';
import Link from 'next/link';

export default function ShipmentDetailNotFound() {
  return (
    <div className="px-6 py-20 text-center">
      <FileQuestion className="w-10 h-10 text-muted-foreground/40 mx-auto mb-4" />
      <h2 className="text-lg font-semibold text-gray-900 mb-2">
        在途记录不存在
      </h2>
      <p className="text-sm text-muted-foreground mb-5">
        该记录可能已被删除，或您没有访问权限
      </p>
      <Link
        href="/dashboard/shipments"
        className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
      >
        <ArrowLeft className="w-4 h-4 mr-1" />
        返回列表
      </Link>
    </div>
  );
}
