// === FILE PURPOSE ===
// Shared date utility functions used across renderer components.

/** Format date string as "Feb 25" or "Feb 25, 2026" */
export function formatDate(dateStr: string, includeYear = false): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (includeYear) opts.year = 'numeric';
  return new Date(dateStr).toLocaleDateString('en-US', opts);
}

/** Format ISO date as relative time: "2h ago", "3d ago", etc. Falls back to short date for 30+ days */
export function formatRelativeTime(isoDate: string): string {
  const seconds = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  const days = Math.floor(seconds / 86400);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(isoDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Get badge classes and label for a due date string */
export function getDueDateBadge(dueDateStr: string): { label: string; classes: string } {
  const now = new Date();
  const due = new Date(dueDateStr);
  const diffMs = due.getTime() - now.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffMs < 0) {
    return { label: 'Overdue', classes: 'bg-red-500/20 text-red-400' };
  }
  if (diffDays < 1) {
    return { label: 'Due today', classes: 'bg-amber-500/20 text-amber-400' };
  }
  if (diffDays < 3) {
    return { label: `Due in ${Math.ceil(diffDays)}d`, classes: 'bg-amber-500/10 text-amber-300' };
  }
  if (diffDays < 7) {
    return { label: `Due in ${Math.ceil(diffDays)}d`, classes: 'bg-blue-500/10 text-blue-300' };
  }
  const formatted = new Date(dueDateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return { label: formatted, classes: 'bg-surface-800 text-surface-400' };
}
