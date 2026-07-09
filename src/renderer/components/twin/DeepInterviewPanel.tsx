// === FILE PURPOSE ===
// Digital Twin "Deep interview" mode panel (V3.3.5 — orchestrated deep creation).
// Mounted by TwinWizard's mode fork. Instead of only asking questions, it now runs a
// guided, phased flow: RESEARCH the role first, INTERVIEW about the gaps research
// can't know, optionally fold in MEETING HISTORY, then MERGE everything into one draft
// handed UP via onDraft — the wizard seeds its EXISTING editable review from it (the
// user edits + saves there; NOTHING auto-saves and this panel builds no review of its
// own). Seeded by the user's free-form `brief`.
//
// === PHASES ===
// prefill → role (input + cloud-confirm) → researching → research-review
//        → interview (loading/answering/synthesizing) → history-offer
//        → history-checking/running → onDraft(merged).
// Research is optional and gated: a non-frontier model skips it honestly; unsupported/
// skipped research falls straight through to the interview. History is optional and,
// for a cloud model, gated behind the reused per-run consent dialog.
//
// === FAILURE TOLERANCE ===
// AI is never required. Any skipped/failed interview turn shows a NON-BLOCKING notice
// offering the manual Quick form (onUseForm ?? onBack). A slow research/interview/
// history call that resolves AFTER the user navigated away is dropped (activeRef).
//
// === DEPENDENCIES ===
// react, lucide-react, shared/types/twin, the Deep* step sub-components, the reused
// TwinResearchConsentDialog, and the deepInterviewMerge helper.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { MessagesSquare, ChevronLeft } from 'lucide-react';
import type {
  TwinProfile,
  TwinProfileSections,
  TwinQATurn,
  TwinCreationModel,
  TwinRoleResearchDraft,
  TwinResearchHistoryInfo,
  TwinInterviewNextPayload,
  TwinInterviewSynthesizePayload,
} from '../../../shared/types/twin';
import DeepRoleStep from './DeepRoleStep';
import DeepResearchReview from './DeepResearchReview';
import DeepInterviewStep from './DeepInterviewStep';
import DeepHistoryStep from './DeepHistoryStep';
import TwinResearchConsentDialog from './TwinResearchConsentDialog';
import { LoadingRow, InfoNote, FormFallbackNotice } from './DeepInterviewParts';
import { mergeDrafts } from './deepInterviewMerge';

/** Upper bound on questions — mirrors the service cap; drives the progress copy. */
const MAX_QUESTIONS = 8;

/** twin:research-history-info's provider label when nothing is configured (matches the
 *  service): with no model there is no cloud destination, so mining just can't run. */
const NO_MODEL_LABEL = 'No model configured';

export interface DeepInterviewPanelProps {
  /** The user's free-form brief, seeding the whole flow. May be empty. */
  brief: string;
  /** Return to the wizard's mode-choice screen. */
  onBack: () => void;
  /**
   * Switch to the manual Quick form (the "fill the form instead" fallback when an AI
   * turn can't continue). Falls back to onBack (the mode-choice screen) when omitted.
   */
  onUseForm?: () => void;
  /**
   * Hand the MERGED profile draft (research + interview + optional history) UP to the
   * wizard, which seeds its shared editable review from it (nothing auto-saves).
   */
  onDraft: (draft: Partial<TwinProfileSections>) => void;
}

type DeepPhase =
  | 'prefill'
  | 'role'
  | 'researching'
  | 'research-review'
  | 'interview-loading'
  | 'interview-answering'
  | 'interview-synthesizing'
  | 'history-offer'
  | 'history-checking'
  | 'history-running'
  | 'notice';

/** Transient "working…" phases share one spinner row keyed by phase. */
const LOADING_LABEL: Partial<Record<DeepPhase, string>> = {
  prefill: 'Loading your details…',
  researching: 'Researching your role…',
  'interview-loading': 'Thinking of the next question…',
  'interview-synthesizing': 'Building your profile draft…',
  'history-checking': 'Checking your history…',
  'history-running': 'Reading your history…',
};

