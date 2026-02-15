# Project Review: Living Dashboard

**Reviewed:** 2026-02-15
**Scope:** Full review (all 5 domains)
**NEXUS Version:** v3.0
**Previous Review:** 2026-02-13 (replaced)

---

## Executive Summary

### Overall Health: NEEDS ATTENTION

| Domain | Status | Key Finding |
|--------|--------|-------------|
| Code Quality | B | 8 files exceed 500-line limit; deprecated ScriptProcessorNode; N+1 queries in cards |
| Architecture | A- | Clean 4-layer Electron architecture; exemplary security; cards.ts monolith needs extraction |
| Documentation | B+ | Excellent planning docs + inline headers; missing CHANGELOG, troubleshooting, API reference |
| Test Coverage | D | 99 tests (5 files) cover only validation/utils; 0% on services, IPC, stores, components |
| Features | B+ | All 17 requirements delivered (99 pts); 12 quick wins for polish; brainstorm markdown is most visible gap |

### Top 5 Priorities

1. **Build test infrastructure and add critical-path tests** -- 5-10% coverage is dangerously low for an app handling recordings and AI operations. Services, stores, and IPC handlers are completely untested.
2. **Extract `cardService.ts`** -- The 531-line `cards.ts` IPC handler is the largest monolith, embedding the card-move algorithm, N+1 relationship queries, and activity logging. Extract to a testable service layer.
3. **Brainstorm markdown rendering** -- AI responses display raw markdown characters (`#`, `*`, `-`). This is the most visible polish gap and makes the flagship AI feature look broken. One dependency, one wrapper component.
4. **Close-during-recording guard** -- Closing the app during recording silently discards the session. A single `dialog.showMessageBox()` call prevents data loss.
5. **Reconcile outdated documentation** -- PROJECT.md still says "Docker required," REQUIREMENTS.md references wrong Whisper package, ROADMAP.md checkboxes are all unchecked despite Phases 1-9 being complete.

---

## Detailed Findings

### Code Quality

**Overall health: NEEDS ATTENTION**
**Files reviewed:** 161 | **Code smells:** 23 | **Technical debt items:** 7

#### Critical Findings

| Finding | Severity | Location |
|---------|----------|----------|
| Deprecated `ScriptProcessorNode` | HIGH | `src/renderer/services/audioCaptureService.ts:11` |
| 8 files exceed 500 lines | HIGH | ProjectPlanningModal (744), cards.ts (531), BoardPage (525), MeetingDetailModal (523), CardDetailModal (509) |
| 17 `any` type usages across 11 files | MEDIUM | ideaService, main.ts, taskStructuringService, transcriptionService, others |
| N+1 query in card relationships | MEDIUM | `src/main/ipc/cards.ts:367-401` (2N queries for N relationships) |
| 15 files use `console.log` instead of logger | MEDIUM | Renderer components and stores |
| Deep nesting (4+ levels) in 9 files | MEDIUM | CommandPalette, BoardPage, ProjectPlanningModal, others |
| Duplicated date formatting + priority color maps | LOW | MeetingDetailModal, CardDetailModal, BoardPage |

#### Technical Debt Register

| Item | Location | Severity | Effort |
|------|----------|----------|--------|
| ScriptProcessorNode -> AudioWorklet migration | audioCaptureService.ts | HIGH | 16-24h |
| N+1 query in card relationships | cards.ts:386-398 | MEDIUM | 2-4h |
| No pagination on list queries | cards.ts, meetings.ts, ideas.ts | MEDIUM | 4-8h |
| Migration path TODO for packaged app | migrate.ts:10,24 | MEDIUM | 4-8h |
| Hardcoded prompt templates | meetingIntelligenceService.ts | LOW | 8-12h |
| Whisper process isolation risk | transcriptionService.ts | LOW | 8-12h |
| No full-text search for ideas | ideaService.ts | LOW | 8-12h |

#### Positive Observations

- Excellent structured file headers on all 161 source files (`=== FILE PURPOSE ===`, `=== DEPENDENCIES ===`, `=== LIMITATIONS ===`)
- Strong TypeScript usage (only 17 `any` in 161 files = 89% type safety)
- Zero empty catch blocks
- All IPC inputs validated with Zod schemas
- SQL injection risk: zero (Drizzle ORM with parameterized queries)
- API keys encrypted via Electron safeStorage
- User-facing error messages are descriptive

---

### Architecture

**Architecture style:** Layered Electron with domain-driven IPC
**Coupling level:** LOW to MEDIUM
**Overall structure: CLEAN**

#### Strengths

