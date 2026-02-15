// === FILE PURPOSE ===
// Parse action item descriptions from an AI response.
// Strategy: try JSON array first, fall back to bullet/numbered line extraction.
// Pure function — no AI or DB dependencies.

/**
 * Parse action item descriptions from an AI response text.
 *
 * Strategy 1: Try to parse as a JSON array of { description: string } objects.
 * Strategy 2: If JSON fails or yields no results, extract from bullet/numbered lines.
 *
 * Bug fix over original: if JSON parses as an array but all items lack .description,
 * now falls through to bullet extraction instead of returning empty.
 */
export function parseActionItems(aiResponseText: string): string[] {
  // Strategy 1: Try JSON array
  try {
    const parsed = JSON.parse(aiResponseText);
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
    // Not valid JSON — fall through to Strategy 2
  }

  // Strategy 2: Extract from bullet/numbered lines
  return aiResponseText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*]|\d+[.)]/.test(line))
    .map((line) => line.replace(/^[-*]\s*|\d+[.)]\s*/, '').trim())
    .filter((line) => line.length > 0);
}
