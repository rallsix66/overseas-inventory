import { Skeleton } from '@/components/ui/skeleton';

export default function ProductOverviewLoading() {
  return (
    <div className="space-y-5 px-4 py-4 sm:px-6 sm:py-6">
      <div className="space-y-2">
        <Skeleton className="h-6 w-52 motion-reduce:animate-none" />
        <Skeleton className="h-4 w-96 max-w-full motion-reduce:animate-none" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-12 motion-reduce:animate-none" />
        ))}
      </div>
      <Skeleton className="h-10 w-full motion-reduce:animate-none" />
      <Skeleton className="h-80 w-full motion-reduce:animate-none" />
    </div>
  );
}
