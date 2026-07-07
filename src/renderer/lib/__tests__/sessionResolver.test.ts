// === FILE PURPOSE ===
// Unit tests for the pure project -> session resolvers used to route every
// (now session-only) project/board link. Covers: latest-session selection by
// startedAt, no-session -> null, and the /session deep-link builder (viewProject +
// openCard, and the home fallback when a project has no session).

import { describe, it, expect } from 'vitest';
import { latestSessionForProject, projectSessionLink } from '../sessionResolver';
import type { Meeting } from '../../../shared/types';

function meeting(overrides: Partial<Meeting> & { id: string }): Meeting {
  return {
    projectId: null,
    title: 'Meeting',
    template: 'none',
    startedAt: '2026-01-01T00:00:00Z',
    endedAt: null,
    audioPath: null,
    status: 'completed',
    prepBriefing: null,
    transcriptionLanguage: null,
    unassignedPending: false,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('latestSessionForProject', () => {
  const meetings: Meeting[] = [
    meeting({ id: 'm-old', projectId: 'p1', startedAt: '2026-01-01T09:00:00Z' }),
    meeting({ id: 'm-new', projectId: 'p1', startedAt: '2026-03-10T09:00:00Z' }),
    meeting({ id: 'm-other', projectId: 'p2', startedAt: '2026-05-01T09:00:00Z' }),
    meeting({ id: 'm-none', projectId: null, startedAt: '2026-06-01T09:00:00Z' }),
  ];

  it('returns the most recent (max startedAt) session linked to the project', () => {
    expect(latestSessionForProject('p1', meetings)).toBe('m-new');
  });

  it('returns null when the project has no sessions', () => {
    expect(latestSessionForProject('p-missing', meetings)).toBeNull();
  });

  it('ignores meetings with a different (or null) projectId', () => {
    expect(latestSessionForProject('p2', meetings)).toBe('m-other');
  });
});

describe('projectSessionLink', () => {
  const meetings: Meeting[] = [meeting({ id: 'm2', projectId: 'p1', startedAt: '2026-02-01T09:00:00Z' })];

  it('builds a Board-tab deep link with viewProject', () => {
    expect(projectSessionLink('p1', meetings)).toBe('/session/m2?viewProject=p1');
  });

  it('adds openCard when a cardId is supplied', () => {
    expect(projectSessionLink('p1', meetings, 'c9')).toBe('/session/m2?viewProject=p1&openCard=c9');
  });

  it('falls back to home when the project has no session (never a /projects dead-end)', () => {
    expect(projectSessionLink('p-empty', meetings, 'c9')).toBe('/');
  });
});
