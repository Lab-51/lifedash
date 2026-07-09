// === FILE PURPOSE ===
// Merge helper for the orchestrated Digital Twin "Deep interview" flow (V3.3.5).
// The deep flow folds up to FOUR partial drafts into ONE Partial<TwinProfileSections>
// the wizard seeds its editable review from: the existing profile (on a REFINE), the
// role research, the gap interview, and (optionally) history mining.
//
// MERGE RULE (see DeepInterviewPanel): object sections shallow-merge with the LATER
// (more-specific) source winning per field; array sections concatenate and DEEP-MERGE
// entries that share a natural identity (name / term) — the later source fills in and
// overwrites fields the earlier entry lacked, so a richer duplicate never loses data.
// String arrays (goals) dedupe by value. Callers fold in increasing specificity —
// existing profile → research → interview → history — so the user's stored data is the
// least-specific base (augmented, never replaced) and their own answers win over
// generic researched facts.
//
// === DEPENDENCIES ===
// shared/types/twin (TwinProfileSections) — pure, no React.

import type { TwinProfileSections } from '../../../shared/types/twin';

type Draft = Partial<TwinProfileSections>;
type Row = Record<string, unknown>;

const norm = (value: unknown): string => (typeof value === 'string' ? value : '').trim().toLowerCase();

/** Strip undefined / null / empty-string fields so a sparse later entry doesn't
 *  overwrite a populated earlier field with a blank. */
function pruneEmpty(obj: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null && value !== '') out[key] = value;
  }
  return out;
}

/** Dedupe strings preserving first occurrence (case-insensitive). */
function dedupeStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = norm(item);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(item);
  }
  return out;
}

/** Concatenate object entries, DEEP-MERGING those that share a key: the later entry's
 *  present fields win, earlier fields it omits survive. First-seen order is preserved.
 *  Blank-key entries are never merged (we can't reliably match them). */
function dedupeObjects(items: Row[], keyOf: (item: Row) => string): Row[] {
  const indexByKey = new Map<string, number>();
  const out: Row[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (key && indexByKey.has(key)) {
      const i = indexByKey.get(key)!;
      out[i] = { ...out[i], ...pruneEmpty(item) }; // later fields win, earlier ones fill gaps
      continue;
    }
    if (key) indexByKey.set(key, out.length);
    out.push({ ...item });
  }
  return out;
}

/** Concatenate two array sections, deduping by each section's natural identity. */
function mergeArray(key: keyof TwinProfileSections, base: unknown[], add: unknown[]): unknown[] {
  const items = [...base, ...add];
  if (key === 'goals') return dedupeStrings(items as string[]);
  if (key === 'vocabulary') return dedupeObjects(items as Row[], (v) => norm(v.term));
  // projects + people are identified by name.
  return dedupeObjects(items as Row[], (it) => norm(it.name));
}

/** Merge `add` INTO `base` with `add` taking precedence: object sections shallow-merge
 *  (add's fields win); array sections concatenate + dedupe. Fields present on only one
 *  side pass through untouched. */
export function mergeSections(base: Draft, add: Draft): Draft {
  const out: Record<string, unknown> = { ...base, ...add };
  for (const key of Object.keys(add) as Array<keyof TwinProfileSections>) {
    if (!(key in base)) continue;
    const b = base[key];
    const a = add[key];
    if (Array.isArray(b) && Array.isArray(a)) {
      out[key] = mergeArray(key, b, a);
    } else if (b && a && typeof b === 'object' && typeof a === 'object') {
      out[key] = { ...b, ...a }; // add wins per field
    }
  }
  return out as Draft;
}

/** Fold several drafts left-to-right; later drafts win on conflicts. Pass them in
 *  increasing specificity (existing → research → interview → history). Nullish drafts
 *  are skipped, so CREATE (no existing profile) is unaffected. */
export function mergeDrafts(...drafts: Array<Draft | null | undefined>): Draft {
  return drafts.reduce<Draft>((acc, draft) => (draft ? mergeSections(acc, draft) : acc), {});
}
