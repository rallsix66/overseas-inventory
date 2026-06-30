// P3-S2E: 在途入口收口 — /dashboard/shipments 是唯一在途维护入口
// /dashboard/inventory/in-transit 不再做重复页面，重定向到 /dashboard/shipments
import { redirect } from 'next/navigation';

export default function InTransitInventoryPage() {
  redirect('/dashboard/shipments');
}
