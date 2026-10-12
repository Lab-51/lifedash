// @vitest-environment jsdom
// === FILE PURPOSE ===
// TWIN-LOOP.3 Task 3, wizard level: a draft handed up by web research / history
// mining / the deep interview is CLAMPED to the save limits as it fills the form
// (so the save is never refused for a drafted value), and a stored profile that is
// already over a limit is NOT cut - the user sees the field-specific message and the
// save is blocked with that message instead of the generic validation failure.
// window.electronAPI is mocked; the real schemas are covered by ipc/__tests__/twin.test.ts.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { TwinProfile, TwinProfileSections } from '../../../../shared/types/twin';
import { SHORT_MAX, TEXT_MAX, LIST_MAX } from '../../../../shared/twinLimits';

const twinGetProfile = vi.fn();
const twinSaveProfile = vi.fn();
vi.stubGlobal('electronAPI', { twinGetProfile, twinSaveProfile });

let draftToEmit: Partial<TwinProfileSections> = {};
vi.mock('../TwinModeChoice', () => ({
  default: ({ onChoose }: { onChoose: (m: 'quick' | 'history') => void }) => (
    <>
      <button type="button" onClick={() => onChoose('history')}>
        go history
      </button>
      <button type="button" onClick={() => onChoose('quick')}>
        go quick
      </button>
    </>
  ),
}));
vi.mock('../TwinResearchPanel', () => ({
  default: ({ onDraft }: { onDraft: (d: Partial<TwinProfileSections>) => void }) => (
    <button type="button" onClick={() => onDraft(draftToEmit)}>
      emit draft
    </button>
  ),
}));

const { default: TwinWizard } = await import('../../TwinWizard');

function profile(over: Partial<TwinProfile> = {}): TwinProfile {
  return {
    brief: {},
    identity: {},
    domain: {},
    projects: [],
    people: [],
    vocabulary: [],
    goals: [],
    preferences: {},
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  twinGetProfile.mockResolvedValue(null);
  twinSaveProfile.mockResolvedValue(profile());
});

describe('TwinWizard - drafts are clamped to the save limits', () => {
  it('cuts an over-long drafted field, list entry and list length before the form is filled', async () => {
    draftToEmit = {
      brief: { statement: 'b'.repeat(TEXT_MAX + 50) },
      domain: { company: 'c'.repeat(SHORT_MAX + 50), focus: 'f'.repeat(TEXT_MAX + 50) },
      projects: [{ name: 'p'.repeat(SHORT_MAX + 50), description: 'd'.repeat(TEXT_MAX + 50) }],
      goals: Array.from({ length: LIST_MAX + 20 }, (_, i) => `goal ${i}`),
    };
    render(<TwinWizard onClose={vi.fn()} onComplete={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /go history/i }));
    fireEvent.click(await screen.findByRole('button', { name: /emit draft/i }));
    fireEvent.click(await screen.findByRole('button', { name: /save & finish/i }));

    await vi.waitFor(() => expect(twinSaveProfile).toHaveBeenCalledTimes(1));
    const saved = twinSaveProfile.mock.calls[0][0] as TwinProfileSections;
    expect(saved.brief.statement).toHaveLength(TEXT_MAX);
    expect(saved.domain.company).toHaveLength(SHORT_MAX);
    expect(saved.domain.focus).toHaveLength(TEXT_MAX);
    expect(saved.projects[0].name).toHaveLength(SHORT_MAX);
    expect(saved.projects[0].description).toHaveLength(TEXT_MAX);
    expect(saved.goals).toHaveLength(LIST_MAX);
  });
});

describe('TwinWizard - a stored value already over its limit', () => {
  it('is shown with the field message, kept uncut, and blocks the save with that message', async () => {
    twinGetProfile.mockResolvedValue(profile({ identity: { name: 'n'.repeat(SHORT_MAX + 1) } }));
    render(<TwinWizard onClose={vi.fn()} onComplete={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /go quick/i }));

    // Step 1 (identity) shows the message next to the uncut value.
    expect(await screen.findByText('Shorten Name to 200 characters to save.')).toBeInTheDocument();
    expect(screen.getByDisplayValue('n'.repeat(SHORT_MAX + 1))).toBeInTheDocument();

    // Walk to the review (7 steps) and try to save.
    for (let i = 0; i < 7; i++) fireEvent.click(screen.getByRole('button', { name: /^(next|review)$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /save changes/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Shorten Name to 200 characters to save.');
    expect(twinSaveProfile).not.toHaveBeenCalled();
  });
});
