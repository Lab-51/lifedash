// @vitest-environment jsdom
// === FILE PURPOSE ===
// Tests the ORCHESTRATED Digital Twin deep-creation flow (V3.3.5). Mocks
// window.electronAPI to verify the load-bearing behaviour of the phased state machine:
//   role input (pre-filled from the profile) → optional CLOUD role research behind an
//   explicit confirm → cited research review → gap interview that threads roleContext →
//   optional meeting-history mining (local runs immediately, cloud goes behind the
//   reused consent dialog) → a single MERGED draft handed UP via onDraft (never saved
//   here). Research/interview/history each degrade to a NON-BLOCKING path so the flow
//   stays usable with zero AI, and a late async after unmount never forwards a draft.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import DeepInterviewPanel, { type DeepInterviewPanelProps } from '../DeepInterviewPanel';
import type {
  TwinProfile,
  TwinProfileSections,
  TwinCreationModel,
  TwinResearchHistoryInfo,
  TwinRoleResearchResult,
} from '../../../../shared/types/twin';

const twinGetProfile = vi.fn();
const twinGetCreationModel = vi.fn();
const twinResearchRole = vi.fn();
const twinInterviewNext = vi.fn();
const twinInterviewSynthesize = vi.fn();
const twinResearchHistoryInfo = vi.fn();
const twinResearchHistory = vi.fn();

vi.stubGlobal('electronAPI', {
  twinGetProfile,
  twinGetCreationModel,
  twinResearchRole,
  twinInterviewNext,
  twinInterviewSynthesize,
  twinResearchHistoryInfo,
  twinResearchHistory,
});

const FRONTIER: TwinCreationModel = {
  providerLabel: 'OpenAI',
  modelLabel: 'gpt-5',
  isLocal: false,
  isFrontier: true,
};
const LOCAL: TwinCreationModel = { providerLabel: 'Ollama', modelLabel: 'llama3.2', isLocal: true, isFrontier: false };

const LOCAL_INFO: TwinResearchHistoryInfo = {
  excerptCount: 2,
  briefCount: 1,
  projectCount: 1,
  cardCount: 3,
  providerLabel: 'Ollama',
  isLocal: true,
};
const CLOUD_INFO: TwinResearchHistoryInfo = { ...LOCAL_INFO, providerLabel: 'OpenAI', isLocal: false };

const ROLE_RESEARCH: TwinRoleResearchResult = {
  status: 'ok',
  result: {
    draft: {
      domain: { industry: 'B2B SaaS billing', focus: 'Payments' },
      vocabulary: [{ term: 'ARR', meaning: 'Annual Recurring Revenue' }],
      goals: ['Reduce churn'],
    },
    roleContext: 'Senior PMs in billing own pricing, packaging, and revenue retention.',
    citations: [{ title: 'Billing PM guide', url: 'https://example.com/pm' }],
  },
};

