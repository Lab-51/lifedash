# Plan 6.3: AI Features & Cross-Feature Integration

## Coverage
- **R12: Idea Repository** (remaining) — AI-assisted idea analysis (feasibility/effort/impact)
- **R10: AI Brainstorming Agent** (remaining) — Enhanced context injection (cards, ideas, meeting briefs)
- Cross-feature bridge: "Brainstorm this idea" from IdeaDetailModal

## Plan Overview
Phase 6 covers R10 (AI Brainstorming, 8 pts) + R12 (Idea Repository, 5 pts).
Plans 6.1 (Idea Repository) and 6.2 (Brainstorming Chat) are complete.

Plan 6.3 delivers the remaining ROADMAP Phase 6 deliverables:
- **Task 1**: AI idea analysis service + IPC + types + store (backend pipeline)
- **Task 2**: AI analysis UI in IdeaDetailModal + "Brainstorm This Idea" cross-feature button
- **Task 3**: Enhanced brainstorm context injection (cards, ideas, meeting briefs + parallelized queries)

## Architecture Decisions for Plan 6.3

1. **Non-streaming AI for idea analysis** — Uses `generate()` from ai-provider.ts (not streamText),
   same pattern as meetingIntelligenceService. Analysis is a one-shot request, not conversational.

2. **JSON response parsing with fallback** — AI returns structured JSON for analysis.
   Try JSON.parse first, regex extraction fallback, then sensible defaults. Never crash.

3. **Context enrichment scope** — Add card titles (5/board), idea titles (5 total),
   meeting briefs (3 truncated) to brainstorm context. Keep total context manageable
   to avoid excessive token usage.

4. **"Brainstorm this idea" flow** — Creates a new brainstorm session, sends an initial
   message describing the idea, then navigates to BrainstormPage.

---

