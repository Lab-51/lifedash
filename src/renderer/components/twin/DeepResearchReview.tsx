// === FILE PURPOSE ===
// Step 2 review of the orchestrated Digital Twin "Deep interview" flow (V3.3.5):
// shows the CITED role dossier returned by twin:research-role — the prose role
// background, the structured findings (domain / refined identity / vocabulary /
// typical priorities), and clickable sources. Nothing is saved: it is an editable
// STARTING POINT the gap interview then builds on. "Continue to interview" hands
// control back to the panel.
//
// Rendered as a stack of null-returning blocks so each stays trivial and the whole
// component has no branchy render (eslint complexity budget).
//
// === DEPENDENCIES ===
// react (implicit), lucide-react, shared/types/twin.

import { Sparkles, ExternalLink, ChevronRight } from 'lucide-react';
import type {
  TwinRoleResearchDraft,
  TwinCitation,
  TwinDomain,
  TwinIdentity,
  TwinVocabularyTerm,
} from '../../../shared/types/twin';

export interface DeepResearchReviewProps {
  result: TwinRoleResearchDraft;
  onContinue: () => void;
}

/** One "label: value" dossier row. */
function DossierRow({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-sm text-[var(--color-text-secondary)] break-words overflow-hidden">
      <span className="text-[var(--color-text-muted)]">{label}:</span> {value}
    </p>
  );
}

/** The prose role/industry background summary. */
function ContextSummary({ text }: { text: string }) {
  if (!text.trim()) return null;
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-accent-muted)]/20 p-3">
      <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-1">Role background</p>
      <p className="text-sm text-[var(--color-text-primary)] break-words overflow-hidden">{text.trim()}</p>
    </div>
  );
}

function DomainBlock({ domain }: { domain?: TwinDomain }) {
  const line = [domain?.industry, domain?.company, domain?.focus].filter(Boolean).join(' · ');
  if (!line) return null;
  return <DossierRow label="Domain" value={line} />;
}

function IdentityBlock({ identity }: { identity?: TwinIdentity }) {
  const line = [identity?.role, identity?.seniority].filter(Boolean).join(' · ');
  if (!line) return null;
  return <DossierRow label="Role" value={line} />;
}

function VocabBlock({ vocabulary }: { vocabulary?: TwinVocabularyTerm[] }) {
  if (!vocabulary || vocabulary.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-1">Vocabulary</p>
      <ul className="space-y-0.5">
        {vocabulary.map((v) => (
          <li key={v.term} className="text-xs text-[var(--color-text-secondary)] break-words overflow-hidden">
            <span className="text-[var(--color-text-primary)]">{v.term}</span>
            {v.meaning ? ` — ${v.meaning}` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}

function GoalsBlock({ goals }: { goals?: string[] }) {
  if (!goals || goals.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-1">Typical priorities</p>
      <ul className="list-disc pl-4 space-y-0.5">
        {goals.map((g, i) => (
          <li key={`${g}:${i}`} className="text-xs text-[var(--color-text-secondary)] break-words overflow-hidden">
            {g}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Clickable citations backing the dossier — the user can trust/trace every finding. */
function CitationsBlock({ citations }: { citations: TwinCitation[] }) {
  if (citations.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-1">Sources</p>
      <ul className="space-y-0.5">
        {citations.map((c, i) => (
          <li key={`${c.url}:${i}`} className="min-w-0">
            <a
              href={c.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline break-all overflow-hidden"
            >
              <ExternalLink size={12} className="shrink-0" />
              <span className="truncate">{c.title || c.url}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function DeepResearchReview({ result, onContinue }: DeepResearchReviewProps) {
  const { draft, roleContext, citations } = result;
  return (
    <div className="space-y-3 rounded-lg border border-[var(--color-border-accent)] bg-[var(--color-accent-muted)]/20 p-4">
      <div className="flex items-center gap-2">
        <Sparkles size={16} className="text-[var(--color-accent)] shrink-0" />
        <h4 className="text-sm font-medium text-[var(--color-text-primary)]">What we found about your role</h4>
      </div>
      <p className="text-xs text-[var(--color-text-muted)] break-words">
        Nothing is saved — this is an editable starting point. Next, the interview fills the gaps research can&apos;t
        know (your real projects, people, and goals).
      </p>

      <ContextSummary text={roleContext} />
      <DomainBlock domain={draft.domain} />
      <IdentityBlock identity={draft.identity} />
      <VocabBlock vocabulary={draft.vocabulary} />
      <GoalsBlock goals={draft.goals} />
      <CitationsBlock citations={citations} />

      <button
        type="button"
        onClick={onContinue}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg font-medium text-sm bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white transition-all"
      >
        Continue to interview
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
