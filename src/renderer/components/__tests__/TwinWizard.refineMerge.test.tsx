// @vitest-environment jsdom
// === FILE PURPOSE ===
// Regression guard for finding #6.1 (V3.3.5 Task 6): on a REFINE (an existing
// profile is loaded and its sections seed the wizard drafts at mount), a deep/
// history/web panel that emits a PARTIAL draft — omitting some sections — must
// only OVERRIDE the sections it actually supplies. Sections the panel does not
// supply (here identity + preferences, which history mining structurally excludes)
// MUST survive to the save call, not collapse to {}. Before the fix,
// seedFromPanelDraft rebuilt the drafts from ONLY the panel draft, so on save the
// section-level jsonb REPLACE permanently wiped the user's stored identity /
// preferences / etc. This proves they are preserved.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { TwinProfileSections, TwinProfile } from '../../../shared/types/twin';

const twinGetProfile = vi.fn();
const twinUpdateProfileSection = vi.fn();

vi.stubGlobal('electronAPI', { twinGetProfile, twinUpdateProfileSection });

// Mode choice → a button that picks the (mocked) deep path.
vi.mock('../twin/TwinModeChoice', () => ({
  default: ({ onChoose }: { onChoose: (m: 'quick' | 'deep' | 'history') => void }) => (
    <button type="button" onClick={() => onChoose('deep')}>
      go deep
    </button>
  ),
}));

// The panel emits a PARTIAL draft that supplies ONLY projects — no identity, no
// preferences (mirrors history mining's MINE_KEYS exclusion, or a deep synthesis
// that omits sections it found nothing for).
const PARTIAL_DRAFT: Partial<TwinProfileSections> = {
  projects: [{ name: 'Beta' }],
};
vi.mock('../twin/DeepInterviewPanel', () => ({
  default: ({ onDraft }: { onDraft: (d: Partial<TwinProfileSections>) => void }) => (
    <button type="button" onClick={() => onDraft(PARTIAL_DRAFT)}>
      emit draft
    </button>
  ),
}));

const { default: TwinWizard } = await import('../TwinWizard');

/** An existing (refine) profile: identity + preferences are set and must survive. */
function existingProfile(): TwinProfile {
  return {
    brief: {},
    identity: { name: 'Jane', role: 'PM' },
    domain: {},
    projects: [{ name: 'Apollo' }],
    people: [],
    vocabulary: [],
    goals: [],
    preferences: { tone: 'concise' },
    updatedAt: '2026-07-08T12:00:00.000Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  twinGetProfile.mockResolvedValue(existingProfile());
  twinUpdateProfileSection.mockResolvedValue(existingProfile());
});

describe('TwinWizard — refine + partial panel draft preserves unsupplied sections', () => {
  it('keeps the existing identity + preferences when the panel draft omits them', async () => {
    render(<TwinWizard onClose={vi.fn()} onComplete={vi.fn()} />);

    // Refine mode fork → deep panel → emit a partial (projects-only) draft.
    fireEvent.click(await screen.findByRole('button', { name: /go deep/i }));
    fireEvent.click(await screen.findByRole('button', { name: /emit draft/i }));

    // Lands on the seeded review — nothing saved yet.
    expect(await screen.findByText(/here is what your twin will know/i)).toBeInTheDocument();
    expect(twinUpdateProfileSection).not.toHaveBeenCalled();

    // Save from the review (refine → "Save changes").
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    // The supplied section is overridden…
    await vi.waitFor(() => expect(twinUpdateProfileSection).toHaveBeenCalledWith('projects', [{ name: 'Beta' }]));
    // …and the UNSUPPLIED sections are PRESERVED from the existing profile — NOT {}.
    expect(twinUpdateProfileSection).toHaveBeenCalledWith('identity', { name: 'Jane', role: 'PM' });
    expect(twinUpdateProfileSection).toHaveBeenCalledWith('preferences', { tone: 'concise' });
    // Regression assertion: identity/preferences must never be written as empty.
    expect(twinUpdateProfileSection).not.toHaveBeenCalledWith('identity', {});
    expect(twinUpdateProfileSection).not.toHaveBeenCalledWith('preferences', {});
  });
});
