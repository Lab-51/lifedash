// @vitest-environment jsdom
//
// POST-FLOW.1 Task 2 — the wrap-up hero. Covers the three states that sit above
// the (REUSED, never forked) BriefSection, the honest-in-flight rule that keeps a
// no-AI install and an old brief-less session from ever showing a spinner, and
// the fill-in-place swap once a brief lands.
//
// All fixture content is invented.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';

vi.stubGlobal('electronAPI', {
  getBoards: vi.fn().mockResolvedValue([]),
  getColumns: vi.fn().mockResolvedValue([]),
});

const { useMeetingStore } = await import('../../stores/meetingStore');
const { useSettingsStore } = await import('../../stores/settingsStore');
const { default: SessionWrapUpHero, SessionIntelligence } = await import('../SessionWrapUpHero');
// The banner's routing rule is a pure module; its unit tests live here so the
// hero and the rule that decides its content stay verified together.
const { resolveSummarizationRoute } = await import('../../lib/summarizationRoute');

// ---------------------------------------------------------------------------
// Fixtures (invented)
// ---------------------------------------------------------------------------
const makeMeeting = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'meet-1',
    title: 'Quarterly Kestrel sync',
    template: 'none',
    projectId: null,
    status: 'completed',
    startedAt: '2026-04-02T09:00:00Z',
    endedAt: '2026-04-02T09:45:00Z',
    createdAt: '2026-04-02T09:00:00Z',
    audioPath: null,
    prepBriefing: null,
    transcriptionLanguage: null,
    unassignedPending: false,
    segments: [
      {
        id: 'seg-1',
        meetingId: 'meet-1',
        content: 'Invented transcript line',
        startTime: 0,
        endTime: 1000,
        speaker: null,
        createdAt: '2026-04-02T09:00:00Z',
      },
    ],
    brief: null,
    actionItems: [],
    ...overrides,
  }) as never;

const makeBrief = (summary: string) => ({
  id: 'brief-1',
  meetingId: 'meet-1',
  summary,
  structure: null,
  createdAt: '2026-04-02T09:50:00Z',
});

const BUILTIN_PROVIDER = { id: 'p-builtin', name: 'builtin', displayName: 'Built-in AI', enabled: true };

function renderHero(meeting = makeMeeting()) {
  return render(
    <MemoryRouter>
      <SessionWrapUpHero meeting={meeting} autoGenerate={false} onConvert={() => {}} />
    </MemoryRouter>,
  );
}

const banner = () => screen.queryByTestId('brief-writing-banner');

