// @vitest-environment jsdom
// === FILE PURPOSE ===
// Proves the SHARED deep-creation seam (V3.3.5): a deep/history panel synthesizes a
// Partial<TwinProfileSections> draft and hands it UP to the wizard via onDraft; the
// wizard seeds its EXISTING editable review from that draft (nothing auto-saves),
// and only the user's save writes the sections + calls onComplete. TwinModeChoice
// and DeepInterviewPanel are mocked to a minimal "emit a draft" harness so the test
// exercises the wizard's routing (not the stub panels, which are covered separately).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { TwinProfileSections, TwinProfile } from '../../../shared/types/twin';

const twinGetProfile = vi.fn();
const twinUpdateProfileSection = vi.fn();

vi.stubGlobal('electronAPI', { twinGetProfile, twinUpdateProfileSection });

// Mode choice → a button that picks the deep path.
vi.mock('../twin/TwinModeChoice', () => ({
  default: ({ onChoose }: { onChoose: (m: 'quick' | 'deep' | 'history') => void }) => (
    <button type="button" onClick={() => onChoose('deep')}>
      go deep
    </button>
  ),
}));

// Deep panel → a button that synthesizes a draft and hands it up via onDraft.
const SYNTH_DRAFT: Partial<TwinProfileSections> = {
  identity: { name: 'Ada' },
  projects: [{ name: 'Deep Project' }],
};
vi.mock('../twin/DeepInterviewPanel', () => ({
  default: ({ onDraft }: { onDraft: (d: Partial<TwinProfileSections>) => void }) => (
    <button type="button" onClick={() => onDraft(SYNTH_DRAFT)}>
      emit draft
    </button>
  ),
}));

const { default: TwinWizard } = await import('../TwinWizard');

function returnedProfile(): TwinProfile {
  return {
    brief: {},
    identity: { name: 'Ada' },
    domain: {},
    projects: [{ name: 'Deep Project' }],
    people: [],
    vocabulary: [],
    goals: [],
    preferences: {},
    updatedAt: '2026-07-08T12:00:00.000Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  twinGetProfile.mockResolvedValue(null);
  twinUpdateProfileSection.mockResolvedValue(returnedProfile());
});

describe('TwinWizard — deep-creation draft → shared editable review → save', () => {
  it('seeds the editable review from a panel draft and writes it only on save', async () => {
    const onComplete = vi.fn();
    render(<TwinWizard onClose={vi.fn()} onComplete={onComplete} />);

    // Mode fork → deep panel → synthesize a draft.
    fireEvent.click(await screen.findByRole('button', { name: /go deep/i }));
    fireEvent.click(await screen.findByRole('button', { name: /emit draft/i }));

    // The wizard lands on its EXISTING review, seeded from the draft — nothing saved yet.
    expect(await screen.findByText(/here is what your twin will know/i)).toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('Deep Project')).toBeInTheDocument();
    expect(twinUpdateProfileSection).not.toHaveBeenCalled();

    // The user saves from the review — now the drafted sections are written.
    fireEvent.click(screen.getByRole('button', { name: /save & finish/i }));
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledWith(returnedProfile()));
    expect(twinUpdateProfileSection).toHaveBeenCalledWith('identity', { name: 'Ada' });
    expect(twinUpdateProfileSection).toHaveBeenCalledWith('projects', [{ name: 'Deep Project' }]);
  });

  it('the seeded draft is EDITABLE before saving — Back reaches the identity step pre-filled', async () => {
    render(<TwinWizard onClose={vi.fn()} onComplete={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /go deep/i }));
    fireEvent.click(await screen.findByRole('button', { name: /emit draft/i }));
    await screen.findByText(/here is what your twin will know/i);

    // Walk Back from review to the identity step; the drafted name is editable there.
    fireEvent.click(screen.getByRole('button', { name: /^back$/i })); // preferences
    for (let i = 0; i < 6; i++) fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
    expect(screen.getByText(/step 1 of 8/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Ada')).toBeInTheDocument();
  });
});
