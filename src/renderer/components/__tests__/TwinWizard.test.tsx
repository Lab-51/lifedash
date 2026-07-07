// @vitest-environment jsdom
// === FILE PURPOSE ===
// TwinWizard (V3.3 Task 4): the guided creation/refinement interview. Covers the
// load-bearing behaviour — step flow (forward to review + back), pre-fill on
// re-run from an existing profile, the optional AI-assist draft-fill from a
// MOCKED twinDraftSection response (fills fields without auto-advancing; user
// input wins on merge), graceful degradation when no model is configured
// (non-blocking, form stays usable), required-row validation blocking save, and
// the review step writing every section through twinUpdateProfileSection.
// window.electronAPI.{twinGetProfile,twinUpdateProfileSection,twinDraftSection}
// are mocked — the real IPC/service round trip is covered elsewhere.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { TwinProfile } from '../../../shared/types/twin';

const twinGetProfile = vi.fn();
const twinUpdateProfileSection = vi.fn();
const twinDraftSection = vi.fn();

vi.stubGlobal('electronAPI', {
  twinGetProfile,
  twinUpdateProfileSection,
  twinDraftSection,
});

const { default: TwinWizard } = await import('../TwinWizard');

function fullProfile(overrides: Partial<TwinProfile> = {}): TwinProfile {
  return {
    identity: { name: 'Jane Doe', role: 'Staff Engineer', seniority: 'senior' },
    domain: { industry: 'SaaS', company: 'Acme', focus: 'billing' },
    projects: [{ name: 'Replatform', description: 'move to Stripe' }],
    people: [{ name: 'Sarah', role: 'PM', org: 'Acme' }],
    vocabulary: [{ term: 'MRR', meaning: 'monthly recurring revenue' }],
    goals: ['Ship v3'],
    preferences: { tone: 'concise', language: 'en', cardTitleStyle: 'imperative' },
    updatedAt: '2026-07-08T12:00:00.000Z',
    ...overrides,
  };
}

