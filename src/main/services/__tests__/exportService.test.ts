import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('node:fs', () => ({
  promises: {
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
}));

const mockSelect = vi.fn();
const mockFrom = vi.fn();

vi.mock('../../db/connection', () => ({
  getDb: () => ({
    select: () => ({
      from: (table: unknown) => {
        mockSelect(table);
        // Return rows based on which table is queried
        return mockFrom(table);
      },
    }),
  }),
}));

vi.mock('../../db/schema', () => {
  const table = (name: string) => ({ _name: name });
  return {
    projects: table('projects'),
    boards: table('boards'),
    columns: table('columns'),
    cards: table('cards'),
    labels: table('labels'),
    cardLabels: table('cardLabels'),
    cardComments: table('cardComments'),
    cardRelationships: table('cardRelationships'),
    cardActivities: table('cardActivities'),
    cardAttachments: table('cardAttachments'),
    meetings: table('meetings'),
    transcripts: table('transcripts'),
    meetingBriefs: table('meetingBriefs'),
    actionItems: table('actionItems'),
    ideas: table('ideas'),
    ideaTags: table('ideaTags'),
    brainstormSessions: table('brainstormSessions'),
    brainstormMessages: table('brainstormMessages'),
    settings: table('settings'),
    aiProviders: table('aiProviders'),
    aiUsage: table('aiUsage'),
  };
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { exportAllData, writeJSON, tableToCsv } from '../exportService';
import * as fs from 'node:fs';

// ============================================================================
// Tests
// ============================================================================

describe('exportService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: all table queries return empty arrays
    mockFrom.mockResolvedValue([]);
  });

  // -------------------------------------------------------------------------
  // 1. EXPORT_TABLES covers expected tables
  // -------------------------------------------------------------------------
  describe('EXPORT_TABLES', () => {
    it('exports all 21 expected tables', async () => {
      const data = await exportAllData();
      const tableNames = Object.keys(data);

      const expected = [
        'projects',
        'boards',
        'columns',
        'cards',
        'labels',
        'cardLabels',
        'cardComments',
        'cardRelationships',
        'cardActivities',
        'cardAttachments',
        'meetings',
        'transcripts',
        'meetingBriefs',
        'actionItems',
        'ideas',
        'ideaTags',
        'brainstormSessions',
        'brainstormMessages',
        'settings',
        'aiProviders',
        'aiUsage',
      ];

      for (const name of expected) {
        expect(tableNames).toContain(name);
      }
      expect(tableNames).toHaveLength(expected.length);
    });

    it('allows exporting a subset of tables', async () => {
      const data = await exportAllData(['projects', 'settings']);
      const tableNames = Object.keys(data);
      expect(tableNames).toHaveLength(2);
      expect(tableNames).toContain('projects');
      expect(tableNames).toContain('settings');
    });

    it('skips unknown table names gracefully', async () => {
      const data = await exportAllData(['projects', 'nonexistent']);
      const tableNames = Object.keys(data);
      expect(tableNames).toContain('projects');
      expect(tableNames).not.toContain('nonexistent');
    });
  });

  // -------------------------------------------------------------------------
  // 2. Sensitive column stripping
  // -------------------------------------------------------------------------
  describe('sensitive column stripping', () => {
    it('strips apiKeyEncrypted from aiProviders rows', async () => {
      // When querying the aiProviders table, return rows with sensitive data
      mockFrom.mockImplementation((table: { _name: string }) => {
        if (table._name === 'aiProviders') {
          return Promise.resolve([
            { id: '1', name: 'OpenAI', apiKeyEncrypted: 'sk-secret-123', modelId: 'gpt-4' },
            { id: '2', name: 'Anthropic', apiKeyEncrypted: 'sk-ant-secret', modelId: 'claude' },
          ]);
        }
        return Promise.resolve([]);
      });

      const data = await exportAllData(['aiProviders']);
      const providers = data.aiProviders;

      expect(providers).toHaveLength(2);
      expect(providers[0]).not.toHaveProperty('apiKeyEncrypted');
      expect(providers[1]).not.toHaveProperty('apiKeyEncrypted');
      // Other fields preserved
      expect(providers[0]).toHaveProperty('id', '1');
      expect(providers[0]).toHaveProperty('name', 'OpenAI');
    });

    it('does not strip columns from non-sensitive tables', async () => {
      mockFrom.mockImplementation((table: { _name: string }) => {
        if (table._name === 'projects') {
          return Promise.resolve([{ id: '1', name: 'My Project', description: 'Test' }]);
        }
        return Promise.resolve([]);
      });

      const data = await exportAllData(['projects']);
      expect(data.projects[0]).toEqual({
        id: '1',
        name: 'My Project',
        description: 'Test',
      });
    });
  });

  // -------------------------------------------------------------------------
  // 3. writeJSON
  // -------------------------------------------------------------------------
  describe('writeJSON', () => {
    it('writes formatted JSON to the specified file', async () => {
      const data = { projects: [{ id: '1', name: 'Test' }] };
      const size = await writeJSON(data, '/tmp/export.json');

      expect(fs.promises.writeFile).toHaveBeenCalledWith('/tmp/export.json', JSON.stringify(data, null, 2), 'utf-8');
      expect(size).toBeGreaterThan(0);
    });

    it('returns byte size of the written JSON', async () => {
      const data = { items: [{ id: '1' }] };
      const size = await writeJSON(data, '/tmp/test.json');
      const expectedSize = Buffer.byteLength(JSON.stringify(data, null, 2), 'utf-8');
      expect(size).toBe(expectedSize);
    });
  });

  // -------------------------------------------------------------------------
  // 4. tableToCsv
  // -------------------------------------------------------------------------
  describe('tableToCsv', () => {
    it('returns empty string for empty rows', () => {
      expect(tableToCsv([])).toBe('');
    });

    it('generates CSV with headers and data rows', () => {
      const rows = [
        { id: '1', name: 'Alice', score: 95 },
        { id: '2', name: 'Bob', score: 87 },
      ];
      const csv = tableToCsv(rows);
      const lines = csv.split('\n');

      expect(lines[0]).toBe('id,name,score');
      expect(lines[1]).toBe('1,Alice,95');
      expect(lines[2]).toBe('2,Bob,87');
    });

    it('quotes values containing commas', () => {
      const rows = [{ name: 'Doe, John', age: 30 }];
      const csv = tableToCsv(rows);
      expect(csv).toContain('"Doe, John"');
    });

    it('escapes double quotes inside values', () => {
      const rows = [{ quote: 'He said "hello"' }];
      const csv = tableToCsv(rows);
      expect(csv).toContain('"He said ""hello"""');
    });

    it('quotes values containing newlines', () => {
      const rows = [{ text: 'line1\nline2' }];
      const csv = tableToCsv(rows);
      expect(csv).toContain('"line1\nline2"');
    });

    it('handles null and undefined values as empty strings', () => {
      const rows = [{ a: null, b: undefined, c: 'ok' }];
      const csv = tableToCsv(rows);
      const dataLine = csv.split('\n')[1];
      expect(dataLine).toBe(',,ok');
    });
  });
});
