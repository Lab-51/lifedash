// === FILE PURPOSE ===
// Digital Twin web-research SUB-section (V3.3.5 — Task 4). Mounted INSIDE
// TwinResearchPanel so history-mining (Task 3) and web-research (Task 4) never edit
// the same file. Given a company/industry the user enters, it runs a provider-native
// web search (via twin:research-web) into a cited profile draft and bubbles it up
// through onDraft — the parent seeds its editable review from it.
//
// Web search needs a frontier cloud provider, so the section is VISIBLE only when
// the resolved twin-creation model is frontier (twin:get-creation-model → isFrontier)
// — an honest gate that needs no live support probe. Because the call is cloud by
// definition, the outgoing company/industry strings are shown for an explicit
// Confirm-before-run consent. If the provider turns out to have no web-search tool,
// twin:research-web returns `unsupported` and the section says so honestly (never a
// fabricated result). Skips are non-blocking; success shows the citations.
//
// The component is split into small render helpers (LoadingRow / AbsenceNotice /
// FrontierResearch / QueryInput / ConfirmPanel / ResultView / CitationList) so each
// function stays simple: the top-level component only owns the mount capability
// probe and the visibility gate.
//
// === DEPENDENCIES ===
// react, lucide-react. window.electronAPI.{twinGetCreationModel, twinResearchWeb}.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Globe, Loader2, ExternalLink, Check, Info } from 'lucide-react';
import type {
  TwinProfileSections,
  TwinCitation,
  TwinCreationModel,
  TwinWebResearchResult,
} from '../../../shared/types/twin';

export interface TwinWebResearchSectionProps {
  /** The user's free-form brief, shown as background for the research. May be empty. */
  brief: string;
  /** Bubble a web-research draft (+ citations) up to the research panel. */
  onDraft?: (draft: Partial<TwinProfileSections>, citations: TwinCitation[]) => void;
}

type Phase = 'idle' | 'confirm' | 'running';

const INPUT_CLASS =
  'w-full text-sm bg-white dark:bg-surface-900 border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)] disabled:opacity-50';

function Panel({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-[var(--color-border)] p-4 space-y-3">{children}</div>;
}

function Header() {
  return (
    <div className="flex items-center gap-2">
      <Globe size={16} className="text-[var(--color-accent)] shrink-0" />
      <h4 className="text-sm font-medium text-[var(--color-text-primary)]">Research from the web</h4>
    </div>
  );
}

export default function TwinWebResearchSection({ brief, onDraft }: TwinWebResearchSectionProps) {
  const [model, setModel] = useState<TwinCreationModel | null>(null);
  const [loading, setLoading] = useState(true);

  // Resolve the twin-creation model to decide whether to show the section at all.
  // No cloud call here — this only reads which model is configured.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const m = await window.electronAPI?.twinGetCreationModel();
        if (active) setModel(m ?? null);
      } catch {
        if (active) setModel(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <Panel>
        <Header />
        <LoadingRow label="Checking availability…" />
      </Panel>
    );
  }

  // Honest absence: web search needs a frontier cloud model. No live probe needed.
  if (!model?.isFrontier) {
    return (
      <Panel>
        <Header />
        <AbsenceNotice model={model} />
      </Panel>
    );
  }

  return (
    <FrontierResearch brief={brief} providerLabel={model.providerLabel || 'your cloud provider'} onDraft={onDraft} />
  );
}

function LoadingRow({ label }: { label: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
      <Loader2 size={14} className="animate-spin" />
      {label}
    </p>
  );
}

/** The "web enrichment isn't available" state for a non-frontier / missing model. */
function AbsenceNotice({ model }: { model: TwinCreationModel | null }) {
  const which = model?.providerLabel
    ? `Your twin-creation model (${model.providerLabel}${model.modelLabel ? ` — ${model.modelLabel}` : ''}) ${
        model.isLocal ? 'runs on-device' : "isn't a frontier cloud model"
      }`
    : 'No twin-creation model is configured';
  return (
    <p className="text-sm text-[var(--color-text-secondary)] break-words overflow-hidden">
      {which}, so web enrichment isn't available. Web research needs a frontier cloud provider (OpenAI, Anthropic, or
      Google).
    </p>
  );
}

