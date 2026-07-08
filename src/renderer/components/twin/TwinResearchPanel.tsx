// === FILE PURPOSE ===
// Digital Twin "Build from my history" mode panel (V3.3.5 — Task 3). Mounted by
// TwinWizard's mode fork. Mines the user's OWN local data (meeting excerpts,
// briefs, projects, cards) into a profile draft, and ALSO hosts the web-research
// sub-section (TwinWebResearchSection, owned by Task 4) — so history mining and web
// research live in one "build from what's known" panel without the two tasks ever
// editing the same file. Seeded by the user's free-form `brief`.
//
// === FLOW ===
// 1. "Mine my history" → twinResearchHistoryInfo() (the NO-model consent descriptor).
//    - Local model → run immediately (no dialog).
//    - Cloud model → TwinResearchConsentDialog with the exact counts + provider;
//      only Confirm runs it (EVERY run, no remember-me — locked decision).
//    - No model configured → a non-blocking notice pointing at the Quick form; no
//      dialog and NOTHING is sent (there is no destination).
// 2. On a successful mine we DON'T auto-forward: the panel surfaces the source
//    attribution (which meetings/briefs/projects/cards it drew from) so the user
//    sees the provenance BEFORE anything lands in the wizard's review. The web
//    sub-section can enrich the same accumulated draft. "Continue to review" then
//    hands the MERGED draft up via onDraft — the wizard seeds its shared editable
//    review from it, and the user saves there (nothing auto-saves).
//
// SUB-SEAM (Task 3 ↔ Task 4): TwinWebResearchSection reports its web-research draft
// via onDraft(draft, citations); this panel MERGES it with the history-mined draft
// (keeping citations for attribution), so the single "Continue to review" forwards
// the combined Partial<TwinProfileSections>. Task 3 owns the panel body and the
// merge; Task 4 owns TwinWebResearchSection's body (do NOT edit it here).

import { useRef, useState } from 'react';
import { History, ChevronLeft, Sparkles, FileText, FolderKanban, StickyNote, Users, ExternalLink } from 'lucide-react';
import TwinWebResearchSection from './TwinWebResearchSection';
import TwinResearchConsentDialog from './TwinResearchConsentDialog';
import type {
  TwinProfileSections,
  TwinResearchHistoryInfo,
  TwinSourceHint,
  TwinCitation,
} from '../../../shared/types/twin';

export interface TwinResearchPanelProps {
  /** The user's free-form brief, seeding the mining + web research. May be empty. */
  brief: string;
  /** Return to the wizard's mode-choice screen. */
  onBack: () => void;
  /**
   * Hand the synthesized profile draft UP to the wizard, which seeds its shared
   * editable review from it (the user edits + saves there — nothing auto-saves).
   */
  onDraft: (draft: Partial<TwinProfileSections>) => void;
}

/** The descriptor's provider label when nothing is configured (matches the service
 *  + twin:get-creation-model). Used to skip the dialog entirely — with no model
 *  there is no cloud destination, so nothing can leave the machine. */
const NO_MODEL_LABEL = 'No model configured';

/** Merge an "add" draft into a "base" draft: base wins on object fields; arrays
 *  concatenate. Used to fold the web draft into the history-mined draft. */
function mergeSections(
  base: Partial<TwinProfileSections>,
  add: Partial<TwinProfileSections>,
): Partial<TwinProfileSections> {
  const out: Record<string, unknown> = { ...add, ...base };
  for (const key of Object.keys(add) as (keyof TwinProfileSections)[]) {
    if (!(key in base)) continue;
    const b = base[key];
    const a = add[key];
    if (Array.isArray(b) && Array.isArray(a)) out[key] = [...b, ...a];
    else if (b && a && typeof b === 'object' && typeof a === 'object') out[key] = { ...a, ...b };
  }
  return out as Partial<TwinProfileSections>;
}

const SOURCE_ICON: Record<TwinSourceHint['kind'], typeof FileText> = {
  meeting: FileText,
  brief: StickyNote,
  project: FolderKanban,
  card: Users,
};

