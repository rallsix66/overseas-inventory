export default function ReplenishmentLoading() {
  return (
    <div className="space-y-4 px-6 py-6" aria-busy="true" aria-label="正在加载补货建议">
      <div className="h-8 w-40 animate-pulse rounded bg-muted" />
      <div className="h-9 w-full animate-pulse rounded bg-muted" />
      <div className="h-72 w-full animate-pulse rounded bg-muted" />
    </div>
  );
}

