// @vitest-environment jsdom
// === FILE PURPOSE ===
// V3.4 Task 5 tests for SessionSearch's explicit "Ask" (knowledge Q&A) surface
// and the semantic-match indicator. Verifies the load-bearing UX contract:
//   - Ask is EXPLICIT ONLY — Enter on a question-shaped query or the Ask button,
//     NEVER per keystroke (one model call per ask),
//   - the returned SearchAnswer renders ABOVE the results with citations that
//     navigate to /session/:id,
//   - null / failure degrades to a non-blocking notice (never an error screen)
//     while the plain results still show,
//   - a `semantic` result shows the subtle "semantic" indicator.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import '@testing-library/jest-dom';
import type { SearchAnswer, SearchResults } from '../../../shared/types';

/** Reflects the router's current location so navigation assertions can read it. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

const searchMock = vi.fn<(query: string) => Promise<SearchResults>>();
const askMock = vi.fn<(query: string) => Promise<SearchAnswer | null>>();

vi.stubGlobal('electronAPI', { search: searchMock, askKnowledge: askMock });

const { useMeetingStore } = await import('../../stores/meetingStore');
const { default: SessionSearch } = await import('../SessionSearch');

const PLACEHOLDER = 'Search sessions, cards, projects...';
const EMPTY: SearchResults = { sessions: [], cards: [], projects: [] };

function renderComponent() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <SessionSearch />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('SessionSearch — explicit Ask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchMock.mockResolvedValue(EMPTY);
    askMock.mockResolvedValue(null);
    useMeetingStore.setState({ meetings: [] } as any);
  });

  it('does NOT call askKnowledge per keystroke — only on an explicit Enter', async () => {
    const user = userEvent.setup();
    renderComponent();

    // A question-shaped query, but NO Enter yet.
    await user.type(screen.getByPlaceholderText(PLACEHOLDER), 'what did we decide');
    await waitFor(() => expect(searchMock).toHaveBeenCalled(), { timeout: 2000 });
    expect(askMock).not.toHaveBeenCalled(); // never per keystroke

    // Now press Enter → exactly one Ask.
    await user.keyboard('{Enter}');
    await waitFor(() => expect(askMock).toHaveBeenCalledTimes(1));
    expect(askMock).toHaveBeenCalledWith('what did we decide');
  });

  it('renders the cited answer ABOVE results and navigates to /session/:id on a citation click', async () => {
    askMock.mockResolvedValue({
      text: 'You decided to raise prices by 10%.',
      citations: [{ meetingId: 'm-kickoff', title: 'Pricing kickoff', snippet: 'raise prices' }],
    });
    const user = userEvent.setup();
    renderComponent();

    await user.type(screen.getByPlaceholderText(PLACEHOLDER), 'what did we decide about pricing?');
    await user.keyboard('{Enter}');

    expect(await screen.findByText('You decided to raise prices by 10%.')).toBeInTheDocument();
    const citation = await screen.findByRole('button', { name: /Pricing kickoff/ });
    await user.click(citation);
    expect(screen.getByTestId('location')).toHaveTextContent('/session/m-kickoff');
  });

  it('triggers Ask from the explicit Ask button too', async () => {
    askMock.mockResolvedValue({ text: 'Answer.', citations: [] });
    const user = userEvent.setup();
    renderComponent();

    // A non-question query — Enter would NOT ask, but the button always does.
    await user.type(screen.getByPlaceholderText(PLACEHOLDER), 'pricing notes');
    await user.click(await screen.findByRole('button', { name: /Ask AI about/ }));

    await waitFor(() => expect(askMock).toHaveBeenCalledWith('pricing notes'));
    expect(await screen.findByText('Answer.')).toBeInTheDocument();
  });

  it('degrades to a non-blocking notice (not an error) when Ask returns null, keeping results visible', async () => {
    askMock.mockResolvedValue(null);
    searchMock.mockResolvedValue({
      sessions: [{ type: 'session', id: 'm1', title: 'Q3 Roadmap', snippet: null, rank: 0.9 }],
      cards: [],
      projects: [],
    });
    const user = userEvent.setup();
    renderComponent();

    await user.type(screen.getByPlaceholderText(PLACEHOLDER), 'what did we decide?');
    await user.keyboard('{Enter}');

    expect(await screen.findByText(/No answer/i)).toBeInTheDocument();
    // The plain keyword result is still shown beneath the notice.
    expect(await screen.findByText('Q3 Roadmap')).toBeInTheDocument();
  });

  it('degrades to a non-blocking notice when the Ask call rejects (never throws to an error screen)', async () => {
    askMock.mockRejectedValue(new Error('ipc failed'));
    const user = userEvent.setup();
    renderComponent();

    await user.type(screen.getByPlaceholderText(PLACEHOLDER), 'why did that happen?');
    await user.keyboard('{Enter}');

    expect(await screen.findByText(/No answer/i)).toBeInTheDocument();
  });

  it('shows the "semantic" indicator on results flagged semantic', async () => {
    searchMock.mockResolvedValue({
      sessions: [
        { type: 'session', id: 'm1', title: 'Northstar sync', snippet: 'agreed direction', rank: 0.8, semantic: true },
        { type: 'session', id: 'm2', title: 'Roadmap review', snippet: null, rank: 0.9 },
      ],
      cards: [],
      projects: [],
    });
    const user = userEvent.setup();
    renderComponent();

    // A non-question query so no Ask fires — just the hybrid results.
    await user.type(screen.getByPlaceholderText(PLACEHOLDER), 'roadmap');

    expect(await screen.findByText('Northstar sync', {}, { timeout: 2000 })).toBeInTheDocument();
    // The semantic badge is present and accessibly labelled.
    expect(screen.getByLabelText('Semantic match')).toBeInTheDocument();
    expect(askMock).not.toHaveBeenCalled();
  });

  it('exposes an accessible busy state while the Ask is in flight', async () => {
    let resolveAsk: (v: SearchAnswer | null) => void = () => {};
    askMock.mockImplementation(() => new Promise((r) => (resolveAsk = r)));
    const user = userEvent.setup();
    renderComponent();

    await user.type(screen.getByPlaceholderText(PLACEHOLDER), 'what is pending?');
    await user.keyboard('{Enter}');

    const status = await screen.findByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveTextContent(/Thinking/i);

    resolveAsk({ text: 'Done.', citations: [] });
    await waitFor(() => expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'false'));
    expect(screen.getByText('Done.')).toBeInTheDocument();
  });
});