/** Small attribution chip list — where the mined draft came from. */
function SourceHints({ sources }: { sources: TwinSourceHint[] }) {
  if (sources.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">Drawn from your history</p>
      <ul className="flex flex-wrap gap-1.5">
        {sources.map((s) => {
          const Icon = SOURCE_ICON[s.kind];
          return (
            <li
              key={`${s.kind}:${s.id}`}
              className="flex items-center gap-1 max-w-full rounded border border-[var(--color-border)] bg-[var(--color-accent-muted)]/30 px-2 py-0.5 text-xs text-[var(--color-text-secondary)] overflow-hidden"
            >
              <Icon size={11} className="shrink-0 text-[var(--color-accent-dim)]" aria-hidden="true" />
              <span className="truncate break-words">{s.label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Web-research citations, when the web sub-section contributed. */
function Citations({ citations }: { citations: TwinCitation[] }) {
  if (citations.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">Web sources</p>
      <ul className="space-y-1">
        {citations.map((c, i) => (
          <li
            key={`${c.url}:${i}`}
            className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)] overflow-hidden"
          >
            <ExternalLink size={11} className="shrink-0 text-[var(--color-accent-dim)]" aria-hidden="true" />
            <span className="truncate break-words">{c.title || c.url}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function TwinResearchPanel({ brief, onBack, onDraft }: TwinResearchPanelProps) {
  const [phase, setPhase] = useState<'idle' | 'checking' | 'running'>('idle');
  const [consentInfo, setConsentInfo] = useState<TwinResearchHistoryInfo | null>(null);
  const [historyDraft, setHistoryDraft] = useState<Partial<TwinProfileSections> | null>(null);
  const [webDraft, setWebDraft] = useState<Partial<TwinProfileSections> | null>(null);
  const [sources, setSources] = useState<TwinSourceHint[]>([]);
  const [citations, setCitations] = useState<TwinCitation[]>([]);
  const [notice, setNotice] = useState<'no-model' | 'failed' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The mining trigger — focus returns here when the consent dialog closes (#6.5).
  const mineButtonRef = useRef<HTMLButtonElement>(null);

  const busy = phase !== 'idle';
  const hasDraft = historyDraft !== null || webDraft !== null;

  const runMining = async () => {
    setConsentInfo(null);
    setNotice(null);
    setError(null);
    setPhase('running');
    try {
      const result = await window.electronAPI.twinResearchHistory();
      if (result.status === 'ok') {
        setHistoryDraft(result.draft);
        setSources(result.sources);
      } else {
        setNotice(result.reason === 'no-model' ? 'no-model' : 'failed');
      }
    } catch {
      setError('Mining your history failed. You can still use the Quick form.');
    } finally {
      setPhase('idle');
    }
  };

  const handleMine = async () => {
    setNotice(null);
    setError(null);
    setPhase('checking');
    try {
      const info = await window.electronAPI.twinResearchHistoryInfo();
      if (info.providerLabel === NO_MODEL_LABEL) {
        // No cloud destination exists — never show a "send to nowhere" dialog.
        setNotice('no-model');
        setPhase('idle');
      } else if (info.isLocal) {
        await runMining();
      } else {
        setConsentInfo(info); // cloud → require explicit per-run consent
        setPhase('idle');
      }
    } catch {
      setError('Could not check what would be read from your history.');
      setPhase('idle');
    }
  };

  /** Web sub-section produced a draft — fold it into the accumulated draft. */
  const handleWebDraft = (draft: Partial<TwinProfileSections>, webCitations: TwinCitation[]) => {
    setWebDraft((prev) => mergeSections(prev ?? {}, draft));
    setCitations((prev) => [...prev, ...webCitations]);
  };

  /** Hand the merged (history + web) draft up to the wizard's editable review. */
  const handleContinue = () => {
    onDraft(mergeSections(historyDraft ?? {}, webDraft ?? {}));
  };

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
      >
        <ChevronLeft size={16} />
        Back to options
      </button>

      <div className="flex items-center gap-2">
        <History size={18} className="text-[var(--color-accent)] shrink-0" />
        <h3 className="font-hud text-base text-[var(--color-text-primary)]">Build from my history</h3>
      </div>

      {brief.trim() && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-accent-muted)]/30 p-3">
          <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-1">Your brief</p>
          <p className="text-sm text-[var(--color-text-primary)] break-words overflow-hidden">{brief.trim()}</p>
        </div>
      )}

      <div className="rounded-lg border border-[var(--color-border)] p-4 space-y-3">
        <p className="text-sm text-[var(--color-text-secondary)] break-words">
          Draft your twin from your recent meetings, briefs, projects, and cards. You will see exactly what would be
          read — and consent first if a cloud model is configured. Nothing is saved until you review it.
        </p>
        <button
          ref={mineButtonRef}
          type="button"
          onClick={() => void handleMine()}
          disabled={busy}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm bg-[var(--color-accent-muted)] hover:bg-[var(--color-accent-dim)] text-[var(--color-accent)] border border-[var(--color-border-accent)] transition-all disabled:opacity-50"
        >
          <Sparkles size={16} />
          {phase === 'checking'
            ? 'Checking your history…'
            : phase === 'running'
              ? 'Reading your history…'
              : hasDraft
                ? 'Mine again'
                : 'Mine my history'}
        </button>

        {notice === 'no-model' && (
          <p role="status" className="text-sm text-[var(--color-text-secondary)] break-words">
            No AI model is configured, so history mining is unavailable. Use the Quick form to author your profile.
          </p>
        )}
        {notice === 'failed' && (
          <p role="status" className="text-sm text-[var(--color-text-secondary)] break-words">
            Couldn&apos;t draft a profile from your history yet. You can try again or use the Quick form.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-500 break-words">
            {error}
          </p>
        )}
      </div>

      {hasDraft && (
        <div className="rounded-lg border border-[var(--color-border-accent)] bg-[var(--color-accent-muted)]/20 p-4 space-y-3">
          <p className="text-sm font-medium text-[var(--color-text-primary)]">
            A draft is ready to review — edit anything before it is saved.
          </p>
          <SourceHints sources={sources} />
          <Citations citations={citations} />
          <button
            type="button"
            onClick={handleContinue}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white transition-all"
          >
            Continue to review
          </button>
        </div>
      )}

      {/* Task 4's seam — the web-research sub-section lives here so Tasks 3 and 4
          never edit the same file. Its draft + citations are merged into the
          accumulated draft above, then forwarded on "Continue to review". */}
      <TwinWebResearchSection brief={brief} onDraft={handleWebDraft} />

      {consentInfo && (
        <TwinResearchConsentDialog
          info={consentInfo}
          onConfirm={() => void runMining()}
          onCancel={() => setConsentInfo(null)}
          returnFocusRef={mineButtonRef}
        />
      )}
    </div>
  );
}
