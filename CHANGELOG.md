# LifeDash Changelog

All notable changes per released version. Generated from git history; newest first.
Commit subjects are truncated to their headline clause — see `git log` for full rationale.

## v2.13.0 — 2026-09-04
- release: prep v2.13.0
- fix(recording): a meeting interrupted by a crash or a quit no longer says "Running..." forever — every launch now closes the sessions a previous process left open
- feat(speaker): who said what, locally — the mic becomes "Me" at capture time with no model, whisper is told the roster's names, and speaker labels reach the brief through one line-shape definition

## v2.12.0 — 2026-08-24
- release: prep v2.12.0
- fix(brain): the node-anchored inspector card is capped by its container, not the viewport
- fix(post-meeting): the brief is a peer tab, not a hero above the strip — Summary leads the completed-session tab set and opens selected
- feat(post-meeting): the brief becomes the destination after a meeting — stop lands on the brief, completion fills in place or reaches an away user as a desktop notification
- feat(brain): one person, one entity — diacritic-folded dedup key, a version-flagged merge sweep, and a user-confirmed merge for the judgment cases
- feat(brief): the built-in tier gets its first honest measured baseline and a bar set from it, not hoped
- feat(brief): attack local-tier brief quality at its measured causes, and fix the ruler first
- feat(brief): the brief becomes a judgment and the record stays complete
- feat(brief): the brief is written from a complete extracted record instead of compressed in one capped pass

## v2.11.0 — 2026-08-13
- release: prep v2.11.0
- feat(twin): a session is learned from even if its page is never opened — main-process auto-generation at the completion transition, plus the kept-fact provenance label nothing was reading
- feat(twin): the memory graph surface follows the app theme — one additive html.light block, dark values byte-identical
- docs(readme): current screenshot instead of the stale demo video, facts re-verified against v2.10.0
- chore(repo): untrack internal PLAN-*.md planning docs from the public repo

## v2.10.0 — 2026-08-07
- release: prep v2.10.0
- feat(ai): a long meeting always gets a brief — context-budgeted prompts with a chunked map-reduce fallback; the first-use model pick now governs every chat task
- test(ci): whisperModelManager EPERM round 2 — per-test case dirs, a used directory is never revisited
- test(ci): un-redden six days of CI — three environment-conditioned failures, all test-side

## v2.9.0 — 2026-08-07
- release: prep v2.9.0
- feat(ai): the built-in sidecar can no longer kill a generation to load another model
- feat(ai): a failed brief is a card, never food for the twin
- test(macos): pin the VAD-crash and code-signing fixes so they cannot silently regress
- docs: add full CHANGELOG.md covering all 68 released versions

## v2.8.0 — 2026-08-06
- release: prep v2.8.0
- feat(meetings): deleting a meeting now deletes its influence

## v2.7.1 — 2026-08-06
- fix(transcription): pass useGpu:false explicitly to VAD init
- release: prep v2.7.1
- fix(transcription): make VAD CPU-only on Windows/Linux
- fix(build): sign ad-hoc without hardened runtime
- fix(build): always codesign macOS bundles
- fix(transcription): disable whisper VAD on macOS

## v2.7.0 — 2026-08-05
- release: prep v2.7.0 notes
- feat(twin+transcription): riverbank memory graph, readable twin memory, and Whisper hallucination fix
- release: prep v2.7.0
- fix(meeting-assistant): ground answers in the meeting instead of the twin profile
- feat(meeting-assistant): clear the chat or start a new one with the old kept in archive
- feat(local-ai+session-ux): runtime telemetry, auto-activation and session rail
- chore(repo): stop publishing internal planning docs
- chore(repo): untrack Playwright test-results artifact and gitignore the directory
- feat(local-ai): LOCAL-RT.1

## v2.6.0 — 2026-08-01
- release: prep v2.6.0
- docs: bring README and repo metadata in line with the shipped app
- chore(license): switch AGPL-3.0 -> PolyForm Noncommercial 1.0.0 from 2.6.0 onward
- fix(calendar): drop the 📅 emoji from the ribbon title
- feat(calendar): CAL-UX.2b
- feat(calendar): CAL-UX.2
- docs(decisions): CAL-UX.2 scope for 2.6.0

