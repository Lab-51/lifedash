# Plan 7.8 — Card Attachments, Due Date UI & KanbanCard Enhancements

**Requirements:** R16 (Advanced Card Features — remaining items)
**Scope:** File attachments (schema, service, IPC, UI), due date picker in CardDetailModal, due date + overdue badge on KanbanCard
**Approach:** Attachment files stored on local filesystem (app data directory), metadata in DB. Due date UI uses native HTML date input (no external library needed — dueDate backend already exists).

## Phase 7 Overview

Phase 7 covers R11, R13, R14, R15, R16, R17 (31 pts total, v2 features).
Planned as 8 sequential plans:

| Plan | Requirement | Focus |
|------|-------------|-------|
| 7.1 | R16 (backend) | Card comments, relationships, activity log — schema + services + IPC |
| 7.2 | R16 (UI) | Comments UI, relationships UI, activity log, card templates in CardDetailModal |
| 7.3 | R15 | Database backup/restore (pg_dump), JSON/CSV export, backup UI |
| 7.4 | R11 | AI task structuring — service, IPC, store, project planning modal, card breakdown |
| 7.5 | R13+R17 | Meeting templates, desktop notifications, daily digest |
| 7.6 | R14 | API transcription providers (Deepgram, AssemblyAI), fallback |
| 7.7 | R13 | Speaker diarization, meeting analytics, analytics UI |
| **7.8** | **R16 (rest)** | **Card attachments, due dates UI, KanbanCard enhancements** |

## Architecture Decisions

1. **File storage in app data directory:** Attachment files are copied into `{userData}/attachments/{cardId}/` using Electron's `app.getPath('userData')`. This keeps files organized per card, survives card metadata changes, and the path is portable relative to the app data location. Files are copied (not moved) so the original stays intact.

2. **Native HTML date input (no date picker library):** The `<input type="date">` and `<input type="datetime-local">` elements provide sufficient functionality for due dates. No need to add a dependency like react-datepicker or date-fns. The dueDate field already exists in schema, types, IPC, and store — we only need the UI.

3. **Attachments as a separate table (not inline on cards):** A `cardAttachments` table with file metadata (name, path, size, MIME type) keeps the cards table clean and supports multiple attachments per card. Files are opened via Electron's `shell.openPath()` for native OS handling.

4. **Overdue badge on KanbanCard:** Cards with dueDate in the past get a red "Overdue" badge, cards due today get an amber "Due today" badge, and cards due within 3 days get a subtle indicator. This makes it easy to spot urgent items on the board without opening the card.

5. **Activity logging for attachments:** Attachment add/remove actions are logged to cardActivities with the 'updated' action type (details JSON contains attachment info). No new enum values needed.

---