type NoticeReason = 'no-model' | 'failed';

const NOTICE_MESSAGE: Record<NoticeReason, string> = {
  'no-model': 'No AI model is configured for the interview. You can fill the form instead — nothing is lost.',
  failed: "The interview couldn't continue right now. You can fill the form instead — nothing is lost.",
};

/** Read an optional electronAPI method, tolerating an absent method or a rejection. */
async function safeCall<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

/** The stored profile's STRUCTURED sections, used as the least-specific MERGE BASE on a
 *  REFINE so the merged draft AUGMENTS the user's data instead of replacing it (the
 *  wizard's seed replaces every section the draft supplies). `brief` and `updatedAt` are
 *  excluded — the brief is owned by the wizard's own field, not re-seeded from here. */
function profileToBase(profile: TwinProfile): Partial<TwinProfileSections> {
  return {
    identity: profile.identity ?? {},
    domain: profile.domain ?? {},
    projects: profile.projects ?? [],
    people: profile.people ?? [],
    vocabulary: profile.vocabulary ?? [],
    goals: profile.goals ?? [],
    preferences: profile.preferences ?? {},
  };
}

export default function DeepInterviewPanel({ brief, onBack, onUseForm, onDraft }: DeepInterviewPanelProps) {
  const [phase, setPhase] = useState<DeepPhase>('prefill');
  const [role, setRole] = useState('');
  const [company, setCompany] = useState('');
  const [industry, setIndustry] = useState('');
  const [model, setModel] = useState<TwinCreationModel | null>(null);
  const [research, setResearch] = useState<TwinRoleResearchDraft | null>(null);
  const [infoNote, setInfoNote] = useState<string | null>(null);
  const [qa, setQa] = useState<TwinQATurn[]>([]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [interviewDraft, setInterviewDraft] = useState<Partial<TwinProfileSections> | null>(null);
  const [historyInfo, setHistoryInfo] = useState<TwinResearchHistoryInfo | null>(null);
  const [notice, setNotice] = useState<NoticeReason | null>(null);
  // The stored profile's sections (REFINE) — the merge base so nothing stored is dropped.
  const [existingSections, setExistingSections] = useState<Partial<TwinProfileSections> | null>(null);

  // Restores focus to "Use my history" when the cloud-consent dialog closes.
  const historyTriggerRef = useRef<HTMLButtonElement>(null);

  // True while mounted, so a slow research/interview/history call that resolves AFTER
  // the user navigated away (Back / wizard close) can't update state or forward a draft
  // into an abandoned review (finding #6.4). Set true on (re)mount so StrictMode's
  // mount→cleanup→mount cycle leaves it true.
  const activeRef = useRef(true);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  // The researched role background threaded into the interview so it targets the gaps.
  // Held in a ref (not state) so the interview callbacks read the latest without churn.
  const roleContextRef = useRef<string | undefined>(undefined);

  // One-shot prefill: seed role/company/industry from any existing profile and resolve
  // the creation model (to decide whether research is even offered). No cloud call here.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      const [profile, creationModel] = await Promise.all([
        safeCall(() => window.electronAPI.twinGetProfile()),
        safeCall(() => window.electronAPI.twinGetCreationModel()),
      ]);
      if (!activeRef.current) return;
      if (profile) {
        setRole(profile.identity?.role ?? '');
        setCompany(profile.domain?.company ?? '');
        setIndustry(profile.domain?.industry ?? '');
        setExistingSections(profileToBase(profile));
      }
      setModel(creationModel);
      setPhase('role');
    })();
  }, []);

  // --- interview loop (mirrors the original panel, now with roleContext + a history hop) ---

  // Synthesize the Q&A into a draft, then OFFER history (we don't forward yet). A
  // skipped/failed synthesis degrades to the non-blocking form notice.
  const finish = useCallback(
    async (finalQa: TwinQATurn[]) => {
      setPhase('interview-synthesizing');
      try {
        const payload: TwinInterviewSynthesizePayload = { brief, qa: finalQa };
        if (roleContextRef.current) payload.roleContext = roleContextRef.current;
        const res = await window.electronAPI.twinInterviewSynthesize(payload);
        if (!activeRef.current) return;
        if (res.status === 'ok') {
          setInterviewDraft(res.draft);
          setPhase('history-offer');
          return;
        }
        setNotice(res.reason === 'no-model' ? 'no-model' : 'failed');
        setPhase('notice');
      } catch {
        if (!activeRef.current) return;
        setNotice('failed');
        setPhase('notice');
      }
    },
    [brief],
  );

  // Ask the model for the next question; auto-synthesize on `done`.
  const loadNext = useCallback(
    async (currentQa: TwinQATurn[]) => {
      try {
        const payload: TwinInterviewNextPayload = { brief, profileSoFar: {}, qa: currentQa };
        if (roleContextRef.current) payload.roleContext = roleContextRef.current;
        const res = await window.electronAPI.twinInterviewNext(payload);
        if (!activeRef.current) return;
        if (res.status === 'ok') {
          setQuestion(res.question);
          setAnswer('');
          setPhase('interview-answering');
          return;
        }
        if (res.status === 'done') {
          await finish(currentQa);
          return;
        }
        setNotice(res.reason === 'no-model' ? 'no-model' : 'failed');
        setPhase('notice');
      } catch {
        if (!activeRef.current) return;
        setNotice('failed');
        setPhase('notice');
      }
    },
    [brief, finish],
  );

  // Begin the interview from an empty Q&A, threading any researched role context.
  const startInterview = useCallback(
    (ctx?: string) => {
      roleContextRef.current = ctx;
      setQa([]);
      setPhase('interview-loading');
      void loadNext([]);
    },
    [loadNext],
  );

  // --- research (step 2, cloud) ---

  const runResearch = useCallback(async () => {
    setInfoNote(null);
    setPhase('researching');
    try {
      const res = await window.electronAPI.twinResearchRole({
        role: role.trim(),
        company: company.trim(),
        industry: industry.trim(),
        brief,
      });
      if (!activeRef.current) return;
      if (res.status === 'ok') {
        setResearch(res.result);
        setPhase('research-review');
        return;
      }
      // unsupported / skipped: proceed straight to the interview (never blocks).
      setInfoNote(
        res.status === 'unsupported'
          ? "Web research isn't available with your current model, so we'll go straight to the interview."
          : "Role research was skipped, so we'll go straight to the interview.",
      );
      startInterview(undefined);
    } catch {
      if (!activeRef.current) return;
      setInfoNote("Role research couldn't run, so we'll go straight to the interview.");
      startInterview(undefined);
    }
  }, [role, company, industry, brief, startInterview]);

  // --- merge + forward (step 5) ---

  const forwardMerged = useCallback(
    (history: Partial<TwinProfileSections> | null) => {
      // existing → research → interview → history: later wins, arrays concat + dedupe.
      onDraft(mergeDrafts(existingSections, research?.draft ?? null, interviewDraft, history));
    },
    [onDraft, existingSections, research, interviewDraft],
  );

  // --- history (step 4, optional) ---

  const runHistory = useCallback(async () => {
    setHistoryInfo(null);
    setPhase('history-running');
    try {
      const res = await window.electronAPI.twinResearchHistory();
      if (!activeRef.current) return;
      forwardMerged(res.status === 'ok' ? res.draft : null);
    } catch {
      if (!activeRef.current) return;
      forwardMerged(null); // history is optional — forward what we have
    }
  }, [forwardMerged]);

  const beginHistory = useCallback(async () => {
    setPhase('history-checking');
    try {
      const info = await window.electronAPI.twinResearchHistoryInfo();
      if (!activeRef.current) return;
      if (info.providerLabel === NO_MODEL_LABEL) {
        forwardMerged(null); // no cloud destination — mining unavailable, forward as-is
        return;
      }
      if (info.isLocal) {
        await runHistory();
        return;
      }
      setHistoryInfo(info); // cloud → require explicit per-run consent
      setPhase('history-offer');
    } catch {
      if (!activeRef.current) return;
      forwardMerged(null); // couldn't check — forward what we have, non-blocking
    }
  }, [forwardMerged, runHistory]);

  // --- interview turn handlers (event handlers — synchronous setState is fine here) ---

  const submitAnswer = () => {
    const text = answer.trim();
    if (!text) return;
    const next = [...qa, { question, answer: text }];
    setQa(next);
    setPhase('interview-loading');
    void loadNext(next);
  };

  const skipQuestion = () => {
    const next = [...qa, { question, answer: '' }];
    setQa(next);
    setPhase('interview-loading');
    void loadNext(next);
  };

  const finishNow = () => {
    const text = answer.trim();
    const finalQa = text ? [...qa, { question, answer: text }] : qa;
    setQa(finalQa);
    void finish(finalQa);
  };

  const canResearch = model?.isFrontier === true;
  const providerLabel = model?.providerLabel || 'your cloud provider';
  const loadingLabel = LOADING_LABEL[phase];
  const questionNumber = Math.min(qa.length + 1, MAX_QUESTIONS);

  // Route the current phase to its body. Kept as a small switch so the component's
  // render stays under the complexity budget.
  const body = (): ReactNode => {
    if (loadingLabel) return <LoadingRow label={loadingLabel} />;
    switch (phase) {
      case 'role':
        return (
          <DeepRoleStep
            brief={brief}
            role={role}
            company={company}
            industry={industry}
            onRoleChange={setRole}
            onCompanyChange={setCompany}
            onIndustryChange={setIndustry}
            canResearch={canResearch}
            providerLabel={providerLabel}
            onResearch={() => void runResearch()}
            onSkip={() => startInterview(undefined)}
          />
        );
      case 'research-review':
        return research ? (
          <DeepResearchReview result={research} onContinue={() => startInterview(research.roleContext)} />
        ) : null;
      case 'interview-answering':
        return (
          <DeepInterviewStep
            question={question}
            answer={answer}
            questionNumber={questionNumber}
            maxQuestions={MAX_QUESTIONS}
            onAnswerChange={setAnswer}
            onSubmit={submitAnswer}
            onSkip={skipQuestion}
            onFinish={finishNow}
          />
        );
      case 'history-offer':
        return (
          <DeepHistoryStep
            onUseHistory={() => void beginHistory()}
            onSkip={() => forwardMerged(null)}
            useHistoryButtonRef={historyTriggerRef}
          />
        );
      case 'notice':
        if (!notice) return null;
        // When consented research already succeeded, don't waste it: offer continuing
        // with the research draft (existing + research) as the primary action (#3).
        return research ? (
          <FormFallbackNotice
            message="The interview couldn't continue, but the role research we found is ready for review. Continue with that, or fill the form instead."
            onUseForm={onUseForm ?? onBack}
            onKeepPartial={() => forwardMerged(null)}
          />
        ) : (
          <FormFallbackNotice message={NOTICE_MESSAGE[notice]} onUseForm={onUseForm ?? onBack} />
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        disabled={phase === 'interview-synthesizing'}
        className="flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-40"
      >
        <ChevronLeft size={16} />
        Back to options
      </button>

      <div className="flex items-center gap-2">
        <MessagesSquare size={18} className="text-[var(--color-accent)] shrink-0" />
        <h3 className="font-hud text-base text-[var(--color-text-primary)]">Deep interview</h3>
      </div>

      {brief.trim() && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-accent-muted)]/30 p-3">
          <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-1">Your brief</p>
          <p className="text-sm text-[var(--color-text-primary)] break-words overflow-hidden">{brief.trim()}</p>
        </div>
      )}

      {infoNote && <InfoNote text={infoNote} />}

      {body()}

      {historyInfo && (
        <TwinResearchConsentDialog
          info={historyInfo}
          onConfirm={() => void runHistory()}
          onCancel={() => setHistoryInfo(null)}
          returnFocusRef={historyTriggerRef}
        />
      )}
    </div>
  );
}
