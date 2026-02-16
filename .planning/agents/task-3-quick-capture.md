# Task 3: Quick Capture Mode in Command Palette

## Implementation Complete

**Change:** Added Quick Capture options to the Command Palette so when the user types text that doesn't match many existing entities (fewer than 3 data items), options appear to create a new idea, card, or brainstorm from the typed text.

### Files Modified
- `src/renderer/components/CommandPalette.tsx`: Added Quick Capture functionality

### Changes Detail

**Imports added:**
- `PlusCircle`, `Zap` from lucide-react (alongside existing icons)
- `toast` from `../hooks/useToast`

**Store hooks added:**
- `loadAllCards` from `useBoardStore` -- to refresh allCards after creating a card
- `storeCreateIdea` from `useIdeaStore` -- to create ideas via the store

**Helper functions added:**
- `createIdea(title)` -- creates an idea via the store with toast feedback
- `createCardInFirstColumn(projectId, title)` -- fetches the project's first board and first column via electronAPI, creates a card there, refreshes allCards, shows toast

**Results useMemo updated:**
- After computing matchedData, when `trimmed.length >= 2` and `matchedData.length < 3`, appends Quick Capture items:
  1. "Create idea" (Zap icon) -- creates idea and closes palette
  2. "Create card in [project]" (PlusCircle icon) -- only shown if an active (non-archived) project exists; creates card in first column of first board
  3. "Start brainstorm" (MessageSquare icon) -- navigates to /brainstorm
- Display text truncated to 40 chars with ellipsis for long queries
- Dependencies array updated to include `projects`, `createIdea`, `createCardInFirstColumn`, `go`, `onClose`

### Verification
- TypeScript: Pass (zero errors)
- Tests: Pass (150/150)
- Build: N/A (not required by task)

### Notes
- The `CreateCardInput` type only requires `columnId` and `title`; `priority` is optional and defaults to `'medium'`
- The `CreateIdeaInput` type only requires `title`; `description`, `projectId`, `tags` are all optional
- The brainstorm capture action simply navigates to /brainstorm (no query params needed as per task spec)
- `go()` already calls `onClose()` internally, but the brainstorm capture action also calls `onClose()` explicitly for safety -- the double-close is harmless since the component guards with `if (!isOpen) return null`
