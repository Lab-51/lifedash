// === FILE PURPOSE ===
// Shared date utility functions usable from both the main process and renderer.

/** Format Date as YYYY-MM-DD string */
export function formatDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Calculate next recurrence date from a due date and recurrence type */
export function getNextRecurrenceDate(dueDate: string, recurrenceType: string): Date {
  const d = new Date(dueDate);
  switch (recurrenceType) {
    case 'daily': d.setDate(d.getDate() + 1); break;
    case 'weekly': d.setDate(d.getDate() + 7); break;
    case 'biweekly': d.setDate(d.getDate() + 14); break;
    case 'monthly': d.setMonth(d.getMonth() + 1); break;
  }
  return d;
}