// ---------------------------------------------------------------------------
describe('SessionWrapUpHero — the three states above BriefSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMeetingStore.setState({
      generatingBrief: false,
      generatingActions: false,
      briefErrors: {},
      participantsEditedAfterBrief: {},
      error: null,
    } as never);
    useSettingsStore.setState({ providers: [BUILTIN_PROVIDER], settings: {} } as never);
  });

  it('(a) shows the brief with NO banner once one exists', () => {
    renderHero(makeMeeting({ brief: makeBrief('Kestrel migration is on track for May.') }));

    expect(screen.getByText('Kestrel migration is on track for May.')).toBeInTheDocument();
    expect(banner()).toBeNull();
  });

  it('(a) an AI-RESIL.1 failure card still renders through BriefSection, unchanged and un-bannered', () => {
    renderHero(makeMeeting({ brief: makeBrief('Brief generation failed: the model returned no usable text.') }));

    expect(screen.getByText('Brief generation failed: the model returned no usable text.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /regenerate/i })).toBeInTheDocument();
    expect(banner()).toBeNull();
  });

  it('(b) names the routed summarization provider AND model while a brief is being written', () => {
    useSettingsStore.setState({
      providers: [BUILTIN_PROVIDER],
      settings: {
        'ai.taskModels': JSON.stringify({ summarization: { providerId: 'p-builtin', model: 'Qwen3-14B-Q4_K_M' } }),
      },
    } as never);
    useMeetingStore.setState({ generatingBrief: true } as never);

    renderHero();

    const el = banner()!;
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent('Writing your brief…');
    expect(el).toHaveTextContent('Built-in AI · Qwen3-14B-Q4_K_M');
  });

  it('(b) inherits live_assistant’s route when summarization itself is unset', () => {
    useSettingsStore.setState({
      providers: [BUILTIN_PROVIDER],
      settings: {
        'ai.taskModels': JSON.stringify({ live_assistant: { providerId: 'p-builtin', model: 'Gemma-3-12B' } }),
      },
    } as never);
    useMeetingStore.setState({ generatingBrief: true } as never);

    renderHero();

    expect(banner()).toHaveTextContent('Built-in AI · Gemma-3-12B');
  });

  it('(b) names the provider ALONE (never a guessed model) on the first-enabled-provider fallback', () => {
    useMeetingStore.setState({ generatingBrief: true } as never);

    renderHero();

    const el = banner()!;
    expect(el).toHaveTextContent('Built-in AI');
    expect(el.textContent).not.toMatch(/·/);
  });

  it('(c) NO banner and NO spinner when no provider is configured — nothing will ever arrive', () => {
    useSettingsStore.setState({ providers: [], settings: {} } as never);
    // Even with the in-flight flag somehow set, a no-AI install must not promise a brief.
    useMeetingStore.setState({ generatingBrief: true } as never);

    const { container } = renderHero();

    expect(banner()).toBeNull();
    expect(container.querySelector('.animate-spin')).toBeNull();
    expect(screen.getByRole('button', { name: /set up ai/i })).toBeInTheDocument();
  });

  it('(c) a DISABLED provider counts as unconfigured', () => {
    useSettingsStore.setState({ providers: [{ ...BUILTIN_PROVIDER, enabled: false }], settings: {} } as never);
    useMeetingStore.setState({ generatingBrief: true } as never);

    renderHero();

    expect(banner()).toBeNull();
  });

  it('shows NO banner for an old completed session with no brief and nothing in flight', () => {
    // Recorded before any AI was configured: a provider exists NOW, but no
    // generation is running, so "Writing your brief…" would be a lie.
    renderHero();

    expect(banner()).toBeNull();
    expect(screen.getByRole('button', { name: /generate brief/i })).toBeInTheDocument();
  });

  it('fills in place: the banner is replaced by the brief when one lands', () => {
    useMeetingStore.setState({ generatingBrief: true } as never);
    const { rerender } = renderHero();
    expect(banner()).toBeInTheDocument();

    useMeetingStore.setState({ generatingBrief: false } as never);
    rerender(
      <MemoryRouter>
        <SessionWrapUpHero
          meeting={makeMeeting({ brief: makeBrief('Two decisions, one open question.') })}
          autoGenerate={false}
          onConvert={() => {}}
        />
      </MemoryRouter>,
    );

    expect(banner()).toBeNull();
    expect(screen.getByText('Two decisions, one open question.')).toBeInTheDocument();
  });

  it('renders NOTHING for a live session — the host mounts it unconditionally', () => {
    const { container } = renderHero(makeMeeting({ status: 'recording', endedAt: null }));

    expect(screen.queryByTestId('session-wrapup-hero')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('the rail placement is the exact inverse: nothing for completed, the block for live', () => {
    const { rerender } = render(
      <MemoryRouter>
        <SessionIntelligence meeting={makeMeeting()} autoGenerate={false} onConvert={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByText('Brief')).toBeNull();

    rerender(
      <MemoryRouter>
        <SessionIntelligence
          meeting={makeMeeting({ status: 'recording', endedAt: null })}
          autoGenerate={false}
          onConvert={() => {}}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Brief')).toBeInTheDocument();
  });

  it('reuses BriefSection and puts ActionItemList directly beneath it', () => {
    renderHero(makeMeeting({ brief: makeBrief('Invented summary line.') }));

    const hero = screen.getByTestId('session-wrapup-hero');
    const headings = Array.from(hero.querySelectorAll('h3')).map((h) => h.textContent);
    expect(headings).toEqual(['Brief', 'Action Items']);
  });
});

// ---------------------------------------------------------------------------
describe('resolveSummarizationRoute — the renderer-side mirror of resolveTaskModel', () => {
  const enabled = { id: 'p1', name: 'lmstudio', displayName: null, enabled: true } as never;

  it('returns null when no provider is enabled', () => {
    expect(resolveSummarizationRoute([], undefined)).toBeNull();
    expect(resolveSummarizationRoute([{ ...(enabled as object), enabled: false } as never], undefined)).toBeNull();
  });

  it('falls back to the raw provider name when there is no displayName', () => {
    expect(resolveSummarizationRoute([enabled], undefined)).toEqual({ label: 'lmstudio', model: null });
  });

  it('ignores a configured route whose provider is disabled and falls through', () => {
    const disabled = { id: 'p-off', name: 'openai', displayName: 'OpenAI', enabled: false } as never;
    const json = JSON.stringify({ summarization: { providerId: 'p-off', model: 'gpt-5.2' } });

    expect(resolveSummarizationRoute([disabled, enabled], json)).toEqual({ label: 'lmstudio', model: null });
  });

  it('prefers an explicit summarization route over the inherited live_assistant one', () => {
    const json = JSON.stringify({
      summarization: { providerId: 'p1', model: 'summary-model' },
      live_assistant: { providerId: 'p1', model: 'chat-model' },
    });

    expect(resolveSummarizationRoute([enabled], json)).toEqual({ label: 'lmstudio', model: 'summary-model' });
  });

  it('survives malformed routing JSON by falling through to the first enabled provider', () => {
    expect(resolveSummarizationRoute([enabled], '{not json')).toEqual({ label: 'lmstudio', model: null });
  });
});