/** Click the forward button (Next/Review) until the review step is reached. */
function advanceToReview() {
  for (;;) {
    const fwd = screen.queryByRole('button', { name: /^(next|review)$/i });
    if (!fwd) break;
    fireEvent.click(fwd);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TwinWizard — step flow', () => {
  it('opens on the identity step for a brand-new profile and walks to the review step', async () => {
    twinGetProfile.mockResolvedValue(null);
    render(<TwinWizard onClose={vi.fn()} onComplete={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: /set up your twin/i })).toBeInTheDocument();
    expect(screen.getByText(/step 1 of 8/i)).toBeInTheDocument();

    advanceToReview();
    expect(screen.getByText(/here is what your twin will know/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save & finish/i })).toBeInTheDocument();
  });

  it('Back returns to the previous step', async () => {
    twinGetProfile.mockResolvedValue(null);
    render(<TwinWizard onClose={vi.fn()} onComplete={vi.fn()} />);
    await screen.findByRole('heading', { name: /set up your twin/i });

    fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // -> step 2 (domain)
    expect(screen.getByText(/step 2 of 8/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
    expect(screen.getByText(/step 1 of 8/i)).toBeInTheDocument();
  });

  it('Close invokes onClose', async () => {
    twinGetProfile.mockResolvedValue(null);
    const onClose = vi.fn();
    render(<TwinWizard onClose={onClose} onComplete={vi.fn()} />);
    await screen.findByRole('heading', { name: /set up your twin/i });

    fireEvent.click(screen.getByRole('button', { name: /close wizard/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('TwinWizard — pre-fill on re-run', () => {
  it('seeds each step from the existing profile (refine, not restart)', async () => {
    twinGetProfile.mockResolvedValue(fullProfile());
    render(<TwinWizard onClose={vi.fn()} onComplete={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: /refine your twin/i })).toBeInTheDocument();
    // Identity step pre-filled.
    expect(screen.getByDisplayValue('Jane Doe')).toBeInTheDocument();

    // Advance to the domain step — also pre-filled.
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    expect(screen.getByDisplayValue('Acme')).toBeInTheDocument();
  });
});

describe('TwinWizard — optional AI assist', () => {
  it('drafts field values from a mocked AI response without auto-advancing', async () => {
    twinGetProfile.mockResolvedValue(null);
    twinDraftSection.mockResolvedValue({
      status: 'ok',
      draft: { name: 'Ada', role: 'Founder', seniority: 'lead' },
    });
    render(<TwinWizard onClose={vi.fn()} onComplete={vi.fn()} />);
    await screen.findByRole('heading', { name: /set up your twin/i });

    fireEvent.click(screen.getByRole('button', { name: /interview me instead/i }));
    const answer = screen.getByPlaceholderText(/answer in your own words/i);
    fireEvent.change(answer, { target: { value: "I'm Ada, a founder" } });
    fireEvent.click(screen.getByRole('button', { name: /draft from my answer/i }));

    // Fields filled from the draft; user still edits before continuing.
    expect(await screen.findByDisplayValue('Ada')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Founder')).toBeInTheDocument();
    expect(twinDraftSection).toHaveBeenCalledWith('identity', "I'm Ada, a founder");
    expect(screen.getByText(/drafted below/i)).toBeInTheDocument();
    // Never auto-advances off an AI answer.
    expect(screen.getByText(/step 1 of 8/i)).toBeInTheDocument();
  });

  it('does not overwrite a field the user already filled — the form is the source of truth', async () => {
    twinGetProfile.mockResolvedValue(null);
    twinDraftSection.mockResolvedValue({
      status: 'ok',
      draft: { name: 'Ada', role: 'Founder' },
    });
    render(<TwinWizard onClose={vi.fn()} onComplete={vi.fn()} />);
    await screen.findByRole('heading', { name: /set up your twin/i });

    // User types a name first.
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bob' } });

    fireEvent.click(screen.getByRole('button', { name: /interview me instead/i }));
    fireEvent.change(screen.getByPlaceholderText(/answer in your own words/i), { target: { value: 'about me' } });
    fireEvent.click(screen.getByRole('button', { name: /draft from my answer/i }));

    await screen.findByDisplayValue('Founder'); // role got drafted
    expect(screen.getByLabelText('Name')).toHaveValue('Bob'); // name preserved
  });

  it('degrades to manual (non-blocking) when no model is configured', async () => {
    twinGetProfile.mockResolvedValue(null);
    twinDraftSection.mockResolvedValue({ status: 'skipped', reason: 'no-model' });
    render(<TwinWizard onClose={vi.fn()} onComplete={vi.fn()} />);
    await screen.findByRole('heading', { name: /set up your twin/i });

    fireEvent.click(screen.getByRole('button', { name: /interview me instead/i }));
    fireEvent.change(screen.getByPlaceholderText(/answer in your own words/i), { target: { value: 'anything' } });
    fireEvent.click(screen.getByRole('button', { name: /draft from my answer/i }));

    expect(await screen.findByText(/no ai model is configured/i)).toBeInTheDocument();
    // Form still fully usable, still on the same step — nothing blocked.
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(screen.getByText(/step 1 of 8/i)).toBeInTheDocument();
  });

  it('shows a non-blocking failure message when extraction fails', async () => {
    twinGetProfile.mockResolvedValue(null);
    twinDraftSection.mockResolvedValue({ status: 'skipped', reason: 'failed' });
    render(<TwinWizard onClose={vi.fn()} onComplete={vi.fn()} />);
    await screen.findByRole('heading', { name: /set up your twin/i });

    fireEvent.click(screen.getByRole('button', { name: /interview me instead/i }));
    fireEvent.change(screen.getByPlaceholderText(/answer in your own words/i), { target: { value: 'anything' } });
    fireEvent.click(screen.getByRole('button', { name: /draft from my answer/i }));

    expect(await screen.findByText(/couldn't draft from your answer/i)).toBeInTheDocument();
    expect(screen.getByText(/step 1 of 8/i)).toBeInTheDocument();
  });
});

describe('TwinWizard — review writes via the section-patch API', () => {
  it('prunes and writes every section, then completes with the returned profile', async () => {
    twinGetProfile.mockResolvedValue(null);
    const returned = fullProfile({ identity: { name: 'Ada' } });
    twinUpdateProfileSection.mockResolvedValue(returned);
    const onComplete = vi.fn();

    render(<TwinWizard onClose={vi.fn()} onComplete={onComplete} />);
    await screen.findByRole('heading', { name: /set up your twin/i });

    // Fill just the identity name (everything else stays empty).
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } });

    advanceToReview();
    fireEvent.click(screen.getByRole('button', { name: /save & finish/i }));

    // Waits for the async writes + onComplete.
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledWith(returned));

    // Every section written; empty object/array sections prune to {} / [].
    expect(twinUpdateProfileSection).toHaveBeenCalledTimes(7);
    expect(twinUpdateProfileSection).toHaveBeenCalledWith('identity', { name: 'Ada' });
    expect(twinUpdateProfileSection).toHaveBeenCalledWith('domain', {});
    expect(twinUpdateProfileSection).toHaveBeenCalledWith('projects', []);
    expect(twinUpdateProfileSection).toHaveBeenCalledWith('goals', []);
  });

  it('blocks the save with a validation message when a required list row is incomplete', async () => {
    twinGetProfile.mockResolvedValue(null);
    const onComplete = vi.fn();
    render(<TwinWizard onClose={vi.fn()} onComplete={onComplete} />);
    await screen.findByRole('heading', { name: /set up your twin/i });

    // Go to the projects step and add a row with only a description (name is required).
    fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // domain
    fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // projects
    fireEvent.click(screen.getByRole('button', { name: /add project/i }));
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'orphan description' } });

    advanceToReview();
    fireEvent.click(screen.getByRole('button', { name: /save & finish/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/project name is required/i);
    expect(onComplete).not.toHaveBeenCalled();
    expect(twinUpdateProfileSection).not.toHaveBeenCalled();
  });
});
