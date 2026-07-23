// @vitest-environment jsdom
// === FILE PURPOSE ===
// Tests the Twin web-research SUB-section (V3.3.5 Task 4). Verifies the honest,
// preflight-gated UX contract:
//   - VISIBILITY GATE: the query UI appears only when the resolved twin-creation
//     model is frontier (twin:get-creation-model.isFrontier); otherwise an honest
//     "needs a frontier cloud model" absence renders with NO inputs.
//   - CONFIRM-BEFORE-RUN: the outgoing company/industry strings are shown and the
//     cloud call (twin:research-web) fires only after explicit Confirm.
//   - RESULT HANDLING: ok -> onDraft(draft, citations) + visible citations;
//     unsupported -> honest "not available" state; skipped -> non-blocking notice
//     and no draft. Nothing is ever fabricated.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import TwinWebResearchSection from '../TwinWebResearchSection';
import type { TwinCreationModel, TwinWebResearchResult } from '../../../../shared/types/twin';

const twinGetCreationModel = vi.fn();
const twinResearchWeb = vi.fn();

vi.stubGlobal('electronAPI', { twinGetCreationModel, twinResearchWeb });

const FRONTIER: TwinCreationModel = {
  providerLabel: 'OpenAI',
  modelLabel: 'gpt-5-mini',
  isLocal: false,
  isFrontier: true,
};
const LOCAL: TwinCreationModel = { providerLabel: 'Ollama', modelLabel: 'llama3.2', isLocal: true, isFrontier: false };

const OK_RESULT: TwinWebResearchResult = {
  status: 'ok',
  draft: { domain: { industry: 'B2B SaaS' }, vocabulary: [{ term: 'ARR', meaning: 'Annual Recurring Revenue' }] },
  citations: [{ title: 'Acme newsroom', url: 'https://acme.example/news' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  twinGetCreationModel.mockResolvedValue(FRONTIER);
  twinResearchWeb.mockResolvedValue(OK_RESULT);
});

async function ready() {
  const utils = render(<TwinWebResearchSection brief="" />);
  // Wait past the mount capability probe. The heading itself is NOT a safe wait
  // target — Header() renders identically during the loading state, so
  // findByRole('heading', ...) can resolve before twinGetCreationModel() settles.
  // The Company input only exists once loading is done and the frontier branch
  // has rendered, so it's the only reliable signal.
  await screen.findByLabelText('Company');
  return utils;
}

describe('visibility gate (honest absence without a live probe)', () => {
  it('renders an honest "needs a frontier cloud model" state for a local model — no inputs', async () => {
    twinGetCreationModel.mockResolvedValue(LOCAL);
    render(<TwinWebResearchSection brief="" />);
    expect(await screen.findByText(/web enrichment isn't available/i)).toBeInTheDocument();
    expect(screen.getByText(/runs on-device/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Company')).not.toBeInTheDocument();
  });

  it('renders an honest state when no model is configured', async () => {
    twinGetCreationModel.mockResolvedValue({ providerLabel: '', modelLabel: '', isLocal: false, isFrontier: false });
    render(<TwinWebResearchSection brief="" />);
    expect(await screen.findByText(/no twin-creation model is configured/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Company')).not.toBeInTheDocument();
  });

  it('shows the query inputs for a frontier model', async () => {
    await ready();
    expect(screen.getByLabelText('Company')).toBeInTheDocument();
    expect(screen.getByLabelText('Industry')).toBeInTheDocument();
  });
});

describe('confirm-before-run (cloud consent)', () => {
  it('disables the run button until a query is entered', async () => {
    await ready();
    expect(screen.getByRole('button', { name: /research the web/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'Acme' } });
    expect(screen.getByRole('button', { name: /research the web/i })).toBeEnabled();
  });

  it('shows the exact outgoing strings and does NOT call the cloud until Confirm', async () => {
    await ready();
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'Acme' } });
    fireEvent.change(screen.getByLabelText('Industry'), { target: { value: 'Billing' } });
    fireEvent.click(screen.getByRole('button', { name: /research the web/i }));

    const consent = screen.getByRole('group', { name: /confirm web research/i });
    expect(consent).toHaveTextContent('Acme');
    expect(consent).toHaveTextContent('Billing');
    expect(twinResearchWeb).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /confirm & search/i }));
    await waitFor(() => expect(twinResearchWeb).toHaveBeenCalledWith({ company: 'Acme', industry: 'Billing' }));
  });

  it('Cancel aborts without any cloud call', async () => {
    await ready();
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'Acme' } });
    fireEvent.click(screen.getByRole('button', { name: /research the web/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('group', { name: /confirm web research/i })).not.toBeInTheDocument();
    expect(twinResearchWeb).not.toHaveBeenCalled();
  });
});

