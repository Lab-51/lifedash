// === FILE PURPOSE ===
// Leaf module holding shared helpers used by both intelFeedService and
// intelBriefService. Extracted to break the circular import between those
// two services (Bronze remediation, CODE-Q.1 Task 1). This file MUST NOT
// import from either service.
//
// === DEPENDENCIES ===
// (none — leaf module)

/**
 * Decode HTML entities (numeric decimal, numeric hex, and common named entities)
 * that RSS feeds often include in titles and descriptions.
 *
 * Used by:
 * - intelFeedService.fetchAllSources (sanitises RSS titles/descriptions on insert)
 * - intelBriefService.generateBrief / scoreArticles / summarizeArticle
 *   (sanitises titles/descriptions before sending to AI prompts)
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00A0',
  ndash: '\u2013',
  mdash: '\u2014',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201C',
  rdquo: '\u201D',
  bull: '\u2022',
  hellip: '\u2026',
  copy: '\u00A9',
  reg: '\u00AE',
  trade: '\u2122',
  euro: '\u20AC',
  pound: '\u00A3',
  yen: '\u00A5',
  laquo: '\u00AB',
  raquo: '\u00BB',
};

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = parseInt(entity.slice(2), 16);
      return code ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith('#')) {
      const code = parseInt(entity.slice(1), 10);
      return code ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity] ?? NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}
