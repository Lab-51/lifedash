// === FILE PURPOSE ===
// Shared normalization for calendar event descriptions (CAL-UX.2b). Both provider
// adapters (Google `description`, Microsoft `body.content`) funnel through here so the
// stored text has ONE shape: plain text, entity-decoded, whitespace-tamed, capped.
//
// === WHY PLAIN TEXT ONLY ===
// Descriptions are rendered in the event-details modal and may feed the opt-in prep
// note. Storing raw HTML would push markup into a UI that renders text and into a model
// prompt that pays for every token — so the markup is dropped at the edge, once.
// This is a NORMALIZER, not a sanitizer: nothing downstream renders HTML.

/** Hard cap on a stored description. Cut at fetch time so the cache can never grow unbounded. */
export const DESCRIPTION_MAX_CHARS = 4000;

/** The handful of entities that survive tag removal in practice (Google + Graph bodies). */
const ENTITIES: [RegExp, string][] = [
  [/&nbsp;/g, ' '],
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&quot;/g, '"'],
  [/&#39;/g, "'"],
  // &amp; LAST: decoding it earlier would resurrect entities from literal "&amp;lt;" text.
  [/&amp;/g, '&'],
];

/**
 * Strip HTML to readable plain text: block-level tags become line breaks, every other
 * tag disappears, basic entities decode, and runs of 3+ blank lines collapse to two.
 * Deliberately minimal — a description is prose, not a document.
 */
export function stripHtmlToText(html: string): string {
  let text = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  for (const [pattern, replacement] of ENTITIES) text = text.replace(pattern, replacement);
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Normalize a raw provider description into the value stored on `CalendarEvent`:
 * optionally de-HTML-ed, trimmed and capped. Returns undefined for anything empty so
 * "no description" is a single, unambiguous state (never an empty string).
 */
export function normalizeDescription(raw: string | undefined | null, opts: { html: boolean }): string | undefined {
  if (!raw) return undefined;
  const text = (opts.html ? stripHtmlToText(raw) : raw).trim();
  return text ? text.slice(0, DESCRIPTION_MAX_CHARS) : undefined;
}