const INTERVIEW_DRAFT: Partial<TwinProfileSections> = {
  identity: { name: 'Ada' },
  projects: [{ name: 'Replatform' }],
};
const HISTORY_DRAFT: Partial<TwinProfileSections> = {
  projects: [{ name: 'Mobile app' }],
  people: [{ name: 'Bob' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  twinGetProfile.mockResolvedValue(null);
  twinGetCreationModel.mockResolvedValue(FRONTIER);
});

/** Render and wait past the async prefill to the role-input step. */
async function reachRole(props: Partial<DeepInterviewPanelProps> = {}) {
  const merged = { brief: '', onBack: vi.fn(), onDraft: vi.fn(), ...props };
  const utils = render(<DeepInterviewPanel {...merged} />);
  await screen.findByLabelText('Your role');
  return { ...utils, ...merged };
}

/** Reach the role step, then skip research straight into the interview. */
async function reachInterviewViaSkip(props: Partial<DeepInterviewPanelProps> = {}) {
  const utils = await reachRole(props);
  fireEvent.click(screen.getByRole('button', { name: /skip research/i }));
  return utils;
}

describe('DeepInterviewPanel — role input (step 1)', () => {
  it('pre-fills role/company/industry from the existing profile and shows the brief', async () => {
    twinGetProfile.mockResolvedValue({
      identity: { role: 'Staff Engineer' },
      domain: { company: 'Acme', industry: 'Fintech' },
    } as unknown as TwinProfile);
    await reachRole({ brief: 'A hands-on staff engineer' });

    expect((screen.getByLabelText('Your role') as HTMLInputElement).value).toBe('Staff Engineer');
    expect((screen.getByLabelText('Company (optional)') as HTMLInputElement).value).toBe('Acme');
    expect((screen.getByLabelText('Industry (optional)') as HTMLInputElement).value).toBe('Fintech');
    expect(screen.getByText('A hands-on staff engineer')).toBeInTheDocument();
  });

  it('"Skip research — just interview me" goes straight to the interview with NO research and NO roleContext', async () => {
    twinInterviewNext.mockResolvedValueOnce({ status: 'ok', question: 'What do you own?' });
    await reachInterviewViaSkip({ brief: 'A senior PM' });

    expect(await screen.findByText('What do you own?')).toBeInTheDocument();
    expect(twinResearchRole).not.toHaveBeenCalled();
    expect(twinInterviewNext).toHaveBeenCalledWith({ brief: 'A senior PM', profileSoFar: {}, qa: [] });
    expect(twinInterviewNext.mock.calls[0][0]).not.toHaveProperty('roleContext');
  });

  it('offers no research and only an interview path when the model is not frontier', async () => {
    twinGetCreationModel.mockResolvedValue(LOCAL);
    twinInterviewNext.mockResolvedValueOnce({ status: 'ok', question: 'Q1?' });
    await reachRole();

    expect(screen.queryByRole('button', { name: /research my role/i })).not.toBeInTheDocument();
    expect(screen.getByText(/web research isn't available/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /start interview/i }));

    expect(await screen.findByText('Q1?')).toBeInTheDocument();
    expect(twinResearchRole).not.toHaveBeenCalled();
  });

  it('"Back to options" returns to the mode choice from the role step', async () => {
    const onBack = vi.fn();
    await reachRole({ onBack });
    fireEvent.click(screen.getByRole('button', { name: /back to options/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('DeepInterviewPanel — cloud role research (step 2)', () => {
  it('shows the exact outgoing query and does NOT call the cloud until Confirm', async () => {
    await reachRole({ brief: 'Senior PM' });
    fireEvent.change(screen.getByLabelText('Your role'), { target: { value: 'Senior PM' } });
    fireEvent.change(screen.getByLabelText('Company (optional)'), { target: { value: 'Acme' } });
    fireEvent.click(screen.getByRole('button', { name: /research my role/i }));

    const consent = screen.getByRole('group', { name: /confirm role research/i });
    expect(consent).toHaveTextContent('Senior PM');
    expect(consent).toHaveTextContent('Acme');
    expect(twinResearchRole).not.toHaveBeenCalled();

    twinResearchRole.mockResolvedValueOnce(ROLE_RESEARCH);
    fireEvent.click(screen.getByRole('button', { name: /confirm & research/i }));
    await waitFor(() =>
      expect(twinResearchRole).toHaveBeenCalledWith({
        role: 'Senior PM',
        company: 'Acme',
        industry: '',
        brief: 'Senior PM',
      }),
    );
  });

  it('renders the cited dossier, then threads roleContext into the interview', async () => {
    twinResearchRole.mockResolvedValueOnce(ROLE_RESEARCH);
    twinInterviewNext.mockResolvedValueOnce({ status: 'ok', question: 'Which projects are yours?' });
    await reachRole({ brief: 'Senior PM' });
    fireEvent.change(screen.getByLabelText('Your role'), { target: { value: 'Senior PM' } });
    fireEvent.click(screen.getByRole('button', { name: /research my role/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm & research/i }));

    // The dossier review shows the role background, a vocabulary term, and a source link.
    expect(await screen.findByText(/senior pms in billing/i)).toBeInTheDocument();
    expect(screen.getByText('ARR')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /billing pm guide/i })).toHaveAttribute('href', 'https://example.com/pm');

    fireEvent.click(screen.getByRole('button', { name: /continue to interview/i }));
    expect(await screen.findByText('Which projects are yours?')).toBeInTheDocument();
    expect(twinInterviewNext.mock.calls[0][0]).toMatchObject({ roleContext: ROLE_RESEARCH.result.roleContext });
  });

  it('degrades to interview-only when research is unsupported (honest notice, no roleContext)', async () => {
    twinResearchRole.mockResolvedValueOnce({ status: 'unsupported' });
    twinInterviewNext.mockResolvedValueOnce({ status: 'ok', question: 'Q1?' });
    await reachRole();
    fireEvent.change(screen.getByLabelText('Your role'), { target: { value: 'PM' } });
    fireEvent.click(screen.getByRole('button', { name: /research my role/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm & research/i }));

    expect(await screen.findByText('Q1?')).toBeInTheDocument();
    expect(screen.getByText(/web research isn't available/i)).toBeInTheDocument();
    expect(twinInterviewNext.mock.calls[0][0]).not.toHaveProperty('roleContext');
  });

  it('discloses the brief that is ALSO sent to the cloud provider (defect #2)', async () => {
    await reachRole({ brief: 'A pragmatic staff engineer who ships' });
    fireEvent.change(screen.getByLabelText('Your role'), { target: { value: 'PM' } });
    fireEvent.click(screen.getByRole('button', { name: /research my role/i }));

    const consent = screen.getByRole('group', { name: /confirm role research/i });
    expect(consent).toHaveTextContent(/your brief/i);
    expect(consent).toHaveTextContent('A pragmatic staff engineer who ships');
  });

  it('moves focus into the research confirm group when it appears (defect #5)', async () => {
    await reachRole({ brief: 'x' });
    fireEvent.change(screen.getByLabelText('Your role'), { target: { value: 'PM' } });
    fireEvent.click(screen.getByRole('button', { name: /research my role/i }));
    expect(screen.getByRole('group', { name: /confirm role research/i })).toHaveFocus();
  });
});

describe('DeepInterviewPanel — refine AUGMENTS stored data (defect #1)', () => {
  it('folds the stored profile in as the merge base so nothing stored is dropped', async () => {
    const twentyTerms = Array.from({ length: 20 }, (_, i) => ({ term: `T${i}`, meaning: `M${i}` }));
    twinGetProfile.mockResolvedValue({
      identity: { role: 'PM', name: 'Ada' },
      domain: { company: 'Acme', industry: 'Fintech' },
      projects: [{ name: 'Alpha' }],
      people: [],
      vocabulary: twentyTerms,
      goals: ['G1', 'G2', 'G3'],
      preferences: {},
      brief: {},
      updatedAt: 'x',
    } as unknown as TwinProfile);
    twinResearchRole.mockResolvedValueOnce({
      status: 'ok',
      result: {
        draft: { goals: ['Reduce churn'], vocabulary: [{ term: 'GEN', meaning: 'generic' }] },
        roleContext: 'CTX',
        citations: [],
      },
    });
    twinInterviewNext.mockResolvedValueOnce({ status: 'ok', question: 'Q1?' });
    twinInterviewSynthesize.mockResolvedValue({ status: 'ok', draft: { projects: [{ name: 'Xeno' }] } });
    const onDraft = vi.fn();
    await reachRole({ onDraft });

    // Role is pre-filled from the profile, so research is enabled without typing.
    fireEvent.click(screen.getByRole('button', { name: /research my role/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm & research/i }));
    fireEvent.click(await screen.findByRole('button', { name: /continue to interview/i }));
    await screen.findByText('Q1?');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'answer' } });
    fireEvent.click(screen.getByRole('button', { name: /finish now/i }));
    fireEvent.click(await screen.findByRole('button', { name: /skip — go to review/i }));

    await waitFor(() => expect(onDraft).toHaveBeenCalled());
    const draft = onDraft.mock.calls[0][0] as Partial<TwinProfileSections>;
    expect(draft.goals).toEqual(expect.arrayContaining(['G1', 'G2', 'G3', 'Reduce churn']));
    expect((draft.projects ?? []).map((p) => p.name)).toEqual(expect.arrayContaining(['Alpha', 'Xeno']));
    expect(draft.vocabulary).toHaveLength(21); // 20 stored + 1 researched
    expect(draft.identity).toMatchObject({ name: 'Ada', role: 'PM' });
  });
});

describe('DeepInterviewPanel — the gap interview (step 3)', () => {
  it('accumulates answered turns across questions', async () => {
    twinInterviewNext
      .mockResolvedValueOnce({ status: 'ok', question: 'Q1?' })
      .mockResolvedValueOnce({ status: 'ok', question: 'Q2?' });
    await reachInterviewViaSkip();

    await screen.findByText('Q1?');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'I am a PM' } });
    fireEvent.click(screen.getByRole('button', { name: /next question/i }));

    expect(await screen.findByText('Q2?')).toBeInTheDocument();
    expect(twinInterviewNext.mock.calls[1][0].qa).toEqual([{ question: 'Q1?', answer: 'I am a PM' }]);
  });

  it('announces the question (aria-live) and moves focus to the answer box each turn', async () => {
    twinInterviewNext
      .mockResolvedValueOnce({ status: 'ok', question: 'Q1?' })
      .mockResolvedValueOnce({ status: 'ok', question: 'Q2?' });
    await reachInterviewViaSkip();

    const q1 = await screen.findByText('Q1?');
    expect(q1).toHaveAttribute('aria-live', 'polite');
    const box = screen.getByRole('textbox');
    expect(box).toHaveAttribute('aria-describedby', q1.getAttribute('id'));
    expect(box).toHaveFocus();

    fireEvent.change(box, { target: { value: 'a' } });
    fireEvent.click(screen.getByRole('button', { name: /next question/i }));
    await screen.findByText('Q2?');
    expect(screen.getByRole('textbox')).toHaveFocus();
  });

  it('shows a non-blocking notice offering the form when the interview has no model', async () => {
    twinInterviewNext.mockResolvedValueOnce({ status: 'skipped', reason: 'no-model' });
    const onUseForm = vi.fn();
    await reachInterviewViaSkip({ onUseForm });

    expect(await screen.findByText(/no ai model is configured/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /fill the form instead/i }));
    expect(onUseForm).toHaveBeenCalledTimes(1);
  });

  it('shows a non-blocking notice and never forwards a draft when synthesis is skipped', async () => {
    twinInterviewNext.mockResolvedValueOnce({ status: 'ok', question: 'Q1?' });
    twinInterviewSynthesize.mockResolvedValue({ status: 'skipped', reason: 'failed' });
    const onDraft = vi.fn();
    await reachInterviewViaSkip({ onDraft });

    await screen.findByText('Q1?');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'answer' } });
    fireEvent.click(screen.getByRole('button', { name: /finish now/i }));

    expect(await screen.findByText(/couldn't continue/i)).toBeInTheDocument();
    expect(onDraft).not.toHaveBeenCalled();
  });

  it('keeps consented research when synthesis fails, forwarding it on "Continue with what we found" (defect #3)', async () => {
    twinResearchRole.mockResolvedValueOnce(ROLE_RESEARCH);
    twinInterviewNext.mockResolvedValueOnce({ status: 'ok', question: 'Q1?' });
    twinInterviewSynthesize.mockResolvedValue({ status: 'skipped', reason: 'failed' });
    const onDraft = vi.fn();
    await reachRole({ onDraft });
    fireEvent.change(screen.getByLabelText('Your role'), { target: { value: 'PM' } });
    fireEvent.click(screen.getByRole('button', { name: /research my role/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm & research/i }));
    fireEvent.click(await screen.findByRole('button', { name: /continue to interview/i }));
    await screen.findByText('Q1?');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'answer' } });
    fireEvent.click(screen.getByRole('button', { name: /finish now/i }));

    // The failure notice offers keeping the research (consented cloud work isn't wasted).
    const keep = await screen.findByRole('button', { name: /continue with what we found/i });
    expect(onDraft).not.toHaveBeenCalled();
    fireEvent.click(keep);
    await waitFor(() => expect(onDraft).toHaveBeenCalledWith(ROLE_RESEARCH.result.draft));
  });
});