1. **Exemplary Electron security** -- `contextIsolation: true`, `nodeIntegration: false`, CSP headers, Electron Fuses locked down (`RunAsNode: false`, `OnlyLoadAppFromAsar: true`), safeStorage for API keys
2. **Fully typed IPC boundary** -- `ElectronAPI` interface (228 lines) serves as single source of truth; `declare global { interface Window { electronAPI: ElectronAPI } }` gives full autocomplete
3. **Consistent IPC handler pattern** -- Every handler accepts `unknown`, validates with Zod, calls service/DB, returns typed result
4. **Clean preload decomposition** -- 13 domain bridges with cleanup functions for event listeners
5. **Zero inter-store coupling** -- All 10 Zustand stores are independent, no shared middleware
6. **Strong AI provider abstraction** -- Factory pattern with caching, per-task model routing, provider-specific quirk handling
7. **Proper Drizzle schema design** -- UUID PKs, FK cascades, composite PKs for junctions, enum types
8. **Well-configured build pipeline** -- 3 separate Vite configs, native modules properly externalized, lazy-loaded routes

#### Concerns

| Concern | Impact | Details |
|---------|--------|---------|
| `cards.ts` IPC handler monolith (531 lines) | MEDIUM | Embeds 6 sub-domains; card-move algorithm untestable without mocking ipcMain |
| Older handlers embed DB queries directly | MEDIUM | `projects.ts` (211 lines), `cards.ts` (531 lines) vs newer thin handlers like `ideas.ts` (54 lines) |
| IPC channel naming inconsistency | LOW | Mix of `cards:list-by-board` and `card:getComments` and `cards:getRelationshipsByBoard` |
| Flat component directory (35+ files) | LOW-MEDIUM | Only `settings/` subdirectory exists; at tipping point for navigability |
| Single board per project assumption | LOW | `boardStore` always takes `boards[0]`; schema supports multiple boards |
| No `getProject(id)` endpoint | LOW | `boardStore` loads all projects to find one by ID |

#### Scalability Assessment

**Will hold up:** 4-layer architecture, typed IPC contract, independent Zustand stores, Zod validation layer, AI provider abstraction, Drizzle + PGlite, lazy-loaded routes.

**Will NOT hold up:** Flat `window.electronAPI` object (~80 methods), `cards.ts` monolith, no pagination on list queries, sequential DB updates for position changes, flat component directory.

#### Dependency Flow (No Circular Dependencies)

```
Renderer (React) --> Zustand Stores --> window.electronAPI (typed)
       |
Preload (contextBridge) -- 13 domain bridges --> ipcRenderer.invoke
       |
Main Process -- IPC Handlers --> Services --> DB (Drizzle + PGlite)
                                          --> AI Provider
                                          --> Secure Storage
       |
Shared Layer (cross-process) -- Types, Validation (Zod), Utils
```

Import direction is strictly layered. Shared imports from nothing project-internal.

---

### Documentation

**Coverage: ADEQUATE (B+)**
**Onboarding readiness: NEEDS WORK (achievable in 15-30 min)**

#### What Exists (21 docs)

| Category | Files | Quality |
|----------|-------|---------|
| Strategic/Planning | PROJECT.md, REQUIREMENTS.md, ROADMAP.md, COMPETITIVE-ANALYSIS.md | Excellent |
| Technical Reference | CHEATSHEET.md (383 lines), docs/ARCHITECTURE.md (155 lines), docs/DEVELOPMENT.md (208 lines) | Good-Excellent |
| Session Management | STATE.md, PLAN.md, SUMMARY.md, HANDOFF.md, ISSUES.md | Good |
| Research | 5 docs in .planning/research/ | Good |
| Inline Code | Structured headers on all 161 source files | Excellent |

#### Gaps (ordered by impact)

| Gap | Impact | Fix Effort |
|-----|--------|------------|
| No CHANGELOG.md (10 phases, 50+ commits, no change history) | HIGH | 2-3h |
| No IPC/API reference (100+ channels documented only in source) | HIGH | 4-6h |
| No troubleshooting guide (runtime issues not covered) | MEDIUM-HIGH | 2-3h |
| No user guide (6 feature areas with no workflow docs) | MEDIUM | 4-6h |
| No CONTRIBUTING.md | MEDIUM | 1-2h |
| No LICENSE file | MEDIUM | 5 min |
| Limited JSDoc on ElectronAPI interface (100+ methods, no descriptions) | MEDIUM | 6-8h |
| No CI/CD documentation | LOW-MEDIUM | 2-3h |

#### Outdated Information

