// @vitest-environment jsdom
// === FILE PURPOSE ===
// TwinWizard (V3.3 Quick form + V3.3.5 creation-mode fork). Two concerns:
//   1. The mode fork (V3.3.5): the wizard opens on a mode-choice screen with three
//      ways to build a twin; the SOTA gate warns (never blocks) the deep paths when
//      the resolved creation model is not a frontier cloud model, offers a one-tap
//      switch (writing the twin_interview task-model setting via the existing store)
//      and an explicit "continue with local model anyway" escape. Quick form is
//      never gated.
//   2. Quick-form REGRESSION (unchanged from V3.3): once entered, the 8-step flow —
//      step navigation, pre-fill on re-run, the optional "Interview me" draft-fill,
//      graceful no-model degradation, required-row validation, and the review step
//      writing every section — behaves exactly as before (now the review also
//      writes the seeded `brief`). window.electronAPI + the settings store are
//      mocked; the real IPC/service round trip is covered elsewhere.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import '@testing-library/jest-dom';
import { useSettingsStore } from '../../stores/settingsStore';
import type { TwinProfile } from '../../../shared/types/twin';
import type { AIProvider } from '../../../shared/types/ai';
import type { TwinCreationModel } from '../../../shared/types/twin';

const twinGetProfile = vi.fn();
const twinUpdateProfileSection = vi.fn();
const twinDraftSection = vi.fn();
const twinGetCreationModel = vi.fn();
const getAIProviders = vi.fn();
const getAllSettings = vi.fn();
const setSetting = vi.fn();

vi.stubGlobal('electronAPI', {
  twinGetProfile,
  twinUpdateProfileSection,
  twinDraftSection,
  twinGetCreationModel,
  getAIProviders,
  getAllSettings,
  setSetting,
});

// The mode-fork + SOTA gate (real TwinModeChoice) is what these tests exercise; the
// deep/history panels that mount AFTER a mode is chosen are covered by their own
// suites, so here they are mocked to stable markers (with a Back affordance) so these
// wizard tests stay decoupled from the real panels' internals + electronAPI calls.
vi.mock('../twin/DeepInterviewPanel', () => ({
  default: ({ onBack }: { onBack: () => void }) => (
    <div>
      <span>deep interview panel mounted</span>
      <button type="button" onClick={onBack}>
        Back to options
      </button>
    </div>
  ),
}));
vi.mock('../twin/TwinResearchPanel', () => ({
  default: ({ onBack }: { onBack: () => void }) => (
    <div>
      <span>history research panel mounted</span>
      <button type="button" onClick={onBack}>
        Back to options
      </button>
    </div>
  ),
}));

const { default: TwinWizard } = await import('../TwinWizard');

// The real TwinModeChoice now uses useNavigate for its "no frontier configured →
// Settings" pointer, so the wizard is rendered inside a router (repo test pattern).
const renderWizard = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

const FRONTIER_MODEL: TwinCreationModel = {
  providerLabel: 'openai',
  modelLabel: 'gpt-5-mini',
  isLocal: false,
  isFrontier: true,
};
const LOCAL_MODEL: TwinCreationModel = {
  providerLabel: 'ollama',
  modelLabel: 'llama3.2',
  isLocal: true,
  isFrontier: false,
};

function frontierProvider(): AIProvider {
  return {
    id: 'p1',
    name: 'openai',
    displayName: 'My OpenAI',
    enabled: true,
    hasApiKey: true,
    baseUrl: null,
    createdAt: '2026-07-08T00:00:00.000Z',
    updatedAt: '2026-07-08T00:00:00.000Z',
  };
}

