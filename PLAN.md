# Plan 11.2 — Extract & Test Critical Business Logic

<phase n="11.2" name="Extract & Test Critical Business Logic">
  <context>
    The project review (REVIEW.md) identified test coverage as the #1 priority:
    99 tests across 5 files, estimated 5-10% coverage, marked CRITICAL.

    Existing tests cover only pure utilities (card-utils, date-utils, schemas,
    ipc-validator, types). Zero tests exist for services, IPC handlers, or stores.

    The two highest-risk untested codepaths are:
    1. **Card-move algorithm** (cards.ts:182-235) — position clamping, array
       reordering, and sibling update logic embedded in an ipcMain.handle callback.
       Bug here = corrupted Kanban board.
    2. **Action item parsing** (meetingIntelligenceService.ts:207-228) — JSON
       parse with bullet-point regex fallback, embedded in generateActionItems().
       Bug here = lost action items after meetings.

    Both are currently untestable because the logic is embedded inside IPC
    handlers / service functions that require DB + AI provider. Strategy:
    extract the pure logic into standalone functions, then test exhaustively.

    Current test setup:
    - Vitest 4.0.18, environment: node, globals: true
    - Pattern: src/**/\__tests__/*.test.ts
    - No mocks used yet (all tests are pure functions)
    - No test setup file

    @src/main/ipc/cards.ts
    @src/main/services/meetingIntelligenceService.ts
    @vitest.config.ts
    @src/shared/utils/__tests__/card-utils.test.ts (pattern reference)
  </context>

  <task type="auto" n="1">
    <n>Extract card-move reordering logic into a pure testable function</n>
    <files>
      src/main/ipc/cards.ts
      src/shared/utils/card-move.ts (new)
    </files>
    <action>
      Extract the pure reordering logic from the `cards:move` IPC handler
      (cards.ts:182-235) into a standalone, side-effect-free function.

      **Create `src/shared/utils/card-move.ts`:**

      ```ts
      /**
       * Pure function: compute the new positions after moving a card.
       * No DB access — takes siblings list, returns update instructions.
       */
      export interface CardSibling {
        id: string;
        position: number;
      }

      export interface MoveResult {
        /** The clamped position the card ended up at */
        clampedPosition: number;
        /** Updates to apply: [cardId, newPosition][] — includes moved card */
        updates: Array<{ id: string; position: number }>;
      }

      export function computeCardMove(
        movedCardId: string,
        targetPosition: number,
        siblingsInTarget: CardSibling[],
      ): MoveResult {
        // Remove the moved card from siblings (may already be in column for same-column reorder)
        const filtered = siblingsInTarget.filter(c => c.id !== movedCardId);

        // Clamp position to valid range
        const clampedPosition = Math.max(0, Math.min(targetPosition, filtered.length));

        // Insert at clamped position
        const reordered = [...filtered];
        reordered.splice(clampedPosition, 0, { id: movedCardId, position: -1 });

        // Compute updates — only cards whose position actually changed
        const updates: MoveResult['updates'] = [];
        for (let i = 0; i < reordered.length; i++) {
          if (reordered[i].id === movedCardId || reordered[i].position !== i) {
            updates.push({ id: reordered[i].id, position: i });
          }
        }

        return { clampedPosition, updates };
      }
      ```

      **Refactor `cards.ts`** to use the extracted function:
      - Import `computeCardMove` from `../../shared/utils/card-move`
      - Replace lines 201-227 with:
        ```ts
        const siblings = siblingsInTarget.map(c => ({ id: c.id, position: c.position }));
        const { clampedPosition, updates } = computeCardMove(validId, moveData.position, siblings);

        for (const upd of updates) {
          if (upd.id === validId) {
            await db.update(cards).set({ columnId: moveData.columnId, position: upd.position, updatedAt: new Date() }).where(eq(cards.id, validId));
          } else {
            await db.update(cards).set({ position: upd.position }).where(eq(cards.id, upd.id));
          }
        }
        ```
      - Update the logCardActivity call to use `clampedPosition`

      **WHY:** The card-move algorithm is the highest-risk untested code in the app.
      Extracting it as a pure function makes it testable without any DB mocking,
      while keeping the IPC handler thin (fetch → compute → apply → log).
    </action>
    <verify>
      - `npx tsc --noEmit` passes with zero errors
      - `npx vitest run` — all 99 existing tests still pass
      - The new `card-move.ts` file exports `computeCardMove`, `CardSibling`, `MoveResult`
      - `cards.ts` imports and uses `computeCardMove` (no duplicate logic)
    </verify>
    <done>
      Card-move reordering logic extracted to src/shared/utils/card-move.ts as a
      pure function. cards.ts IPC handler refactored to use it. Zero behavior change.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - The card-move handler logic at lines 182-235 hasn't changed since the review
      - The extracted function's interface (CardSibling[]) is sufficient to represent
        the data needed from the DB query
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Extract action-item parsing into a pure testable function</n>
    <files>
      src/main/services/meetingIntelligenceService.ts
      src/shared/utils/action-item-parser.ts (new)
    </files>
    <preconditions>
      - Task 1 complete (establishes the extraction pattern)
    </preconditions>
    <action>
      Extract the AI response parsing logic from `generateActionItems()`
      (meetingIntelligenceService.ts:207-228) into a standalone pure function.

      **Create `src/shared/utils/action-item-parser.ts`:**

      ```ts
      /**
       * Parse action item descriptions from an AI response.
       * Strategy: try JSON array first, fall back to bullet/numbered line extraction.
       * Pure function — no AI or DB dependencies.
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
      ```

      **Refactor `meetingIntelligenceService.ts`:**
      - Import `parseActionItems` from `../../shared/utils/action-item-parser`
      - Replace lines 207-228 with:
        ```ts
        const descriptions = parseActionItems(result.text);
        ```

      **Subtle improvement:** The current code has a bug — if JSON parses successfully
      as an array but all items lack `.description`, it returns an empty array instead
      of falling through to the bullet extraction. The extracted version fixes this by
      checking `descriptions.length > 0` before returning.

      **WHY:** Action item parsing is the second-highest-risk untested code. AI models
      return unpredictable formats — sometimes valid JSON, sometimes markdown bullets,
      sometimes mixed. The regex fallback needs thorough edge-case testing.
    </action>
    <verify>
      - `npx tsc --noEmit` passes with zero errors
      - `npx vitest run` — all 99 existing tests still pass
      - The new `action-item-parser.ts` exports `parseActionItems`
      - `meetingIntelligenceService.ts` imports and uses `parseActionItems`
    </verify>
    <done>
      Action item parsing logic extracted to src/shared/utils/action-item-parser.ts.
      meetingIntelligenceService.ts refactored to use it. Bug fix: empty JSON array
      now falls through to bullet extraction.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - The parsing logic at lines 207-228 is self-contained (no closure over
        external variables except `result.text`)
      - The bug fix (fallthrough on empty descriptions) is correct behavior
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Add comprehensive tests for card-move and action-item parsing</n>
    <files>
      src/shared/utils/__tests__/card-move.test.ts (new)
      src/shared/utils/__tests__/action-item-parser.test.ts (new)
    </files>
    <preconditions>
      - Tasks 1 and 2 complete (functions extracted and available for import)
    </preconditions>
    <action>
      Write exhaustive unit tests for both extracted functions. Follow the
      existing test pattern (describe/it blocks, no mocks needed since both
      are pure functions).

      **card-move.test.ts — Test cases for `computeCardMove()`:**

      1. **Basic scenarios:**
         - Move card to position 0 (beginning) in a column with existing cards
         - Move card to last position in a column
         - Move card to middle position
         - Move card to empty column (no siblings)

      2. **Same-column reorder:**
         - Move card from position 0 to position 2 (forward)
         - Move card from position 3 to position 1 (backward)
         - Move card to its current position (no-op — should produce minimal updates)

      3. **Cross-column move:**
         - Card ID not in siblings list (new column) — should insert at requested position
         - Siblings should be renumbered starting from 0

      4. **Edge cases:**
         - Position -1 (out of bounds low) → clamped to 0
         - Position 999 (out of bounds high) → clamped to end
         - Single card in column, move it to position 0 (trivial case)
         - Only the moved card changes when no siblings shift

      5. **Position correctness:**
         - After every move, positions form a contiguous 0..N-1 sequence
         - Updates array only includes cards whose position actually changed

      **action-item-parser.test.ts — Test cases for `parseActionItems()`:**

      1. **JSON strategy:**
         - Valid JSON array of `{ description: "..." }` objects
         - JSON array with mixed valid/invalid items (some missing description)
         - JSON array with non-string descriptions (number, null) → filtered out
         - Valid JSON but not an array (object) → falls through to bullet extraction
         - Empty JSON array → falls through to bullet extraction

      2. **Bullet extraction strategy:**
         - Lines starting with `- ` (dash bullet)
         - Lines starting with `* ` (star bullet)
         - Lines starting with `1. `, `2) `, `3. ` (numbered)
         - Mixed bullet styles in same response
         - Indented bullets (leading whitespace before `-`)
         - Lines with extra whitespace after bullet marker

      3. **Edge cases:**
         - Empty string → returns []
         - Only whitespace/blank lines → returns []
         - Malformed JSON (partial, truncated) → falls through to bullets
         - Response with no bullets and no JSON → returns []
         - Very long descriptions (should not be truncated by parser)
         - Lines that look like bullets but inside code blocks (edge case, may not handle)

      4. **Real-world AI response formats:**
         - OpenAI-style: numbered list with descriptions
         - Anthropic-style: markdown with headers + bullets
         - Mixed: JSON with some markdown

      Target: **~40-50 tests** across both files, bringing total from 99 to ~140-150.

      **WHY:** These two functions guard the most critical data paths in the app.
      Card-move corruption makes the Kanban board unusable. Action item parsing
      failures mean users lose meeting insights. Exhaustive testing here catches
      regressions before users do.
    </action>
    <verify>
      - `npx vitest run` — all tests pass (old 99 + new ~40-50)
      - card-move tests cover: basic, same-column, cross-column, edge cases, position correctness
      - action-item-parser tests cover: JSON strategy, bullet strategy, edge cases, real-world formats
      - No flaky tests (all deterministic, no timers or async)
    </verify>
    <done>
      Two new test files with ~40-50 tests total. computeCardMove and parseActionItems
      are thoroughly tested with edge cases, real-world scenarios, and invariant checks.
      Total test count: ~140-150.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Both functions are pure and synchronous (no async, no side effects)
      - The existing vitest config (environment: node) is sufficient for these tests
      - Real-world AI response formats can be approximated from the prompt templates
    </assumptions>
  </task>
</phase>