<phase n="7.8" name="Card Attachments, Due Date UI & KanbanCard Enhancements">
  <context>
    Phase 7, Plan 8 of 8 (final plan). Implements remaining R16 items:
    - Card file attachments (full stack: schema → service → IPC → UI)
    - Due date picker UI in CardDetailModal (backend already exists)
    - Due date / overdue badges on KanbanCard

    Already complete (not in scope):
    - Card comments, relationships, activity log (Plans 7.1-7.2)
    - Card templates (Plan 7.2)
    - Task breakdown / AI structuring (Plan 7.4)

    Key existing infrastructure:
    - cards table already has `dueDate: timestamp('due_date', { withTimezone: true })` — line 29 of cards.ts
    - Card type has `dueDate: string | null` — types.ts line 47
    - UpdateCardInput has `dueDate?: string | null` — types.ts line 108
    - cards:update IPC handler converts string → Date for DB — cards.ts lines 128-135
    - boardStore.updateCard already passes through dueDate
    - CardDetailModal currently has NO dueDate UI — needs date input
    - KanbanCard shows title, priority badge, label dots — no dueDate display

    Key files for context:
    @src/main/db/schema/cards.ts (add cardAttachments table)
    @src/shared/types.ts (add attachment types + ElectronAPI methods)
    @src/main/ipc/cards.ts (add attachment IPC handlers)
    @src/preload/preload.ts (add attachment bridge methods)
    @src/renderer/stores/boardStore.ts (add attachment state/actions)
    @src/renderer/components/CardDetailModal.tsx (add due date picker + attachments section)
    @src/renderer/components/KanbanCard.tsx (add due date badge)
  </context>

  <task type="auto" n="1">
    <n>Card attachments — schema, types, service, IPC, and preload</n>
    <files>
      src/main/db/schema/cards.ts (MODIFY — add cardAttachments table)
      src/shared/types.ts (MODIFY — add CardAttachment type + 4 ElectronAPI methods)
      src/main/services/attachmentService.ts (NEW ~120 lines)
      src/main/ipc/cards.ts (MODIFY — add 4 attachment IPC handlers)
      src/preload/preload.ts (MODIFY — add 4 attachment bridge methods)
      drizzle migration (auto-generated)
    </files>
    <action>
      ## WHY
      Card attachments allow users to associate files (documents, screenshots, specs) with
      cards. This completes the R16 Advanced Card Features requirement. We need: a DB table
      for metadata, a service to copy files to app data and manage lifecycle, IPC handlers
      for the renderer to add/list/delete attachments, and preload bridges.

      ## WHAT

      ### 1a. Schema — modify src/main/db/schema/cards.ts

      Add a `cardAttachments` table after `cardActivities`:

      ```typescript
      // --- Card Attachments ---

      export const cardAttachments = pgTable('card_attachments', {
        id: uuid('id').primaryKey().defaultRandom(),
        cardId: uuid('card_id').notNull()
          .references(() => cards.id, { onDelete: 'cascade' }),
        fileName: varchar('file_name', { length: 500 }).notNull(),
        filePath: text('file_path').notNull(),       // Absolute path in app data dir
        fileSize: integer('file_size').notNull(),     // Bytes
        mimeType: varchar('mime_type', { length: 200 }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      });
      ```

      Also add `cardAttachments` to the barrel export in schema/index.ts.

      Generate migration: `npx drizzle-kit generate`

      ### 1b. Types — modify src/shared/types.ts

      Add near the card types section:

      ```typescript
      // === CARD ATTACHMENT TYPES ===

      export interface CardAttachment {
        id: string;
        cardId: string;
        fileName: string;
        filePath: string;
        fileSize: number;
        mimeType: string | null;
        createdAt: string;
      }
      ```

      Add to ElectronAPI interface:

      ```typescript
      // Card Attachments
      getCardAttachments: (cardId: string) => Promise<CardAttachment[]>;
      addCardAttachment: (cardId: string) => Promise<CardAttachment | null>;  // Opens file dialog
      deleteCardAttachment: (id: string) => Promise<void>;
      openCardAttachment: (filePath: string) => Promise<void>;
      ```

      ### 1c. Create src/main/services/attachmentService.ts (~120 lines)

      File header:
      ```
      // === FILE PURPOSE ===
      // Manages card file attachments — copies files into app data directory,
      // stores metadata in DB, handles file deletion and opening.
      //
      // === DEPENDENCIES ===
      // electron (app, dialog, shell), fs, path, drizzle
      //
      // === LIMITATIONS ===
      // - Files are copied (not moved) — original stays in place
      // - No file size limit enforced (user responsibility)
      // - No duplicate detection (same file can be attached multiple times)
      ```

      Imports:
      ```typescript
      import { app, dialog, shell } from 'electron';
      import fs from 'node:fs';
      import path from 'node:path';
      import { getDb } from '../db/connection';
      import { cardAttachments } from '../db/schema';
      import { eq } from 'drizzle-orm';
      import type { CardAttachment } from '../../shared/types';
      ```

      Functions:

      **`getAttachmentsDir(cardId: string): string`** (private helper)
      - Returns `path.join(app.getPath('userData'), 'attachments', cardId)`
      - Creates directory if it doesn't exist (`fs.mkdirSync(..., { recursive: true })`)

      **`function toAttachment(row): CardAttachment`** (private mapper)
      - Maps Drizzle row to CardAttachment interface
      - Converts `createdAt` Date → ISO string

      **`async function getAttachments(cardId: string): Promise<CardAttachment[]>`**
      - Query `cardAttachments` where cardId matches, ordered by createdAt desc
      - Map with toAttachment

      **`async function addAttachment(cardId: string): Promise<CardAttachment | null>`**
      - Open file dialog: `dialog.showOpenDialog({ properties: ['openFile'] })`
      - If cancelled, return null
      - Get source file info: `fs.statSync(filePath)` for size
      - Determine MIME type from extension (use a small lookup map for common types: pdf, png, jpg, gif, txt, md, doc, docx, xls, xlsx, csv, zip — default to `application/octet-stream`)
      - Get destination dir: `getAttachmentsDir(cardId)`
      - Copy file: `fs.copyFileSync(sourcePath, destPath)`
        - If filename collision, append `-1`, `-2` etc. before extension
      - Insert row into `cardAttachments` table with destPath
      - Return the new attachment

      **`async function deleteAttachment(id: string): Promise<void>`**
      - Query the attachment row by id
      - If found, delete the file from disk (`fs.unlinkSync`, wrapped in try/catch)
      - Delete the row from DB

      **`async function openAttachment(filePath: string): Promise<void>`**
      - Call `shell.openPath(filePath)` to open with default OS application

      Export all 4 public functions.

      ### 1d. IPC handlers — modify src/main/ipc/cards.ts

      Add after existing card handlers (before label handlers):

      ```typescript
      import * as attachmentService from '../services/attachmentService';

      // Card Attachments
      ipcMain.handle('card:getAttachments', async (_event, cardId: string) => {
        return attachmentService.getAttachments(cardId);
      });

      ipcMain.handle('card:addAttachment', async (_event, cardId: string) => {
        const attachment = await attachmentService.addAttachment(cardId);
        if (attachment) {
          logCardActivity(cardId, 'updated', JSON.stringify({
            action: 'attachment_added',
            fileName: attachment.fileName,
          }));
        }
        return attachment;
      });

      ipcMain.handle('card:deleteAttachment', async (_event, id: string) => {
        // Get attachment info before deleting (for activity log)
        const db = getDb();
        const [att] = await db.select().from(cardAttachments).where(eq(cardAttachments.id, id));
        await attachmentService.deleteAttachment(id);
        if (att) {
          logCardActivity(att.cardId, 'updated', JSON.stringify({
            action: 'attachment_removed',
            fileName: att.fileName,
          }));
        }
      });

      ipcMain.handle('card:openAttachment', async (_event, filePath: string) => {
        return attachmentService.openAttachment(filePath);
      });
      ```

      Import `cardAttachments` from schema and `eq` from drizzle-orm (if not already imported).

      ### 1e. Preload — modify src/preload/preload.ts

      Add to electronAPI object:

      ```typescript
      // Card Attachments
      getCardAttachments: (cardId: string) => ipcRenderer.invoke('card:getAttachments', cardId),
      addCardAttachment: (cardId: string) => ipcRenderer.invoke('card:addAttachment', cardId),
      deleteCardAttachment: (id: string) => ipcRenderer.invoke('card:deleteAttachment', id),
      openCardAttachment: (filePath: string) => ipcRenderer.invoke('card:openAttachment', filePath),
      ```

      ### 1f. Schema export — modify src/main/db/schema/index.ts

      Add `cardAttachments` to the exports if not auto-exported.

      ### 1g. Generate and apply migration

      Run `npx drizzle-kit generate` to create migration for card_attachments table.
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. cardAttachments table exists in schema with: id, cardId, fileName, filePath, fileSize, mimeType, createdAt
      3. CardAttachment type exists in shared/types.ts
      4. ElectronAPI has 4 new attachment methods
      5. attachmentService.ts exports: getAttachments, addAttachment, deleteAttachment, openAttachment
      6. addAttachment opens file dialog, copies file to userData/attachments/{cardId}/, inserts DB row
      7. deleteAttachment removes file from disk + DB row
      8. openAttachment uses shell.openPath
      9. 4 IPC handlers registered: card:getAttachments, card:addAttachment, card:deleteAttachment, card:openAttachment
      10. Activity logged for attachment add/remove
      11. 4 preload bridge methods exist
      12. Migration generated
    </verify>
    <done>cardAttachments table, CardAttachment type, attachment service (file dialog → copy → DB), 4 IPC handlers with activity logging, 4 preload bridges. Migration generated. TypeScript compiles cleanly.</done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Electron dialog.showOpenDialog is available in main process
      - Electron shell.openPath is available in main process
      - app.getPath('userData') returns a writable directory
      - fs.copyFileSync works on Windows for cross-drive copies
      - cardActivities 'updated' action type is suitable for attachment events (no new enum needed)
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Due date picker in CardDetailModal + overdue badge on KanbanCard</n>
    <files>
      src/renderer/components/CardDetailModal.tsx (MODIFY — add due date picker section)
      src/renderer/components/KanbanCard.tsx (MODIFY — add due date badge with overdue styling)
    </files>
    <action>
      ## WHY
      The dueDate field exists in schema, types, IPC, and store — but has NO UI anywhere.
      Users need a way to set/clear due dates on cards, and see at a glance which cards are
      overdue or due soon on the Kanban board.

      ## WHAT

      ### 2a. CardDetailModal — add due date picker

      Read the current CardDetailModal.tsx first to understand structure.

      Add a due date section between the Labels section and the Card Details section
      (i.e., after the labels `</div>` at ~line 421 and before the loadingCardDetails check at ~line 424).

      Import `Calendar` icon from lucide-react.

      Due date section:
      ```tsx
      {/* Due Date */}
      <div className="mb-5">
        <span className="text-sm text-surface-400 block mb-2">Due Date</span>
        <div className="flex items-center gap-3">
          <Calendar size={16} className="text-surface-400 shrink-0" />
          <input
            type="datetime-local"
            value={card.dueDate ? toDateTimeLocalValue(card.dueDate) : ''}
            onChange={(e) => {
              const val = e.target.value;
              onUpdate(card.id, {
                dueDate: val ? new Date(val).toISOString() : null,
              });
            }}
            className="bg-surface-800 border border-surface-700 rounded-lg px-3 py-1.5 text-sm text-surface-100 focus:outline-none focus:border-primary-500 [color-scheme:dark]"
          />
          {card.dueDate && (
            <>
              <span className={`text-xs px-2 py-0.5 rounded-full ${getDueDateBadge(card.dueDate).classes}`}>
                {getDueDateBadge(card.dueDate).label}
              </span>
              <button
                onClick={() => onUpdate(card.id, { dueDate: null })}
                className="text-xs text-surface-500 hover:text-surface-300 transition-colors"
              >
                Clear
              </button>
            </>
          )}
        </div>
      </div>
      ```

      Add helper functions (at the top of the file, after formatDate):

      ```typescript
      /** Convert ISO string to datetime-local input value (YYYY-MM-DDTHH:mm) */
      function toDateTimeLocalValue(isoStr: string): string {
        const d = new Date(isoStr);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
      }

      /** Get badge classes and label for a due date */
      function getDueDateBadge(dueDateStr: string): { label: string; classes: string } {
        const now = new Date();
        const due = new Date(dueDateStr);
        const diffMs = due.getTime() - now.getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);

        if (diffMs < 0) {
          return { label: 'Overdue', classes: 'bg-red-500/20 text-red-400' };
        }
        if (diffDays < 1) {
          return { label: 'Due today', classes: 'bg-amber-500/20 text-amber-400' };
        }
        if (diffDays < 3) {
          return { label: `Due in ${Math.ceil(diffDays)}d`, classes: 'bg-amber-500/10 text-amber-300' };
        }
        if (diffDays < 7) {
          return { label: `Due in ${Math.ceil(diffDays)}d`, classes: 'bg-blue-500/10 text-blue-300' };
        }
        return { label: formatDate(dueDateStr), classes: 'bg-surface-800 text-surface-400' };
      }
      ```

      The `[color-scheme:dark]` class on the input ensures the native date picker renders
      in dark mode to match our theme.

      ### 2b. KanbanCard — add due date badge

      Read the current KanbanCard.tsx first to understand structure.

      Import `Clock` icon from lucide-react.

      Add the getDueDateBadge helper (same function as above — or extract to a shared util,
      but since it's small, duplicating in both files is acceptable for now).

      Add due date display between the priority badge and the label dots (or after both).
      Only show when `card.dueDate` is not null:

      ```tsx
      {/* Due date badge */}
      {card.dueDate && (
        <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${getDueDateBadge(card.dueDate).classes}`}>
          <Clock size={10} />
          {getDueDateBadge(card.dueDate).label}
        </span>
      )}
      ```

      Place this in the card footer area, alongside the priority badge and label dots.
      The exact placement depends on the existing layout — add it as a new row or inline
      with existing badges. Keep it compact since KanbanCards are small.
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. CardDetailModal has a datetime-local input for due date
      3. Setting a date calls onUpdate with ISO string; clearing calls with null
      4. Due date badge shows: "Overdue" (red), "Due today" (amber), "Due in Nd" (amber/blue), or formatted date
      5. Clear button removes the due date
      6. `[color-scheme:dark]` on input for dark mode native picker
      7. KanbanCard shows due date badge when card.dueDate is set
      8. KanbanCard badge uses same color scheme as CardDetailModal badge
      9. toDateTimeLocalValue correctly formats ISO → YYYY-MM-DDTHH:mm for input value
    </verify>
    <done>Due date picker with datetime-local input in CardDetailModal. Status badge (overdue/due today/due soon). Clear button. Due date badge on KanbanCard with color-coded overdue styling. TypeScript compiles cleanly.</done>
    <confidence>HIGH</confidence>
    <assumptions>
      - datetime-local input works well in Electron's Chromium renderer
      - [color-scheme:dark] Tailwind class properly triggers dark mode for native inputs
      - Card type already has dueDate field available in both components
      - onUpdate(id, { dueDate: isoString }) flows through store → IPC → DB correctly (already tested in Plan 7.1)
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Attachments UI — store extensions + AttachmentsSection + CardDetailModal integration</n>
    <files>
      src/renderer/stores/boardStore.ts (MODIFY — add attachment state/actions)
      src/renderer/components/AttachmentsSection.tsx (NEW ~180 lines)
      src/renderer/components/CardDetailModal.tsx (MODIFY — integrate AttachmentsSection)
    </files>
    <action>
      ## WHY
      The attachment backend (Task 1) and due date UI (Task 2) are complete. Now we need
      the renderer-side integration: store state for attachments, a UI section for
      viewing/adding/deleting attachments, and integration into CardDetailModal.

      ## WHAT

      ### 3a. boardStore — add attachment state and actions

      Read the current boardStore.ts first.

      Add state:
      ```typescript
      selectedCardAttachments: CardAttachment[];
      ```

      Initialize to `[]` in the store default.

      Modify `loadCardDetails` to also load attachments:
      ```typescript
      // Inside loadCardDetails, alongside existing comment/relationship/activity loads:
      const attachments = await window.electronAPI.getCardAttachments(cardId);
      // Add to set:
      set({ ..., selectedCardAttachments: attachments });
      ```

      Modify `clearCardDetails` to also clear attachments:
      ```typescript
      set({ ..., selectedCardAttachments: [] });
      ```

      Add actions:
      ```typescript
      addAttachment: async (cardId: string) => {
        const attachment = await window.electronAPI.addCardAttachment(cardId);
        if (attachment) {
          set(state => ({
            selectedCardAttachments: [attachment, ...state.selectedCardAttachments],
          }));
        }
      },

      deleteAttachment: async (id: string) => {
        await window.electronAPI.deleteCardAttachment(id);
        set(state => ({
          selectedCardAttachments: state.selectedCardAttachments.filter(a => a.id !== id),
        }));
      },

      openAttachment: async (filePath: string) => {
        await window.electronAPI.openCardAttachment(filePath);
      },
      ```

      Import `CardAttachment` from shared/types.ts.

      ### 3b. Create src/renderer/components/AttachmentsSection.tsx (~180 lines)

      Read CommentsSection.tsx for component pattern reference.

      File header:
      ```
      // === FILE PURPOSE ===
      // Displays card file attachments with add, open, and delete functionality.
      // Files are opened with the OS default application.
      //
      // === DEPENDENCIES ===
      // react, lucide-react, boardStore
      //
      // === LIMITATIONS ===
      // - No drag-and-drop file upload (uses file dialog)
      // - No file preview (opens with OS app)
      // - No file size limit enforcement
      ```

      Props:
      ```typescript
      interface AttachmentsSectionProps {
        cardId: string;
      }
      ```

      Component layout:
      ```
      ── Attachments (3) ─── [+ Add File] ──────
      │ 📄 requirements.pdf      1.2 MB    2 days ago   [Open] [🗑]
      │ 📸 screenshot.png        340 KB    5 min ago    [Open] [🗑]
      │ 📝 notes.md              2.1 KB    1 hour ago   [Open] [🗑]
      ────────────────────────────────────────────
      ```

      Implementation details:

      - Use boardStore: `selectedCardAttachments`, `addAttachment`, `deleteAttachment`, `openAttachment`
      - Header row: section title "Attachments" with count badge, "+ Add File" button (calls addAttachment)
      - Each attachment row:
        - File icon based on MIME type (use getFileIcon helper):
          - image/*: ImageIcon (lucide)
          - application/pdf: FileText
          - text/*: FileCode
          - default: File
        - File name (truncated to ~30 chars with title tooltip for full name)
        - File size formatted (formatFileSize helper: bytes → KB/MB/GB)
        - Relative time (reuse timeAgo pattern from CommentsSection if available, or simple logic)
        - "Open" button: calls openAttachment(filePath)
        - Delete button (Trash2 icon): calls deleteAttachment(id) with inline confirmation
      - Empty state: "No attachments. Click '+ Add File' to attach documents, images, or other files."
      - Delete confirmation: simple inline "Delete?" / "Cancel" toggle (same pattern as CommentsSection)

      Helper functions:
      ```typescript
      function formatFileSize(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
      }

      function getFileIcon(mimeType: string | null): React.ComponentType<{ size?: number }> {
        if (mimeType?.startsWith('image/')) return ImageIcon;
        if (mimeType === 'application/pdf') return FileText;
        if (mimeType?.startsWith('text/')) return FileCode;
        return File;
      }
      ```

      Styling:
      - Follow CommentsSection pattern for consistent look
      - Attachment rows: `bg-surface-800/50 rounded-lg p-3` with hover highlight
      - Compact layout for file list

      ### 3c. CardDetailModal — integrate AttachmentsSection

      Import AttachmentsSection:
      ```typescript
      import AttachmentsSection from './AttachmentsSection';
      ```

      Add the section between the Labels and Due Date sections (or between Due Date and
      the Card Details block — wherever it fits naturally). Recommended placement: after
      the Due Date section and before the loadingCardDetails guard:

      ```tsx
      {/* Attachments */}
      <div className="mb-5">
        <AttachmentsSection cardId={card.id} />
      </div>
      ```

      This should be placed OUTSIDE the loadingCardDetails guard since attachments are
      loaded as part of loadCardDetails (inside the guard block alongside Comments,
      Relationships, etc.) — actually, since attachments load with loadCardDetails,
      place it INSIDE the guard:

      ```tsx
      {loadingCardDetails ? (
        <div>Loading details...</div>
      ) : (
        <>
          <div className="mb-5">
            <AttachmentsSection cardId={card.id} />
          </div>
          <div className="mb-5">
            <CommentsSection cardId={card.id} />
          </div>
          ...existing sections...
        </>
      )}
      ```
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. boardStore has selectedCardAttachments state ([] default)
      3. loadCardDetails fetches and sets attachments
      4. clearCardDetails resets attachments to []
      5. boardStore has addAttachment (opens dialog, adds to state), deleteAttachment (removes from state + DB), openAttachment
      6. AttachmentsSection shows file list with icon, name, size, time
      7. "Add File" button opens native file dialog
      8. "Open" button opens file with OS default app
      9. Delete button has inline confirmation
      10. Empty state message when no attachments
      11. AttachmentsSection integrated in CardDetailModal within loadingCardDetails guard
      12. File size formatting works (B, KB, MB, GB)
    </verify>
    <done>boardStore with attachment state/actions. AttachmentsSection component with file list, add/open/delete. Integrated in CardDetailModal. Full attachment lifecycle works: add (file dialog → copy → DB) → view (list with metadata) → open (OS app) → delete (confirm → remove). TypeScript compiles cleanly.</done>
    <confidence>HIGH</confidence>
    <assumptions>
      - boardStore.loadCardDetails can be extended with one additional Promise.all entry
      - CommentsSection pattern (title + count + action button + list) is suitable for attachments
      - Lucide React has File, FileText, FileCode, ImageIcon exports (standard lucide-react icons)
        - Note: ImageIcon might be named differently — verify import. Alternative: Image from lucide-react
      - window.electronAPI.addCardAttachment returns null when file dialog is cancelled
    </assumptions>
  </task>
</phase>
