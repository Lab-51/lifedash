// === FILE PURPOSE ===
// Step 1 of the orchestrated Digital Twin "Deep interview" flow (V3.3.5): the role
// input. The user confirms/edits their role, company, and industry (pre-filled from
// any existing profile) so the flow can RESEARCH the role before interviewing about
// the gaps. Two paths out:
//   - "Research my role" → a cloud web search. Because that leaves the machine, the
//     exact outgoing query is shown for an explicit Confirm first (privacy contract).
//   - "Skip research — just interview me" → straight to the interview (the honest
//     default for users with no frontier model or who don't want a cloud call).
//
// When the resolved creation model is NOT a frontier cloud model, research is not
// offered at all (an honest gate) — only the interview path is shown.
//
// === DEPENDENCIES ===
// react, lucide-react. Owns no data calls — the parent runs research/interview.

import { useEffect, useRef, useState } from 'react';
import { Search, ChevronRight } from 'lucide-react';
import { InfoNote } from './DeepInterviewParts';

const INPUT_CLASS =
  'w-full text-sm bg-white dark:bg-surface-900 border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)]';

const PRIMARY_BTN =
  'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg font-medium text-sm bg-[var(--color-accent-muted)] hover:bg-[var(--color-accent-dim)] text-[var(--color-accent)] border border-[var(--color-border-accent)] transition-all disabled:opacity-50';

export interface DeepRoleStepProps {
  /** The user's free-form brief — sent to the cloud provider WITH the role research,
   *  so the consent confirm must disclose it too. May be empty. */
  brief: string;
  role: string;
  company: string;
  industry: string;
  onRoleChange: (v: string) => void;
  onCompanyChange: (v: string) => void;
  onIndustryChange: (v: string) => void;
  /** True when the creation model is a frontier cloud model that can research the web. */
  canResearch: boolean;
  /** Label of the cloud provider the query would be sent to (for the consent copy). */
  providerLabel: string;
  /** User confirmed the (cloud) role-research call. */
  onResearch: () => void;
  /** User chose to skip research and go straight to the interview. */
  onSkip: () => void;
}

/** A labelled text input for one role field. */
function Field({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="block text-xs text-[var(--color-text-secondary)] mb-1">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT_CLASS}
      />
    </label>
  );
}

/** Cloud-consent gate: shows the exact outgoing strings before any network call. Moves
 *  focus into itself on appear (the clicked "Research my role" button unmounts, which
 *  would otherwise drop focus to <body>). */
function ResearchConfirm({
  brief,
  role,
  company,
  industry,
  providerLabel,
  onConfirm,
  onCancel,
}: {
  brief: string;
  role: string;
  company: string;
  industry: string;
  providerLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const groupRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    groupRef.current?.focus();
  }, []);

  return (
    <div
      ref={groupRef}
      role="group"
      aria-label="Confirm role research"
      tabIndex={-1}
      className="rounded-lg border border-[var(--color-border-accent)] bg-[var(--color-accent-muted)]/40 p-3 space-y-2 focus:outline-none"
    >
      <p className="text-xs text-[var(--color-text-secondary)]">
        This will send the following to {providerLabel} over the internet:
      </p>
      <ul className="text-xs text-[var(--color-text-primary)] space-y-0.5 break-words overflow-hidden">
        {role.trim() && (
          <li>
            <span className="text-[var(--color-text-muted)]">Role:</span> {role.trim()}
          </li>
        )}
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
        {brief.trim() && (
          <li>
            <span className="text-[var(--color-text-muted)]">Your brief:</span> {brief.trim()}
          </li>
        )}
      </ul>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="text-xs border border-[var(--color-accent)] bg-[var(--color-accent)] text-white px-2.5 py-1 rounded hover:opacity-90 transition-opacity"
        >
          Confirm &amp; research
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

/** The action row shown for a frontier model: research (with confirm) or skip. */
function ResearchChoice({
  brief,
  role,
  company,
  industry,
  providerLabel,
  onResearch,
  onSkip,
}: {
  brief: string;
  role: string;
  company: string;
  industry: string;
  providerLabel: string;
  onResearch: () => void;
  onSkip: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const canRun = [role, company, industry].some((v) => v.trim().length > 0);

  if (confirming) {
    return (
      <ResearchConfirm
        brief={brief}
        role={role}
        company={company}
        industry={industry}
        providerLabel={providerLabel}
        onConfirm={onResearch}
        onCancel={() => setConfirming(false)}
      />
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={() => setConfirming(true)} disabled={!canRun} className={PRIMARY_BTN}>
        <Search size={16} />
        Research my role
      </button>
      <button
        type="button"
        onClick={onSkip}
        className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
      >
        Skip research — just interview me
      </button>
    </div>
  );
}

export default function DeepRoleStep({
  brief,
  role,
  company,
  industry,
  onRoleChange,
  onCompanyChange,
  onIndustryChange,
  canResearch,
  providerLabel,
  onResearch,
  onSkip,
}: DeepRoleStepProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--color-text-secondary)] break-words">
        Confirm your role so we can research it first, then interview you about the gaps research can&apos;t know.
        Nothing is saved — you edit everything at the end.
      </p>

      <div className="grid gap-2">
        <Field label="Your role" value={role} placeholder="e.g. Senior Product Manager" onChange={onRoleChange} />
        <Field label="Company (optional)" value={company} placeholder="e.g. Acme Corp" onChange={onCompanyChange} />
        <Field
          label="Industry (optional)"
          value={industry}
          placeholder="e.g. B2B SaaS billing"
          onChange={onIndustryChange}
        />
      </div>

      {canResearch ? (
        <ResearchChoice
          brief={brief}
          role={role}
          company={company}
          industry={industry}
          providerLabel={providerLabel}
          onResearch={onResearch}
          onSkip={onSkip}
        />
      ) : (
        <div className="space-y-3">
          <InfoNote text="Web research isn't available with your current model. Continue with just the interview — it still works well." />
          <button type="button" onClick={onSkip} className={PRIMARY_BTN}>
            Start interview
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