| File | Issue | Fix |
|------|-------|-----|
| PROJECT.md:38 | "Docker required for PostgreSQL" | Update to "PGlite (embedded WASM)" |
| PROJECT.md:29 | "Database: PostgreSQL (local via Docker)" | Update to "PGlite" |
| REQUIREMENTS.md:51 | References `@kutalia/whisper-node-addon` | Change to `@fugood/whisper.node` |
| ROADMAP.md | All phase checkboxes unchecked | Mark Phases 1-9 as `[x]` |
| CHEATSHEET.md:116 | Architecture shows "Framer Motion" | Removed in Plan 10.2 (d32a112) |

---

### Test Coverage

**Tests: 99 across 5 files | Framework: Vitest | Estimated coverage: 5-10%**
**Test health: CRITICAL**

#### Coverage Map

| Module/Area | Files | Unit | Integration | E2E |
|-------------|-------|------|-------------|-----|
| Utilities (date-utils, card-utils) | 2 | 100% | - | - |
| Validation (schemas, ipc-validator) | 2 | 100% | - | - |
| Types (MEETING_TEMPLATES) | 1 | Partial | - | - |
| IPC Handlers | 18 | 0% | 0% | 0% |
| Services (Main) | 23 | 0% | 0% | 0% |
| Zustand Stores | 10 | 0% | 0% | 0% |
| React Components | 42 | 0% | 0% | 0% |
| React Pages | 7 | 0% | 0% | 0% |
| Database Schema | 10 | 0% | 0% | 0% |

#### Test Quality (Where Tests Exist)

The existing 99 tests are **excellent quality:**
- `schemas.test.ts` (91 tests): Exhaustive validation with parameterized tests, boundary conditions, nullability checks
- `date-utils.test.ts` (7 tests): Fake timers, edge cases (overdue by 1ms), both label text and CSS class assertions
- `ipc-validator.test.ts` (13 tests): Valid/invalid paths, multi-error formatting, nested validation
- Zero flaky tests, sub-1s execution time

#### Critical Untested Risks

| Risk | Area | Impact if Bug |
|------|------|---------------|
| Recording failure / silent data loss | audioProcessor.ts, transcriptionService.ts | Users lose meeting recordings permanently |
| AI parsing failures | meetingIntelligenceService.ts, brainstormService.ts | Core AI features stop working |
| Card position corruption | cards.ts card-move algorithm | Kanban board becomes unusable |
| Database migration failures | migrate.ts | App won't start after upgrade |
| Optimistic update bugs | boardStore.ts moveCard() | UI out of sync with backend |

#### Missing Infrastructure

- Test environment is `node` (cannot render React components -- needs `happy-dom`)
- No coverage collection configured
- No React Testing Library installed
- No Playwright for E2E tests
- No Electron API mocks for store testing
- No test setup file with global mocks

---

### Features & Improvements

**Features assessed:** 17 | **Improvement opportunities:** 28 | **Quick wins:** 12
**Overall maturity: GROWING**

#### Quick Wins (High Value, Low Effort)

| # | Improvement | Impact | Effort |
|---|------------|--------|--------|
| 1 | **Brainstorm markdown rendering** -- AI responses display raw `#`, `*`, `-` | Highest visual impact | 1-2h |
| 2 | **Command palette data loading** -- entities not loaded until page visited | Ctrl+K appears broken | 30min |
| 3 | **Close-during-recording guard** -- no warning, recording silently lost | Data loss prevention | 30min |
| 4 | **Idea/Meeting sorting** -- no sort by date, name, or priority | Basic UX expectation | 1-2h |
| 5 | **Unarchive projects UI** -- archiving is one-way, no recovery path | Copy existing pattern from BrainstormPage | 30min |
| 6 | **Select element styling** -- browser defaults clash with dark theme | Visual consistency | 30min |
| 7 | **Status bar recording indicator** -- always-visible area underutilized | Better awareness | 1h |
| 8 | **Card count on board columns** -- standard Kanban expectation | Every Kanban tool has this | 15min |
| 9 | **Textarea auto-resize in brainstorm** -- fixed 1-row input for multi-line prompts | Better chat UX | 15min |
| 10 | **User-friendly error messages** -- raw `error.message` strings shown to users | Professional feel | 1-2h |
| 11 | **Consistent delete confirmations** -- 4 different patterns across app | UX consistency | 2-3h |
| 12 | **List pagination/virtual scrolling** -- unbounded queries for meetings, ideas | Performance at scale | 4-6h |

#### Strategic Improvements (Higher Effort)

| Improvement | Value | Effort |
|-------------|-------|--------|
| AI health monitoring + offline error recovery | Reduces silent failures | 8-12h |
| Per-entity data export (meeting as Markdown, board as CSV) | Workflow integration | 6-8h |
| Multi-language transcription (Whisper supports 99 languages) | Non-English users | 4-6h |
| Brainstorm context management (pin cards/ideas as context) | More effective AI | 8-12h |
| Dashboard / home overview page | Cohesive "what needs attention" view | 12-16h |
| Keyboard accessibility + ARIA compliance | Accessibility | 8-12h |
| Streaming for meeting brief generation | Eliminates "is it working?" | 4-6h |
| Recording pause/resume | Standard recorder expectation | 4-6h |