/** The active section shown for a frontier model: query inputs → confirm → result. */
function FrontierResearch({
  brief,
  providerLabel,
  onDraft,
}: {
  brief: string;
  providerLabel: string;
  onDraft?: (draft: Partial<TwinProfileSections>, citations: TwinCitation[]) => void;
}) {
  const [company, setCompany] = useState('');
  const [industry, setIndustry] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<TwinWebResearchResult | null>(null);

  // Guard against a slow web-search resolving after the user navigated away (Back /
  // wizard close): a late onDraft would snap them into an abandoned review (finding
  // #6.4). Set true on (re)mount so StrictMode's mount→cleanup→mount leaves it true.
  const activeRef = useRef(true);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  const canRun = company.trim().length > 0 || industry.trim().length > 0;
  const busy = phase !== 'idle';

  const runResearch = async () => {
    setPhase('running');
    setResult(null);
    try {
      const res = await window.electronAPI.twinResearchWeb({ company: company.trim(), industry: industry.trim() });
      if (!activeRef.current) return; // navigated away mid-search — do not draft or touch state
      setResult(res);
      if (res.status === 'ok') onDraft?.(res.draft, res.citations);
    } catch {
      // Any unexpected rejection degrades to a non-blocking skip — never blocks creation.
      if (!activeRef.current) return;
      setResult({ status: 'skipped', reason: 'failed' });
    } finally {
      if (activeRef.current) setPhase('idle');
    }
  };

  return (
    <Panel>
      <Header />
      <p className="text-sm text-[var(--color-text-secondary)] break-words">
        Enrich your twin with public web context about your company and industry — with citations. This sends your query
        to {providerLabel} (cloud).
      </p>
      {brief.trim() && (
        <p className="text-xs text-[var(--color-text-muted)] break-words overflow-hidden">
          Background from your brief: {brief.trim()}
        </p>
      )}

      <div className="grid gap-2">
        <QueryInput
          label="Company"
          value={company}
          placeholder="e.g. Acme Corp"
          disabled={busy}
          onChange={setCompany}
        />
        <QueryInput
          label="Industry"
          value={industry}
          placeholder="e.g. B2B SaaS billing"
          disabled={busy}
          onChange={setIndustry}
        />
      </div>

      {phase === 'idle' && (
        <button
          type="button"
          onClick={() => setPhase('confirm')}
          disabled={!canRun}
          className="flex items-center gap-1.5 text-xs border border-[var(--color-accent-dim)] text-[var(--color-accent)] hover:border-[var(--color-accent)] px-2.5 py-1 rounded transition-colors disabled:opacity-50"
        >
          <Globe size={14} />
          Research the web
        </button>
      )}

      {phase === 'confirm' && (
        <ConfirmPanel
          company={company}
          industry={industry}
          providerLabel={providerLabel}
          onConfirm={() => void runResearch()}
          onCancel={() => setPhase('idle')}
        />
      )}

      {phase === 'running' && <LoadingRow label="Searching the web…" />}

      {phase === 'idle' && result && <ResultView result={result} />}
    </Panel>
  );
}

/** A labelled text input for one query field. */
function QueryInput({
  label,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="block text-xs text-[var(--color-text-secondary)] mb-1">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className={INPUT_CLASS}
      />
    </label>
  );
}

/** Cloud-consent gate: shows the exact outgoing strings before any network call. */
function ConfirmPanel({
  company,
  industry,
  providerLabel,
  onConfirm,
  onCancel,
}: {
  company: string;
  industry: string;
  providerLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="group"
      aria-label="Confirm web research"
      className="rounded-lg border border-[var(--color-border-accent)] bg-[var(--color-accent-muted)]/40 p-3 space-y-2"
    >
      <p className="text-xs text-[var(--color-text-secondary)]">
        This will send the following query to {providerLabel} over the internet:
      </p>
      <ul className="text-xs text-[var(--color-text-primary)] space-y-0.5 break-words overflow-hidden">
        {company.trim() && (
          <li>
            <span className="text-[var(--color-text-muted)]">Company:</span> {company.trim()}
          </li>
        )}
        {industry.trim() && (
          <li>
            <span className="text-[var(--color-text-muted)]">Industry:</span> {industry.trim()}
          </li>
        )}
      </ul>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="text-xs border border-[var(--color-accent)] bg-[var(--color-accent)] text-white px-2.5 py-1 rounded hover:opacity-90 transition-opacity"
        >
          Confirm &amp; search
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] px-2 py-1 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Renders the outcome of a completed research call (ok / unsupported / skipped). */
function ResultView({ result }: { result: TwinWebResearchResult }) {
  if (result.status === 'unsupported') {
    return (
      <p role="status" className="flex items-start gap-1.5 text-xs text-[var(--color-text-secondary)] break-words">
        <Info size={14} className="shrink-0 mt-0.5" />
        Web research isn't available with the current provider or SDK.
      </p>
    );
  }

  if (result.status === 'skipped') {
    return (
      <p role="status" className="flex items-start gap-1.5 text-xs text-[var(--color-text-secondary)] break-words">
        <Info size={14} className="shrink-0 mt-0.5" />
        {result.reason === 'no-model'
          ? 'No AI model is configured, so web research was skipped. You can continue manually.'
          : "Couldn't complete web research. You can continue manually, or try again."}
      </p>
    );
  }

  const { draft, citations } = result;
  const vocab = draft.vocabulary ?? [];
  const nothingFound = !draft.domain && vocab.length === 0;

  return (
    <div role="status" className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs text-[var(--color-accent)]">
        <Check size={14} className="shrink-0" />
        {nothingFound ? 'No public enrichment found — nothing added.' : 'Added to your review below.'}
      </p>

      {draft.domain && (
        <p className="text-xs text-[var(--color-text-secondary)] break-words overflow-hidden">
          {[draft.domain.industry, draft.domain.focus].filter(Boolean).join(' · ')}
        </p>
      )}
      {vocab.length > 0 && (
        <p className="text-xs text-[var(--color-text-secondary)] break-words overflow-hidden">
          {vocab.length} term{vocab.length === 1 ? '' : 's'}: {vocab.map((v) => v.term).join(', ')}
        </p>
      )}

      {citations.length > 0 && <CitationList citations={citations} />}
    </div>
  );
}

/** The visible source list backing a drafted result. */
function CitationList({ citations }: { citations: TwinCitation[] }) {
  return (
    <div className="space-y-1">
      <span className="block text-xs font-medium text-[var(--color-text-secondary)]">Sources</span>
      <ul className="space-y-0.5">
        {citations.map((c) => (
          <li key={c.url} className="min-w-0">
            <a
              href={c.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline break-all overflow-hidden"
            >
              <ExternalLink size={12} className="shrink-0" />
              <span className="truncate">{c.title}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
