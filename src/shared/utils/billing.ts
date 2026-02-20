// === FILE PURPOSE ===
// Billing utility: converts session minutes to billable hours.
// Rule: sessions over 30 min are rounded up to the nearest full hour.

/**
 * Convert session minutes to billable hours.
 * - <= 30 min: billed proportionally (minutes / 60)
 * - > 30 min: rounded up to the nearest full hour
 *
 * Examples: 15m → 0.25h, 30m → 0.5h, 31m → 1h, 60m → 1h, 75m → 2h
 */
export function billableHours(minutes: number): number {
  if (minutes <= 30) return minutes / 60;
  return Math.ceil(minutes / 60);
}
