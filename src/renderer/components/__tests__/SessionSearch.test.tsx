// @vitest-environment jsdom
// === FILE PURPOSE ===
// Unit tests for SessionSearch (V3.1 Task 6): debounced full-text search box.
// Verifies the 300ms debounce (search does not fire immediately), grouped
// rendering (Sessions/Cards/Projects), the open target per result type
// (session -> /session/:id, card/project -> the relevant session's Board tab via
// the viewProject override, or home when the project has no session), keyboard
// navigation, the clear button, and that snippet highlight markers render as
// <mark> spans (never via dangerouslySetInnerHTML).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import '@testing-library/jest-dom';
import { SNIPPET_HIGHLIGHT_START, SNIPPET_HIGHLIGHT_END } from '../../../shared/types';
import type { SearchResults } from '../../../shared/types';

/** Reflects the router's current location so navigation assertions can read it. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

const searchMock = vi.fn<(query: string) => Promise<SearchResults>>();

vi.stubGlobal('electronAPI', { search: searchMock });

const { useMeetingStore } = await import('../../stores/meetingStore');
const { default: SessionSearch } = await import('../SessionSearch');

/** Seed one session linked to project p1 so project/card results resolve to it. */
function seedSessionForP1() {
  useMeetingStore.setState({
    meetings: [{ id: 'sess-1', projectId: 'p1', startedAt: '2026-02-01T09:00:00Z' }] as any,
  } as any);
}

function renderComponent() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <SessionSearch />
      <LocationProbe />
    </MemoryRouter>,
  );
}

const EMPTY: SearchResults = { sessions: [], cards: [], projects: [] };

