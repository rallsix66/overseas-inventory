import { Skeleton } from '@/components/ui/skeleton';

export default function DashboardLoading() {
  return (
    <div className="space-y-4">
      <div className="flex justify-between gap-4">
        <div className="space-y-2"><Skeleton className="h-6 w-40 motion-reduce:animate-none" /><Skeleton className="h-4 w-72 motion-reduce:animate-none" /></div>
        <Skeleton className="h-9 w-64 motion-reduce:animate-none" />
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-32 motion-reduce:animate-none" />)}
      </div>
      <div className="grid gap-3 xl:grid-cols-2"><Skeleton className="h-72 motion-reduce:animate-none" /><Skeleton className="h-72 motion-reduce:animate-none" /></div>
      <div className="grid gap-3 xl:grid-cols-2"><Skeleton className="h-64 motion-reduce:animate-none" /><Skeleton className="h-64 motion-reduce:animate-none" /></div>
    </div>
  );
}
