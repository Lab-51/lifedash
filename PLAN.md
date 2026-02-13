# Plan 8.5 — Remaining IPC Validation, IdeaDetailModal Decomposition & Console Cleanup

**Source:** Plan 8.4 completed Zod validation for 6 IPC files (63 handlers, ~56%). This plan validates the remaining 11 files (46 handlers) to reach ~100%, decomposes IdeaDetailModal (815 lines), and cleans up 2 renderer console.log calls.
**Scope:** 3 tasks — all independent (different files), safe for parallel execution.
**Approach:** Task 1 validates 6 medium IPC files (29 handlers, schemas mostly exist). Task 2 validates 5 small IPC files (13 handlers, mostly id-only or no-param) + console cleanup. Task 3 extracts components from IdeaDetailModal.

## Scope Rationale

Plan 8.4 brought validation coverage to 63/~112 handlers (~56%). The remaining 46 handlers are spread across 11 smaller files, many with trivial signatures (no params or just an ID). Schemas already exist for brainstorm, backup, settings, notifications, and transcription-provider (created as "bonus" in Plan 8.4 Task 1). Most remaining files just need idParamSchema applied.

IdeaDetailModal at 815 lines exceeds the 500-line guideline. The AI Analysis section (~80 lines) and Convert Wizard (~130 lines) are self-contained concerns that extract cleanly.

---

