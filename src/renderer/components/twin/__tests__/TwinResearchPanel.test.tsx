// @vitest-environment jsdom
// === FILE PURPOSE ===
// Tests the "Build from my history" panel (V3.3.5 Task 3): the consent gating
// (local mines immediately, cloud requires the per-run dialog, no-model shows a
// non-blocking notice), the draft→onDraft handoff on "Continue to review", and the
// web sub-section MERGE path (Task 4's seam is mocked to emit a draft + citations).
// window.electronAPI.twinResearchHistoryInfo / twinResearchHistory are mocked.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { TwinProfileSections, TwinCitation } from '../../../../shared/types/twin';

// Mock Task 4's sub-section with a test double that emits a web draft + citations.
vi.mock('../TwinWebResearchSection', () => ({
  default: ({ onDraft }: { onDraft?: (d: Partial<TwinProfileSections>, c: TwinCitation[]) => void }) => (
    <button
      type="button"
      onClick={() =>
        onDraft?.({ domain: { company: 'WebCo' }, people: [{ name: 'Ada' }] }, [
          { title: 'ACME', url: 'https://acme.test' },
        ])
      }
    >
      emit-web-draft
    </button>
  ),
}));

const twinResearchHistoryInfo = vi.fn();
const twinResearchHistory = vi.fn();
vi.stubGlobal('electronAPI', { twinResearchHistoryInfo, twinResearchHistory });

const { default: TwinResearchPanel } = await import('../TwinResearchPanel');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TwinResearchPanel — consent gating', () => {
  it('a local model mines immediately (no dialog) and hands the draft up on Continue', async () => {
    twinResearchHistoryInfo.mockResolvedValue({
      excerptCount: 2,
      briefCount: 0,
      projectCount: 1,
      cardCount: 0,
      providerLabel: 'lmstudio',
      isLocal: true,
    });
    twinResearchHistory.mockResolvedValue({
      status: 'ok',
      draft: { projects: [{ name: 'Replatform' }] },
      sources: [{ kind: 'meeting', id: 'm1', label: 'Sync · 2026-07-01' }],
    });
    const onDraft = vi.fn();
    render(<TwinResearchPanel brief="" onBack={vi.fn()} onDraft={onDraft} />);

    fireEvent.click(screen.getByRole('button', { name: /mine my history/i }));

    // Source attribution surfaces before anything lands in review; no consent dialog.
    expect(await screen.findByText(/Sync · 2026-07-01/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(twinResearchHistory).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /continue to review/i }));
    expect(onDraft).toHaveBeenCalledWith({ projects: [{ name: 'Replatform' }] });
  });

  it('a cloud model requires the per-run consent dialog before anything is sent', async () => {
    twinResearchHistoryInfo.mockResolvedValue({
      excerptCount: 3,
      briefCount: 1,
      projectCount: 0,
      cardCount: 2,
      providerLabel: 'openai',
      isLocal: false,
    });
    twinResearchHistory.mockResolvedValue({ status: 'ok', draft: { goals: ['Ship'] }, sources: [] });
    render(<TwinResearchPanel brief="" onBack={vi.fn()} onDraft={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /mine my history/i }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(twinResearchHistory).not.toHaveBeenCalled(); // nothing sent pre-consent
    expect(screen.getByText('openai')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /send & build/i }));
    await screen.findByRole('button', { name: /continue to review/i });
    expect(twinResearchHistory).toHaveBeenCalledTimes(1);
  });

  it('cancelling the consent dialog sends nothing', async () => {
    twinResearchHistoryInfo.mockResolvedValue({
      excerptCount: 1,
      briefCount: 0,
      projectCount: 0,
      cardCount: 0,
      providerLabel: 'anthropic',
      isLocal: false,
    });
    render(<TwinResearchPanel brief="" onBack={vi.fn()} onDraft={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /mine my history/i }));
    fireEvent.click(await screen.findByRole('button', { name: /cancel/i }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(twinResearchHistory).not.toHaveBeenCalled();
  });

  it('shows a non-blocking notice when no model is configured — no dialog, nothing sent', async () => {
    twinResearchHistoryInfo.mockResolvedValue({
      excerptCount: 0,
      briefCount: 0,
      projectCount: 0,
      cardCount: 0,
      providerLabel: 'No model configured',
      isLocal: false,
    });
    render(<TwinResearchPanel brief="" onBack={vi.fn()} onDraft={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /mine my history/i }));

    expect(await screen.findByText(/No AI model is configured/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(twinResearchHistory).not.toHaveBeenCalled();
  });
});

describe('TwinResearchPanel — web-draft merge', () => {
  it('merges the web sub-section draft into the history draft before handoff', async () => {
    twinResearchHistoryInfo.mockResolvedValue({
      excerptCount: 1,
      briefCount: 0,
      projectCount: 0,
      cardCount: 0,
      providerLabel: 'lmstudio',
      isLocal: true,
    });
    twinResearchHistory.mockResolvedValue({
      status: 'ok',
      draft: { domain: { industry: 'SaaS' }, people: [{ name: 'Sarah' }] },
      sources: [],
    });
    const onDraft = vi.fn();
    render(<TwinResearchPanel brief="" onBack={vi.fn()} onDraft={onDraft} />);

    fireEvent.click(screen.getByRole('button', { name: /mine my history/i }));
    await screen.findByRole('button', { name: /continue to review/i });

    // Task 4's sub-section emits a web draft + citation; the panel folds it in.
    fireEvent.click(screen.getByRole('button', { name: /emit-web-draft/i }));
    expect(await screen.findByText('ACME')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /continue to review/i }));

    expect(onDraft).toHaveBeenCalledTimes(1);
    const combined = onDraft.mock.calls[0][0] as Partial<TwinProfileSections>;
    expect(combined.domain).toEqual({ industry: 'SaaS', company: 'WebCo' }); // object fields merged
    expect(combined.people).toEqual([{ name: 'Sarah' }, { name: 'Ada' }]); // arrays concatenated
  });
});
