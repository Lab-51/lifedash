// === FILE PURPOSE ===
// The brief's line-by-line markdown renderer (BRIEF-QUAL.1 Task 4), moved out of
// BriefSection.tsx VERBATIM (BRIEF-QUAL.2 Task 2) so the new "Full notes"
// disclosure (BriefFullNotes.tsx) can share the exact same renderer without a
// circular import between the two components. Every className below is
// byte-identical to what BriefSection.tsx used to inline — the "legacy
// rendering stays byte-identical" tests in BriefSection.test.tsx are the proof.
//
// === DEPENDENCIES ===
// None beyond React/JSX.

import type { ReactNode } from 'react';

/** Exact-prefix match for the chunked-extraction footer line (BRIEF-QUAL.1
 *  Task 3 emits it only when the transcript needed multiple summarization
 *  passes) — anything else stays a regular paragraph. */
export function isSummarizedFooter(trimmed: string): boolean {
  return trimmed.startsWith('_Summarized in ') && trimmed.endsWith('_');
}

/** Render a single line of the brief summary based on its prefix. Stays
 *  heading-agnostic by design (BRIEF-QUAL.1 Task 4) — every existing `## ` /
 *  `- ` / plain-text brief in the DB must render byte-for-byte identically, so
 *  those three branches are untouched; only `### ` (owner sub-headings) and the
 *  footer line are new. */
export function renderLine(line: string, idx: number) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('### ')) {
    return (
      <h5 key={idx} className="font-medium text-xs text-surface-600 dark:text-surface-400 mt-2 mb-0.5">
        {trimmed.slice(4)}
      </h5>
    );
  }

  if (trimmed.startsWith('## ')) {
    return (
      <h4 key={idx} className="font-semibold text-surface-800 dark:text-surface-200 mt-3 mb-1">
        {trimmed.slice(3)}
      </h4>
    );
  }

  if (trimmed.startsWith('- ')) {
    return (
      <p key={idx} className="ml-4 text-surface-700 dark:text-surface-300 text-sm">
        <span className="mr-1.5">&bull;</span>
        {renderInline(trimmed.slice(2))}
      </p>
    );
  }

  if (isSummarizedFooter(trimmed)) {
    return (
      <p key={idx} className="text-xs text-surface-500 mt-2 italic">
        {trimmed.slice(1, -1)}
      </p>
    );
  }

  return (
    <p key={idx} className="text-surface-700 dark:text-surface-300 text-sm">
      {renderInline(trimmed)}
    </p>
  );
}

/** `**text**` pairs, and nothing else. Matches non-greedily so two bold runs on
 *  one line stay two runs. */
const BOLD_RUN = /\*\*(.+?)\*\*/g;

/**
 * Inline bold for bullet and paragraph lines (the writer marks a bullet's lead
 * label bold, and a date or a role the reader must not miss). A line with no
 * `**` pair returns the original string unchanged, so every brief written
 * before this existed renders byte-identically — that is what keeps the
 * "legacy rendering stays byte-identical" tests honest. Only `**...**` is
 * recognised; a lone `*` or `**` with no closing pair is left as typed.
 */
export function renderInline(text: string): ReactNode {
  if (!text.includes('**')) return text;
  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(BOLD_RUN)) {
    const start = match.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <strong key={key++} className="font-semibold text-surface-800 dark:text-surface-200">
        {match[1]}
      </strong>,
    );
    last = start + match[0].length;
  }
  if (parts.length === 0) return text;
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