describe('result handling', () => {
  async function runResearch() {
    await ready();
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'Acme' } });
    fireEvent.click(screen.getByRole('button', { name: /research the web/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm & search/i }));
  }

  it('bubbles an ok draft via onDraft and shows its citations', async () => {
    const onDraft = vi.fn();
    render(<TwinWebResearchSection brief="" onDraft={onDraft} />);
    // Wait target fix — see ready()'s comment: the heading is unsafe, it also
    // renders during the loading state, so it can resolve before the mocked
    // twinGetCreationModel() promise has actually settled.
    await screen.findByLabelText('Company');
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'Acme' } });
    fireEvent.click(screen.getByRole('button', { name: /research the web/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm & search/i }));

    await waitFor(() => expect(onDraft).toHaveBeenCalledWith(OK_RESULT.draft, OK_RESULT.citations));
    expect(await screen.findByText(/added to your review/i)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /acme newsroom/i });
    expect(link).toHaveAttribute('href', 'https://acme.example/news');
  });

  it('renders an honest "not available" state on an unsupported result', async () => {
    twinResearchWeb.mockResolvedValue({ status: 'unsupported' } as TwinWebResearchResult);
    await runResearch();
    expect(await screen.findByText(/isn't available with the current provider/i)).toBeInTheDocument();
  });

  it('shows a non-blocking notice on a skipped result and never drafts', async () => {
    const onDraft = vi.fn();
    twinResearchWeb.mockResolvedValue({ status: 'skipped', reason: 'failed' } as TwinWebResearchResult);
    render(<TwinWebResearchSection brief="" onDraft={onDraft} />);
    // Wait target fix — see ready()'s comment: the heading is unsafe, it also
    // renders during the loading state, so it can resolve before the mocked
    // twinGetCreationModel() promise has actually settled.
    await screen.findByLabelText('Company');
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'Acme' } });
    fireEvent.click(screen.getByRole('button', { name: /research the web/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm & search/i }));

    expect(await screen.findByText(/couldn't complete web research/i)).toBeInTheDocument();
    expect(onDraft).not.toHaveBeenCalled();
  });

  it('does NOT call onDraft when the section unmounts before the search resolves (finding #6.4)', async () => {
    const onDraft = vi.fn();
    let resolveWeb!: (v: TwinWebResearchResult) => void;
    twinResearchWeb.mockReturnValue(new Promise((r) => (resolveWeb = r)));
    const { unmount } = render(<TwinWebResearchSection brief="" onDraft={onDraft} />);
    // Wait target fix — see ready()'s comment: the heading is unsafe, it also
    // renders during the loading state, so it can resolve before the mocked
    // twinGetCreationModel() promise has actually settled.
    await screen.findByLabelText('Company');
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'Acme' } });
    fireEvent.click(screen.getByRole('button', { name: /research the web/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm & search/i }));

    // The user backs out of the research panel mid-search…
    unmount();
    // …and only then does the slow web search resolve.
    resolveWeb(OK_RESULT);
    await Promise.resolve();
    await Promise.resolve();

    expect(onDraft).not.toHaveBeenCalled();
  });
});
