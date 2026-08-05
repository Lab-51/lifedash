// @vitest-environment jsdom
// === FILE PURPOSE ===
// TwinPage (V3.3 Tasks 3-4, V3.4 Task 3, TWIN-GRAPH.2 Task 3): empty state (no
// profile) + the mounted creation wizard (open/close from both the empty-state
// CTA and the "Refine profile" header button), section render + inline edit/save
// round-trip via twinUpdateProfileSection, and the Memory tab — which since
// TWIN-GRAPH.2 renders the tiered memory GRAPH (TwinMemoryGraph) rather than the
// flat list. What is asserted here is the SEAM: the graph mounts on that tab and
// still feeds the tab count badge. TwinMemoryGraph's own test file covers the
// full safety-triad behaviour (provenance, forget+undo with rollback, the pause
// toggle, and their keyboard reachability).
// window.electronAPI.twinGetProfile / twinUpdateProfileSection / twinDraftSection
// / twinBuildMemoryGraph are mocked — the real IPC/service round trip is covered
// by twinProfileService's / twinGraphService's own unit tests and TwinWizard's
// own tests (Task 4).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import type { TwinMemoryGraph, TwinProfile } from '../../../shared/types/twin';

const twinGetProfile = vi.fn();
const twinUpdateProfileSection = vi.fn();
const twinDraftSection = vi.fn();
// The mode-choice fork resolves the creation model + reads providers/settings.
const twinGetCreationModel = vi
  .fn()
  .mockResolvedValue({ providerLabel: 'openai', modelLabel: 'gpt-5-mini', isLocal: false, isFrontier: true });
// Memory tab — the tab panel is always mounted (badge needs the count even while
// Profile is active), so every test here indirectly mounts the memory graph.
const twinBuildMemoryGraph = vi.fn();
const twinMemoryForget = vi.fn();
const twinMemoryRestore = vi.fn();
const setSetting = vi.fn().mockResolvedValue(undefined);

vi.stubGlobal('electronAPI', {
  twinGetProfile,
  twinUpdateProfileSection,
  twinDraftSection,
  twinGetCreationModel,
  twinBuildMemoryGraph,
  twinMemoryForget,
  twinMemoryRestore,
  setSetting,
  getAIProviders: vi.fn().mockResolvedValue([]),
  getAllSettings: vi.fn().mockResolvedValue({}),
});

const { default: TwinPage } = await import('../TwinPage');
const { useMeetingStore } = await import('../../stores/meetingStore');
const { useSettingsStore } = await import('../../stores/settingsStore');
const { useTwinMemoryGraphStore, NO_ENTERING_NODES, NO_EXPANDED_LANES } =
  await import('../../stores/twinMemoryGraphStore');

/** The twin core alone — a ledger that has learned nothing yet. */
function emptyMemoryGraph(): TwinMemoryGraph {
  return {
    nodes: [
      {
        id: 'twin',
        type: 'twin',
        tier: 0,
        label: 'You',
        recordId: 'singleton',
        category: null,
        degree: 0,
        newestTimestamp: null,
      },
    ],
    edges: [],
    droppedCount: 0,
  };
}

/** Core -> one populated hub -> one fact, provenance joined in by the payload. */
function oneFactMemoryGraph(): TwinMemoryGraph {
  const graph = emptyMemoryGraph();
  return {
    nodes: [
      ...graph.nodes,
      {
        id: 'category:preference',
        type: 'category',
        tier: 1,
        label: 'Preference',
        recordId: 'preference',
        category: 'preference',
        degree: 2,
        newestTimestamp: '2026-07-01T00:00:00.000Z',
      },
      {
        id: 'fact:fact-1',
        type: 'fact',
        tier: 2,
        label: 'Prefers async updates over meetings',
        recordId: 'fact-1',
        category: 'preference',
        degree: 1,
        newestTimestamp: '2026-07-01T00:00:00.000Z',
        sourceMeetingId: 'meeting-1',
        sourceMeetingTitle: 'Weekly Sync',
      },
    ],
    edges: [
      { fromId: 'twin', toId: 'category:preference', kind: 'twin-hub' },
      { fromId: 'category:preference', toId: 'fact:fact-1', kind: 'hub-fact' },
    ],
    droppedCount: 0,
  };
}

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
  twinBuildMemoryGraph.mockResolvedValue(emptyMemoryGraph());
  useMeetingStore.setState({ meetings: [] } as any);
  useSettingsStore.setState({ settings: {} } as any);
  // The graph store is a module singleton and its `load` is cache-or-fetch, so a
  // leftover graph from the previous test would suppress the next fetch. Lane
  // disclosure is deliberately sticky across graph writes, so it has to be reset
  // here too or one test's open lane becomes the next test's starting state.
  useTwinMemoryGraphStore.setState({
    graph: null,
    entering: NO_ENTERING_NODES,
    expandedLanes: NO_EXPANDED_LANES,
  });
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

describe('TwinPage — Memory tab (the tiered memory graph)', () => {
  it('shows the empty-state explainer and a "0" count badge when no facts exist yet', async () => {
    twinGetProfile.mockResolvedValue(fullProfile());
    twinBuildMemoryGraph.mockResolvedValue(emptyMemoryGraph());
    renderPage();
    await screen.findByText('Jane Doe');

    const memoryTab = screen.getByRole('tab', { name: /memory/i });
    fireEvent.click(memoryTab);

    expect(await screen.findByText('No facts learned yet')).toBeVisible();
    expect(memoryTab).toHaveTextContent('0');
  });

  it('mounts the graph with its safety triad and badges the tab with the active fact count', async () => {
    twinGetProfile.mockResolvedValue(fullProfile());
    twinBuildMemoryGraph.mockResolvedValue(oneFactMemoryGraph());
    renderPage();
    await screen.findByText('Jane Doe');

    const memoryTab = screen.getByRole('tab', { name: /memory/i });
    fireEvent.click(memoryTab);

    // The graph opens COLLAPSED (TWIN-READ.1 Task 2), so the lane's hub is what
    // is on screen — carrying the count the lane holds — and opening it reveals
    // the fact as a node on the canvas, not a row.
    fireEvent.click(await screen.findByRole('button', { name: 'Category: Preferences, 1 learned fact' }));
    expect(
      screen.getByRole('button', { name: 'Learned fact: Prefers async updates over meetings' }),
    ).toBeInTheDocument();
    // ...the kill-switch rides above it...
    expect(screen.getByRole('button', { name: /pause learning/i })).toBeInTheDocument();
    // ...and the badge still counts ACTIVE facts only (not the core or the hub).
    expect(memoryTab).toHaveTextContent('1');
  });

  it('opens a fact node to its provenance — the title the payload carried, never an id', async () => {
    twinGetProfile.mockResolvedValue(fullProfile());
    twinBuildMemoryGraph.mockResolvedValue(oneFactMemoryGraph());
    renderPage();
    await screen.findByText('Jane Doe');

    fireEvent.click(screen.getByRole('tab', { name: /memory/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^Category: Preferences/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Learned fact:/ }));

    expect(screen.getByRole('button', { name: 'learned in Weekly Sync' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Forget:/ })).toBeInTheDocument();
  });
});
