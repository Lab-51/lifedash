# Plan 8.1 Summary — Critical Review Fixes: Performance, Testing, Security

## Date: 2026-02-13
## Status: COMPLETE (3/3 tasks)

## What Changed
Addressed the top 3 findings from the project review (REVIEW.md, grade B-): fixed the severe N+1 query in Kanban board loading, established Vitest testing framework with 12 initial tests, and added CSP headers + path traversal prevention.

### Task 1: Fix N+1 query in cards:list-by-board
**Status:** COMPLETE | **Confidence:** HIGH

- Replaced triple-nested loop (300-600+ sequential DB queries) with 4 batch queries using Drizzle `inArray`
- Query pattern: columns → cards → cardLabels → labels (all batch-fetched)
- Empty-array guards prevent unnecessary queries
- Updated LIMITATIONS comment to reflect new approach

### Task 2: Set up Vitest test framework and write initial unit tests
**Status:** COMPLETE | **Confidence:** HIGH

- Installed vitest v4.0.18 + @vitest/ui as devDependencies
- Created vitest.config.ts (globals: true, node environment)
- Added 3 test scripts to package.json (test, test:watch, test:ui)
- Extracted `buildCardLabelMap` to src/shared/utils/card-utils.ts (pure function, no Electron deps)
- Updated cards.ts to import from shared util
- 2 test files, 12 tests, all passing:
  - card-utils.test.ts: 6 tests (empty, mapping, multi-label, shared labels, missing IDs)
  - types.test.ts: 6 tests (MEETING_TEMPLATES structure, fields, uniqueness, non-general validation)

### Task 3: Security hardening — CSP headers and path validation
**Status:** COMPLETE | **Confidence:** HIGH

- Content-Security-Policy via session.webRequest.onHeadersReceived:
  - Production: strict self-only for scripts, self+inline for styles, self+data for images
  - Development: adds ws: + localhost:* for HMR, 'unsafe-eval' for Vite
  - connect-src: all 4 API providers (OpenAI, Anthropic, Deepgram, AssemblyAI) + Ollama
- Path traversal prevention in openAttachment:
  - Validates resolved path starts with userData/attachments/
  - Checks file existence before shell.openPath()
  - Clear error messages for both failure cases

## Files Created (4)
- `vitest.config.ts`
- `src/shared/utils/card-utils.ts` (~35 lines)
- `src/shared/utils/__tests__/card-utils.test.ts` (6 tests)
- `src/shared/__tests__/types.test.ts` (6 tests)

## Files Modified (4)
- `src/main/ipc/cards.ts` (N+1 fix + buildCardLabelMap import)
- `src/main/main.ts` (CSP headers)
- `src/main/services/attachmentService.ts` (path validation in openAttachment)
- `package.json` (vitest devDeps + test scripts)

## Verification
- `npx tsc --noEmit`: PASS (zero errors)
- `npm test`: 2 files, 12 tests, all passed (229ms)

## What's Next
1. `/nexus:git` to commit Plan 8.1 changes
2. Consider Plan 8.2 (IPC validation with Zod, structured logging, component refactoring)