describe('SessionSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchMock.mockResolvedValue(EMPTY);
    useMeetingStore.setState({ meetings: [] } as any);
  });

  it('renders the search input', () => {
    renderComponent();
    expect(screen.getByPlaceholderText('Search sessions, cards, projects...')).toBeInTheDocument();
  });

  it('debounces the search call by 300ms', async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.type(screen.getByPlaceholderText('Search sessions, cards, projects...'), 'roadmap');

    // Not called immediately -- still inside the debounce window.
    expect(searchMock).not.toHaveBeenCalled();

    await waitFor(() => expect(searchMock).toHaveBeenCalledWith('roadmap'), { timeout: 2000 });
    expect(searchMock).toHaveBeenCalledTimes(1);
  });

  it('renders grouped results (Sessions / Cards / Projects) once the search resolves', async () => {
    searchMock.mockResolvedValue({
      sessions: [{ type: 'session', id: 'm1', title: 'Q3 Roadmap', snippet: null, rank: 0.9 }],
      cards: [{ type: 'card', id: 'c1', title: 'Build search feature', snippet: null, projectId: 'p1', rank: 0.5 }],
      projects: [{ type: 'project', id: 'p1', title: 'Acme Launch', snippet: null, rank: 0.4 }],
    });
    const user = userEvent.setup();
    renderComponent();

    await user.type(screen.getByPlaceholderText('Search sessions, cards, projects...'), 'roadmap');

    expect(await screen.findByText('Sessions', {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByText('Cards')).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.getByText('Q3 Roadmap')).toBeInTheDocument();
    expect(screen.getByText('Build search feature')).toBeInTheDocument();
    expect(screen.getByText('Acme Launch')).toBeInTheDocument();
  });

  it('shows "No results found" when the query matches nothing', async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.type(screen.getByPlaceholderText('Search sessions, cards, projects...'), 'nomatch');

    expect(await screen.findByText('No results found', {}, { timeout: 2000 })).toBeInTheDocument();
  });

  it("renders a snippet's highlight markers as <mark> text, never as raw HTML", async () => {
    searchMock.mockResolvedValue({
      sessions: [
        {
          type: 'session',
          id: 'm1',
          title: 'Q3 Roadmap',
          snippet: `We discussed the ${SNIPPET_HIGHLIGHT_START}roadmap${SNIPPET_HIGHLIGHT_END} in depth`,
          rank: 0.9,
        },
      ],
      cards: [],
      projects: [],
    });
    const user = userEvent.setup();
    renderComponent();

    await user.type(screen.getByPlaceholderText('Search sessions, cards, projects...'), 'roadmap');

    const mark = await screen.findByText('roadmap', { selector: 'mark' }, { timeout: 2000 });
    expect(mark).toBeInTheDocument();
    // The literal control characters must never leak into the rendered text.
    expect(mark.closest('button')?.textContent).not.toContain(SNIPPET_HIGHLIGHT_START);
  });

  it('navigates to /session/:id when a session result is clicked', async () => {
    searchMock.mockResolvedValue({
      sessions: [{ type: 'session', id: 'm1', title: 'Q3 Roadmap', snippet: null, rank: 0.9 }],
      cards: [],
      projects: [],
    });
    const user = userEvent.setup();
    renderComponent();

    await user.type(screen.getByPlaceholderText('Search sessions, cards, projects...'), 'roadmap');
    await user.click(await screen.findByText('Q3 Roadmap', {}, { timeout: 2000 }));

    expect(screen.getByTestId('location')).toHaveTextContent('/session/m1');
  });

  it("opens a card result in its project's latest session (Board tab + viewProject + openCard)", async () => {
    seedSessionForP1();
    searchMock.mockResolvedValue({
      sessions: [],
      cards: [{ type: 'card', id: 'c1', title: 'Build search feature', snippet: null, projectId: 'p1', rank: 0.5 }],
      projects: [],
    });
    const user = userEvent.setup();
    renderComponent();

    await user.type(screen.getByPlaceholderText('Search sessions, cards, projects...'), 'search');
    await user.click(await screen.findByText('Build search feature', {}, { timeout: 2000 }));

    expect(screen.getByTestId('location')).toHaveTextContent('/session/sess-1?viewProject=p1&openCard=c1');
  });

  it("opens a project result in its latest session's Board tab (viewProject override)", async () => {
    seedSessionForP1();
    searchMock.mockResolvedValue({
      sessions: [],
      cards: [],
      projects: [{ type: 'project', id: 'p1', title: 'Acme Launch', snippet: null, rank: 0.4 }],
    });
    const user = userEvent.setup();
    renderComponent();

    await user.type(screen.getByPlaceholderText('Search sessions, cards, projects...'), 'acme');
    await user.click(await screen.findByText('Acme Launch', {}, { timeout: 2000 }));

    expect(screen.getByTestId('location')).toHaveTextContent('/session/sess-1?viewProject=p1');
  });

  it('falls back to home (never /projects) when the result project has no session', async () => {
    // No meetings seeded — p1 has no session.
    searchMock.mockResolvedValue({
      sessions: [],
      cards: [],
      projects: [{ type: 'project', id: 'p1', title: 'Acme Launch', snippet: null, rank: 0.4 }],
    });
    const user = userEvent.setup();
    renderComponent();

    await user.type(screen.getByPlaceholderText('Search sessions, cards, projects...'), 'acme');
    await user.click(await screen.findByText('Acme Launch', {}, { timeout: 2000 }));

    const location = screen.getByTestId('location').textContent ?? '';
    expect(location).toBe('/');
    expect(location).not.toContain('/projects');
  });

  it('supports ArrowDown + Enter keyboard navigation to select a result', async () => {
    searchMock.mockResolvedValue({
      sessions: [
        { type: 'session', id: 'm1', title: 'First Session', snippet: null, rank: 0.9 },
        { type: 'session', id: 'm2', title: 'Second Session', snippet: null, rank: 0.8 },
      ],
      cards: [],
      projects: [],
    });
    const user = userEvent.setup();
    renderComponent();

    const input = screen.getByPlaceholderText('Search sessions, cards, projects...');
    await user.type(input, 'session');
    await screen.findByText('Second Session', {}, { timeout: 2000 });

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(screen.getByTestId('location')).toHaveTextContent('/session/m2');
  });

  it('clears the query and closes the dropdown when the clear button is clicked', async () => {
    searchMock.mockResolvedValue({
      sessions: [{ type: 'session', id: 'm1', title: 'Q3 Roadmap', snippet: null, rank: 0.9 }],
      cards: [],
      projects: [],
    });
    const user = userEvent.setup();
    renderComponent();

    const input = screen.getByPlaceholderText('Search sessions, cards, projects...');
    await user.type(input, 'roadmap');
    await screen.findByText('Q3 Roadmap', {}, { timeout: 2000 });

    await user.click(screen.getByLabelText('Clear search'));

    expect(input).toHaveValue('');
    expect(screen.queryByText('Q3 Roadmap')).not.toBeInTheDocument();
  });
});
