// === FILE PURPOSE ===
// Config-driven field renderers for Twin profile sections (V3.3 Task 3). Every
// profile section field is a plain string, so editing state is uniformly
// Record<string, string> (object sections) or Record<string, string>[] (list
// sections: projects/people/vocabulary/goals) — the concrete TwinProfile
// section type is only re-imposed at the save boundary in TwinPage (a single,
// explained cast per section), which keeps these renderers reusable across all
// seven sections without generic gymnastics.
//
// === DEPENDENCIES ===
// react, lucide-react

import { X, Plus } from 'lucide-react';

/** One editable string field within an object or list-row section. */
export interface FieldDef {
  key: string;
  label: string;
  required?: boolean;
}

const INPUT_CLASSES =
  'w-full text-sm bg-white dark:bg-surface-900 border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)]';

/** Seed an editor draft from the current (possibly partial) section value. */
export function fieldsToDraft(fields: FieldDef[], value: Record<string, string | undefined>): Record<string, string> {
  const draft: Record<string, string> = {};
  for (const f of fields) draft[f.key] = value[f.key] ?? '';
  return draft;
}

/** Trim + drop empty optional fields, ready to send as a section patch. */
export function pruneObject(fields: FieldDef[], draft: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = draft[f.key]?.trim();
    if (v) out[f.key] = v;
  }
  return out;
}

/**
 * Prune every row (dropping fully-blank rows silently — an unfilled "Add" row
 * the user never touched). A row missing a REQUIRED field is a save-blocking
 * error rather than a silent drop — never discard partially-entered user data.
 */
export function pruneRows(
  fields: FieldDef[],
  rows: Record<string, string>[],
): { rows: Record<string, string>[]; error: string | null } {
  const out: Record<string, string>[] = [];
  for (const row of rows) {
    const cleaned = pruneObject(fields, row);
    if (Object.keys(cleaned).length === 0) continue;
    const missing = fields.find((f) => f.required && !cleaned[f.key]);
    if (missing) return { rows: [], error: `${missing.label} is required for every row.` };
    out.push(cleaned);
  }
  return { rows: out, error: null };
}

// ---------------------------------------------------------------------------
// Object sections (identity / domain / preferences) — a handful of labeled fields
// ---------------------------------------------------------------------------

export function ObjectFieldsView({ fields, value }: { fields: FieldDef[]; value: Record<string, string | undefined> }) {
  const present = fields.filter((f) => value[f.key]?.trim());
  if (present.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)] italic">Not set yet.</p>;
  }
  return (
    <dl className="space-y-1.5">
      {present.map((f) => (
        <div key={f.key} className="flex gap-2 text-sm">
          <dt className="text-[var(--color-text-secondary)] shrink-0">{f.label}:</dt>
          <dd className="text-[var(--color-text-primary)] break-words overflow-hidden min-w-0">{value[f.key]}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ObjectFieldsEditor({
  fields,
  value,
  onChange,
}: {
  fields: FieldDef[];
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  return (
    <div className="space-y-3">
      {fields.map((f) => (
        <label key={f.key} className="block">
          <span className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
            {f.label}
            {f.required && <span className="text-red-500"> *</span>}
          </span>
          <input
            type="text"
            value={value[f.key] ?? ''}
            onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
            className={INPUT_CLASSES}
          />
        </label>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// List sections (projects / people / vocabulary / goals) — repeatable rows.
// The first field is treated as the row's primary label in view mode.
// ---------------------------------------------------------------------------

export function ListFieldsView({
  fields,
  items,
  emptyLabel,
}: {
  fields: FieldDef[];
  items: Record<string, string | undefined>[];
  emptyLabel: string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)] italic">{emptyLabel}</p>;
  }
  const [primary, ...rest] = fields;
  return (
    <ul className="list-disc list-inside space-y-1.5">
      {items.map((item, idx) => (
        <li key={idx} className="text-sm break-words overflow-hidden">
          <span className="font-medium text-[var(--color-text-primary)]">{item[primary.key]}</span>
          {rest
            .filter((f) => item[f.key]?.trim())
            .map((f) => (
              <span key={f.key} className="text-[var(--color-text-secondary)]">
                {' '}
                — {item[f.key]}
              </span>
            ))}
        </li>
      ))}
    </ul>
  );
}

export function ListFieldsEditor({
  fields,
  rows,
  onChange,
  addLabel,
}: {
  fields: FieldDef[];
  rows: Record<string, string>[];
  onChange: (next: Record<string, string>[]) => void;
  addLabel: string;
}) {
  const updateRow = (idx: number, key: string, v: string) => {
    const next = rows.slice();
    next[idx] = { ...next[idx], [key]: v };
    onChange(next);
  };
  const removeRow = (idx: number) => onChange(rows.filter((_, i) => i !== idx));
  const addRow = () => onChange([...rows, {}]);

  return (
    <div className="space-y-2">
      {rows.map((row, idx) => (
        <div key={idx} className="flex items-start gap-2">
          <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
            {fields.map((f) => (
              <input
                key={f.key}
                type="text"
                value={row[f.key] ?? ''}
                onChange={(e) => updateRow(idx, f.key, e.target.value)}
                placeholder={f.required ? `${f.label} *` : f.label}
                aria-label={f.label}
                className={INPUT_CLASSES}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => removeRow(idx)}
            aria-label="Remove row"
            className="shrink-0 p-1.5 text-[var(--color-text-muted)] hover:text-red-500 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        className="flex items-center gap-1.5 text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-dim)] transition-colors"
      >
        <Plus size={14} />
        {addLabel}
      </button>
    </div>
  );
}
