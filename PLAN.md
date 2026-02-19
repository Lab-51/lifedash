<phase n="E.2" name="Card Agent UI — Chat Panel, Tool Visualization, and Modal Integration">
  <context>
    Plan E.1 is COMPLETE — the card agent backend is fully operational:
    - Schema: card_agent_messages table (migration 0016)
    - Service: cardAgentService.ts with 7 tools + context builder + message persistence
    - IPC: 5 handlers (send-message streaming, get-messages, clear-messages, get-message-count, abort)
    - Preload: 7 bridge methods (5 invoke + 2 event listeners)
    - Types: CardAgentMessage, ToolCallRecord, ToolResultRecord, AgentAction

    The frontend needs a chat panel inside CardDetailModal. The modal is currently a
    single scrollable column (max-w-3xl, 80vh). We will add a 2-tab system:
    "Details" (existing content) and "AI Agent" (new chat panel).

    Proven patterns to reuse:
    - BrainstormModern.tsx / brainstormStore.ts — streaming chat with abort
    - ChatMessageModern.tsx — ReactMarkdown + remarkGfm rendering with dark/light mode
    - brainstormStore — streaming pattern: onChunk listener → accumulate text → final reload

    Key API surface (preload bridge):
      cardAgentSendMessage(cardId, content) → { assistantMessage, actions } | null
      cardAgentGetMessages(cardId) → CardAgentMessage[]
      cardAgentClearMessages(cardId) → void
      cardAgentGetMessageCount(cardId) → number
      cardAgentAbort(cardId) → void
      onCardAgentChunk(cb: ({cardId, chunk}) => void) → cleanup fn
      onCardAgentToolEvent(cb: ({cardId, type, toolName, args?, result?}) => void) → cleanup fn

    Tool events fire twice per tool use: 'call' (with args) then 'result' (with result).
    AgentAction[] (returned from sendMessage) has human-readable descriptions + success boolean.

    Important nuances:
    - CardAgentMessage.content can be null (tool-only assistant messages)
    - Only one card modal is open at a time — store can track single cardId
    - After write tools (checklist, comment, description, createCard) → must refresh
      cardDetailStore to show updated data in the Details tab
    - The message history uses last-20-message windowing server-side (commit 5970332)

    @src/renderer/components/CardDetailModal.tsx
    @src/renderer/components/ChatMessageModern.tsx
    @src/renderer/stores/brainstormStore.ts
    @src/renderer/stores/cardDetailStore.ts
    @src/shared/types/card-agent.ts
    @src/preload/domains/card-agent.ts
    @src/main/ipc/card-agent.ts
  </context>

  <task type="auto" n="1">
    <n>cardAgentStore + CardAgentPanel — core chat component</n>
    <files>
      src/renderer/stores/cardAgentStore.ts (NEW)
      src/renderer/components/CardAgentPanel.tsx (NEW)
    </files>
    <action>
      **Part A — Zustand store: src/renderer/stores/cardAgentStore.ts**

      State:
      ```typescript
      interface CardAgentStore {
        cardId: string | null;
        messages: CardAgentMessage[];
        streaming: boolean;
        streamingText: string;
        toolEvents: ToolEvent[];   // live tool events during streaming
        actions: AgentAction[];    // final action summary from last turn
        loading: boolean;
        messageCount: number;      // for tab badge

        // Actions
        loadMessages: (cardId: string) => Promise<void>;
        sendMessage: (cardId: string, content: string) => Promise<void>;
        clearMessages: (cardId: string) => Promise<void>;
        abort: (cardId: string) => Promise<void>;
        loadMessageCount: (cardId: string) => Promise<void>;
        reset: () => void;
      }

      interface ToolEvent {
        toolName: string;
        type: 'call' | 'result';
        args?: unknown;
        result?: unknown;
      }
      ```

      Implementation pattern (mirrors brainstormStore):
      1. `loadMessages` — calls cardAgentGetMessages, sets messages + cardId
      2. `sendMessage` — the core streaming flow:
         a. Push optimistic user message into messages[] (temp id, role:'user')
         b. Set streaming=true, streamingText='', toolEvents=[], actions=[]
         c. Register onCardAgentChunk listener → append chunk to streamingText
         d. Register onCardAgentToolEvent listener → append to toolEvents[]
         e. await cardAgentSendMessage(cardId, content)
         f. On success: push saved assistantMessage into messages[], set actions
         g. Set streaming=false, streamingText='', clear toolEvents
         h. Cleanup both listeners in finally block
         i. If result is null (aborted), remove optimistic user message
      3. `clearMessages` — calls cardAgentClearMessages, resets messages[]
      4. `abort` — calls cardAgentAbort
      5. `loadMessageCount` — calls cardAgentGetMessageCount
      6. `reset` — clear all state (called when modal closes)

      The event listener cleanup functions returned by onCardAgentChunk/onCardAgentToolEvent
      MUST be called in the finally block to prevent memory leaks.

      WHY Zustand over local state: The store persists across tab switches within the modal
      (user can switch to Details tab and back without losing streaming state).

      **Part B — Chat panel: src/renderer/components/CardAgentPanel.tsx**

      A vertically structured chat panel that fills the modal body area:

      ```
      ┌────────────────────────────────────────┐
      │  [Messages area — flex-1 overflow-y]   │
      │    ┌──────────────────────────────┐     │
      │    │  User message (right-aligned) │     │
      │    └──────────────────────────────┘     │
      │    ┌──────────────────────────────┐     │
      │    │  AI message (left-aligned)    │     │
      │    │  ┌─ Tool actions ──────────┐  │     │
      │    │  │ ✓ Added checklist item  │  │     │
      │    │  └────────────────────────┘  │     │
      │    └──────────────────────────────┘     │
      │                                         │
      │  [Starter prompts — when empty]         │
      ├─────────────────────────────────────────┤
      │  [Input area — sticky bottom]           │
      │  ┌─────────────────────────┐ [Send/Stop]│
      │  │  Ask the agent...       │            │
      │  └─────────────────────────┘  [Clear]   │
      └─────────────────────────────────────────┘
      ```

      Props: `{ cardId: string }`

      Component structure:
      1. **Message list** — scrollable area, ref for auto-scroll
         - Map over store.messages
         - User messages: right-aligned bubble (bg-primary-600 text-white, rounded-2xl rounded-tr-sm)
           Plain whitespace-pre-wrap text (no markdown)
         - Assistant messages: left-aligned card (bg-white dark:bg-surface-900, border, rounded-2xl rounded-tl-sm)
           Render content via ReactMarkdown + remarkGfm (reuse exact component map from ChatMessageModern)
           Guard: if content is null, show only tool actions (no markdown render)
         - Streaming state: show assistant bubble with streamingText + blinking cursor span
           If streamingText is empty + streaming=true, show "Thinking..." with Loader2 spinner
         - Tool events during streaming: render below streaming text as small animated pills
         - After each assistant message: render AgentAction badges from message.toolCalls

      2. **Starter prompts** — shown when messages[] is empty and not streaming
         4 clickable prompt cards in a 2x2 grid:
         - "Break this task into steps" (ListChecks icon)
         - "Draft acceptance criteria" (FileText icon)
         - "What's the status of related work?" (Search icon)
         - "Create sub-tasks for this card" (Plus icon)
         Clicking a prompt calls sendMessage with that text.

      3. **Input area** — sticky at bottom
         - Textarea (auto-resize up to ~4 lines, reset after send)
         - Enter to send, Shift+Enter for newline
         - Send button (SendHorizonal icon) — disabled when empty or streaming
         - Stop button (Square icon) — shown during streaming, calls abort
         - Clear conversation button (Trash2 icon) — shown when messages exist + not streaming
           Uses window.confirm for safety

      4. **Auto-scroll** — same pattern as brainstorm:
         - Track userScrolledUp via scroll listener (if >80px from bottom, set true)
         - Auto-scroll to bottom on new messages/chunks (only when !userScrolledUp)
         - Force-scroll on user send

      5. **Loading state** — show skeleton while loadMessages is in progress

      6. **Empty AI config state** — if no AI provider configured, show a gentle message
         with link to Settings (same pattern as brainstorm)

      Full dark/light mode from the start — use dark: variant classes throughout.
      Keep file under 300 lines by extracting the markdown component map to a const.
    </action>
    <verify>
      - npx tsc --noEmit passes
      - cardAgentStore.ts exports useCardAgentStore
      - CardAgentPanel.tsx exports default component accepting { cardId: string }
      - Store has all 6 actions: loadMessages, sendMessage, clearMessages, abort, loadMessageCount, reset
      - Component renders messages, input area, starter prompts
      - ReactMarkdown + remarkGfm used for assistant messages
      - Event listener cleanup in finally block (no memory leaks)
      - Dark/light mode classes present
    </verify>
    <done>
      Working chat panel component + store that can render messages, stream AI responses,
      display tool events, and manage conversation lifecycle
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - react-markdown and remark-gfm already installed (used by brainstorm)
      - Preload bridge methods match the signatures documented in E.1
      - CardAgentMessage.content can be null for tool-only assistant steps
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>CardDetailModal tab system + agent panel integration</n>
    <files>
      src/renderer/components/CardDetailModal.tsx (MODIFY)
    </files>
    <action>
      **Part A — Add tab bar to CardDetailModal**

      Add a simple 2-tab bar immediately after the header (title + close button) and
      before the priority selector:

      ```
      ┌─────────────────────────────────────────┐
      │  Card Title                          [X] │
      │  ┌──────────┐  ┌──────────┐             │
      │  │ Details   │  │ AI Agent │  (3)        │
      │  └──────────┘  └──────────┘             │
      │  ─────────────────────────────────────── │  ← border-b
      │  [Tab content below]                     │
      ```

      State: `const [activeTab, setActiveTab] = useState<'details' | 'agent'>('details');`

      Tab styling:
      - Active: `text-primary-500 border-b-2 border-primary-500 font-medium`
      - Inactive: `text-surface-400 hover:text-surface-600 dark:hover:text-surface-300`
      - Both: `px-4 py-2 text-sm transition-colors`
      - AI Agent tab: show message count badge (small emerald circle with number)
        when messageCount > 0

      Icons: Details tab = LayoutList, AI Agent tab = Bot

      **Part B — Wrap existing content in Details tab**

      All content from the priority selector down to the timestamps goes inside:
      ```jsx
      {activeTab === 'details' && (
        <>
          {/* existing priority, template, description, labels, ... timestamps */}
        </>
      )}
      ```

      This is a simple conditional render — no restructuring of existing code.

      **Part C — Mount CardAgentPanel in AI Agent tab**

      ```jsx
      {activeTab === 'agent' && (
        <CardAgentPanel cardId={card.id} />
      )}
      ```

      Lazy import: `const CardAgentPanel = lazy(() => import('./CardAgentPanel'));`
      Wrap in Suspense with a simple loading spinner fallback.

      **Part D — Load message count on mount + refresh after agent turn**

      On modal mount: call `useCardAgentStore.getState().loadMessageCount(card.id)`
      This populates the badge on the AI Agent tab before the user clicks it.

      **Part E — Refresh card data after agent mutations**

      After an agent turn completes (sendMessage resolves), the agent may have modified
      checklist items, comments, or the card description. The Details tab must reflect these.

      In CardAgentPanel, after sendMessage resolves and actions[] contains write actions
      (addChecklistItem, toggleChecklistItem, addComment, updateDescription, createCard),
      call `useCardDetailStore.getState().loadCardDetails(cardId)` to refresh.

      Also call the onUpdate callback for description changes so the TipTap editor
      gets the updated content if the user switches back to Details tab.

      For card-level changes (description), also refresh the card from boardStore so
      the parent has the latest data.

      **Part F — Clean up on modal close**

      In the existing useEffect cleanup (where clearCardDetails is called), also call
      `useCardAgentStore.getState().reset()` to clear agent state.

      WHY tabs: The modal is max-w-3xl (768px) — too narrow for a side-by-side layout.
      A tab system cleanly separates the dense card details from the conversational
      agent interface. The store persists across tab switches so users can check details
      and return to the conversation without losing state.
    </action>
    <verify>
      - npx tsc --noEmit passes
      - CardDetailModal renders tab bar with Details and AI Agent tabs
      - Clicking Details shows all existing card content (no visual changes)
      - Clicking AI Agent shows CardAgentPanel with correct cardId
      - Message count badge appears on AI Agent tab when messages exist
      - After agent mutations, switching to Details tab shows updated data
      - Agent store resets on modal close
      - Existing card detail functionality is completely unchanged
    </verify>
    <done>
      CardDetailModal has a 2-tab system with the agent chat panel integrated,
      message count badge, and card data refresh after mutations
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - CardAgentPanel from Task 1 is complete and working
      - Tab switching preserves store state (no re-mount issues)
      - React.lazy works for the panel component (same pattern as other lazy components)
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Tool call visualization + action badges + edge case polish</n>
    <files>
      src/renderer/components/CardAgentPanel.tsx (MODIFY)
      src/renderer/stores/cardAgentStore.ts (MODIFY — if needed)
    </files>
    <action>
      This task adds the visual polish that makes the agent feel alive — real-time
      tool execution feedback and clear action summaries.

      **Part A — Streaming tool event indicators**

      During streaming, below the current streaming text, render tool events as
      small animated pills:

      ```
      AI is responding...
      ──────────────────
      "Here's what I'll do..."  █  (blinking cursor)

        ⟳ Searching project cards...          ← type='call', spinner
        ✓ Found 3 matching cards              ← type='result', checkmark
        ⟳ Adding checklist item: "Set up JWT" ← type='call', spinner
      ```

      Each tool event renders as:
      - `type='call'`: Loader2 spinner + tool description in amber text
        Format: "{humanName}..." where humanName maps tool names to friendly labels:
        ```
        getCardDetails → "Looking up card details"
        searchProjectCards → "Searching project cards"
        addChecklistItem → `Adding checklist item: "${args.title}"`
        toggleChecklistItem → `${args.completed ? 'Completing' : 'Uncompleting'} checklist item`
        addComment → "Adding comment"
        updateDescription → "Updating description"
        createCard → `Creating card: "${args.title}"`
        ```
      - `type='result'`: Check icon + same text in emerald, no spinner
      - Animate: fade-in transition (opacity 0→1, 150ms)
      - Container: border-l-2 border-surface-300 dark:border-surface-700 pl-3 ml-4 mt-2 space-y-1

      **Part B — Persisted action badges on assistant messages**

      For assistant messages that have non-null toolCalls[], render action badges
      below the markdown content:

      ```
      [AI response text with markdown...]

      ┌─────────────────────────────────────┐
      │ ✓ Added checklist item: "Set up JWT" │
      │ ✓ Added checklist item: "Write tests" │
      │ ✓ Updated description                │
      └─────────────────────────────────────┘
      ```

      Implementation:
      - Parse toolCalls[] from the message to generate human-readable descriptions
        (same humanName mapping as Part A, but using past tense: "Added", "Created", etc.)
      - Each badge: flex row with CheckCircle2 icon (emerald) + description text
      - Container: mt-3 pt-3 border-t border-surface-100 dark:border-surface-800 space-y-1.5
      - Text: text-xs text-surface-600 dark:text-surface-400
      - If a tool result indicates failure, show XCircle icon (red) instead

      Note: Use toolCalls from the message, NOT the store's actions[] — the store actions
      are only for the latest turn, but persisted messages need their own rendering.

      To generate descriptions from toolCalls, create a helper:
      ```typescript
      function describeToolCall(call: ToolCallRecord): string {
        // Map tool name + args to past-tense description
      }
      ```

      **Part C — Edge case handling**

      1. **No AI provider configured:**
         Check if any AI provider is available (same check brainstorm uses).
         If not, show a centered message:
         "Configure an AI provider in Settings to use the card agent."
         with a button/link to navigate to Settings.

      2. **Error handling in sendMessage:**
         If sendMessage throws (network error, provider error), show an error toast
         via the toast() function. Don't leave the UI in a broken state — set
         streaming=false and clean up listeners.

      3. **Long conversations:**
         The backend already windows to last 20 messages. No frontend work needed,
         but older messages still show in the UI (they're loaded from DB). Add a subtle
         separator if messages.length > 20: "Earlier messages are summarized for AI context"
         (optional, low priority).

      4. **Copy button on assistant messages:**
         Small copy icon button (top-right of assistant message, visible on hover)
         that copies the text content to clipboard. Same pattern as ChatMessageModern.

      5. **Keyboard hint:**
         Below the input area, small muted text: "Enter to send · Shift+Enter for new line"

      WHY real-time tool events matter: Without them, the user stares at a loading
      spinner for 5-15 seconds while the agent runs multiple tool calls. Showing each
      step as it happens builds trust and makes the agent feel responsive.
    </action>
    <verify>
      - npx tsc --noEmit passes
      - npm test passes (150/150 tests)
      - During streaming: tool events appear as animated pills below streaming text
      - After completion: assistant messages show action badges from toolCalls
      - Read tools (getCardDetails, searchProjectCards) show subtle styling
      - Write tools (add/toggle/update/create) show emerald checkmarks
      - No AI provider: shows configuration message (not a crash)
      - Copy button works on assistant messages
      - Keyboard hint visible below input
      - Full dark/light mode support on all new elements
    </verify>
    <done>
      Rich tool visualization during streaming and in message history,
      error handling, copy functionality, and edge case polish
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - ToolCallRecord.args contains the original tool arguments for description generation
      - toast() function available from existing useToast hook
      - Brainstorm's AI provider check pattern can be reused
    </assumptions>
  </task>
</phase>
