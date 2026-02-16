# Task 2: AI Generate Card Description from Title

## Status: COMPLETE

## Change
Added a "Generate with AI" button in CardDetailModal that uses the configured AI provider to generate a 2-3 sentence description from the card title, priority, project name, and labels.

## Files Modified

### `src/main/ipc/cards.ts`
- Added import for `projects` from schema and `resolveTaskModel`, `generate` from ai-provider service
- Added new IPC handler `card:generate-description` that:
  - Fetches the card by ID
  - Traverses card -> column -> board -> project to get project name for context
  - Fetches card labels for additional context
  - Resolves the AI provider via `resolveTaskModel('card-description')`
  - Generates a description using the `generate()` function with a structured prompt
  - Returns `{ description: result.text }`

### `src/preload/domains/card-details.ts`
- Added `generateCardDescription` method to the bridge object, invoking `card:generate-description`

### `src/shared/types/electron-api.ts`
- Added `generateCardDescription: (cardId: string) => Promise<{ description: string }>` to the ElectronAPI interface

### `src/renderer/components/CardDetailModal.tsx`
- Imported `Sparkles` icon from lucide-react
- Imported `toast` from `../hooks/useToast`
- Added `generatingDescription` state
- Added `handleGenerateDescription` async handler with error handling and toast notifications
- Restructured template selector area to a flex row containing both "Apply Template" and "Generate with AI" buttons side by side
- The "Generate with AI" button shows a spinning Sparkles icon during generation

## Verification
- TypeScript: PASS (zero errors from `npx tsc --noEmit`)
- Tests: PASS (150/150 tests pass)

## Implementation Notes
- Task type used for AI provider resolution: `card-description`
- Default temperature: 0.7, default max tokens: 200
- If no AI provider is configured, the handler throws a descriptive error that surfaces via toast in the UI
- The generated description is set as HTML content in the TipTap editor and persisted via `onUpdate`
- Error messages from the IPC handler are surfaced to the user via the toast notification system
