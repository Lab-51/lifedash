// === FILE PURPOSE ===
// Digital Twin creation/refinement wizard (V3.3 Task 4). A guided, multi-step
// interview (identity -> domain -> projects -> people -> vocabulary -> goals ->
// preferences -> review). Each step is a plain form built from the same field
// editors the section cards use, so the wizard is FULLY USABLE with zero AI.
// An optional per-step "interview me" affordance (TwinInterviewAssist) drafts
// field values from a free-form answer, which the user edits — the form is the
// source of truth. It NEVER auto-advances off an AI answer.
//
// Re-runnable: on mount it loads any existing profile and pre-fills every step
// (refine, not restart). The final review step shows exactly what will be saved
// and writes each section through the same twinUpdateProfileSection patch API
// the cards use, returning the updated profile to onComplete.
//
// === DEPENDENCIES ===
// react, lucide-react, twin/twinSteps + twin/twinFields (config/data),
// twin/TwinFieldEditors (form + prune helpers), twin/TwinInterviewAssist,
// twin/TwinWizardReview, LoadingSpinner.

import { useEffect, useState } from 'react';
import { X, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import LoadingSpinner from './LoadingSpinner';
import TwinInterviewAssist from './twin/TwinInterviewAssist';
import TwinWizardReview from './twin/TwinWizardReview';
import { fieldsToDraft, pruneObject, pruneRows, ObjectFieldsEditor, ListFieldsEditor } from './twin/TwinFieldEditors';
import { WIZARD_STEPS, type WizardStep, type WizardDrafts } from './twin/twinSteps';
import {
  IDENTITY_FIELDS,
  DOMAIN_FIELDS,
  PREFERENCES_FIELDS,
  PROJECT_FIELDS,
  PERSON_FIELDS,
  VOCAB_FIELDS,
  GOAL_FIELDS,
} from './twin/twinFields';
import type {
  TwinProfile,
  TwinProfileSections,
  TwinIdentity,
  TwinDomain,
  TwinPreferences,
  TwinProject,
  TwinPerson,
  TwinVocabularyTerm,
} from '../../shared/types/twin';

// ---------------------------------------------------------------------------
// Pure helpers (seed / merge / validate) — kept out of the component so its
// render + handlers stay simple.
// ---------------------------------------------------------------------------

const asRecord = (v: unknown): Record<string, string | undefined> => v as Record<string, string | undefined>;

/** Seed the wizard's working drafts from an existing profile (or empty on create). */
function seedDrafts(profile: TwinProfile | null): WizardDrafts {
  const rows = (items: unknown[], fields: typeof PROJECT_FIELDS) =>
    items.map((it) => fieldsToDraft(fields, asRecord(it)));
  return {
    identity: fieldsToDraft(IDENTITY_FIELDS, asRecord(profile?.identity ?? {})),
    domain: fieldsToDraft(DOMAIN_FIELDS, asRecord(profile?.domain ?? {})),
    preferences: fieldsToDraft(PREFERENCES_FIELDS, asRecord(profile?.preferences ?? {})),
    projects: rows(profile?.projects ?? [], PROJECT_FIELDS),
    people: rows(profile?.people ?? [], PERSON_FIELDS),
    vocabulary: rows(profile?.vocabulary ?? [], VOCAB_FIELDS),
    goals: (profile?.goals ?? []).map((g) => ({ value: g })),
  };
}

/** Fill only currently-empty fields from the AI draft — user input always wins. */
function mergeObjectFields(
  fields: typeof IDENTITY_FIELDS,
  current: Record<string, string>,
  ai: Record<string, string | undefined>,
): Record<string, string> {
  const out = { ...current };
  for (const f of fields) {
    if (!out[f.key]?.trim() && ai[f.key]?.trim()) out[f.key] = ai[f.key]!.trim();
  }
  return out;
}

/** Keep the user's non-empty rows, append the AI-drafted rows after them. */
function appendListRows(
  fields: typeof PROJECT_FIELDS,
  current: Record<string, string>[],
  aiItems: Record<string, string | undefined>[],
): Record<string, string>[] {
  const kept = current.filter((r) => Object.values(r).some((v) => v?.trim()));
  return [...kept, ...aiItems.map((item) => fieldsToDraft(fields, item))];
}

/** Merge an AI-assist draft for one step into the working drafts (immutably). */
function mergeDraftInto(
  prev: WizardDrafts,
  step: WizardStep,
  aiDraft: TwinProfileSections[typeof step.key],
): WizardDrafts {
  if (step.key === 'goals') {
    const items = (aiDraft as string[]).map((g) => ({ value: g }));
    return { ...prev, goals: appendListRows(GOAL_FIELDS, prev.goals, items) };
  }
  if (step.kind === 'object') {
    const merged = mergeObjectFields(step.fields, prev[step.key] as Record<string, string>, asRecord(aiDraft));
    return { ...prev, [step.key]: merged } as WizardDrafts;
  }
  const appended = appendListRows(
    step.fields,
    prev[step.key] as Record<string, string>[],
    aiDraft as unknown as Record<string, string | undefined>[],
  );
  return { ...prev, [step.key]: appended } as WizardDrafts;
}

/**
 * Prune + validate every section into the concrete profile shapes ready to save.
 * Returns a validation error (first offending required list row) instead of
 * values so the review step can show it — never silently drops user data.
 */
function buildSectionValues(drafts: WizardDrafts): { values: TwinProfileSections | null; error: string | null } {
  const projects = pruneRows(PROJECT_FIELDS, drafts.projects);
  if (projects.error) return { values: null, error: projects.error };
  const people = pruneRows(PERSON_FIELDS, drafts.people);
  if (people.error) return { values: null, error: people.error };
  const vocabulary = pruneRows(VOCAB_FIELDS, drafts.vocabulary);
  if (vocabulary.error) return { values: null, error: vocabulary.error };
  const goals = pruneRows(GOAL_FIELDS, drafts.goals);
  if (goals.error) return { values: null, error: goals.error };

  return {
    values: {
      identity: pruneObject(IDENTITY_FIELDS, drafts.identity) as TwinIdentity,
      domain: pruneObject(DOMAIN_FIELDS, drafts.domain) as TwinDomain,
      preferences: pruneObject(PREFERENCES_FIELDS, drafts.preferences) as TwinPreferences,
      projects: projects.rows as unknown as TwinProject[],
      people: people.rows as unknown as TwinPerson[],
      vocabulary: vocabulary.rows as unknown as TwinVocabularyTerm[],
      goals: goals.rows.map((r) => r.value),
    },
    error: null,
  };
}

/** Persist every section via the section-patch API; the last call returns the full profile. */
async function writeAllSections(values: TwinProfileSections): Promise<TwinProfile> {
  const api = window.electronAPI;
  await api.twinUpdateProfileSection('identity', values.identity);
  await api.twinUpdateProfileSection('domain', values.domain);
  await api.twinUpdateProfileSection('projects', values.projects);
  await api.twinUpdateProfileSection('people', values.people);
  await api.twinUpdateProfileSection('vocabulary', values.vocabulary);
  await api.twinUpdateProfileSection('goals', values.goals);
  return api.twinUpdateProfileSection('preferences', values.preferences);
}

// ---------------------------------------------------------------------------
// Step body (one interview step's form + optional AI assist)
// ---------------------------------------------------------------------------

function StepBody({
  step,
  drafts,
  onChange,
  onAiDraft,
}: {
  step: WizardStep;
  drafts: WizardDrafts;
  onChange: (next: WizardDrafts) => void;
  onAiDraft: (step: WizardStep, draft: TwinProfileSections[typeof step.key]) => void;
}) {
  const Icon = step.icon;
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Icon size={18} className="text-[var(--color-accent)] shrink-0" />
          <h3 className="font-hud text-base text-[var(--color-text-primary)]">{step.title}</h3>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)] break-words">{step.blurb}</p>
      </div>

      <TwinInterviewAssist section={step.key} question={step.question} onDraft={(draft) => onAiDraft(step, draft)} />

      {step.kind === 'object' ? (
        <ObjectFieldsEditor
          fields={step.fields}
          value={drafts[step.key] as Record<string, string>}
          onChange={(v) => onChange({ ...drafts, [step.key]: v } as WizardDrafts)}
        />
      ) : (
        <ListFieldsEditor
          fields={step.fields}
          rows={drafts[step.key] as Record<string, string>[]}
          onChange={(v) => onChange({ ...drafts, [step.key]: v } as WizardDrafts)}
          addLabel={step.addLabel ?? 'Add'}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------

const TOTAL_STEPS = WIZARD_STEPS.length + 1; // + review

export default function TwinWizard({
  onClose,
  onComplete,
}: {
  onClose: () => void;
  onComplete: (profile: TwinProfile) => void;
}) {
  const [drafts, setDrafts] = useState<WizardDrafts | null>(null);
  const [isRefine, setIsRefine] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI
      .twinGetProfile()
      .then((profile) => {
        setIsRefine(profile !== null);
        setDrafts(seedDrafts(profile));
      })
      .catch(() => setDrafts(seedDrafts(null)));
  }, []);

  const isReview = stepIndex === WIZARD_STEPS.length;

  const handleFinish = async () => {
    if (!drafts) return;
    const { values, error } = buildSectionValues(drafts);
    if (error || !values) {
      setSaveError(error ?? 'Something is incomplete. Review the steps and try again.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      onComplete(await writeAllSections(values));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save your profile. Try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!drafts) {
    return (
      <div className="flex items-center justify-center py-16">
        <LoadingSpinner />
      </div>
    );
  }

  const step = WIZARD_STEPS[stepIndex];

  return (
    <section aria-label="Twin setup wizard" className="hud-panel clip-corner-cut-sm p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-4 mb-1">
        <h2 className="font-hud text-lg text-[var(--color-accent)] text-glow">
          {isRefine ? 'Refine your twin' : 'Set up your twin'}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close wizard"
          className="shrink-0 p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      <p className="text-xs font-data tracking-wide text-[var(--color-text-secondary)] mb-1">
        Step {stepIndex + 1} of {TOTAL_STEPS}
      </p>
      <div
        className="h-1 w-full rounded bg-[var(--color-border)] overflow-hidden mb-5"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={TOTAL_STEPS}
        aria-valuenow={stepIndex + 1}
      >
        <div
          className="h-full bg-[var(--color-accent)] transition-all"
          style={{ width: `${((stepIndex + 1) / TOTAL_STEPS) * 100}%` }}
        />
      </div>

      {isReview ? (
        <TwinWizardReview drafts={drafts} />
      ) : (
        <StepBody
          step={step}
          drafts={drafts}
          onChange={setDrafts}
          onAiDraft={(s, draft) => setDrafts((prev) => (prev ? mergeDraftInto(prev, s, draft) : prev))}
        />
      )}

      {saveError && (
        <p className="mt-4 text-sm text-red-500 break-words" role="alert">
          {saveError}
        </p>
      )}

      <div className="flex items-center justify-between gap-3 mt-6 pt-4 border-t border-[var(--color-border)]">
        <button
          type="button"
          onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
          disabled={stepIndex === 0 || saving}
          className="flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-40"
        >
          <ChevronLeft size={16} />
          Back
        </button>

        {isReview ? (
          <button
            type="button"
            onClick={() => void handleFinish()}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-medium text-sm bg-[var(--color-accent-muted)] hover:bg-[var(--color-accent-dim)] text-[var(--color-accent)] border border-[var(--color-border-accent)] transition-all disabled:opacity-50"
          >
            <Check size={16} />
            {saving ? 'Saving…' : isRefine ? 'Save changes' : 'Save & finish'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setStepIndex((i) => Math.min(WIZARD_STEPS.length, i + 1))}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-medium text-sm bg-[var(--color-accent-muted)] hover:bg-[var(--color-accent-dim)] text-[var(--color-accent)] border border-[var(--color-border-accent)] transition-all"
          >
            {stepIndex === WIZARD_STEPS.length - 1 ? 'Review' : 'Next'}
            <ChevronRight size={16} />
          </button>
        )}
      </div>
    </section>
  );
}
