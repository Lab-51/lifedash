// @vitest-environment jsdom
// === FILE PURPOSE ===
// TwinPage (V3.3 Tasks 3-4): empty state (no profile) + the mounted creation
// wizard (open/close from both the empty-state CTA and the "Refine profile"
// header button), section render + inline edit/save round-trip via
// twinUpdateProfileSection, and the Memory tab placeholder.
// window.electronAPI.twinGetProfile / twinUpdateProfileSection / twinDraftSection
// are mocked — the real IPC/service round trip is covered by twinProfileService's
// own unit tests (Task 1) and TwinWizard's own tests (Task 4).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import type { TwinProfile } from '../../../shared/types/twin';

const twinGetProfile = vi.fn();
const twinUpdateProfileSection = vi.fn();
const twinDraftSection = vi.fn();
// The mode-choice fork resolves the creation model + reads providers/settings.
const twinGetCreationModel = vi
  .fn()
  .mockResolvedValue({ providerLabel: 'openai', modelLabel: 'gpt-5-mini', isLocal: false, isFrontier: true });

vi.stubGlobal('electronAPI', {
  twinGetProfile,
  twinUpdateProfileSection,
  twinDraftSection,
  twinGetCreationModel,
  getAIProviders: vi.fn().mockResolvedValue([]),
  getAllSettings: vi.fn().mockResolvedValue({}),
});

const { default: TwinPage } = await import('../TwinPage');

// The creation wizard's mode-choice screen uses useNavigate (Settings pointer), so
// TwinPage is rendered inside a router (repo test pattern).
const renderPage = () =>
  render(
    <MemoryRouter>
      <TwinPage />
    </MemoryRouter>,
  );

function fullProfile(overrides: Partial<TwinProfile> = {}): TwinProfile {
  return {
    brief: {},
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TwinPage — empty state + creation wizard', () => {
  it('shows the "Create your twin" empty state when no profile has ever been authored', async () => {
    twinGetProfile.mockResolvedValue(null);
    renderPage();

    expect(await screen.findByRole('button', { name: /create your twin/i })).toBeInTheDocument();
    expect(screen.getByText(/personalizes meeting briefs/i)).toBeInTheDocument();
  });

  it('the CTA opens the real creation wizard, and closing it returns to the empty state', async () => {
    twinGetProfile.mockResolvedValue(null);
    renderPage();

    const cta = await screen.findByRole('button', { name: /create your twin/i });
    fireEvent.click(cta);

    // The wizard now opens on the creation-mode fork; Quick form leads into the
    // unchanged 8-step flow.
    expect(await screen.findByRole('heading', { name: /set up your twin/i })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /start quick form/i }));
    expect(screen.getByText(/step 1 of 8/i)).toBeInTheDocument();
    // Not the section-card grid behind it — those cards each carry an Edit button.
    expect(screen.queryByRole('button', { name: /^edit$/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /close wizard/i }));
    expect(await screen.findByRole('button', { name: /create your twin/i })).toBeInTheDocument();
  });
});

describe('TwinPage — section render, edit, save round-trip', () => {
  it('renders every section with the loaded profile data', async () => {
    twinGetProfile.mockResolvedValue(fullProfile());
    renderPage();

    expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Replatform')).toBeInTheDocument();
    expect(screen.getByText('Sarah')).toBeInTheDocument();
    expect(screen.getByText('MRR')).toBeInTheDocument();
    expect(screen.getByText('Ship v3')).toBeInTheDocument();
    expect(screen.getByText('concise')).toBeInTheDocument();

    // Identity-derived header subtitle.
    expect(screen.getByText(/Mirrors Jane Doe — Staff Engineer/)).toBeInTheDocument();
  });

  it('edits the Identity section and round-trips the save through twinUpdateProfileSection', async () => {
    twinGetProfile.mockResolvedValue(fullProfile());
    const updated = fullProfile({ identity: { name: 'Jane Smith', role: 'Staff Engineer', seniority: 'senior' } });
    twinUpdateProfileSection.mockResolvedValue(updated);

    renderPage();
    await screen.findByText('Jane Doe');

    const identityHeading = screen.getByRole('heading', { name: 'Identity' });
    const card = identityHeading.closest('section') as HTMLElement;

    fireEvent.click(within(card).getByRole('button', { name: /edit/i }));

    const nameInput = within(card).getByLabelText('Name');
    fireEvent.change(nameInput, { target: { value: 'Jane Smith' } });
    fireEvent.click(within(card).getByRole('button', { name: /save/i }));

    expect(await within(card).findByText('Jane Smith')).toBeInTheDocument();
    expect(twinUpdateProfileSection).toHaveBeenCalledWith('identity', {
      name: 'Jane Smith',
      role: 'Staff Engineer',
      seniority: 'senior',
    });
    // Editor closed back to view mode.
    expect(within(card).queryByLabelText('Name')).toBeNull();
  });

  it('shows a save error inline and stays in edit mode when the IPC call rejects', async () => {
    twinGetProfile.mockResolvedValue(fullProfile());
    twinUpdateProfileSection.mockRejectedValue(new Error('DB unavailable'));

    renderPage();
    await screen.findByText('Jane Doe');

    const identityHeading = screen.getByRole('heading', { name: 'Identity' });
    const card = identityHeading.closest('section') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: /edit/i }));
    fireEvent.click(within(card).getByRole('button', { name: /save/i }));

    expect(await within(card).findByText('DB unavailable')).toBeInTheDocument();
    // Still editable — the field input is still present.
    expect(within(card).getByLabelText('Name')).toBeInTheDocument();
  });

  it('"Refine profile" opens the wizard pre-filled from the existing profile', async () => {
    twinGetProfile.mockResolvedValue(fullProfile());
    renderPage();
    await screen.findByText('Jane Doe');

    fireEvent.click(screen.getByRole('button', { name: /refine profile/i }));
    expect(await screen.findByRole('heading', { name: /refine your twin/i })).toBeInTheDocument();
    // Pre-filled: enter Quick form and the identity step's Name field carries the stored value.
    fireEvent.click(await screen.findByRole('button', { name: /start quick form/i }));
    expect(screen.getByDisplayValue('Jane Doe')).toBeInTheDocument();
  });
});

describe('TwinPage — Memory tab placeholder', () => {
  it('shows the V3.4 placeholder and no learning infrastructure', async () => {
    twinGetProfile.mockResolvedValue(fullProfile());
    renderPage();
    await screen.findByText('Jane Doe');

    fireEvent.click(screen.getByRole('tab', { name: 'Memory' }));
    expect(screen.getByText('The twin starts learning in V3.4.')).toBeVisible();
  });
});
