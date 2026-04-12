// === FILE PURPOSE ===
// Parse action item descriptions from an AI response.
// Strategy: try JSON array first (with code-fence stripping and substring extraction),
// fall back to bullet/numbered line extraction.
// Pure function — no AI or DB dependencies.

/**
 * Parse action item descriptions from an AI response text.
 *
 * Strategy 1: Strip markdown code fences, then try to parse as a JSON array
 *   of { description: string } objects.
 * Strategy 1.5: If JSON parse fails, look for the first '[' and last ']' and
 *   try parsing that substring.
 * Strategy 2: If JSON fails or yields no results, extract from bullet/numbered
 *   lines. Handles: "- item", "* item", "• item", "- [ ] item",
 *   "- **Task:** item", "1. item".
 *
 * Bug fix over original: if JSON parses as an array but all items lack .description,
 * now falls through to bullet extraction instead of returning empty.
 */
export function parseActionItems(aiResponseText: string): string[] {
  // --- Strategy 1: Try JSON array (with code-fence stripping) ---
  const stripped = aiResponseText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/m, '')
    .replace(/```\s*$/m, '')
    .trim();

  const tryParseJsonArray = (text: string): string[] | null => {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        const descriptions = parsed
          .filter((item: unknown) => {
            const obj = item as Record<string, unknown>;
            return obj.description && typeof obj.description === 'string';
          })
          .map((item: unknown) => (item as Record<string, string>).description);
        if (descriptions.length > 0) return descriptions;
      }
    } catch {
      // Not valid JSON
    }
    return null;
  };

  const fromStripped = tryParseJsonArray(stripped);
  if (fromStripped) return fromStripped;

  // --- Strategy 1.5: Extract JSON array substring ---
  const firstBracket = stripped.indexOf('[');
  const lastBracket = stripped.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const substring = stripped.slice(firstBracket, lastBracket + 1);
    const fromSubstring = tryParseJsonArray(substring);
    if (fromSubstring) return fromSubstring;
  }

  // --- Strategy 2: Extract from bullet/numbered lines ---
  return (
    aiResponseText
      .split('\n')
      .map((line) => line.trim())
      // Skip lines that are clearly not action items
      .filter((line) => {
        if (/no action items/i.test(line)) return false;
        if (/no clear action items/i.test(line)) return false;
        if (/^#{1,6}\s/.test(line)) return false; // section headers
        return true;
      })
      // Match bullet formats: "- ", "* ", "• ", numbered "1. " / "1) "
      .filter((line) => /^[-*•]|\d+[.)]/.test(line))
      .map((line) => {
        // Strip checkbox format: "- [ ] " or "- [x] "
        line = line.replace(/^[-*•]\s*\[[x ]\]\s*/i, '');
        // Strip bold task marker: "- **Task:** " or "- **Action:** "
        line = line.replace(/^[-*•]\s*\*\*[^*]+\*\*:\s*/i, '');
        // Strip leading bullet/number prefix
        line = line.replace(/^[-*•]\s*|\d+[.)]\s*/, '');
        return line.trim();
      })
      .filter((line) => line.length > 0)
  );
}