function fullProfile(overrides: Partial<TwinProfile> = {}): TwinProfile {
  return {
    brief: { statement: 'A staff engineer at Acme' },
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

/** Enter the Quick-form path from the mode-choice screen. */
async function enterQuickForm() {
  fireEvent.click(await screen.findByRole('button', { name: /start quick form/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({ providers: [], settings: {} });
  twinGetCreationModel.mockResolvedValue(FRONTIER_MODEL);
  getAIProviders.mockResolvedValue([]);
  getAllSettings.mockResolvedValue({});
});

// ---------------------------------------------------------------------------
// Mode-choice fork (V3.3.5)
// ---------------------------------------------------------------------------

describe('TwinWizard — creation-mode fork', () => {
  it('opens on the mode-choice screen offering all three modes', async () => {
    twinGetProfile.mockResolvedValue(null);
    renderWizard(<TwinWizard onClose={vi.fn()} onComplete={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: /set up your twin/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Quick form' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Deep interview' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Build from my history' })).toBeInTheDocument();
  });

  it('picking Deep interview mounts the deep panel; picking history mounts the research panel', async () => {
    twinGetProfile.mockResolvedValue(null);
    renderWizard(<TwinWizard onClose={vi.fn()} onComplete={vi.fn()} />);
    await screen.findByRole('heading', { name: /set up your twin/i });

    fireEvent.click(await screen.findByRole('button', { name: /start deep interview/i }));
    expect(await screen.findByText('deep interview panel mounted')).toBeInTheDocument();

    // Back to options, then into history.
    fireEvent.click(screen.getByRole('button', { name: /back to options/i }));
    fireEvent.click(await screen.findByRole('button', { name: /start build from my history/i }));
    expect(await screen.findByText('history research panel mounted')).toBeInTheDocument();
  });

  it('seeds the brief into the mode screen from an existing profile (refine)', async () => {
    twinGetProfile.mockResolvedValue(fullProfile());
    renderWizard(<TwinWizard onClose={vi.fn()} onComplete={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: /refine your twin/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue('A staff engineer at Acme')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SOTA gate (WARN + CONTINUE-ANYWAY)
// ---------------------------------------------------------------------------

describe('TwinWizard — SOTA gate', () => {
  it('shows the SOTA notice on the deep paths for a non-frontier resolved model', async () => {
    twinGetProfile.mockResolvedValue(null);
    twinGetCreationModel.mockResolvedValue(LOCAL_MODEL);
    renderWizard(<TwinWizard onClose={vi.fn()} onComplete={vi.fn()} />);
    await screen.findByRole('heading', { name: /set up your twin/i });

    expect(await screen.findAllByText(/state-of-the-art model/i)).not.toHaveLength(0);
    // Quick form is NEVER gated — its Start affordance is always present.
    expect(screen.getByRole('button', { name: /start quick form/i })).toBeInTheDocument();
    // ...while the gated deep paths have no plain Start button.
    expect(screen.queryByRole('button', { name: /start deep interview/i })).toBeNull();
  });

  it('hides the SOTA notice for a frontier resolved model (deep paths are directly startable)', async () => {
    twinGetProfile.mockResolvedValue(null);
    twinGetCreationModel.mockResolvedValue(FRONTIER_MODEL);
    renderWizard(<TwinWizard onClose={vi.fn()} onComplete={vi.fn()} />);
    await screen.findByRole('button', { name: /start quick form/i });

    expect(screen.queryByText(/state-of-the-art model/i)).toBeNull();
    expect(screen.getByRole('button', { name: /start deep interview/i })).toBeInTheDocument();
  });

  it('"Continue with local model anyway" proceeds into the gated deep path', async () => {
    twinGetProfile.mockResolvedValue(null);
    twinGetCreationModel.mockResolvedValue(LOCAL_MODEL);
    renderWizard(<TwinWizard onClose={vi.fn()} onComplete={vi.fn()} />);
    await screen.findByRole('heading', { name: /set up your twin/i });
    await screen.findAllByText(/state-of-the-art model/i);

    // The first "continue anyway" belongs to the Deep interview card.
    fireEvent.click(screen.getAllByRole('button', { name: /continue with local model anyway/i })[0]);
    expect(await screen.findByText('deep interview panel mounted')).toBeInTheDocument();
  });

  it('one-tap "Use <frontier>" writes the twin_interview task-model setting via the existing store', async () => {
    twinGetProfile.mockResolvedValue(null);
    // First resolve is local (gated); after the write we re-resolve as frontier.
    twinGetCreationModel.mockResolvedValueOnce(LOCAL_MODEL).mockResolvedValue(FRONTIER_MODEL);
    getAIProviders.mockResolvedValue([frontierProvider()]);
    setSetting.mockResolvedValue(undefined);

    renderWizard(<TwinWizard onClose={vi.fn()} onComplete={vi.fn()} />);
    await screen.findByRole('heading', { name: /set up your twin/i });

    // Both gated deep cards carry the one-tap; click the first (Deep interview).
    const useBtns = await screen.findAllByRole('button', { name: /use my openai/i });
    fireEvent.click(useBtns[0]);

    await vi.waitFor(() => expect(setSetting).toHaveBeenCalled());
    const [key, value] = setSetting.mock.calls[0] as [string, string];
    expect(key).toBe('ai.taskModels');
    const parsed = JSON.parse(value);
    expect(parsed.twin_interview).toEqual({ providerId: 'p1', model: 'gpt-5-mini' });
  });
});

// ---------------------------------------------------------------------------
// Quick form — regression (unchanged 8-step flow, now writing the brief too)
// ---------------------------------------------------------------------------

describe('TwinWizard — Quick form step flow', () => {
  it('opens on the identity step for a brand-new profile and walks to the review step', async () => {
    twinGetProfile.mockResolvedValue(null);
    renderWizard(<TwinWizard onClose={vi.fn()} onComplete={vi.fn()} />);
    await enterQuickForm();

    expect(screen.getByText(/step 1 of 8/i)).toBeInTheDocument();

    advanceToReview();
    expect(screen.getByText(/here is what your twin will know/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save & finish/i })).toBeInTheDocument();
  });

  it('Back returns to the previous step', async () => {
    twinGetProfile.mockResolvedValue(null);
    renderWizard(<TwinWizard onClose={vi.fn()} onComplete={vi.fn()} />);
    await enterQuickForm();

    fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // -> step 2 (domain)
    expect(screen.getByText(/step 2 of 8/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
    expect(screen.getByText(/step 1 of 8/i)).toBeInTheDocument();
  });

  it('Close invokes onClose', async () => {
    twinGetProfile.mockResolvedValue(null);
    const onClose = vi.fn();
    renderWizard(<TwinWizard onClose={onClose} onComplete={vi.fn()} />);
    await screen.findByRole('heading', { name: /set up your twin/i });

    fireEvent.click(screen.getByRole('button', { name: /close wizard/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('TwinWizard — Quick form pre-fill on re-run', () => {
  it('seeds each step from the existing profile (refine, not restart)', async () => {
    twinGetProfile.mockResolvedValue(fullProfile());
    renderWizard(<TwinWizard onClose={vi.fn()} onComplete={vi.fn()} />);
    await screen.findByRole('heading', { name: /refine your twin/i });
    await enterQuickForm();

    // Identity step pre-filled.
    expect(screen.getByDisplayValue('Jane Doe')).toBeInTheDocument();

    // Advance to the domain step — also pre-filled.
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    expect(screen.getByDisplayValue('Acme')).toBeInTheDocument();
  });
});

describe('TwinWizard — Quick form optional AI assist', () => {
  it('drafts field values from a mocked AI response without auto-advancing', async () => {
    twinGetProfile.mockResolvedValue(null);
    twinDraftSection.mockResolvedValue({
      status: 'ok',
      draft: { name: 'Ada', role: 'Founder', seniority: 'lead' },
    });
    renderWizard(<TwinWizard onClose={vi.fn()} onComplete={vi.fn()} />);
    await enterQuickForm();

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
    renderWizard(<TwinWizard onClose={vi.fn()} onComplete={vi.fn()} />);
    await enterQuickForm();

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
    renderWizard(<TwinWizard onClose={vi.fn()} onComplete={vi.fn()} />);
    await enterQuickForm();

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
    renderWizard(<TwinWizard onClose={vi.fn()} onComplete={vi.fn()} />);
    await enterQuickForm();

    fireEvent.click(screen.getByRole('button', { name: /interview me instead/i }));
    fireEvent.change(screen.getByPlaceholderText(/answer in your own words/i), { target: { value: 'anything' } });
    fireEvent.click(screen.getByRole('button', { name: /draft from my answer/i }));

    expect(await screen.findByText(/couldn't draft from your answer/i)).toBeInTheDocument();
    expect(screen.getByText(/step 1 of 8/i)).toBeInTheDocument();
  });
});

describe('TwinWizard — review writes via the section-patch API', () => {
  it('prunes and writes every section (incl. the brief), then completes with the returned profile', async () => {
    twinGetProfile.mockResolvedValue(null);
    const returned = fullProfile({ identity: { name: 'Ada' } });
    twinUpdateProfileSection.mockResolvedValue(returned);
    const onComplete = vi.fn();

    renderWizard(<TwinWizard onClose={vi.fn()} onComplete={onComplete} />);
    await enterQuickForm();

    // Fill just the identity name (everything else stays empty).
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } });

    advanceToReview();
    fireEvent.click(screen.getByRole('button', { name: /save & finish/i }));

    // Waits for the async writes + onComplete.
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledWith(returned));

    // Every section written; adding brief makes it 8 (empty object/array sections prune to {} / []).
    expect(twinUpdateProfileSection).toHaveBeenCalledTimes(8);
    expect(twinUpdateProfileSection).toHaveBeenCalledWith('brief', {});
    expect(twinUpdateProfileSection).toHaveBeenCalledWith('identity', { name: 'Ada' });
    expect(twinUpdateProfileSection).toHaveBeenCalledWith('domain', {});
    expect(twinUpdateProfileSection).toHaveBeenCalledWith('projects', []);
    expect(twinUpdateProfileSection).toHaveBeenCalledWith('goals', []);
  });

  it('writes the brief seeded on the mode screen through review', async () => {
    twinGetProfile.mockResolvedValue(null);
    twinUpdateProfileSection.mockResolvedValue(fullProfile());

    renderWizard(<TwinWizard onClose={vi.fn()} onComplete={vi.fn()} />);
    await screen.findByRole('heading', { name: /set up your twin/i });

    // Type the brief on the mode screen, THEN enter Quick form.
    fireEvent.change(screen.getByPlaceholderText(/senior product manager/i), {
      target: { value: 'A senior PM in fintech' },
    });
    await enterQuickForm();

    advanceToReview();
    fireEvent.click(screen.getByRole('button', { name: /save & finish/i }));

    await vi.waitFor(() =>
      expect(twinUpdateProfileSection).toHaveBeenCalledWith('brief', { statement: 'A senior PM in fintech' }),
    );
  });

  it('blocks the save with a validation message when a required list row is incomplete', async () => {
    twinGetProfile.mockResolvedValue(null);
    const onComplete = vi.fn();
    renderWizard(<TwinWizard onClose={vi.fn()} onComplete={onComplete} />);
    await enterQuickForm();

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
