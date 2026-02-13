import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDueDateBadge } from '../date-utils';

describe('getDueDateBadge', () => {
  beforeEach(() => {
    // Fix "now" to 2026-06-15 12:00:00 UTC for deterministic tests
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns overdue for a past date', () => {
    const badge = getDueDateBadge('2026-06-10T00:00:00Z');
    expect(badge.label).toBe('Overdue');
    expect(badge.classes).toContain('red');
  });

  it('returns overdue for yesterday', () => {
    const badge = getDueDateBadge('2026-06-14T11:00:00Z');
    expect(badge.label).toBe('Overdue');
    expect(badge.classes).toContain('red');
  });

  it('returns "Due today" for a due date later today', () => {
    const badge = getDueDateBadge('2026-06-15T18:00:00Z');
    expect(badge.label).toBe('Due today');
    expect(badge.classes).toContain('amber');
  });

  it('returns "Due in Nd" for tomorrow (within 3 days)', () => {
    const badge = getDueDateBadge('2026-06-16T18:00:00Z');
    expect(badge.label).toMatch(/^Due in \d+d$/);
    expect(badge.classes).toContain('amber');
  });

  it('returns "Due in Nd" for a date 5 days out (within 7 days)', () => {
    const badge = getDueDateBadge('2026-06-20T12:00:00Z');
    expect(badge.label).toMatch(/^Due in 5d$/);
    expect(badge.classes).toContain('blue');
  });

  it('returns formatted date for a date 7+ days out', () => {
    const badge = getDueDateBadge('2026-06-30T12:00:00Z');
    // Should be a localized date string like "Jun 30"
    expect(badge.label).toMatch(/Jun/);
    expect(badge.classes).toContain('surface');
  });

  it('returns overdue for a date exactly 1 millisecond in the past', () => {
    // Just barely overdue (the fixed "now" is 2026-06-15T12:00:00Z)
    const badge = getDueDateBadge('2026-06-15T11:59:59.999Z');
    expect(badge.label).toBe('Overdue');
  });
});