## v2.5.0 — 2026-07-31
- feat(calendar): manual refresh button on the Upcoming meetings agenda
- feat(calendar): CAL-UX.1
- release: prep v2.5.0
- fix(intel): bookmark toggle for reader/brief articles, null-result rollback, invisible manual articles (Saved Links source disabled), Saved badge/list
- feat(brain-ux): entity fact profiles with provenance, post-meeting Q&A chat, Brain tree regrouping, collapsible transcript, Intel nav restore (BRAIN-U
- feat(calendar): always-visible Upcoming meetings list on Sessions home
- fix(calendar): surface real fetch errors instead of a false 'reauth' loop; poll immediately on connect
- feat(calendar): Phase G — Google + Microsoft calendar integration
- fix(test): stabilize TwinWebResearchSection's mount-wait target

## v2.3.1 — 2026-07-23
- release: prep v2.3.1 (v2.3.0 tag/release was already public with mismatched macOS assets)

## v2.3.0 — 2026-07-21
- feat(recording): inactivity auto-stop, transcription privacy enforcement, OFFICIAL_BUILD CI fix (GUARD.1)
- docs: rewrite README for v3 (2.3.0) — session-centric workspace, learning Digital Twin with auditable memory, Living Brain mind map + entities, loca
- fix(release): make 'gh release create' non-interactive via --generate-notes — the missing notes source made gh prompt + open $EDITOR, which aborted 
- feat(settings): live embedding-model dropdown for local providers (LM Studio/Ollama loaded models via checkLmStudio) + include Embedding in auto-assig
- release: prep v2.3.0 — bump package.json 2.2.40→2.3.0 and add the V3.3.6 orchestrated deep-creation release note (no tag/publish; local build+smok
- fix(db): externalize @electric-sql/pglite subpaths in vite.main so the pgvector extension bundle loads in Electron (was inlined to a broken data: URL 
- V3.4: Digital Twin — Learning Loop + Semantic Layer (final v3 phase): auditable twin_facts learning (provenance/forget/pause kill-switch, byte-ident
- V3.3.6: orchestrated deep twin creation (role research -> gap interview -> optional history -> merged review) + reasoning-model token-budget & wizard 
- V3.3.5: Digital Twin — Deep Creation: brief-seeded deep interview, history mining w/ per-run cloud consent, provider-native web research, Google Gem
- Checkpoint: V3.3 shipped (3ae2aa3) — add digital-twin SPEC.md behavior contract + gitignore graphify-out
- V3.3: Digital Twin — creation phase: twin_profile schema + budgeted profile injection into assistant/triage/briefs, Twin page, 8-step interview wiza
- V3.2: Living Brain — collapsible living mind map + in-canvas inspector; projects become session-only surfaces
- V3.1: Session Workspace & IA Collapse — the session becomes the app
- docs: v3 decisions — session-centric pivot, V3.1 planning choices, Brain as dynamic mind map (d3-hierarchy, supersedes force-graph)
- LIVE.2+LIVE.3: Live Mode — full-screen takeover with proactive proposals: live_suggestions schema + cadence-gated triage loop, proposal lifecycle IP
- LIVE.1: Live Assistant — in-meeting AI partner: meeting-agent schema + 4-tool service, streaming IPC bridge, global live drawer with transcript via 
- MEET-INTEL.1: meeting auto-flow — auto-push action items to Inbox column, project auto-detect, brief threading, Unassigned routing, smart dropdown, 

## v2.2.40 — 2026-04-18
- 2.2.40
- CODE-Q.1: Bronze code-quality remediation — break 4 circular deps, no-explicit-any error, add no-floating-promises + complexity:15 with legacy basel

## v2.2.39 — 2026-04-16
- 2.2.39
- fix: meeting UX — keep modal open on project select, add brief retry/regenerate, inline project create in dropdown

## v2.2.38 — 2026-04-15
- 2.2.38
- feat: add medium-q5 and large-v3-turbo-q5 Whisper models with Slovak and mixed-language presets for better CS/SK transcription

## v2.2.37 — 2026-04-14
- 2.2.37
- feat: auto-recover mic on disconnect and notify user via toast during recording
- fix: improve meeting brief prompt for better coverage with local models
- fix: show friendly error when local model context is too small for request

## v2.2.36 — 2026-04-12
- 2.2.36
- feat: local-model-friendly meeting briefs and action items

## v2.2.35 — 2026-04-12
- 2.2.35
- feat: add LM Studio as first-class AI provider with auto-detection
- chore: add artifact retention limits to CI and release workflows
- feat: multi-tab intelligence feeds with topic consolidation and per-feed briefs

## v2.2.34 — 2026-04-03
- chore: add fork-safety to v2.2.34 release notes
- feat: fork-safe release infrastructure — preflight checks, dynamic repo, gated auto-updater
- 2.2.34
- feat: add Czech and French transcription language support with language-aware AI prompts

## v2.2.33 — 2026-03-30
- 2.2.33
- fix: add sortOrder column mapping for project cloud sync
- chore: clean up repo — move internal docs, delete stray files, convert WAV to OGG

## v2.2.32 — 2026-03-29
- 2.2.32
- feat: add UI sound effects (click + hover) with title bar toggle

## v2.2.31 — 2026-03-29
- 2.2.31
- feat: add project view modes (grid/list) and drag-and-drop reordering
- chore: switch primary remote to lifedash (public), simplify release workflow

## v2.2.30 — 2026-03-28
- 2.2.30
- feat: add Ctrl+Shift+R quick record shortcut, fix shortcuts modal, toast on recording complete
- docs: prioritize Homebrew for macOS install, add xattr workaround for unsigned DMG
- fix(docs): use GitHub CDN URL for README video embed
- fix(docs): use full raw URL for README video embed
- docs: replace demo GIF with compressed MP4 video

## v2.2.29 — 2026-03-28
- 2.2.29
- fix(ci): restrict release workflow to private repo only
- fix: unpack GPU whisper native addons from asar and add missing CUDA/Vulkan variants to build

## v2.2.28 — 2026-03-28
- 2.2.28
- feat(intel): open saved briefs in slide-in modal instead of switching to feed view
- docs: label macOS as beta in README badge, platform table, and release assets
- feat(macos): add update modal with Homebrew command and download link
- refactor(ci): simplify release workflow to macOS-only (Windows built locally)
- feat(ci): add cross-platform release workflow triggered by version tags
- feat(macos): Info.plist permissions, Metal GPU Whisper, Homebrew tap, and README install instructions
- feat(macos): platform-gate build scripts, auto-updater, and add macOS CI job

## v2.2.27 — 2026-03-27
- 2.2.27
- feat(audio): transcription progress UI, parallel dispatch, speed presets, and GPU visibility
- chore: remove APP-DESCRIPTION.md from tracking and gitignore it
- chore: add app-description.md to gitignore

## v2.2.26 — 2026-03-27
- 2.2.26
- fix(intel): update Saved badge to show total count (bookmarks + pinned briefs) and load on mount
- fix(about): align creator name baseline with 'Created by' text
- feat(about): add creator name and LinkedIn link to Settings About section

## v2.2.25 — 2026-03-26
- 2.2.25
- fix(ux): move How does it work button to left of CTAs on all pages
- fix(ux): add in-memory cache to FeatureTip for instant dismiss/restore sync
- feat(intel): smart article ranking, feature tips, and app description
- docs: replace static screenshot with demo GIF in README
- chore: gitignore docs/demo-video (Remotion project)

## v2.2.24 — 2026-03-25
- 2.2.24
- fix(a11y): guard FocusTrap onDeactivate against React StrictMode unmount cycle
- perf(audio): stream WAV to disk during recording instead of accumulating in memory

## v2.2.23 — 2026-03-23
- 2.2.23
- fix(intel): decode HTML entities in RSS titles and briefs to display clean text
- fix(a11y): heading hierarchy, ARIA labels, command palette dialog role, and UX polish
- fix(auth): clear stored tokens on permanent refresh failure to stop retry loop

## v2.2.22 — 2026-03-19
- 2.2.22
- fix(intel): use markdown links in briefs for reliable article linking

## v2.2.21 — 2026-03-17
- 2.2.21
- fix(intel): prevent sync from deleting local RSS articles and briefs

## v2.2.20 — 2026-03-17
- 2.2.20
- fix(sync): use user_id,url as intel_items conflict target to fix upsert duplicate error
- fix(sync/intel): fix double RSS fetch race condition and intel_items URL conflict on sync
- fix(sync): fix xp_events pull column and intel_items URL duplicate conflict

## v2.2.19 — 2026-03-17
- 2.2.19
- fix: intel feed links/reader/sync and critical sync data-loss bug
- feat: account deletion — delete all remote data and auth user from settings
- feat(sync): add xp_events to sync config for Supabase SOT

## v2.2.18 — 2026-03-17
- 2.2.18
- fix: sync now button feedback, service init, and migration blockers
- fix: move handleClose ref after declaration to resolve TS2448/TS2454
- feat: brief history and pinning — save, browse, and pin intel briefs
- chore: remove production audit files from repo and gitignore them

## v2.2.17 — 2026-03-16
- 2.2.17
- fix: intel bookmark toggle in article preview + remove redundant trending row
- chore: fix all 79 eslint errors and warnings across codebase
- fix: prevent text overflow in brainstorm chat message bubbles
- fix: use targeted vi.stubGlobal for electronAPI to fix CI test failures on Node 20
- fix: add .npmrc with legacy-peer-deps for eslint 10 compat

## v2.2.16 — 2026-03-16
- 2.2.16
- feat: Intel Feed search, bookmarks view, and trending topics
- chore: production audit Gold — 256 new tests, file splitting, data deletion, memory monitoring, component tests, coverage thresholds
- chore: production audit remediation — DOMPurify, ESLint, Prettier, husky, privacy policy, CI hardening

## v2.2.15 — 2026-03-15
- 2.2.15
- fix: redirect all external links to system browser instead of spawning trapped Electron windows

## v2.2.14 — 2026-03-15
- 2.2.14
- polish: article reader typography overhaul — larger text, magazine-style header, better spacing and readability
- feat: Reddit comments in article reader — top 15 comments with nested replies via JSON API
- feat: clickable article titles in daily brief — open in-app reader from brief mentions
- fix: daily brief uses today's articles only, default filter 'today', tour update, setup wizard quick-start actions, source toggle refreshes feed, chat
- fix: source favicons, CSP img-src https, Reddit reader skip Readability
- fix: RSS feed robustness — Reddit JSON API, safe field extraction, ConfirmDialog FocusTrap removal
- fix: remove FocusTrap from Intel modals — was causing instant close on open
- feat: brief chat panel, improved brief typography, modal fixes, cursor-pointer audit
- feat: Intelligence Feed — RSS aggregation, AI briefs, magazine layout, in-app reader

## v2.2.13 — 2026-03-12
- 2.2.13
- fix: convert ISO date strings from Supabase to Date objects in sync pull, fix sync toggle checkbox

## v2.2.12 — 2026-03-12
- 2.2.12
- fix: prevent reconcileDeletes from wiping local data when remote is empty
- fix: backup restore — rehydrate dates correctly, upsert settings, reload UI after restore

## v2.2.11 — 2026-03-12
- 2.2.11
- fix: clear title bar sync status on sign-out via IPC event
- fix: use correct watermark column per table in sync pull queries

## v2.2.10 — 2026-03-11
- 2.2.10
- fix: refresh sync status after sign-in/sign-out so UI updates

## v2.2.9 — 2026-03-11
- 2.2.9
- fix: auth modal sign-up toggle not responding to clicks

## v2.2.8 — 2026-03-11
- 2.2.8
- feat: bidirectional sync, title bar indicator, auth modal redesign
- fix: vendor tslib for Supabase — resolves runtime module-not-found crash
- fix: externalize tslib in Vite main process build for Supabase
- fix: add tslib dependency for Supabase build

## v2.2.7 — 2026-03-11
- 2.2.7
- feat: add Supabase cloud sync — auth, sync engine, status UI, and schema
- fix: remove meeting prep section from recording project selector

## v2.2.6 — 2026-03-09
- 2.2.6
- feat: production hardening — 100% IPC validation, DB resilience, AI graceful degradation
- feat: add focus trapping for all modals, perf instrumentation, and Playwright E2E scaffolding
- feat: add file logging, crash recovery, and opt-in Sentry integration
- docs: rewrite README for more natural tone
- fix: use Rajdhani font for thread titles instead of monospace
- fix: nested button in thread bar, refresh badge on thread delete
- feat: add conversation threads to card and project agent panels
- fix: improve card agent prompts for lean card creation and persist lastSeenVersion before showing changelog
- feat: add automated demo video recording pipeline (Playwright + FFmpeg)
- docs: restructure README with download section, platform status, and meeting-first positioning
- chore: fix license discrepancy and add community templates

## v2.2.5 — 2026-03-08
- 2.2.5
- feat: add global font size scaling setting with Small/Default/Large/XL presets
- feat: add cancel option for meeting recording and voice input across all features

## v2.2.4 — 2026-03-07
- 2.2.4
- fix: bigger brainstorm chat text, shorter LLM responses with 1-2 examples

## v2.2.3 — 2026-03-07
- 2.2.3
- fix: user-friendly API key error messages in settings and setup wizard
- feat: add app icon above title in README

## v2.2.2 — 2026-03-07
- 2.2.2
- fix: resolve ArrayBufferLike type error in useVoiceInput
- fix: meeting card action items tag now updates when items are dismissed

## v2.2.1 — 2026-03-07
- 2.2.1
- feat: auto-detect GPU for Whisper transcription (Vulkan → CUDA → CPU fallback)
- feat: simplify language options to English and Multilingual (99 languages, auto-detect)
- fix: use Rajdhani body font for AI agent readable text and prose markdown
- feat: fix voice input transcription, improve Whisper accuracy, add model picker in settings
- fix: replace Web Speech API with MediaRecorder + native transcription backend for voice input in Electron
- feat: voice-to-text input for brainstorm chat, card description dictation, and comment voice input
- feat: idea modal matches card design; whats-new modal shows version history + GitHub changelog link; prevent overlay close on idea modal
- feat: conversational brainstorm UX with quick-reply chips, streaming markdown, and adaptive system prompt
- fix: card relationships show titles on add + cross-project picker; unique project copy names
- fix: focus overlay pause/stop unclickable + elapsed time calc robustness
- readme: add website link to lifedash.space
- license: switch from MIT to AGPL-3.0 with dual-licensing notice

## v2.2.0 — 2026-03-06
- 2.2.0
- improve: README with prominent download button and cleaner badge layout
- open source: remove licensing, update README, and clean repo for public release
- pivot: reposition app as meeting intelligence tool with privacy-first narrative

## v2.1.0 — 2026-03-06
- 2.1.0
- feat: add auto-assign button for model assignments with per-provider presets
- improve: feature discoverability, font consistency, and provider card layout

## v2.0.19 — 2026-03-05
- 2.0.19
- improve: remove checkboxes from action items — approve = selected for push
- improve: unify action items push UX with inline column picker

## v2.0.18 — 2026-03-05
- 2.0.18
- fix: standup button dropdown and AI generation

## v2.0.17 — 2026-03-04
- 2.0.17
- fix: prevent duplicate recurring cards on re-completion

## v2.0.16 — 2026-03-03
- 2.0.16
- fix: trial banner license button, local AI copy, and default theme

## v2.0.15 — 2026-03-03
- 2.0.15
- fix: ensure 14-day trial activates on fresh install

## v2.0.14 — 2026-03-02
- 2.0.14
- feat: redesign setup wizard with guided AI provider flow

## v2.0.13 — 2026-03-02
- 2.0.13
- fix: show What's New modal for existing users upgrading

## v2.0.12 — 2026-03-02
- 2.0.12
- feat: add "What's New" modal shown after app updates

## v2.0.11 — 2026-03-02
- 2.0.11
- fix: auto-open insights panel when clicking project scope toggle
- feat: consolidate AI insights across projects into single card
- fix: crash on AI settings tab and move project picker to dashboard
- fix: deduplicate AI insights and add per-project analysis selection

## v2.0.10 — 2026-03-01
- 2.0.10
- feat: improve AI Insights panel — clickable cards, collapsible, better UI
- fix: silence LICENSE_REQUIRED errors for non-Pro users and fix nested button
- fix: collapse AI Insights panel when not Pro or disabled
- feat: background agent infrastructure with stale card detection

## v2.0.9 — 2026-03-01
- 2.0.9
- fix: app now restarts after silent auto-update

## v2.0.8 — 2026-03-01
- 2.0.8
- fix: switch distribution from ZIP to 7z to avoid SmartScreen MOTW warning

## v2.0.7 — 2026-03-01
- 2.0.7
- fix: auto-updater checks lifedash.space instead of private GitHub API

## v2.0.6 — 2026-02-28
- 2.0.6
- fix: resolve medium/low code quality issues from review
- fix: resolve critical/high code quality and performance issues from review
- fix: auto-updater installs to current app directory via /DIR=
- feat: add ZIP distribution as primary download (no SmartScreen)
- fix: add gh CLI path discovery fallback to upload-release.js
- fix: Inno Setup build fixes (SourceDir, Flags, ISCC path discovery)

## v2.0.5 — 2026-02-28
- 2.0.5
- feat: replace Squirrel with Inno Setup installer and custom auto-updater
- feat: replace app logo with new premium pulse+chevron design
- feat: animated splash screen with inlined icon, square row, and 3s minimum
- fix: add LemonSqueezy API to CSP connect-src for license validation

## v2.0.4 — 2026-02-28
- 2.0.4
- docs: update release workflow to auto-publish draft via GitHub API

## v2.0.3 — 2026-02-28
- 2.0.3

## v2.0.2 — 2026-02-28
- 2.0.2
- chore: rename installer to LifeDash-{version}.exe, drop "Setup" from name
- docs: add customer installation guide and dual-remote push to RELEASING.md
- chore: add .gitattributes to exclude dev files from source archives

## v2.0.1 — 2026-02-28
- 2.0.1
- chore: add build artifact main.js to gitignore
- fix(ui): comprehensive light-mode consistency across 35 files
- fix(ui): consistent title font on Dashboard greeting and Focus header
- fix(ui): consistent section headers — left-align SYS labels, remove dividers
- feat(ui): shared HUD background across all main sections
- feat: add title bar update status indicator and release guide
- feat: add auto-update and GitHub Releases publisher (Plan W.1)
- feat: add Project Agent, Setup Wizard, and packaging improvements (Plans T.1–T.2)
- fix: ungate focus:get-time-report IPC — data display is free, only CSV export is Pro
- fix(ui): render HudSelect and HudDatePicker popovers via portal to prevent overflow clipping
- fix: convert dynamic imports to static in main process (Vite build path resolution)
- feat: add license security hardening — IPC gating, HMAC tamper detection, JS obfuscation (Plan Q.1)
- feat: wire LemonSqueezy store IDs, checkout URLs, and openExternal IPC
- feat: add licensing system with perpetual fallback model (Plan P.1)
- fix(ui): convert label dropdown to inline panel, fix overflow clipping
- fix(ui): replace remaining non-HUD patterns across all modals with design system tokens
- feat(ui): replace all native selects with HudSelect, align controls to HUD design system
- feat(ui): add interactive starfield and HUD grid background to dashboard
- fix(ui): align AI Agent panel and label dropdown with HUD design system
- fix(ui): reduce transcript search field width to align with content
- fix(ui): replace native dropdowns in meetings with HudSelect, fix search styling
- fix(ui): align meeting card with HUD design system tokens
- feat(ui): replace native date/select inputs with custom HUD components
- fix(ui): unify form fields, dropdowns, and buttons to HUD design system
- feat(cards): add drag-and-drop reordering to checklist items
- feat(cards): persist AI task breakdown across modal close, add delete/move
- fix(ui): make kanban grid background extend full height
- ci: add GitHub Actions workflow for lint and test on PR
- chore: bump version to 2.0.0 for public launch
- fix(ui): fix Add Idea button layout in ideas quick-add bar
- feat(ui): add magenta color theme for SYS.MEETINGS dashboard section
- fix(ui): unify quick-action button fonts and reduce size
- feat(ui): update logo and branding to V2 teal design
- fix(ui): remove corner-brackets from project and idea cards
- fix(ui): replace clip-path polygons with border-radius for rounded containers
- feat(ui): V2 design pattern adoption — eyebrows, ambient life, button system
- feat(ui): HUD design system overhaul — full sci-fi visual transformation
- chore: update author to Daniel Rieger
- docs: add hero screenshot and improve installation guide