#### Security Posture

- **Strong:** CSP, contextIsolation, safeStorage encryption, Zod input validation, backup path traversal prevention, no nodeIntegration
- **Minor concern:** Proxy credentials stored in plaintext in settings table
- **Minor concern:** Non-transactional database restore (partial state risk on failure)

---

## Action Items

### Immediate (This Sprint)

- [ ] Install test infrastructure: `@testing-library/react`, `happy-dom`, `@vitest/coverage-v8`
- [ ] Configure vitest for React testing (environment: `happy-dom`, setup file with Electron API mocks)
- [ ] Add tests for card-move algorithm and AI response parsing (highest-risk untested code)
- [ ] Add `dialog.showMessageBox()` guard for closing during active recording
- [ ] Fix brainstorm markdown rendering (add `react-markdown` or similar)
- [ ] Fix command palette to load entity lists on app mount
- [ ] Add "Show Archived" toggle to ProjectsPage (copy pattern from BrainstormPage)
- [ ] Add card count badges to board column headers

### Short-term (Next 2-4 Weeks)

- [ ] Extract `cardService.ts` from `cards.ts` IPC handler (follow ideaService pattern)
- [ ] Extract `projectService.ts` from `projects.ts`
- [ ] Add sorting dropdowns to IdeasPage and MeetingsPage
- [ ] Add tests for audioProcessor, transcriptionService, AI provider, Zustand stores
- [ ] Standardize `<select>` element styling across all dark-theme pages
- [ ] Reconcile outdated docs: PROJECT.md Docker refs, REQUIREMENTS.md Whisper package, ROADMAP.md checkboxes
- [ ] Create CHANGELOG.md from git history
- [ ] Normalize IPC channel naming to `plural-domain:kebab-case-verb`
- [ ] Migrate `console.log` to logger in 15 renderer files
- [ ] Fix N+1 query in card relationship enrichment (batch with `inArray`)
- [ ] Organize components into feature subdirectories (board/, meetings/, ideas/, brainstorm/, layout/, shared/)

### Long-term (Future Planning)

- [ ] Migrate ScriptProcessorNode to AudioWorklet (16-24h)
- [ ] Add pagination to list queries (meetings, ideas, brainstorm sessions)
- [ ] Achieve 60% test coverage with service + store + component tests
- [ ] Add Playwright E2E tests for critical user flows
- [ ] Set up CI/CD with GitHub Actions (test + coverage on push)
- [ ] Create docs/TROUBLESHOOTING.md and docs/API.md
- [ ] Add streaming to meeting brief generation
- [ ] Add recording pause/resume
- [ ] Implement dashboard/home overview page
- [ ] Eliminate all 17 `any` type usages

---

## Metrics Snapshot

| Metric | Value |
|--------|-------|
| Source files | 161 (.ts/.tsx) |
| Test files | 5 |
| Tests passing | 99/99 |
| Doc files | 21 |
| TODO/FIXME count | 2 (both in migrate.ts) |
| Dependencies (prod) | 24 |
| Dependencies (dev) | 16 |
| `any` type usages | 17 |
| Files > 500 lines | 5 |
| Files > 400 lines | 8+ |
| Console.log files | 15 |
| IPC channels | ~100 |
| Zustand stores | 10 |
| DB tables | 18+ |
| Test coverage (est.) | 5-10% |
| Empty catch blocks | 0 |
| SQL injection risk | 0 |

---

## Previous Review Comparison (Feb 13 -> Feb 15)

Since the last review (2026-02-13), the following items have been addressed:
- README.md created (126 lines)
- docs/ARCHITECTURE.md created (155 lines)
- docs/DEVELOPMENT.md created (208 lines)
- CHEATSHEET.md created (383 lines)
- IPC input validation added (Zod schemas on all handlers)
- Structured logging added (logger service)
- Monolithic preload.ts split into 13 domain modules
- Single shared types file split into 17 domain type modules
- Content Security Policy enforced
- Command palette added (Ctrl+K)
- 99 tests added (from 0)

Items still outstanding from previous review:
- Test coverage remains critically low (5-10% vs recommended 60%+)
- Large file refactoring not yet done
- CHANGELOG.md still missing
- AudioWorklet migration still pending

---

Reviewed by NEXUS Project Review (5 parallel agents: code-reviewer, architecture/Opus, documentation/Sonnet, test-runner, features/Opus)
