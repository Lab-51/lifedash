import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  app: { getPath: () => '/fake/userData' },
}));

vi.mock('node:fs', () => {
  const actual = vi.importActual('node:fs');
  return {
    ...actual,
    mkdirSync: vi.fn(),
    promises: {
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn(),
      stat: vi.fn().mockResolvedValue({ size: 1234, mtime: new Date() }),
      readdir: vi.fn().mockResolvedValue([]),
      access: vi.fn().mockResolvedValue(undefined),
      unlink: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock('../../db/connection', () => ({
  getDb: vi.fn(),
}));

vi.mock('../../db/schema', () => {
  // Create minimal table stubs — each is just a unique object so the module
  // can reference them without crashing.
  const table = (name: string) => ({ _: name });
  return {
    projects: table('projects'),
    settings: table('settings'),
    aiProviders: table('aiProviders'),
    boards: table('boards'),
    labels: table('labels'),
    columns: table('columns'),
    meetings: table('meetings'),
    ideas: table('ideas'),
    brainstormSessions: table('brainstormSessions'),
    cards: table('cards'),
    aiUsage: table('aiUsage'),
    transcripts: table('transcripts'),
    meetingBriefs: table('meetingBriefs'),
    actionItems: table('actionItems'),
    cardLabels: table('cardLabels'),
    cardComments: table('cardComments'),
    cardRelationships: table('cardRelationships'),
    cardActivities: table('cardActivities'),
    cardAttachments: table('cardAttachments'),
    ideaTags: table('ideaTags'),
    brainstormMessages: table('brainstormMessages'),
  };
});

vi.mock('../logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

// We need to test internal constants and functions that are NOT exported.
// Strategy: import the module source directly and test what IS exported,
// plus use knowledge of the internal logic for validation.

// For testing unexported internals we read them via a re-export trick:
// We'll test the *effects* of internal logic through the exported functions.

import { getBackupDir, deleteBackup } from '../backupService';

// ============================================================================
// Tests
// ============================================================================

describe('backupService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // getBackupDir and deleteBackup. Backup contents, ordering, date handling and
  // restore are covered against a real database in backupRestore.pglite.test.ts.
  // -------------------------------------------------------------------------
  describe('getBackupDir', () => {
    it('returns the backups subdirectory under userData', () => {
      const dir = getBackupDir();
      // app.getPath('userData') is mocked to return '/fake/userData'
      expect(dir).toContain('backups');
      expect(dir).toContain('fake');
    });
  });

  describe('deleteBackup', () => {
    it('rejects filenames with path traversal', async () => {
      await expect(deleteBackup('../../../etc/passwd')).rejects.toThrow('Invalid backup file name');
    });

    it('rejects arbitrary filenames', async () => {
      await expect(deleteBackup('malicious.exe')).rejects.toThrow('Invalid backup file name');
    });

    it('accepts valid backup filenames', async () => {
      // unlink is mocked to resolve, so this should succeed
      await expect(deleteBackup('backup-2024-01-15-10-30-00.json')).resolves.toBeUndefined();
    });
  });
});