describe('DeepInterviewPanel — optional history + merge (steps 4-5)', () => {
  /** Skip research, answer one question, finish — landing on the history offer. */
  async function reachHistoryOffer(props: Partial<DeepInterviewPanelProps> = {}) {
    twinInterviewNext.mockResolvedValueOnce({ status: 'ok', question: 'Q1?' });
    twinInterviewSynthesize.mockResolvedValue({ status: 'ok', draft: INTERVIEW_DRAFT });
    const utils = await reachInterviewViaSkip(props);
    await screen.findByText('Q1?');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'my answer' } });
    fireEvent.click(screen.getByRole('button', { name: /finish now/i }));
    await screen.findByText(/also use your meeting history/i);
    return utils;
  }

  it('skips history and forwards only the interview draft', async () => {
    const onDraft = vi.fn();
    await reachHistoryOffer({ onDraft });
    fireEvent.click(screen.getByRole('button', { name: /skip — go to review/i }));

    await waitFor(() => expect(onDraft).toHaveBeenCalledWith(INTERVIEW_DRAFT));
    expect(twinResearchHistory).not.toHaveBeenCalled();
  });

  it('runs local history immediately and forwards the MERGED draft (arrays concatenated)', async () => {
    twinResearchHistoryInfo.mockResolvedValue(LOCAL_INFO);
    twinResearchHistory.mockResolvedValue({ status: 'ok', draft: HISTORY_DRAFT, sources: [] });
    const onDraft = vi.fn();
    await reachHistoryOffer({ onDraft });
    fireEvent.click(screen.getByRole('button', { name: /use my history/i }));

    await waitFor(() =>
      expect(onDraft).toHaveBeenCalledWith({
        identity: { name: 'Ada' },
        projects: [{ name: 'Replatform' }, { name: 'Mobile app' }],
        people: [{ name: 'Bob' }],
      }),
    );
  });

  it('requires per-run consent before a CLOUD history call', async () => {
    twinResearchHistoryInfo.mockResolvedValue(CLOUD_INFO);
    twinResearchHistory.mockResolvedValue({ status: 'ok', draft: HISTORY_DRAFT, sources: [] });
    const onDraft = vi.fn();
    await reachHistoryOffer({ onDraft });
    fireEvent.click(screen.getByRole('button', { name: /use my history/i }));

    expect(await screen.findByRole('dialog')).toHaveTextContent(/send your history to a cloud model/i);
    expect(twinResearchHistory).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /send & build/i }));
    await waitFor(() => expect(twinResearchHistory).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onDraft).toHaveBeenCalled());
  });

  it('forwards without a dialog when no mining model is configured', async () => {
    twinResearchHistoryInfo.mockResolvedValue({ ...CLOUD_INFO, providerLabel: 'No model configured' });
    const onDraft = vi.fn();
    await reachHistoryOffer({ onDraft });
    fireEvent.click(screen.getByRole('button', { name: /use my history/i }));

    await waitFor(() => expect(onDraft).toHaveBeenCalledWith(INTERVIEW_DRAFT));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(twinResearchHistory).not.toHaveBeenCalled();
  });

  it('merges so interview values win over researched values for the same field', async () => {
    twinResearchRole.mockResolvedValueOnce({
      status: 'ok',
      result: {
        draft: { domain: { industry: 'Fintech (generic)', focus: 'Payments' }, identity: { role: 'PM' } },
        roleContext: 'CTX',
        citations: [],
      },
    });
    twinInterviewNext.mockResolvedValueOnce({ status: 'ok', question: 'Q1?' });
    twinInterviewSynthesize.mockResolvedValue({
      status: 'ok',
      draft: { domain: { industry: 'Payments infrastructure' }, identity: { role: 'Senior PM' } },
    });
    const onDraft = vi.fn();
    await reachRole({ onDraft });
    fireEvent.change(screen.getByLabelText('Your role'), { target: { value: 'PM' } });
    fireEvent.click(screen.getByRole('button', { name: /research my role/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm & research/i }));
    fireEvent.click(await screen.findByRole('button', { name: /continue to interview/i }));

    await screen.findByText('Q1?');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'answer' } });
    fireEvent.click(screen.getByRole('button', { name: /finish now/i }));
    fireEvent.click(await screen.findByRole('button', { name: /skip — go to review/i }));

    await waitFor(() =>
      expect(onDraft).toHaveBeenCalledWith({
        domain: { industry: 'Payments infrastructure', focus: 'Payments' },
        identity: { role: 'Senior PM' },
      }),
    );
  });

  it('does NOT forward a draft when the panel unmounts before history resolves (finding #6.4)', async () => {
    twinResearchHistoryInfo.mockResolvedValue(LOCAL_INFO);
    let resolveHistory!: (v: unknown) => void;
    twinResearchHistory.mockReturnValue(new Promise((r) => (resolveHistory = r)));
    const onDraft = vi.fn();
    const { unmount } = await reachHistoryOffer({ onDraft });
    fireEvent.click(screen.getByRole('button', { name: /use my history/i }));

    // The mining is in flight (phase "Reading your history…")…
    await screen.findByText(/reading your history/i);
    unmount();
    // …and only THEN does the slow mining resolve.
    resolveHistory({ status: 'ok', draft: HISTORY_DRAFT, sources: [] });
    await Promise.resolve();
    await Promise.resolve();

    expect(onDraft).not.toHaveBeenCalled();
  });

  it('deep-merges same-named array entries so a richer duplicate keeps its fields (defect #4)', async () => {
    twinInterviewNext.mockResolvedValueOnce({ status: 'ok', question: 'Q1?' });
    twinInterviewSynthesize.mockResolvedValue({ status: 'ok', draft: { people: [{ name: 'Bob' }] } });
    twinResearchHistoryInfo.mockResolvedValue(LOCAL_INFO);
    twinResearchHistory.mockResolvedValue({
      status: 'ok',
      draft: { people: [{ name: 'Bob', role: 'Manager', org: 'Acme' }] },
      sources: [],
    });
    const onDraft = vi.fn();
    await reachInterviewViaSkip({ onDraft });
    await screen.findByText('Q1?');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a' } });
    fireEvent.click(screen.getByRole('button', { name: /finish now/i }));
    fireEvent.click(await screen.findByRole('button', { name: /use my history/i }));

    await waitFor(() => expect(onDraft).toHaveBeenCalled());
    const draft = onDraft.mock.calls[0][0] as Partial<TwinProfileSections>;
    expect(draft.people).toEqual([{ name: 'Bob', role: 'Manager', org: 'Acme' }]);
  });

  it('restores focus to "Use my history" when the cloud-consent dialog is cancelled (defect #5)', async () => {
    twinResearchHistoryInfo.mockResolvedValue(CLOUD_INFO);
    await reachHistoryOffer();
    fireEvent.click(screen.getByRole('button', { name: /use my history/i }));

    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.getByRole('button', { name: /use my history/i })).toHaveFocus());
  });
});