<phase n="6.3" name="AI Features & Cross-Feature Integration">
  <context>
    Plans 6.1 (Idea Repository) and 6.2 (Brainstorming Chat) are complete.
    This plan delivers the remaining Phase 6 deliverables.

    Existing infrastructure to build on:
    @src/main/services/ai-provider.ts — resolveTaskModel('idea_analysis'), generate(), logUsage()
    @src/main/services/ideaService.ts — getIdea(), toIdea(), loadTagsForIdeas() helpers; 7 exports
    @src/main/services/brainstormService.ts — buildContext() at lines 182-221 (enrich here)
    @src/main/ipc/ideas.ts — 7 existing idea IPC channels
    @src/preload/preload.ts — 7 existing idea bridge methods
    @src/shared/types.ts — AITaskType includes 'idea_analysis'; Idea, EffortLevel, ImpactLevel types
    @src/renderer/stores/ideaStore.ts — 8 Zustand actions (add analysis state + action)
    @src/renderer/components/IdeaDetailModal.tsx — 672 lines (add analysis section + brainstorm button)
    @src/renderer/pages/IdeasPage.tsx — wires IdeaDetailModal
    @src/renderer/stores/brainstormStore.ts — createSession, sendMessage actions
    @src/main/db/schema/cards.ts — cards table: title, columnId, archived, updatedAt
    @src/main/db/schema/boards.ts — columns table: boardId; boards table: projectId, name
    @src/main/db/schema/ideas.ts — ideas table: title, status, projectId, updatedAt
    @src/main/db/schema/meetings.ts — meetings + meetingBriefs tables

    Pattern reference:
    - meetingIntelligenceService.ts uses resolveTaskModel() + generate() for non-streaming AI
    - brainstormService.ts buildContext() for context injection pattern
    - IPC + preload + store pattern established in all previous plans

    UI conventions:
    - Primary action: bg-primary-600 hover:bg-primary-500 text-white rounded-lg
    - Section bg: bg-surface-800/50 border border-surface-700 rounded-lg
    - Loading: Loader2 from lucide-react with animate-spin
    - Icons: lucide-react (Sparkles, MessageSquare, Check, AlertCircle, etc.)
  </context>

  <task type="auto" n="1">
    <n>AI Idea Analysis — Service, IPC, Types & Store</n>
    <files>
      src/shared/types.ts (add IdeaAnalysis type + analyzeIdea in ElectronAPI)
      src/main/services/ideaService.ts (add analyzeIdea function)
      src/main/ipc/ideas.ts (add idea:analyze channel)
      src/preload/preload.ts (add analyzeIdea bridge method)
      src/renderer/stores/ideaStore.ts (add analysis state + analyzeIdea/clearAnalysis actions)
    </files>
    <preconditions>
      - Plan 6.2 complete, TypeScript compiles clean
      - AI provider system functional (ai-provider.ts with generate() + resolveTaskModel())
      - 'idea_analysis' already exists in AITaskType union (types.ts line 128)
      - At least one AI provider configured in the app (for runtime testing)
    </preconditions>
    <action>
      ## WHY
      R12 requires "AI-assisted idea analysis (feasibility, effort, impact)". The AITaskType
      'idea_analysis' is defined but has no implementation. This task creates the full
      backend-to-store pipeline for AI-powered idea analysis.

      ## WHAT

      ### 1. types.ts — Add IdeaAnalysis type (~line 349, after ConvertIdeaToCardResult)
      ```typescript
      export interface IdeaAnalysis {
        suggestedEffort: EffortLevel;
        suggestedImpact: ImpactLevel;
        feasibilityNotes: string;
        rationale: string;
      }
      ```

      Add to ElectronAPI interface (after convertIdeaToCard, ~line 487):
      ```typescript
      analyzeIdea: (id: string) => Promise<IdeaAnalysis>;
      ```

      ### 2. ideaService.ts — Add analyzeIdea function

      Add import at top:
      ```typescript
      import { generate, resolveTaskModel } from './ai-provider';
      import type { IdeaAnalysis, EffortLevel, ImpactLevel } from '../../shared/types';
      ```

      Add new exported function after convertIdeaToCard:
      ```typescript
      const IDEA_ANALYSIS_SYSTEM_PROMPT = `You are an idea analysis assistant. Given an idea with its title, description, and tags, analyze it and provide structured feedback.

      Respond ONLY with a JSON object (no markdown, no code fences):
      {
        "suggestedEffort": "<one of: trivial, small, medium, large, epic>",
        "suggestedImpact": "<one of: minimal, low, medium, high, critical>",
        "feasibilityNotes": "<1-3 sentences about technical feasibility, risks, and prerequisites>",
        "rationale": "<1-3 sentences explaining why you chose these effort/impact levels>"
      }

      Effort levels:
      - trivial: less than a day, straightforward
      - small: 1-3 days, well-understood
      - medium: 1-2 weeks, some unknowns
      - large: 2-4 weeks, significant complexity
      - epic: 1+ months, major undertaking

      Impact levels:
      - minimal: nice-to-have, few users affected
      - low: minor improvement, limited scope
      - medium: noticeable improvement, moderate reach
      - high: significant value, many users affected
      - critical: essential, business-critical`;

      export async function analyzeIdea(ideaId: string): Promise<IdeaAnalysis> {
        const db = getDb();

        // Load idea
        const [ideaRow] = await db.select().from(ideas).where(eq(ideas.id, ideaId));
        if (!ideaRow) throw new Error(`Idea not found: ${ideaId}`);

        // Load tags
        const tagRows = await db.select({ tag: ideaTags.tag })
          .from(ideaTags).where(eq(ideaTags.ideaId, ideaId));
        const tags = tagRows.map(r => r.tag);

        // Resolve AI provider
        const provider = await resolveTaskModel('idea_analysis');
        if (!provider) {
          throw new Error('No AI provider configured. Go to Settings to add one.');
        }

        // Build prompt
        let prompt = `Idea: ${ideaRow.title}`;
        if (ideaRow.description) prompt += `\nDescription: ${ideaRow.description}`;
        if (tags.length > 0) prompt += `\nTags: ${tags.join(', ')}`;
        if (ideaRow.effort) prompt += `\nCurrent effort estimate: ${ideaRow.effort}`;
        if (ideaRow.impact) prompt += `\nCurrent impact estimate: ${ideaRow.impact}`;

        // Generate analysis
        const result = await generate({
          providerId: provider.providerId,
          providerName: provider.providerName,
          apiKeyEncrypted: provider.apiKeyEncrypted,
          baseUrl: provider.baseUrl,
          model: provider.model,
          taskType: 'idea_analysis',
          prompt,
          system: IDEA_ANALYSIS_SYSTEM_PROMPT,
          temperature: provider.temperature ?? 0.3,
          maxTokens: provider.maxTokens ?? 1024,
        });

        // Parse JSON response with fallback
        return parseAnalysisResponse(result.text);
      }

      const VALID_EFFORTS: EffortLevel[] = ['trivial', 'small', 'medium', 'large', 'epic'];
      const VALID_IMPACTS: ImpactLevel[] = ['minimal', 'low', 'medium', 'high', 'critical'];

      function parseAnalysisResponse(text: string): IdeaAnalysis {
        // Try direct JSON parse
        try {
          const parsed = JSON.parse(text);
          return validateAnalysis(parsed);
        } catch {
          // Try extracting JSON from response text
        }

        // Regex fallback: find JSON object in text
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            const parsed = JSON.parse(match[0]);
            return validateAnalysis(parsed);
          } catch {
            // Fall through to defaults
          }
        }

        // Default fallback — return sensible defaults with raw text as rationale
        return {
          suggestedEffort: 'medium',
          suggestedImpact: 'medium',
          feasibilityNotes: 'Unable to parse structured analysis.',
          rationale: text.slice(0, 500),
        };
      }

      function validateAnalysis(parsed: Record<string, unknown>): IdeaAnalysis {
        return {
          suggestedEffort: VALID_EFFORTS.includes(parsed.suggestedEffort as EffortLevel)
            ? (parsed.suggestedEffort as EffortLevel)
            : 'medium',
          suggestedImpact: VALID_IMPACTS.includes(parsed.suggestedImpact as ImpactLevel)
            ? (parsed.suggestedImpact as ImpactLevel)
            : 'medium',
          feasibilityNotes: typeof parsed.feasibilityNotes === 'string'
            ? parsed.feasibilityNotes
            : 'No feasibility notes provided.',
          rationale: typeof parsed.rationale === 'string'
            ? parsed.rationale
            : 'No rationale provided.',
        };
      }
      ```

      ### 3. ideas.ts IPC — Add idea:analyze channel

      Add import of analyzeIdea from ideaService (update the existing `import * as ideaService`
      or individual imports).

      Add handler inside registerIdeaHandlers():
      ```typescript
      ipcMain.handle('idea:analyze', async (_event, id: string) => {
        return ideaService.analyzeIdea(id);
      });
      ```

      ### 4. preload.ts — Add analyzeIdea bridge method

      Add to the idea section (after convertIdeaToCard):
      ```typescript
      analyzeIdea: (id: string) => ipcRenderer.invoke('idea:analyze', id),
      ```

      ### 5. ideaStore.ts — Add analysis state + actions

      Add to the store interface:
      ```typescript
      analysis: IdeaAnalysis | null;
      analyzing: boolean;
      analysisError: string | null;
      analyzeIdea: (id: string) => Promise<void>;
      clearAnalysis: () => void;
      ```

      Add import: `import type { IdeaAnalysis } from '../../shared/types';`

      Add initial state:
      ```typescript
      analysis: null,
      analyzing: false,
      analysisError: null,
      ```

      Add actions:
      ```typescript
      analyzeIdea: async (id: string) => {
        set({ analyzing: true, analysisError: null, analysis: null });
        try {
          const analysis = await window.electronAPI.analyzeIdea(id);
          set({ analysis, analyzing: false });
        } catch (error) {
          set({
            analyzing: false,
            analysisError: error instanceof Error ? error.message : 'Analysis failed',
          });
        }
      },

      clearAnalysis: () => set({ analysis: null, analysisError: null }),
      ```

      Update clearSelectedIdea to also clear analysis:
      ```typescript
      clearSelectedIdea: () => set({ selectedIdea: null, analysis: null, analysisError: null }),
      ```
    </action>
    <verify>
      1. `npx tsc --noEmit` passes with zero errors
      2. IdeaAnalysis type is exported from types.ts with all 4 fields
      3. analyzeIdea is in ElectronAPI interface
      4. ideaService.analyzeIdea uses resolveTaskModel('idea_analysis') + generate()
      5. parseAnalysisResponse handles: valid JSON, JSON in text, total fallback
      6. validateAnalysis validates effort/impact against allowed enum values
      7. IPC handler 'idea:analyze' is registered in ideas.ts
      8. Preload bridge includes analyzeIdea method
      9. ideaStore has analysis/analyzing/analysisError state + analyzeIdea/clearAnalysis actions
      10. clearSelectedIdea resets analysis state
    </verify>
    <done>
      Full AI idea analysis pipeline: types → service (with prompt + JSON parsing fallback) →
      IPC → preload → store. TypeScript compiles cleanly.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - generate() from ai-provider.ts works for non-streaming analysis (verified pattern from meetingIntelligenceService)
      - resolveTaskModel('idea_analysis') resolves a provider when user has one configured
      - JSON response parsing with regex fallback handles common LLM output variations
      - ideaTags table can be queried directly for tag loading (avoids loadTagsForIdeas helper which expects full idea array)
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>AI Analysis UI + "Brainstorm This Idea" in IdeaDetailModal</n>
    <files>
      src/renderer/components/IdeaDetailModal.tsx (add analysis section + brainstorm button)
      src/renderer/pages/IdeasPage.tsx (wire onNavigate prop to modal)
    </files>
    <preconditions>
      - Task 1 complete (analyzeIdea pipeline working end-to-end)
      - ideaStore has analysis/analyzing/analysisError state + actions
      - brainstormStore has createSession and sendMessage actions
    </preconditions>
    <action>
      ## WHY
      Task 1 built the backend pipeline for idea analysis. This task adds the user-facing UI
      so users can request AI analysis and act on suggestions. Additionally, a natural
      cross-feature bridge is "Brainstorm this idea" — creating a brainstorm session seeded
      with idea context.

      ## WHAT

      ### 1. IdeaDetailModal.tsx — Add AI Analysis Section

      Add imports:
      ```typescript
      import { Sparkles, MessageSquare, AlertCircle } from 'lucide-react';
      import { useIdeaStore } from '../stores/ideaStore';
      import { useBrainstormStore } from '../stores/brainstormStore';
      ```

      Add new props to the component:
      ```typescript
      interface IdeaDetailModalProps {
        // ... existing props
        onNavigate?: (path: string) => void;
      }
      ```

      Inside the component, destructure analysis state from ideaStore:
      ```typescript
      const { analysis, analyzing, analysisError, analyzeIdea, clearAnalysis } = useIdeaStore();
      ```

      **Add an AI Analysis section between the effort/impact dropdowns and the tags editor.**

      Layout of analysis section:
      ```
      +-------------------------------------------------------+
      | [Sparkles] AI Analysis           [Analyze with AI btn] |
      |                                                        |
      | (if analyzing: spinner + "Analyzing...")               |
      |                                                        |
      | (if analysisError: red alert message)                  |
      |                                                        |
      | (if analysis result exists:)                           |
      | +----------------------------------------------------+ |
      | | Suggested Effort: [medium badge]        [Apply btn] | |
      | | Suggested Impact: [high badge]          [Apply btn] | |
      | |                                                    | |
      | | Feasibility: "The idea is technically..."          | |
      | | Rationale: "Medium effort because..."              | |
      | |                                        [Dismiss]   | |
      | +----------------------------------------------------+ |
      +-------------------------------------------------------+
      ```

      **"Analyze with AI" button:**
      - Styling: `flex items-center gap-1.5 px-3 py-1.5 bg-purple-600/20 border border-purple-500/30 hover:bg-purple-600/30 text-purple-300 rounded-lg text-sm transition-colors`
      - Icon: Sparkles (size 14)
      - Text: "Analyze with AI"
      - Disabled when `analyzing` is true
      - On click: `analyzeIdea(idea.id)` (idea is the selected idea passed as prop or from store)

      **Loading state (analyzing === true):**
      - Loader2 with animate-spin + "Analyzing idea..." text
      - text-surface-400 text-sm

      **Error state (analysisError !== null):**
      - AlertCircle icon + error message text
      - text-red-400 text-sm
      - Suggestion: "Check that an AI provider is configured in Settings."

      **Analysis results panel (analysis !== null):**
      - Container: `bg-surface-800/50 border border-surface-700 rounded-lg p-4 space-y-3`
      - Each suggestion row is a flex between label+badge and "Apply" button:

      Effort row:
      ```tsx
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-surface-400">Suggested Effort:</span>
          <span className="px-2 py-0.5 bg-blue-500/20 text-blue-300 rounded text-xs font-medium">
            {analysis.suggestedEffort}
          </span>
        </div>
        <button
          onClick={() => setEffort(analysis.suggestedEffort)}
          className="text-xs text-primary-400 hover:text-primary-300"
        >
          Apply
        </button>
      </div>
      ```

      Impact row: same pattern, with `bg-amber-500/20 text-amber-300` badge.

      Feasibility: `<p className="text-sm text-surface-300">{analysis.feasibilityNotes}</p>`
      Rationale: `<p className="text-sm text-surface-300">{analysis.rationale}</p>`

      Dismiss button at bottom-right:
      ```tsx
      <button
        onClick={clearAnalysis}
        className="text-xs text-surface-500 hover:text-surface-300"
      >
        Dismiss
      </button>
      ```

      The "Apply" buttons should update the local form state for effort/impact
      (the same state variables bound to the dropdowns). The user must still click
      "Save" to persist — Apply only changes the dropdown value locally.

      ### 2. IdeaDetailModal.tsx — Add "Brainstorm This Idea" Button

      Add in the action buttons area (near "Convert to Project" / "Convert to Card" buttons):

      ```tsx
      <button
        onClick={handleBrainstormIdea}
        className="flex items-center gap-2 px-4 py-2 bg-surface-700 hover:bg-surface-600 text-surface-200 rounded-lg text-sm transition-colors"
      >
        <MessageSquare size={16} />
        Brainstorm This Idea
      </button>
      ```

      Handler:
      ```typescript
      const handleBrainstormIdea = async () => {
        try {
          // Create a new brainstorm session with the idea's title and project
          const session = await useBrainstormStore.getState().createSession({
            title: `Brainstorm: ${idea.title}`,
            projectId: idea.projectId || undefined,
          });

          // Load the session to make it active
          await useBrainstormStore.getState().loadSession(session.id);

          // Send an initial message describing the idea
          const description = idea.description
            ? `\n\n${idea.description}`
            : '';
          const tags = idea.tags?.length
            ? `\n\nTags: ${idea.tags.join(', ')}`
            : '';
          await useBrainstormStore.getState().sendMessage(
            `I'd like to brainstorm about this idea:\n\n**${idea.title}**${description}${tags}`
          );

          // Navigate to brainstorm page and close modal
          if (onNavigate) onNavigate('/brainstorm');
          onClose();
        } catch (error) {
          console.error('Failed to start brainstorm session:', error);
        }
      };
      ```

      NOTE: `useBrainstormStore.getState()` is the correct Zustand pattern for calling
      actions outside of React components or in event handlers. It accesses the store
      directly without hooks.

      ### 3. IdeasPage.tsx — Wire onNavigate prop

      Add import:
      ```typescript
      import { useNavigate } from 'react-router-dom';
      ```

      Inside the component:
      ```typescript
      const navigate = useNavigate();
      ```

      Pass to IdeaDetailModal:
      ```tsx
      <IdeaDetailModal
        // ... existing props
        onNavigate={(path) => navigate(path)}
      />
      ```

      ### File size note
      IdeaDetailModal is currently 672 lines. Adding ~80 lines for the analysis section
      + ~30 lines for the brainstorm button brings it to ~780 lines. This exceeds the
      500-line guideline but the code is logically cohesive (all idea detail features).
      Component extraction (IdeaAnalysisPanel) can be done in a future cleanup pass.
    </action>
    <verify>
      1. `npx tsc --noEmit` passes with zero errors
      2. "Analyze with AI" button is visible in IdeaDetailModal
      3. Loading state shows spinner + "Analyzing idea..." when analyzing
      4. Error state shows red message when analysis fails
      5. Analysis results panel shows effort + impact badges with "Apply" buttons
      6. "Apply" buttons update the dropdown values locally (not yet saved)
      7. "Dismiss" button clears the analysis panel
      8. "Brainstorm This Idea" button exists in the action buttons area
      9. Clicking "Brainstorm This Idea" creates a session, sends initial message, and navigates
      10. IdeasPage passes onNavigate prop to IdeaDetailModal
    </verify>
    <done>
      IdeaDetailModal has working AI analysis UI (analyze button, results with apply/dismiss,
      error handling) + "Brainstorm This Idea" cross-feature bridge. TypeScript compiles cleanly.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Sparkles and MessageSquare icons exist in lucide-react (standard icons)
      - useBrainstormStore.getState() works for imperative store access (standard Zustand pattern)
      - brainstormStore.createSession returns the session object with id
      - sendMessage can be called right after loadSession (session is set as active in store)
      - useNavigate is available from react-router-dom (already used in the app)
      - The effort/impact local state setters in IdeaDetailModal are named setEffort/setImpact
        (need to verify actual state variable names during execution)
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Enhanced Brainstorm Context Injection</n>
    <files>
      src/main/services/brainstormService.ts (enrich buildContext with cards, ideas, meeting briefs)
    </files>
    <preconditions>
      - Plans 6.1 and 6.2 complete (brainstormService.ts exists with buildContext)
      - Schema tables exist: cards, columns, boards, ideas, meetings, meetingBriefs
      - buildContext currently injects: project name, description, board names, meeting titles
    </preconditions>
    <action>
      ## WHY
      R10 requires the brainstorming agent to be "context-aware (knows about current project,
      cards, meetings)". Currently buildContext() only injects project name, board names, and
      meeting titles. This task enriches the system prompt with card data, idea data, and
      meeting brief summaries so the AI has richer context for brainstorming.

      ## WHAT

      ### 1. Update imports in brainstormService.ts

      Add to the schema import (the existing import already includes boards, meetings, ideas):
      ```typescript
      import {
        brainstormSessions, brainstormMessages,
        projects, boards, columns, cards, meetings, meetingBriefs, ideas,
      } from '../db/schema';
      ```

      Add to drizzle-orm import:
      ```typescript
      import { eq, desc, asc, and, inArray, not } from 'drizzle-orm';
      ```
      (Currently imports: eq, desc, asc. Add: and, inArray, not)

      ### 2. Rewrite buildContext() with enriched data + Promise.all

      Replace the entire buildContext function (lines 182-221) with:

      ```typescript
      /**
       * Build system prompt with project context.
       * Injects: project info, board names, card titles, idea data, meeting briefs.
       * Queries are parallelized where possible via Promise.all.
       */
      export async function buildContext(sessionId: string): Promise<string> {
        const db = getDb();

        const [session] = await db.select().from(brainstormSessions)
          .where(eq(brainstormSessions.id, sessionId));
        if (!session) return getBaseSystemPrompt();

        let context = getBaseSystemPrompt();

        if (!session.projectId) return context;

        const [project] = await db.select().from(projects)
          .where(eq(projects.id, session.projectId));
        if (!project) return context;

        context += `\n\n## Current Project: ${project.name}`;
        if (project.description) {
          context += `\nDescription: ${project.description}`;
        }

        // Parallel queries: boards, meetings, ideas
        const [projectBoards, projectMeetings, projectIdeas] = await Promise.all([
          db.select().from(boards)
            .where(eq(boards.projectId, project.id)),
          db.select({ id: meetings.id, title: meetings.title })
            .from(meetings)
            .where(eq(meetings.projectId, project.id))
            .orderBy(desc(meetings.createdAt))
            .limit(3),
          db.select({ title: ideas.title, status: ideas.status })
            .from(ideas)
            .where(and(
              eq(ideas.projectId, project.id),
              not(eq(ideas.status, 'archived')),
            ))
            .orderBy(desc(ideas.updatedAt))
            .limit(5),
        ]);

        // Board names + card titles per board
        if (projectBoards.length > 0) {
          context += `\n\n## Boards`;
          for (const board of projectBoards) {
            const boardColumns = await db.select({ id: columns.id })
              .from(columns).where(eq(columns.boardId, board.id));
            const columnIds = boardColumns.map(c => c.id);

            if (columnIds.length > 0) {
              const boardCards = await db.select({ title: cards.title })
                .from(cards)
                .where(and(
                  inArray(cards.columnId, columnIds),
                  eq(cards.archived, false),
                ))
                .orderBy(desc(cards.updatedAt))
                .limit(5);

              if (boardCards.length > 0) {
                context += `\n- ${board.name}: ${boardCards.map(c => c.title).join(', ')}`;
              } else {
                context += `\n- ${board.name} (no cards)`;
              }
            } else {
              context += `\n- ${board.name} (no columns)`;
            }
          }
        }

        // Recent ideas
        if (projectIdeas.length > 0) {
          context += `\n\n## Recent Ideas`;
          for (const idea of projectIdeas) {
            context += `\n- ${idea.title} (${idea.status})`;
          }
        }

        // Recent meetings with brief summaries
        if (projectMeetings.length > 0) {
          context += `\n\n## Recent Meetings`;
          for (const mtg of projectMeetings) {
            context += `\n- ${mtg.title}`;
            const [brief] = await db.select({ summary: meetingBriefs.summary })
              .from(meetingBriefs)
              .where(eq(meetingBriefs.meetingId, mtg.id))
              .orderBy(desc(meetingBriefs.createdAt))
              .limit(1);
            if (brief) {
              // Truncate brief to first 200 chars to keep context manageable
              const truncated = brief.summary.length > 200
                ? brief.summary.slice(0, 200) + '...'
                : brief.summary;
              context += ` — ${truncated}`;
            }
          }
        }

        return context;
      }
      ```

      ### 3. Update file header comments

      Update the LIMITATIONS section to reflect new capabilities:
      ```
      // === LIMITATIONS ===
      // - Context injection is read-only (project data -> system prompt, no tool calls)
      // - No message editing or deletion (append-only conversation)
      // - Card/idea/meeting context limited to most recent items to manage token usage
      ```

      Remove the old note about "buildContext queries are sequential" since we now
      use Promise.all for the main parallel queries.
    </action>
    <verify>
      1. `npx tsc --noEmit` passes with zero errors
      2. drizzle-orm imports include: eq, desc, asc, and, inArray, not
      3. Schema imports include: columns, cards, meetingBriefs (in addition to existing)
      4. buildContext uses Promise.all for boards, meetings, ideas queries
      5. Context includes board names with card titles (up to 5 per board)
      6. Context includes idea titles with status (up to 5, excluding archived)
      7. Context includes meeting titles with truncated brief summaries (up to 3)
      8. Empty states handled gracefully (boards with no columns, no cards, etc.)
      9. File header LIMITATIONS comment updated
    </verify>
    <done>
      Brainstorm context injection enriched with card titles per board, idea titles with status,
      and meeting brief summaries (truncated to 200 chars). Main queries parallelized with
      Promise.all. TypeScript compiles cleanly.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - `columns` table is exported from schema/boards.ts (verified in exploration)
      - `meetingBriefs` table is exported from schema/meetings.ts (verified in exploration)
      - `inArray` and `not` are exported from drizzle-orm (standard operators)
      - `cards.archived` field exists as boolean (verified: schema/cards.ts line 30)
      - `ideas.status` can be compared with `not(eq(..., 'archived'))` for filtering
      - Brief truncation at 200 chars keeps total context within reasonable token limits
      - Sequential card queries per board are acceptable (typically 1-3 boards per project)
    </assumptions>
  </task>
</phase>
