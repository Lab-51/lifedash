// === FILE PURPOSE ===
// Shared date utility functions used across renderer components.

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