<phase n="8.5" name="Remaining IPC Validation, IdeaDetailModal Decomposition & Console Cleanup">
  <context>
    Plan 8.4 validated 6 IPC files. 11 files remain with 46 handlers total.

    Schemas already in schemas.ts (from Plan 8.4 bonus):
    - brainstorm: createBrainstormSessionInputSchema, updateBrainstormSessionInputSchema, brainstormMessageContentSchema
    - backup: autoBackupSettingsUpdateSchema, exportOptionsSchema
    - settings: settingKeySchema, settingValueSchema
    - notifications: notificationPreferencesUpdateSchema
    - transcription-provider: transcriptionProviderTypeSchema, transcriptionApiKeyProviderSchema

    Schemas that may need to be CREATED:
    - task-structuring: handlers take projectId + context string — need to check actual signatures
    - whisper: download takes fileName string — may need whisperModelNameSchema
    - recording/diarization/database/window-controls: mostly id-only or no-param

    Key reference files:
    @src/shared/validation/schemas.ts — all existing schemas
    @src/shared/validation/ipc-validator.ts — validateInput wrapper
    @src/main/ipc/projects.ts — reference implementation for validation pattern
    @src/renderer/components/IdeaDetailModal.tsx — 815 lines, decomposition target
    @src/renderer/services/audioCaptureService.ts — 2 console.log calls to replace
  </context>

  <task type="auto" n="1">
    <n>Apply Zod validation to 6 medium IPC files (29 handlers)</n>
    <files>
      src/main/ipc/brainstorm.ts (MODIFY — 7 handlers)
      src/main/ipc/backup.ts (MODIFY — 8 handlers)
      src/main/ipc/settings.ts (MODIFY — 4 handlers)
      src/main/ipc/notifications.ts (MODIFY — 3 handlers)
      src/main/ipc/transcription-provider.ts (MODIFY — 4 handlers)
      src/main/ipc/task-structuring.ts (MODIFY — 3 handlers)
      src/shared/validation/schemas.ts (MODIFY — add any missing schemas)
    </files>
    <action>
      ## WHY
      These 6 files have 29 handlers combined and existing schemas cover most inputs.
      After this task, only 5 trivial files remain (Task 2).

      ## WHAT

      Read each file BEFORE modifying. Apply the same pattern as projects.ts:
      import validateInput + schemas, change param types to `unknown`, call validateInput.

      ### brainstorm.ts (7 handlers)

      | Handler | Params | Validation |
      |---------|--------|------------|
      | brainstorm:list-sessions | none | skip |
      | brainstorm:get-session | id | idParamSchema |
      | brainstorm:create-session | data (title, projectId?) | createBrainstormSessionInputSchema |
      | brainstorm:update-session | id, data | idParamSchema + updateBrainstormSessionInputSchema |
      | brainstorm:delete-session | id | idParamSchema |
      | brainstorm:send-message | sessionId, content | idParamSchema + brainstormMessageContentSchema |
      | brainstorm:export-to-idea | sessionId, messageContent | idParamSchema + brainstormMessageContentSchema |

      ### backup.ts (8 handlers)

      | Handler | Params | Validation |
      |---------|--------|------------|
      | backup:create | none | skip |
      | backup:list | none | skip |
      | backup:restore | fileName | filePathSchema (or a backupFileNameSchema) |
      | backup:restore-from-file | none (uses dialog) | skip |
      | backup:delete | fileName | filePathSchema |
      | backup:export | options (format, outputDir) | exportOptionsSchema |
      | backup:auto-settings-get | none | skip |
      | backup:auto-settings-update | settings | autoBackupSettingsUpdateSchema |

      NOTE: Read backup.ts to verify — some handlers use Electron dialog (no user input
      to validate). For fileName params, check if they're user-provided strings or
      system-generated. If system-generated from a list, still validate as defense-in-depth.

      ### settings.ts (4 handlers)

      | Handler | Params | Validation |
      |---------|--------|------------|
      | settings:get | key | settingKeySchema |
      | settings:set | key, value | settingKeySchema + settingValueSchema |
      | settings:get-all | none | skip |
      | settings:delete | key | settingKeySchema |

      ### notifications.ts (3 handlers)

      | Handler | Params | Validation |
      |---------|--------|------------|
      | notifications:get-preferences | none | skip |
      | notifications:update-preferences | prefs | notificationPreferencesUpdateSchema |
      | notifications:test | none | skip |

      ### transcription-provider.ts (4 handlers)

      | Handler | Params | Validation |
      |---------|--------|------------|
      | transcription:get-config | none | skip |
      | transcription:set-provider | providerType | transcriptionProviderTypeSchema |
      | transcription:set-api-key | provider, apiKey | transcriptionApiKeyProviderSchema + z.string() |
      | transcription:test-provider | providerType | transcriptionProviderTypeSchema |

      NOTE: Read the file to confirm — transcription:set-api-key may take 2 separate
      string params or an object. Validate accordingly.

      ### task-structuring.ts (3 handlers)

      Read this file carefully. Handlers likely take:
      - task-structuring:generate-plan — projectId + context string
      - task-structuring:quick-plan — projectId + context string
      - task-structuring:breakdown — cardId

      For projectId/cardId: use idParamSchema.
      For context: validate as z.string().min(1).max(10000) or similar.
      Create a new schema if needed (e.g., taskStructuringContextSchema).

      IMPORTANT:
      - Read each file BEFORE modifying to verify actual signatures
      - Create any missing schemas in schemas.ts (add at the bottom of the relevant section)
      - Remove old type imports that are replaced by Zod validation
      - Keep type imports used for return values or casts
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. `npm test` — all tests pass
      3. Grep for `validateInput` in each of the 6 modified files — confirm all param handlers call it
      4. No handler in these files uses specific types for incoming data (all `unknown`)
    </verify>
    <done>
      All 29 handlers across 6 files validated. Any missing schemas created in schemas.ts.
      Combined with Plans 8.3-8.4, total validated: ~92 of ~112 handlers.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Existing bonus schemas from Plan 8.4 match actual handler signatures (agent verifies)
      - task-structuring handlers take projectId + context (agent reads to confirm)
      - brainstorm:send-message streams response — validation still applies to input params
      - backup fileName params are worth validating even if from a controlled list
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Apply Zod validation to 5 small IPC files (13 handlers) + renderer console cleanup</n>
    <files>
      src/main/ipc/recording.ts (MODIFY — 3 handlers)
      src/main/ipc/whisper.ts (MODIFY — 3 handlers)
      src/main/ipc/diarization.ts (MODIFY — 2 handlers)
      src/main/ipc/database.ts (MODIFY — 1 handler)
      src/main/ipc/window-controls.ts (MODIFY — 4 handlers)
      src/renderer/services/audioCaptureService.ts (MODIFY — replace 2 console.log)
      src/shared/validation/schemas.ts (MODIFY — add any missing schemas)
    </files>
    <action>
      ## WHY
      These 5 files have 13 handlers — mostly trivial (no-param or id-only). After this
      task, 100% of IPC handlers will have Zod validation. Also cleans up the last 2
      console.log calls in the renderer process.

      ## WHAT — IPC Validation

      Read each file BEFORE modifying. Same pattern as before.

      ### recording.ts (3 handlers)

      | Handler | Params | Validation |
      |---------|--------|------------|
      | recording:start | meetingId | idParamSchema |
      | recording:stop | none | skip |
      | audio:chunk | audioData (Buffer/ArrayBuffer) | See note below |

      NOTE: audio:chunk receives binary audio data. Zod cannot meaningfully validate
      raw binary buffers. Options:
      a) Skip validation for audio:chunk (binary data, not user-controlled strings)
      b) Validate that it's a Buffer/ArrayBuffer instance
      Recommend option (a) — skip, add a comment explaining why.

      ### whisper.ts (3 handlers)

      | Handler | Params | Validation |
      |---------|--------|------------|
      | whisper:list-models | none | skip |
      | whisper:download-model | fileName | z.string().min(1) or a whisperModelNameSchema |
      | whisper:has-model | fileName | same as above |

      For fileName: create a simple `whisperModelNameSchema = z.string().min(1).max(200)`
      if not already in schemas.ts.

      ### diarization.ts (2 handlers)

      | Handler | Params | Validation |
      |---------|--------|------------|
      | meeting:diarize | meetingId | idParamSchema |
      | meeting:analytics | meetingId | idParamSchema |

      ### database.ts (1 handler)

      | Handler | Params | Validation |
      |---------|--------|------------|
      | db:status | none | skip (no params) |

      For db:status: if it takes no params, just add a comment noting validation is
      not needed. If it turns out to take params, validate them.

      ### window-controls.ts (4 handlers)

      | Handler | Params | Validation |
      |---------|--------|------------|
      | window:minimize | none | skip |
      | window:maximize | none | skip |
      | window:close | none | skip |
      | window:is-maximized | none | skip |

      These are all parameterless. Add a file-level comment:
      `// All handlers are parameterless — no input validation needed`

      ## WHAT — Console Cleanup

      In `src/renderer/services/audioCaptureService.ts`, replace 2 console.log calls:
      - Line ~114: `console.log('[AudioCapture] Started -- 16kHz mono Int16 PCM');`
      - Line ~122: `console.log('[AudioCapture] Stopped');`

      Since this is renderer-side code (no access to the main-process logger), the
      cleanest approach is to simply remove them — they're debug-level messages that
      aren't useful in production. Or if the project uses any renderer-side logging
      pattern, follow that. Check if there's a renderer logger first.

      IMPORTANT: Read audioCaptureService.ts before modifying to confirm line numbers.
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. `npm test` — all tests pass
      3. Grep for `validateInput` in recording.ts, whisper.ts, diarization.ts — confirm param handlers call it
      4. Grep for `console.log` in src/renderer/ — should return 0 results
      5. database.ts and window-controls.ts have appropriate comments about no validation needed
    </verify>
    <done>
      All 13 handlers across 5 files addressed (validated or documented as no-param).
      Console.log calls removed from renderer. Total IPC validation coverage: ~100%.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - audio:chunk receives binary data that Zod can't meaningfully validate
      - window-controls handlers are all parameterless (agent verifies)
      - database handler is parameterless (agent verifies)
      - Removing console.log from audioCaptureService doesn't break any functionality
      - No renderer-side logger exists (messages simply removed)
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Decompose IdeaDetailModal into focused sub-components</n>
    <files>
      src/renderer/components/IdeaDetailModal.tsx (MODIFY — 815 → ~575 lines)
      src/renderer/components/IdeaAnalysisSection.tsx (CREATE — ~100 lines)
      src/renderer/components/IdeaConvertWizard.tsx (CREATE — ~150 lines)
    </files>
    <action>
      ## WHY
      IdeaDetailModal.tsx is 815 lines — the largest renderer component, well above the
      500-line guideline. It has two clearly self-contained sections that can be extracted
      without changing behavior: the AI Analysis display and the Convert-to-Card wizard.

      ## WHAT

      Read IdeaDetailModal.tsx fully before any changes.

      ### Extract 1: IdeaAnalysisSection.tsx (~100 lines)

      Extract the AI Analysis section into its own component. This section handles:
      - "Analyze with AI" button
      - Loading spinner during analysis
      - Error display with provider configuration hint
      - Results panel showing effort/impact suggestions with Apply/Dismiss
      - Feasibility notes and rationale

      Props interface (derive from actual code):
      ```typescript
      interface IdeaAnalysisSectionProps {
        ideaId: string;
        analysis: IdeaAnalysis | null;
        analyzing: boolean;
        analysisError: string | null;
        effort: EffortLevel | null;
        impact: ImpactLevel | null;
        onAnalyze: () => void;
        onApplyEffort: (effort: EffortLevel) => void;
        onApplyImpact: (impact: ImpactLevel) => void;
        onDismiss: () => void;
      }
      ```

      IMPORTANT: Read the actual code to determine exact props. The interface above
      is a best guess — verify field names, types, and what state/callbacks the
      section actually needs from the parent.

      ### Extract 2: IdeaConvertWizard.tsx (~150 lines)

      Extract the Convert-to-Card wizard (the multi-step project → board → column flow).
      This is a self-contained wizard that:
      - Shows project selection (step 1)
      - Shows board selection (step 2, auto-skip for single board)
      - Shows column selection (step 3)
      - Has back navigation and step indicator dots
      - Calls ideaStore.convertToCard on completion

      Props interface (derive from actual code):
      ```typescript
      interface IdeaConvertWizardProps {
        ideaId: string;
        onComplete: () => void;
        onCancel: () => void;
      }
      ```

      The wizard manages its own internal state (projects list, boards, columns,
      current step, loading). Move all related useState + useEffect hooks into
      the new component.

      NOTE: The "Convert to Project" button is simpler (just a confirmation) and
      should STAY in IdeaDetailModal — only extract the multi-step card wizard.

      ### After extraction

      In IdeaDetailModal.tsx:
      1. Import IdeaAnalysisSection and IdeaConvertWizard
      2. Replace the inline sections with component references
      3. Pass required props
      4. Remove state variables and handlers that moved entirely to sub-components
      5. Keep shared state that's used by both the modal and sub-components

      Target: IdeaDetailModal.tsx drops from 815 to ~575 lines (240 lines extracted).

      IMPORTANT:
      - Do NOT change any visible behavior or styling
      - Preserve all keyboard shortcuts (Escape to close)
      - Preserve the "Brainstorm This Idea" button (stays in modal)
      - Test that the modal renders identically after refactoring
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. `npm test` — all tests pass
      3. IdeaDetailModal.tsx is under 600 lines
      4. IdeaAnalysisSection.tsx exists and is under 150 lines
      5. IdeaConvertWizard.tsx exists and is under 200 lines
      6. No duplicate code between modal and extracted components
    </verify>
    <done>
      IdeaDetailModal decomposed from 815 to ~575 lines. Two self-contained
      sections extracted as IdeaAnalysisSection and IdeaConvertWizard. All behavior
      preserved. TypeScript compiles clean.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - AI Analysis section is self-contained (no shared state with other sections beyond props)
      - Convert wizard state (projects, boards, columns, step) can move entirely to sub-component
      - "Brainstorm This Idea" button stays in the modal (depends on navigation, not convert wizard)
      - Extraction reduces IdeaDetailModal by ~240 lines (analysis ~80 + wizard ~130 + removed state/handlers ~30)
    </assumptions>
  </task>
</phase>