// === FILE PURPOSE ===
// Skeleton loading placeholder for lazy-loaded pages. Shown inside
// <Suspense> while the page chunk is being fetched. Mimics the
// general page layout (heading + content rows) with animated pulse bars.

// === DEPENDENCIES ===
// (none — pure Tailwind CSS)

function PageSkeleton() {
  return (
    <div className="p-6 animate-pulse" aria-busy="true" aria-label="Loading page">
      {/* Title bar skeleton */}
      <div className="h-7 w-48 rounded bg-surface-800" />
      {/* Subtitle skeleton */}
      <div className="mt-2 h-4 w-72 rounded bg-surface-800/70" />

      {/* Content skeleton rows */}
      <div className="mt-10 space-y-4">
        <div className="h-4 w-full rounded bg-surface-800/50" />
        <div className="h-4 w-5/6 rounded bg-surface-800/50" />
        <div className="h-4 w-4/6 rounded bg-surface-800/50" />
        <div className="h-4 w-3/4 rounded bg-surface-800/50" />
      </div>
    </div>
  );
}

export default PageSkeleton;
