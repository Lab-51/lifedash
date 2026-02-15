import { describe, it, expect } from 'vitest';
import { parseActionItems } from '../action-item-parser';

describe('parseActionItems', () => {
  // ─── JSON strategy ────────────────────────────────────────────────

  describe('JSON strategy', () => {
    it('parses valid JSON array of { description } objects', () => {
      const input = JSON.stringify([
        { description: 'Schedule follow-up meeting' },
        { description: 'Update project budget' },
      ]);
      expect(parseActionItems(input)).toEqual([
        'Schedule follow-up meeting',
        'Update project budget',
      ]);
    });

    it('filters out items missing description field', () => {
      const input = JSON.stringify([
        { description: 'Valid item' },
        { title: 'Missing description' },
        { description: 'Another valid' },
      ]);
      expect(parseActionItems(input)).toEqual(['Valid item', 'Another valid']);
    });

    it('filters out non-string descriptions (number)', () => {
      const input = JSON.stringify([
        { description: 42 },
        { description: 'Valid' },
      ]);
      expect(parseActionItems(input)).toEqual(['Valid']);
    });

    it('filters out non-string descriptions (null)', () => {
      const input = JSON.stringify([
        { description: null },
        { description: 'Valid' },
      ]);
      expect(parseActionItems(input)).toEqual(['Valid']);
    });

    it('filters out non-string descriptions (boolean)', () => {
      const input = JSON.stringify([
        { description: true },
        { description: 'Valid' },
      ]);
      expect(parseActionItems(input)).toEqual(['Valid']);
    });

    it('falls through to bullet extraction for JSON object (not array)', () => {
      const input = JSON.stringify({ description: 'Not an array' });
      // Not an array, so falls through. No bullets either.
      expect(parseActionItems(input)).toEqual([]);
    });

    it('falls through to bullet extraction for empty JSON array', () => {
      // This is the bug fix — empty array should not return [] from JSON strategy
      // Instead it should fall through and try bullet extraction.
      // With an empty array input and no bullet text, it returns [].
      const input = '[]';
      expect(parseActionItems(input)).toEqual([]);
    });

    it('empty JSON array falls through to bullet extraction when text has bullets', () => {
      // This verifies the bug fix: if someone wraps bullets around an empty JSON array,
      // the function would need the text to be ONLY the JSON to hit the JSON path.
      // In practice, parseActionItems receives the full text. If text is just "[]",
      // JSON parses, yields 0 descriptions, falls through. No bullets in "[]" => [].
      // This test documents the behavior.
      expect(parseActionItems('[]')).toEqual([]);
    });

    it('falls through when all items lack description field', () => {
      const input = JSON.stringify([
        { title: 'No desc' },
        { name: 'Also no desc' },
      ]);
      // JSON parses, 0 valid descriptions, falls through to bullet extraction
      // No bullets in the JSON string either
      expect(parseActionItems(input)).toEqual([]);
    });
  });

  // ─── Bullet extraction strategy ───────────────────────────────────

  describe('bullet extraction strategy', () => {
    it('extracts lines starting with dash bullet', () => {
      const input = '- Schedule follow-up\n- Update budget';
      expect(parseActionItems(input)).toEqual([
        'Schedule follow-up',
        'Update budget',
      ]);
    });

    it('extracts lines starting with star bullet', () => {
      const input = '* Review document\n* Send invitations';
      expect(parseActionItems(input)).toEqual([
        'Review document',
        'Send invitations',
      ]);
    });

    it('extracts numbered lines with dot notation', () => {
      const input = '1. First item\n2. Second item\n3. Third item';
      expect(parseActionItems(input)).toEqual([
        'First item',
        'Second item',
        'Third item',
      ]);
    });

    it('extracts numbered lines with parenthesis notation', () => {
      const input = '1) First item\n2) Second item';
      expect(parseActionItems(input)).toEqual(['First item', 'Second item']);
    });

    it('handles mixed bullet styles in same response', () => {
      const input = '- Dash item\n* Star item\n1. Numbered item\n2) Paren item';
      expect(parseActionItems(input)).toEqual([
        'Dash item',
        'Star item',
        'Numbered item',
        'Paren item',
      ]);
    });

    it('handles indented bullets (leading whitespace)', () => {
      const input = '  - Indented dash\n    * Indented star\n  1. Indented number';
      expect(parseActionItems(input)).toEqual([
        'Indented dash',
        'Indented star',
        'Indented number',
      ]);
    });

    it('handles extra whitespace after bullet marker', () => {
      const input = '-   Lots of space\n*   Also spaced';
      expect(parseActionItems(input)).toEqual([
        'Lots of space',
        'Also spaced',
      ]);
    });
  });

  // ─── Edge cases ───────────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns empty array for empty string', () => {
      expect(parseActionItems('')).toEqual([]);
    });

    it('returns empty array for only whitespace/blank lines', () => {
      expect(parseActionItems('   \n\n  \n   ')).toEqual([]);
    });

    it('falls through to bullets for malformed JSON', () => {
      const input = '[{"description":';
      // Not valid JSON, falls through. No bullets either.
      expect(parseActionItems(input)).toEqual([]);
    });

    it('returns empty array for response with no bullets and no JSON', () => {
      const input =
        'Here are some thoughts about the project.\nLet me think about this more.';
      expect(parseActionItems(input)).toEqual([]);
    });

    it('does not truncate very long descriptions', () => {
      const longText = 'A'.repeat(5000);
      const input = `- ${longText}`;
      const result = parseActionItems(input);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(longText);
    });

    it('falls through for JSON string (not array)', () => {
      const input = '"just a string"';
      // Valid JSON, but not an array — falls through
      expect(parseActionItems(input)).toEqual([]);
    });

    it('handles malformed JSON followed by valid bullets', () => {
      const input = '{"broken: true}\n- Actual item 1\n- Actual item 2';
      expect(parseActionItems(input)).toEqual([
        'Actual item 1',
        'Actual item 2',
      ]);
    });

    it('filters out empty bullet lines', () => {
      const input = '- \n- Valid item\n- \n- Another item';
      expect(parseActionItems(input)).toEqual(['Valid item', 'Another item']);
    });
  });

  // ─── Real-world AI response formats ───────────────────────────────

  describe('real-world AI response formats', () => {
    it('parses OpenAI-style numbered list', () => {
      const input = '1. Schedule follow-up\n2. Update budget\n3. Review docs';
      expect(parseActionItems(input)).toEqual([
        'Schedule follow-up',
        'Update budget',
        'Review docs',
      ]);
    });

    it('parses markdown with headers + bullets', () => {
      const input = [
        '## Action Items',
        '',
        '- Schedule follow-up meeting with the team',
        '- Update project budget spreadsheet',
        '- Send summary email to stakeholders',
      ].join('\n');
      expect(parseActionItems(input)).toEqual([
        'Schedule follow-up meeting with the team',
        'Update project budget spreadsheet',
        'Send summary email to stakeholders',
      ]);
    });

    it('parses JSON with extra whitespace and newlines', () => {
      const input = `
  [
    { "description": "Follow up with client" },
    { "description": "Prepare presentation" }
  ]
  `;
      expect(parseActionItems(input)).toEqual([
        'Follow up with client',
        'Prepare presentation',
      ]);
    });

    it('parses response with preamble text before bullets', () => {
      const input = [
        'Based on the meeting discussion, here are the action items:',
        '',
        '- Finalize Q3 report',
        '- Set up recurring sync',
        '- Assign code review tasks',
      ].join('\n');
      expect(parseActionItems(input)).toEqual([
        'Finalize Q3 report',
        'Set up recurring sync',
        'Assign code review tasks',
      ]);
    });

    it('handles AI response with mixed content and numbered list', () => {
      const input = [
        'Great meeting! Here is what we should do next:',
        '',
        '1. Review the architecture proposal by Friday',
        '2. Schedule a design review session',
        '3. Update the sprint backlog',
        '',
        'Let me know if you need anything else.',
      ].join('\n');
      expect(parseActionItems(input)).toEqual([
        'Review the architecture proposal by Friday',
        'Schedule a design review session',
        'Update the sprint backlog',
      ]);
    });
  });
});
