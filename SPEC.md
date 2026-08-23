# Behavior Specification

<!-- This is a LIVING behavior register for the whole project — a single flat file. -->
<!-- A spec is a behavior CONTRACT, not an implementation plan. -->
<!-- If implementation can change without changing externally visible behavior, it doesn't belong here. -->
<!-- Avoid: internal class/function names, library choices, step-by-step implementation details. -->
<!-- Add new behaviors by appending another `### Requirement:` block under `## Requirements`. -->
<!-- A requirement with the SAME name is UPDATED in place, never duplicated — this file is a register, not a log. -->

## Purpose

LifeDash is a session-centric, local-first meeting-intelligence app. This register holds behavior contracts per domain. It covers the **Digital Twin** domain (V3.3 + V3.3.5 "Deep Creation"): the user profile that personalizes every AI surface, how it is authored — manually or via the deep-creation paths (deep interview, history mining, web enrichment) — and how the app behaves with and without it. It also covers the **V3.4 living layer**: the twin that keeps learning from finished sessions (auditable memory with a safety triad), semantic search with a grounded "Ask", the embedding index (local-by-default, no silent cloud), and the Brain's first flat person/topic entities. It also covers the **Recording Guard** domain (GUARD.1): the inactivity auto-stop safeguard for forgotten recordings, and the transcription-provider privacy controls (local-only enforcement, cloud-switch consent). It also covers the **Meeting Brief** domain (BRIEF-QUAL.1): how a finished session's brief and action items are produced from a complete structured record of what was said, who they name, in which language, and how a long meeting stays complete on any model.

## Requirements

### Requirement: Twin profile authoring works fully without AI

The creation wizard SHALL open on a mode-choice screen where the user writes an optional free-form brief and picks one of three ways to build their twin — **Quick form** (manual), **Deep interview**, or **Build from my history**. The **Quick form** is a guided multi-step flow (identity → domain → projects → people → vocabulary → goals → preferences → review) in which every step is completable by manual form entry alone; it MUST always be available and MUST NEVER be gated or require AI. AI assistance MUST be optional and MUST NOT be required to complete any step or the wizard. Whichever path is chosen, the profile is saved only from the review step — nothing auto-saves.

#### Scenario: Manual creation end-to-end

- GIVEN no twin profile exists
- WHEN the user opens the Twin section, chooses "Create your twin", picks the Quick form, fills steps manually, and confirms the review step
- THEN the profile is saved with the entered sections
- AND the review step shows what the twin now knows before saving

#### Scenario: Refinement pre-fills, never restarts

- GIVEN a twin profile already exists
- WHEN the user relaunches the wizard and enters the Quick form
- THEN every step is pre-filled with the existing profile values for editing
- AND clearing a field or section in the wizard persists the clear on save

#### Scenario: A deep-path draft never overwrites unsupplied existing sections

- GIVEN a twin profile already exists (e.g. with identity and preferences set)
- WHEN a deep-creation path (interview / history / web) produces a draft that supplies only SOME sections
- THEN the review is seeded by merging the supplied sections over the existing profile, and saving preserves every section the draft did not supply (they are not wiped to empty)

---

### Requirement: "Interview me" AI drafts are suggestions that degrade gracefully

When the user invokes the optional "Interview me" assist on a wizard step, the app SHALL turn their free-form answer into DRAFT field values that the user can edit before continuing; the form remains the source of truth. If no AI model is configured, or the AI response is unusable after one retry, the app MUST leave the step in manual mode with a non-blocking notice — an AI failure MUST NEVER block wizard progress or surface as an error state.

#### Scenario: Draft filled from a free-form answer

- GIVEN the user is on a wizard step with a configured local model
- WHEN they describe themselves in free text via "Interview me"
- THEN the step's fields are filled as editable drafts
- AND nothing is saved until the user proceeds through review

#### Scenario: No model configured

- GIVEN no AI model is available for the interview task
- WHEN the user invokes "Interview me"
- THEN the app shows a "fill manually" notice and the step stays fully usable

---

### Requirement: Twin profile is viewable and editable outside the wizard

The Twin section SHALL display the saved profile as editable section cards (identity, domain, projects, people, vocabulary, goals, preferences), each saveable independently. With no profile, the section SHALL show a prominent creation call-to-action instead. A "Memory" tab MAY be present as a placeholder until twin learning ships.

#### Scenario: Section edit round-trip

- GIVEN a saved profile
- WHEN the user edits one section and saves it
- THEN only that section's values change and the rest of the profile is untouched

#### Scenario: Empty state

- GIVEN no profile exists
- WHEN the user opens the Twin section
- THEN a "Create your twin" call-to-action is shown in place of profile cards

---

### Requirement: AI surfaces are profile-aware, and provably unchanged without a profile

The live assistant, in-meeting triage, and meeting briefs/action-item extraction SHALL include a clearly-delimited summary of the twin profile in their prompts, sized to a strict per-task budget that prioritizes the sections most relevant to each task and trims at whole-section boundaries (never mid-sentence). The profile MUST be read at prompt-build time, so an edit applies to the very next AI call without restart. With no profile saved, every prompt MUST be byte-identical to pre-twin behavior. A failure to load the profile MUST NOT break or block any AI request.

#### Scenario: Profile terms reach the assistant

- GIVEN a saved profile containing vocabulary and project names
- WHEN a meeting runs and the assistant, triage, or brief generation is invoked
- THEN each prompt contains the profile block within its task's budget

#### Scenario: Edit applies on the next call

- GIVEN a meeting is in progress
- WHEN the user edits a profile section
- THEN the next AI prompt reflects the edited profile without restarting the app or the session

#### Scenario: No profile — no behavior change

- GIVEN no twin profile has ever been saved
- WHEN any AI surface builds its prompt
- THEN the prompt is byte-identical to the pre-twin implementation

---

### Requirement: Twin interview model routing is user-configurable

The interview draft task SHALL default to the same model as the live assistant, and the user MAY route it to a different model via the task-model settings without affecting other tasks.

#### Scenario: Default inheritance

- GIVEN the user has configured a model for the live assistant and none for the twin interview
- WHEN an interview draft is requested
- THEN the live assistant's model serves it

#### Scenario: Split routing

- GIVEN the user assigns a distinct model to "Twin Interview Assist" in settings
- WHEN an interview draft is requested
- THEN the assigned model serves it and the live assistant's routing is unchanged

---

### Requirement: Deep interview drafts a profile, review-gated and failure-tolerant

The wizard's "Deep interview" mode SHALL conduct an adaptive, brief-seeded conversation that asks ONE focused follow-up question per turn, capped at no more than 8 questions, and MUST let the user Skip any question or Finish at any time. When the interview ends, the app SHALL synthesize the answers into a DRAFT profile that seeds the wizard's editable review — nothing is saved until the user confirms review. If no model is configured, or questioning/synthesis fails after one retry, the mode MUST degrade to a non-blocking notice offering the manual Quick form; an AI failure MUST NEVER block creation, surface as an error state, or forward a draft into a review the user has already navigated away from.

#### Scenario: Adaptive, capped, finish-anytime

- GIVEN the user starts a deep interview seeded by their brief
- WHEN they answer, skip, or choose "Finish now"
- THEN each turn asks at most one new question, never exceeding 8, and finishing synthesizes a draft from the answers gathered so far

#### Scenario: Draft is review-gated

- GIVEN a completed or finished-early deep interview
- WHEN synthesis succeeds
- THEN the drafted sections seed the wizard's editable review and nothing is saved until the user confirms

#### Scenario: AI failure degrades to manual

- GIVEN no model is configured, or the interview cannot continue
- WHEN the user is in the deep interview
- THEN a non-blocking notice offers the manual Quick form and no error state blocks them

---

### Requirement: History mining is consent-gated and sends nothing undisclosed

The wizard's "Build from my history" mode SHALL mine the user's OWN local data — recent meeting transcript excerpts, meeting briefs, project names/descriptions, and card titles — into a source-attributed DRAFT profile, and MUST NOT save anything without review. Before any run that would route to a CLOUD model, the app SHALL present a per-run consent dialog stating the exact counts of each data kind and the provider they would be sent to, with explicit Confirm and Cancel; this dialog MUST appear on EVERY cloud run (no remember-me). Runs on a LOCAL model MUST NOT prompt and MUST keep all data on-device. The consent descriptor MUST be computed with ZERO model calls, and the data a run actually sends MUST NOT exceed what the descriptor enumerates — nothing else leaves the machine. When no model is configured, the mode MUST show a non-blocking notice and send nothing, because there is no destination.

#### Scenario: Cloud run requires per-run consent

- GIVEN the resolved mining model is a cloud model
- WHEN the user starts a mining run
- THEN a dialog states the exact counts + provider, nothing is sent until the user confirms, and the dialog is shown again on every subsequent run

#### Scenario: Local run never prompts

- GIVEN the resolved mining model runs on-device
- WHEN the user starts a mining run
- THEN mining runs immediately with no consent dialog and no data leaves the machine

#### Scenario: Draft is source-attributed and review-gated

- GIVEN a successful mining run
- WHEN the draft is produced
- THEN the sources it drew from are shown, and the draft seeds the editable review without auto-saving

---

### Requirement: Web enrichment is provider-native, cited, and confirm-before-run

Web enrichment SHALL be offered ONLY when the resolved twin-creation model is a frontier cloud provider whose installed adapter natively supports server-side web search; otherwise the app MUST show an honest "not available" state with no query inputs and MUST NEVER fabricate results. Before running, the app SHALL show the exact outgoing query (company / industry) for an explicit Confirm. A successful run's drafted values MUST carry visible citations to the sources actually used, and the draft MUST be review-gated (nothing auto-saves). A provider without a web-search tool MUST resolve to an honest "unsupported" outcome rather than a fabricated one.

#### Scenario: Present only when natively supported

- GIVEN the resolved model is not a frontier cloud provider with a web-search tool
- WHEN the user opens the "Build from my history" mode
- THEN the web-enrichment section shows an honest "needs a frontier cloud provider" absence with no query inputs

#### Scenario: Confirm-before-run with citations

- GIVEN a frontier cloud model with a web-search tool
- WHEN the user enters a company/industry and confirms the shown query
- THEN the web search runs and any drafted values carry visible source citations, review-gated

---

### Requirement: Deep creation warns without a state-of-the-art model, but never blocks

When the resolved creation model is NOT a frontier cloud model, the mode-choice screen SHALL inform the user, unmissably, that the deep creation paths are a one-time, low-cost, quality-critical step best served by a state-of-the-art model — GPT (OpenAI), Claude (Anthropic), or Gemini (Google). The notice MUST offer a one-tap switch to the best CONFIGURED frontier model (writing the same twin-interview task-model setting the Settings row writes) when one exists, or a pointer to Settings when none is configured, AND an explicit "continue with local model anyway" escape. Deep creation MUST NEVER be hard-blocked, and the manual Quick form MUST NEVER be gated.

#### Scenario: Warn + one-tap for a configured frontier

- GIVEN a non-frontier resolved model and a configured frontier provider
- WHEN the user views the deep paths
- THEN a notice names GPT / Claude / Gemini and offers a one-tap switch to the configured frontier model plus a "continue with local model anyway" escape

#### Scenario: No frontier configured points at Settings

- GIVEN a non-frontier resolved model and NO configured frontier provider
- WHEN the user views the deep paths
- THEN the notice points at Settings to set one up, and "continue with local model anyway" still proceeds into the deep path

#### Scenario: Quick form is never gated

- GIVEN any resolved model, frontier or not
- WHEN the user views the mode choice
- THEN the Quick form is always directly startable with zero AI

---

### Requirement: The twin learns from finished sessions with immediate apply and a safety triad

After a session's brief is generated, the twin SHALL learn a small number of durable, discrete FACTS about the user's world (people, projects, preferences, domain, commitments). Learning MUST be extracted ONLY from already-distilled, session-scoped material — the session brief with its stored record, and the suggestions the user ACCEPTED live — and MUST NEVER read the raw transcript and MUST NEVER run live during a meeting. A learned fact SHALL be applied IMMEDIATELY (no approval queue), and MUST carry the full **safety triad**: (1) per-fact PROVENANCE to the source session, (2) a one-tap FORGET, and (3) a global learning PAUSE kill-switch. Learning MUST be error-isolated — a learning failure can NEVER fail or delay brief generation.

#### Scenario: Facts are learned post-session and applied immediately

- GIVEN learning is not paused and a session brief was just generated
- WHEN the post-session learning runs
- THEN a bounded set of durable facts is stored, each linked to its source session, and each becomes active immediately with no approval step

#### Scenario: Learning never touches the raw transcript or runs live

- GIVEN a session in progress
- WHEN the meeting is being recorded/transcribed
- THEN no fact extraction runs, and when it does run post-session it reads only the brief + accepted suggestions, never the raw transcript

#### Scenario: Pause is a real kill-switch

- GIVEN the user has paused learning
- WHEN a session finishes
- THEN no facts and no entities are extracted, and injection stops using learned facts — until the user resumes

#### Scenario: A learning failure never harms the brief

- GIVEN fact/entity extraction throws or the model is unavailable
- WHEN the post-session hook runs
- THEN the brief is unaffected and the failure is swallowed (the session still completes normally)

---

### Requirement: A forgotten fact is never silently re-learned

When the user FORGETS a fact, it MUST be excluded from every consumer prompt AND MUST NOT be silently re-learned as a new active fact on a later session — even if the model re-emits the same statement. The forgotten content MUST be used only as a post-generation dedupe FILTER and MUST NEVER be disclosed back to the model (it MUST NOT appear in any prompt, including the "already known" exclusion list). A forgotten fact remains restorable by the user.

#### Scenario: Re-emitting a forgotten fact does not resurrect it

- GIVEN the user previously forgot a specific fact
- WHEN a later session's extraction re-emits that same fact
- THEN it is dropped (not re-inserted as active) and its text never appears in the extraction prompt

---

### Requirement: Byte-identical guarantee for an un-personalized install

With NO twin profile AND no active learned facts (or with learning paused), every consumer prompt (assistant, triage, briefs) MUST be BYTE-IDENTICAL to the pre-twin baseline. Personalization is strictly additive: the profile block and the "learned from sessions" block are injected ONLY when there is something to inject and learning is active.

#### Scenario: Empty twin changes nothing

- GIVEN no profile is set and there are no active facts (or learning is paused)
- WHEN any assistant/triage/brief prompt is built
- THEN the prompt is exactly what it would have been before the twin existed

---

### Requirement: Semantic search is hybrid, degrades gracefully, and Ask is grounded-only

Search SHALL fuse full-text and vector (semantic) retrieval so a paraphrase finds relevant sessions/cards that keyword search alone would miss. When the semantic layer is absent — no embedding model, an empty index, or an embedding-model mismatch — search MUST DEGRADE to exactly today's full-text results plus a non-blocking notice, and MUST NEVER surface an error. The "Ask" answer MUST be GROUNDED-ONLY: it answers strictly from the user's retrieved sessions with visible citations, returns an honest "I don't find that in your sessions" when the retrieved context does not answer, and MUST NEVER fabricate. No model / empty context / generation failure MUST degrade to plain results (no answer), never an error.

#### Scenario: Paraphrase finds what keyword misses

- GIVEN the index is populated and an embedding model is configured
- WHEN the user searches with wording that does not lexically match the source
- THEN semantically-related sessions/cards are returned (flagged as semantic hits) that a pure full-text search would not surface

#### Scenario: Degrades to full-text when the semantic layer is unavailable

- GIVEN no embedding model, an empty index, or an embedding-model mismatch
- WHEN the user searches
- THEN results are exactly today's full-text results plus a non-blocking notice — never an error

#### Scenario: Ask is honest and cited

- GIVEN a query whose answer is present in the user's sessions
- WHEN the user asks
- THEN a cited answer grounded in those sessions is returned
- AND WHEN the retrieved context does not contain the answer, an honest "I don't find that in your sessions" is returned with no fabricated content

---

### Requirement: Embeddings are local by default and never silently sent to the cloud

Bulk embedding of briefs/cards/transcripts MUST default to a LOCAL model so indexing keeps the app's local-first promise. A CLOUD embedding model MUST require an explicit, visible Settings choice, and at the point of that choice the UI MUST WARN — unmissably — that the user's briefs/transcripts/cards will be sent to that provider (a local choice states the data stays on the device). The index MUST record the embedding model it was built with and, on a model MISMATCH, MUST surface a rebuild affordance rather than mixing incompatible vector spaces.

#### Scenario: Cloud embedding is a visible, warned choice

- GIVEN the user is choosing an embedding model in Settings
- WHEN they select a cloud provider
- THEN an at-the-point-of-choice warning states that briefs/transcripts/cards will be sent to that provider (and a local choice states the data stays on-device)

#### Scenario: Model mismatch surfaces a rebuild, never a mixed index

- GIVEN the index was built with one embedding model and the configured model now differs
- WHEN search runs or Settings is viewed
- THEN a rebuild affordance is surfaced and vectors from different models are not mixed

---

### Requirement: The Brain grows flat person/topic entities — no entity-entity relationships

Post-session extraction SHALL resolve the concrete PEOPLE and TOPICS a session was about into flat entities, each LINKED to the session(s) it appeared in (provenance), deduped so one real person/topic is a single entity across sessions. These entities SHALL appear in the Brain map (styled distinctly by kind) with entity→session edges, and selecting an entity SHALL show the sessions it is linked to. Entity extraction IS learning (it obeys the same pause kill-switch and post-session-only rule) and MUST be error-isolated. The v3 layer is deliberately FLAT: there MUST be NO typed entity-to-entity relationships (that exceeds a local model's reliable reach and is a later, possibly cloud-escalated phase).

#### Scenario: A session's people/topics become linked entities

- GIVEN learning is active and a session brief exists
- WHEN entity extraction runs
- THEN the session's concrete people/topics are stored as flat entities and linked to that session, deduped against existing entities

#### Scenario: The Brain shows entities threaded across sessions

- GIVEN entities linked to one or more sessions
- WHEN the user opens the Brain and selects an entity node
- THEN the entity is shown (styled by person/topic kind) with the sessions it is linked to across the workspace

#### Scenario: No entity-to-entity relationships in v3

- GIVEN the flat-entity layer
- WHEN entities are extracted and rendered
- THEN only entity↔session links exist — no typed relationships between entities are produced or stored

---

### Requirement: Entity Knowledge & Post-Meeting Chat

Entity fact extraction SHALL attach, to every stored fact, the source session it was extracted from — the same provenance the twin's session-level learning already provides — and each fact MUST be individually deletable ("forget") without affecting any other fact on that entity or on any other entity. Analyzing an entity's PAST sessions to backfill facts MUST be user-initiated only; the app MUST NEVER run this analysis automatically in the background, on load, or on a schedule. The post-meeting chat available on a finished session MUST NOT expose any side-effect tool — no card creation, no board mutation, no fact writes — it is answer-only, grounded in that session's transcript and context. A session's transcript section SHALL default to collapsed and MUST auto-expand when the user arrives via a search deep-link that points into the transcript. A fact-extraction failure MUST surface as a typed error, and MUST NEVER fabricate a fact to mask the failure.

#### Scenario: A fact is provenance-linked and independently forgettable

- GIVEN an entity has multiple stored facts from different sessions
- WHEN the user forgets one fact
- THEN only that fact is removed and every other fact — on that entity and on other entities — is unaffected

#### Scenario: History analysis never runs unattended

- GIVEN an entity with past sessions not yet analyzed for facts
- WHEN no user action has requested analysis
- THEN no backfill extraction runs — analysis starts ONLY when the user explicitly triggers it

#### Scenario: Post-meeting chat cannot take side-effect actions

- GIVEN a finished session's post-meeting chat
- WHEN the user asks a question
- THEN the assistant may only read transcript/context — no tool that creates, moves, or mutates a card, board, or fact is ever offered

#### Scenario: Transcript collapses by default, expands for a deep-link

- GIVEN a session detail page opened normally
- WHEN the page loads
- THEN the transcript section starts collapsed
- AND WHEN the user arrives via a search result that deep-links into the transcript
- THEN the transcript section is auto-expanded to show the matched location

#### Scenario: Extraction failure is honest, never fabricated

- GIVEN entity fact extraction throws or the model is unavailable
- WHEN the failure occurs
- THEN a typed error state is surfaced and no fact is invented to fill the gap

---

### Requirement: Recording auto-stop warns first, is one-action cancellable, and stays on the clean stop path

A recording session SHALL monitor for sustained audio silence and, after a configurable threshold (default 10 minutes, adjustable 2-120), MUST warn the user with a visible countdown before taking any stopping action — it MUST NEVER stop a recording silently. The warning MUST be cancellable in a single action ("Keep recording") that cancels the countdown and returns the session to normal monitoring with no interruption. If the countdown elapses unattended, auto-stop MUST invoke the SAME clean stop path used by a manual stop (audio saved, meeting finalized, normal processing) — never a distinct or partial teardown. The feature MUST be disableable via a settings toggle and defaults to enabled.

#### Scenario: Warning precedes any stop action

- GIVEN a recording is active and audio has been silent for the configured threshold
- WHEN the threshold is reached
- THEN a warning banner and notification start a fixed countdown and no stop action occurs yet

#### Scenario: One-action cancel resumes monitoring

- GIVEN the auto-stop countdown is running
- WHEN the user chooses "Keep recording"
- THEN the countdown is cancelled in that single action and monitoring resumes with no recording interruption

#### Scenario: Unattended countdown uses the normal clean stop path

- GIVEN the countdown expires with no user action
- WHEN auto-stop fires
- THEN the recording stops via the same path as a manual stop (audio saved, meeting finalized) and the user sees a distinct "auto-stopped" confirmation

#### Scenario: Auto-stop is disableable

- GIVEN the user turns off auto-stop in Settings
- WHEN a recording runs silent for any duration
- THEN no warning or stop occurs

---

### Requirement: Local-only transcription blocks all cloud audio transmission

When the local-only transcription setting is enabled, the app MUST NOT transmit meeting audio to any network transcription service, regardless of which provider is otherwise configured or selected. This MUST be enforced at every site that can dispatch audio off-device (transcription start, live voice input, and speaker diarization) and MUST be enforced in the MAIN process, not only reflected in UI state — a privacy control that UI state alone enforces is not a real control. A previously configured cloud provider MUST be overridden to local Whisper for the recording; an operation with no local equivalent (e.g. diarization) MUST be blocked outright rather than silently allowed through.

#### Scenario: Local-only overrides an active cloud provider

- GIVEN local-only transcription is enabled and a cloud provider is selected
- WHEN a recording starts
- THEN transcription runs on local Whisper and no audio is sent to the cloud provider

#### Scenario: An operation with no local fallback is blocked, not silently degraded

- GIVEN local-only transcription is enabled
- WHEN an operation with no local equivalent (e.g. speaker diarization) would otherwise dispatch audio to a cloud provider
- THEN the operation is blocked rather than allowed to leak audio

---

### Requirement: Switching to a cloud transcription provider requires explicit consent

Every switch of the active transcription provider from local Whisper to a cloud provider SHALL require the user's explicit, per-switch consent via a dialog that names the destination provider; the switch MUST NOT be persisted before the user confirms, and declining MUST leave the provider on local. This consent gate is per-SWITCH, not per-recording — it MUST appear on every local-to-cloud transition, with no "don't ask again" option.

#### Scenario: Cloud switch requires confirmation

- GIVEN the active provider is local Whisper
- WHEN the user selects a cloud provider
- THEN a consent dialog names the provider and nothing is persisted until the user confirms

#### Scenario: Declining keeps the provider on local

- GIVEN the consent dialog is shown for a cloud switch
- WHEN the user cancels or dismisses it
- THEN the active provider remains local and no data is sent

#### Scenario: Local-only blocks the switch before consent is even reachable

- GIVEN local-only transcription is enabled
- WHEN the user attempts to select a cloud provider
- THEN the cloud option is disabled and rejected, and the consent dialog never needs to be shown

---

### Requirement: Calendar integration is read-only and local-only

The calendar integration SHALL be strictly read-only: LifeDash MUST NOT create, edit, move, or delete any calendar event. For each cached event it MUST store ONLY the title, start/end times, attendees, recurring-series id, and — amended 2026-07-31 by user decision (CAL-UX.2b) — the event description, converted to plain text and capped at 4000 characters. All of it is held locally and MUST NOT sync anywhere. Locations, attachments, and raw HTML bodies MUST NOT be persisted. No calendar data leaves the device except the requests made directly to the user's own calendar provider.

#### Scenario: What is and is not stored for a synced event

- GIVEN a connected calendar with an event that has an HTML description and a location
- WHEN the event is cached during a poll
- THEN its title, times, attendees, series id, and plain-texted capped description are stored locally
- AND its location, attachments, and raw HTML body are never persisted

#### Scenario: Legacy Microsoft grant degrades, never breaks

- GIVEN a Microsoft connection whose granted scope predates Calendars.Read
- WHEN a poll runs
- THEN the request omits the body field entirely (byte-identical legacy query), events sync as before with no description, until the user reconnects

#### Scenario: The integration never writes to the calendar

- GIVEN a connected calendar
- WHEN LifeDash syncs upcoming events
- THEN no event is created, modified, moved, or deleted on the provider

### Requirement: Calendar signals never auto-start a recording

No calendar signal — an event starting, a notification firing, or a poll completing — SHALL ever start a recording automatically. Starting a recording for an event MUST always require an explicit user action.

#### Scenario: An event starting does not record

- GIVEN a connected calendar and event-start notifications enabled
- WHEN a calendar event reaches its start time
- THEN a notification MAY be shown but no recording is started until the user explicitly chooses to record

### Requirement: Calendar OAuth runs in the system browser with encrypted tokens

Calendar authorization SHALL run in the user's system browser (never an embedded/in-app window) via an authorization-code + PKCE flow. OAuth tokens MUST be stored encrypted at rest via the OS secure storage (safeStorage). When a refresh token becomes invalid, the account status SHOULD surface a `needsReauth` state that Settings presents as a Reconnect affordance.

#### Scenario: Authorization opens the system browser

- GIVEN the user connects a calendar provider from Settings
- WHEN the OAuth flow begins
- THEN the authorization page opens in the system browser, not an embedded window

#### Scenario: Expired authorization is surfaced as Reconnect

- GIVEN a connected calendar whose refresh token has become invalid
- WHEN the user views the calendar Settings section
- THEN the provider shows a Reconnect affordance and a short "authorization expired" note

### Requirement: Attendee emails never enter AI prompts

Attendee email addresses MUST NOT be included in any AI prompt. Where attendee information is used to hint project auto-detection, or to build the participant roster that briefs and action items name people from, only attendee names SHALL be passed to the model.

#### Scenario: Only names reach the classifier

- GIVEN an event whose attendees have both names and email addresses
- WHEN attendee information is woven into the project auto-detect prompt
- THEN only the names are included and no email address appears in the prompt

#### Scenario: Only names reach the brief

- GIVEN a session linked to an event whose attendees have both names and email addresses
- WHEN the brief or action items are generated
- THEN the participant roster in the prompt carries the names only and no email address appears anywhere in it

### Requirement: The agenda stays visible whenever a calendar is connected

The Sessions-home agenda section MUST remain visible whenever at least one calendar provider is connected (outside of an active recording), covering a 7-day lookahead grouped by day. An empty window MUST show the section header with an explicit empty state — the section MUST NOT disappear merely because no events fall inside the window.

#### Scenario: Empty week still shows the agenda

- GIVEN a connected calendar with no events in the next 7 days
- WHEN the user views the Sessions home
- THEN the agenda header renders with a "No meetings in the next 7 days." empty state

#### Scenario: No connection, no section

- GIVEN no calendar provider is connected
- WHEN the user views the Sessions home with no cached events
- THEN the agenda section is absent

### Requirement: Sync covers exactly the selected calendars

Calendar sync MUST fetch events from exactly the calendars the user selected for that provider; with no stored selection it SHALL default to the provider's primary/default calendar (pre-picker behavior). An empty selection MUST be rejected at the API edge. Changing the selection MUST take effect immediately: events of a deselected calendar are evicted from the cache on save (session-linked events are retained), not on the next poll cycle.

#### Scenario: Deselection evicts immediately

- GIVEN cached events from two selected calendars
- WHEN the user deselects one and saves
- THEN that calendar's unlinked events leave the agenda without waiting for the next poll

#### Scenario: No selection means primary only

- GIVEN a connected provider with no stored calendar selection
- WHEN a poll runs
- THEN only the provider's primary/default calendar is fetched

#### Scenario: Manual refresh mirrors the provider

- GIVEN a cached event that was deleted upstream in the provider's calendar
- WHEN the user triggers the agenda's manual refresh
- THEN the event leaves the agenda immediately (session-linked events are retained)

### Requirement: Google calendar listing degrades to Reconnect, never an error

When a Google connection's granted scopes predate the calendar-list scope (or the granted-scope string is unknown), the calendar picker MUST present a Reconnect affordance without attempting any network call. Listing calendars MUST NOT be treated as an error state, and reconnecting SHALL grant the additional `calendar.calendarlist.readonly` scope alongside the existing events scope.

#### Scenario: Pre-picker token shows Reconnect

- GIVEN a Google calendar connected before the picker feature existed
- WHEN the user expands "Choose calendars"
- THEN a reconnect notice and button appear, and no calendar-list request is sent

### Requirement: The agenda view preference is the user's and persists

The Upcoming meetings panel MUST offer the list, week-board, and timeline views behind a switcher; the selected view MUST persist across app restarts. With no stored preference the default SHALL be the week board. All views MUST open the same event details surface for a clicked meeting.

#### Scenario: Preference survives a restart

- GIVEN the user switched the agenda to the timeline view
- WHEN the app restarts
- THEN the agenda renders the timeline view

### Requirement: Event details context is deterministic by default; the model runs only on explicit request

Opening an event's details MUST populate its cross-meeting context (previous same-series session's brief snippet, its still-open action items with an honest total, and attendee matches against known Brain persons) from local database lookups only — no model invocation. The details surface SHALL show the locally-stored event description when present and the full attendee list including locally-stored emails (amended 2026-07-31, CAL-UX.2b). Generating a prep note MUST require an explicit user action per event, route through the per-task model resolution, and reject with a typed no-model message when no provider is configured. The prep-note input MAY include the event description (user decision) but MUST NOT include attendee email addresses — that rule is unchanged.

#### Scenario: Opening details never invokes the model

- GIVEN an event whose series has a previously recorded session
- WHEN the user opens the event's details
- THEN the last-session context renders from lookups and no generation task is dispatched

#### Scenario: Prep note only on demand

- GIVEN the details modal is open
- WHEN the user clicks "Generate prep note"
- THEN exactly one generation runs (cached thereafter), and with no model configured a typed error message is shown instead

---

### Requirement: The twin's memory is navigated by category, opening collapsed

The twin's learned memory SHALL be presented as a navigable structure that opens **collapsed** — showing the twin, one anchor per populated category, and each category's honest fact count — rather than showing every fact at once. Expanding a category MUST reveal only that category's facts; a collapsed category's facts MUST be genuinely absent from the rendered surface, not merely visually hidden, so that display cost scales with what the user has opened rather than with what exists. Multiple categories MAY be open simultaneously, and opening one MUST NOT close another — the categories occupy separate regions, so this is navigation, not an accordion. Expansion state MUST survive a data refresh and MUST NOT be changed by any memory write. A category's count MUST always reflect the full ledger, never what is currently on screen — collapsing a category is not forgetting.

#### Scenario: The memory opens as structure, not as a wall of facts

- GIVEN a twin with facts across several categories
- WHEN the user opens the memory surface
- THEN every populated category is named with its total fact count, and no individual fact is shown

#### Scenario: A collapsed category is absent, not hidden

- GIVEN a collapsed category holding facts
- WHEN the surface is rendered
- THEN that category's facts are not present on the surface at all
- AND the category's stated count still reports every fact it holds

#### Scenario: Opening a second category keeps the first open

- GIVEN one category is expanded
- WHEN the user expands a different category
- THEN both remain expanded

---

### Requirement: A fact shows a short title at rest and its full text on demand

Each remembered fact SHALL be listed by a short caption, and its complete original text MUST be reachable by an explicit user action (activating the fact), never by hover alone. The caption MUST NOT be blank under any circumstance: when no stored caption exists, a derived fallback MUST be shown instead. Activating a fact MUST open the app's own node-anchored inspector positioned beside that fact and visually connected to it, and it MUST NOT obscure the caption the user just activated. Activating a different fact MUST move the inspector to it. The inspector MUST be dismissible by keyboard and by clicking away from any control.

#### Scenario: The full sentence is revealed by activation, not by pointing

- GIVEN a fact listed by its short caption
- WHEN the user moves the pointer over it without activating it
- THEN the caption does not change
- AND WHEN the user activates the fact, the inspector opens showing the fact's complete text

#### Scenario: An uncaptioned fact still reads as something

- GIVEN a fact with no stored caption
- WHEN it is listed
- THEN a derived caption is shown and the row is never blank

#### Scenario: The inspector never covers what was clicked

- GIVEN a fact whose caption sits beside its marker
- WHEN the user activates it
- THEN the inspector is placed clear of the caption's full extent, with its connector attached

---

### Requirement: Memory emphasis is decoration and never removes anything from reach

When a fact is attended (by pointer OR by keyboard focus), the memory surface SHALL emphasise that fact and its own category while de-emphasising other categories, so that attention reads as focus-plus-context. Keyboard focus MUST produce the same emphasis as pointing. A fact opened in the inspector MUST remain emphasised when the pointer moves away. This emphasis is **decoration**: a de-emphasised item MUST remain fully focusable, MUST keep its accessible name, and MUST NOT be removed from the accessibility tree. No animation may leave a lingering state that defeats the emphasis — a fact that has just arrived and animated MUST still de-emphasise correctly afterwards.

#### Scenario: Keyboard users get the same model as pointer users

- GIVEN the memory surface with several categories
- WHEN the user focuses a fact using the keyboard
- THEN that fact and its category are emphasised exactly as if it had been pointed at

#### Scenario: De-emphasis never costs reachability

- GIVEN a fact de-emphasised because another category is attended
- WHEN the user tabs to it
- THEN it is focusable, correctly named, and present to assistive technology

#### Scenario: A just-arrived fact still de-emphasises

- GIVEN a newly learned fact that has played its arrival animation
- WHEN attention moves to a different category
- THEN the arrived fact de-emphasises like any other

---

### Requirement: Memory motion is one-shot, honors reduced motion, and costs nothing at idle

Expanding a category, a fact arriving, and restoring a forgotten fact SHALL be accompanied by motion that reads as growth rather than an instant pop. All such motion MUST be one-shot: once finished it MUST leave no scheduled work and no lingering visual state. At rest the memory surface MUST schedule no repeating animation frames or timers, with a single sanctioned exception — an ambient shimmer on the twin itself, which MUST stop whenever the surface is not the visible tab, whenever the window is hidden, and whenever reduced motion is preferred. When the user prefers reduced motion, ALL motion MUST be disabled — counts and facts update instantly — while attention emphasis MUST remain, because emphasis is state rather than motion. A newly learned fact MUST NOT cause its category to expand on its own.

#### Scenario: Nothing is scheduled once the surface settles

- GIVEN the user has opened and closed categories and a fact has arrived
- WHEN the surface is left untouched
- THEN no animation frames or timers remain scheduled, except the twin's ambient shimmer under its stated conditions

#### Scenario: Reduced motion keeps meaning, drops movement

- GIVEN the user prefers reduced motion
- WHEN a category is expanded and a new fact arrives
- THEN both render instantly with no animation
- AND attention emphasis still distinguishes the attended category

#### Scenario: Learning never yanks the view

- GIVEN a collapsed category
- WHEN a new fact is learned into it during a recording
- THEN the category's count increases and it signals the arrival
- AND it does not expand by itself

---

### Requirement: The safety triad remains reachable from the memory surface

Every affordance of the learned-memory safety triad — per-fact provenance, forgetting a fact with an undo window, and the learning kill-switch — MUST remain reachable from the memory surface, including by keyboard alone. Provenance MUST identify the source session, and when that source no longer exists it MUST say so in plain language rather than exposing an internal identifier or offering a dead link. Forgetting a fact MUST remove it from the surface and reduce its category's count immediately, and MUST be undoable for a short window, with the restored fact reappearing in place.

#### Scenario: A keyboard-only user can audit and forget

- GIVEN the memory surface with the keyboard as the only input
- WHEN the user tabs to a fact, activates it, and tabs onward
- THEN the inspector opens and the forget action is reachable without a pointer

#### Scenario: A vanished source is described, not leaked

- GIVEN a fact whose source session has been deleted
- WHEN the user opens that fact
- THEN its provenance reads as an unnamed past session, with no identifier and no dead link

#### Scenario: Forgetting is reversible

- GIVEN the user forgets a fact
- WHEN they choose undo within the offered window
- THEN the fact returns to its category and the count is restored

---

### Requirement: Non-speech audio never becomes transcript text

Transcription MUST NOT emit fabricated text for audio that contains no speech. Windows of audio that carry no detected speech MUST be skipped rather than decoded, and any decoded segment that is recognisably a transcription artifact rather than spoken content — such as a subtitle credit or a stock sign-off — MUST be discarded before it is stored, shown, or acted upon. A discarded segment MUST ALSO be withheld from the context passed to subsequent transcription, so that one artifact cannot make the next more likely. Discarding MUST be conservative: genuine speech that merely mentions such phrasing MUST be preserved. Voice input consisting entirely of such an artifact MUST be treated as if nothing was said.

#### Scenario: Silence and room noise produce nothing

- GIVEN a stretch of recording containing no speech
- WHEN transcription processes it
- THEN no transcript text is produced for that stretch

#### Scenario: A fabricated credit line never reaches the transcript

- GIVEN a decoded segment that is essentially a subtitle-credit artifact
- WHEN the segment is processed
- THEN it is not stored, not displayed, and not passed to downstream analysis
- AND it does not influence the transcription of the following audio

#### Scenario: Real speech about subtitles survives

- GIVEN a speaker genuinely discussing subtitles within a longer sentence
- WHEN the segment is processed
- THEN it is kept and transcribed normally

---

### Requirement: Speech detection degrades to prior behavior and never blocks recording

Speech detection SHALL be an additive safeguard: it MUST NOT alter the audio handed to transcription, and a window containing any speech MUST be transcribed in full exactly as it would have been without it. If the speech-detection capability is unavailable for any reason — its model cannot be obtained, or it fails to initialise or run — transcription MUST continue using the prior behavior, logging the condition once, and MUST NEVER fail, block, or interrupt a recording. Acquiring any supporting model MUST happen quietly in the background and MUST NOT be a precondition for recording.

#### Scenario: A speech window is transcribed unchanged

- GIVEN a window of audio containing speech
- WHEN speech detection runs on it
- THEN the whole window is transcribed exactly as before, with no trimming or re-timing

#### Scenario: Unavailable speech detection is invisible to the user

- GIVEN the speech-detection model cannot be obtained or fails to start
- WHEN the user records
- THEN recording and transcription proceed under the prior behavior with no error surfaced and no interruption

#### Scenario: Speech detection can never take the app down

- GIVEN any machine, GPU, or platform configuration
- WHEN speech detection initialises or runs
- THEN no failure inside it — including one originating in native code — terminates the app or interrupts the recording
- AND on a platform where its engine cannot run safely, it is not attempted at all

---

### Requirement: Previously stored fabricated transcript text is cleaned up exactly once

Transcript text already stored before this safeguard existed SHALL be cleaned up once, removing only segments that the same conservative test identifies as artifacts. The cleanup MUST NOT run again on subsequent launches once it has completed, MUST report how many segments it removed — including when it removed none — and MUST leave genuine speech untouched. If it fails, it MUST NOT be recorded as complete, so that it is retried on the next launch.

#### Scenario: Old fabricated lines disappear once

- GIVEN stored transcripts containing fabricated credit lines
- WHEN the app next starts
- THEN those segments are removed, the count is reported, and the cleanup does not run again on later starts

#### Scenario: A failed cleanup retries rather than silently skipping

- GIVEN the cleanup does not complete successfully
- WHEN the app starts again
- THEN the cleanup is attempted again

---

### Requirement: Deleting a meeting deletes its influence

Deleting a meeting SHALL remove its influence, not merely its own rows. By default, deletion MUST hard-delete every twin fact learned from that meeting and MUST remove its recording file from disk; the meeting's briefs, transcripts, and other meeting-scoped data continue to cascade via their existing foreign keys, unchanged by this requirement. The user MAY instead choose to keep what the twin learned: in that case the facts MUST remain active, and their provenance MUST be rewritten to a human-readable snapshot of the source meeting's title and deletion date — provenance MUST NEVER degrade to a silent null. A board card the user previously accepted from the meeting into a project MUST survive the meeting's deletion regardless of which path is chosen — acceptance was a deliberate, separate action, not something contingent on the meeting continuing to exist. Post-session work (brief generation, action items, fact or entity extraction) already in progress for a meeting that is deleted before it finishes MUST complete as a silent, internally-logged no-op — it MUST NEVER surface a raw database error to the user. Recording files left orphaned by a deletion that predates this contract, or by any failure path, MUST be reclaimed by a startup sweep that runs AT MOST once per install and MUST NEVER delete a file any meeting row still references or that an active recording is still writing.

#### Scenario: Default deletion expunges facts and the recording

- GIVEN a meeting has learned facts and a saved recording
- WHEN the user deletes it without choosing to keep what the twin learned
- THEN its twin facts are hard-deleted and its recording file is removed from disk

#### Scenario: Keeping preserves facts with a readable provenance snapshot

- GIVEN a meeting has learned facts
- WHEN the user deletes it with "Keep what the twin learned" checked
- THEN the facts remain active with their provenance rewritten to the meeting's title and the deletion date, never a silent null

#### Scenario: In-flight post-session work absorbs a mid-generation deletion

- GIVEN a brief, action items, or a fact/entity extraction is being written for a meeting
- WHEN that meeting is deleted before the write completes
- THEN the write resolves as a no-op with nothing persisted, logged once internally, and no raw error reaches the user

#### Scenario: An accepted board card is not deleted with its meeting

- GIVEN a board card was accepted from a meeting into a project
- WHEN the meeting is later deleted, by either path
- THEN the card remains on the board unaffected, by design

#### Scenario: The orphan sweep runs once and only removes what nothing references

- GIVEN recording files on disk that no meeting row references
- WHEN the app starts
- THEN each orphan is deleted, exactly once across the install's lifetime, and any file a meeting still references or that an active recording is writing is left untouched

---

### Requirement: A long meeting still gets a brief

A meeting MUST NOT fail to produce a brief or action items merely because its transcript is long. Before sending anything, the assembled prompt SHALL be measured against the configured model's context window, including the room reserved for the model's own output, using a per-token size estimate calibrated against the densest tokenization the app supports (Czech on a small local model) — never an optimistic average. When a transcript does not fit, its structured record (see "A brief is written from a complete structured record and never capped") MUST be extracted part by part and the parts MERGED BY RULE — never by another model call — so that no topic, decision, commitment or question from any part can be dropped; the writer pass then receives the merged record, and the transcript alongside it only when the whole request still fits. The writer pass MUST carry the same context a short meeting's brief carries — meeting template, project continuity, items confirmed live, pre-meeting prep, the twin's voice, the participant roster and the brief language — so a long meeting's brief is not a lesser brief; the per-part extraction passes MUST NOT carry project continuity, prep or the twin's voice, so that they stay small and factual. A brief built from more than one part MUST say so, naming how many passes built it.

The elasticity MUST be self-healing and bounded. If the model rejects a part as larger than its window — the size estimate having been wrong for that model — that part MUST be split and its halves extracted instead, at most a fixed small number of times, and the event MUST be logged with the model's own reported size so the estimate can be corrected; only a part that cannot be split further MAY fail, and that failure MUST name the size estimate as the cause rather than reporting an anonymous error. Any part that fails for another reason, or comes back empty or unreadable after one retry, MUST stop the whole attempt: the classified failure card is persisted, nothing is learned from it, and no action items are produced. A partial brief or a partial action-item list MUST NEVER be presented as a complete one.

#### Scenario: A transcript that fits is extracted and written in two requests

- GIVEN a transcript whose assembled prompts fit the model's context window
- WHEN a brief is generated
- THEN exactly one extraction request and one writer request are made, the writer sees the transcript alongside the structured record, and the stored brief carries no passes note

#### Scenario: A transcript that overflows still produces a complete brief

- GIVEN a transcript whose extraction prompt exceeds the model's context window
- WHEN a brief is generated
- THEN each part is extracted, the parts are merged by rule with cross-part repeats collapsed, the writer receives the merged record with the project-continuity, confirmed-live, prep, roster and language context, and the stored brief states how many passes built it
- AND no context-overflow failure card is persisted for length alone

#### Scenario: A wrong size estimate splits a part instead of failing the meeting

- GIVEN a part the model rejects as larger than its context window despite the estimate
- WHEN extraction runs
- THEN that part is split and its halves extracted, the split is logged with the model's reported size, and the brief completes with every item retained

#### Scenario: Action items from an overflowing transcript are merged, not duplicated

- GIVEN a transcript too long for one extraction pass
- WHEN action items are produced
- THEN commitments from every part are kept in order and a commitment restated across a part boundary appears exactly once

#### Scenario: A failing part is a failure, not a half brief

- GIVEN one part of a long transcript fails for a reason other than size, or returns nothing usable after one retry
- WHEN the brief is generated
- THEN the classified failure card is stored, nothing is dispatched to the twin, no action items are produced, and no partial brief is presented

#### Scenario: The splitting stops

- GIVEN a single stretch of transcript that the model cannot accept even on its own
- WHEN extraction runs
- THEN the attempt stops with a classified failure card that names the size estimate as the cause, never looping

---

### Requirement: A brief is written from a complete structured record and never capped

Generating a meeting brief SHALL be two steps: first the transcript is EXTRACTED into a structured record of what was said — every topic with its detail, every decision with its rationale when one was given, every commitment with its owner (or none), its task and its due time as spoken, every open question, and the exact terms, numbers and priorities used — and only then is the brief WRITTEN from that record. The extraction MUST favour completeness over brevity: nothing may be summarised away. The brief SHALL be the writer's JUDGMENT of that record for a reader who was not present: every decision and every commitment in the record MUST appear in the brief — the follow-ups GROUPED BY OWNER with unowned follow-ups last — and two decisions or two commitments MUST NEVER be merged into one, while WHICH topics, details and questions appear is the writer's judgment, with small talk, logistics and passing mentions left out; a condition on a decision or a commitment MUST be kept. The brief MUST NOT be limited by any count of bullets, words or items; an empty section MAY be omitted. The stored record MUST be shown with the brief as FULL NOTES, so that nothing the writer left out of the brief is lost. The brief MUST NEVER invent an owner, a date or a number, and MUST keep names and terms exactly as they appear in the record. The structured record MUST be stored with the brief, together with which model produced it and in how many passes, so later features can use it without re-reading the transcript; the twin's learning, entity extraction, semantic indexing and the post-meeting assistant read the brief TOGETHER WITH the stored record — still never the raw transcript. The same contract MUST hold on every model the user routes the task to — a small local model, a locally served model, or a cloud model — with one prompt set; a model reply that cannot be read as the record MUST be retried once with the reason attached before being treated as a failure.

#### Scenario: Nothing said is lost

- GIVEN a 90-minute meeting with many topics, decisions and commitments
- WHEN a brief is generated
- THEN every topic, decision, commitment and open question from the record appears in the FULL NOTES shown with the brief, every decision and every commitment also appears in the brief itself, and a topic the writer judged minor MAY be absent from the brief while it MUST still be in the full notes

#### Scenario: Follow-ups are grouped by owner and unowned ones are last

- GIVEN commitments with several named owners and some with no explicit owner
- WHEN the brief is written
- THEN the follow-ups are grouped under each owner in participant order and the unowned ones form the last group

#### Scenario: An unreadable model reply is retried once, then honest

- GIVEN the model returns a reply that cannot be read as the structured record
- WHEN extraction runs
- THEN exactly one retry is made carrying the reason, and a second failure produces the classified failure card rather than a brief built from nothing

---

### Requirement: Action items are the meeting's commitments

Action items SHALL be derived from the commitments in the meeting's structured record, with no further model call: each carries the task, the owner ONLY when the transcript made that person explicitly responsible, and the due time exactly as spoken — never a date the model constructed. A commitment with no explicit owner MUST be an unowned action item, not one attributed to whoever was mentioned last. A card created from an action item MUST show the owner and due time when known and MUST NOT turn the spoken due time into a calendar date. Items the user already accepted live during the meeting MUST NOT be created again. A meeting whose brief predates this contract, or whose record is missing, MAY fall back to extracting action items from the transcript text, and that fallback MUST likewise be uncapped.

#### Scenario: Owner only when explicit

- GIVEN a first-person commitment ("I'll block two hours daily") and a commitment explicitly assigned to a named participant
- WHEN action items are produced
- THEN the first has no owner and the second carries the participant's name exactly as in the roster

#### Scenario: Cards carry owner and due time as spoken

- GIVEN an action item with an owner and a due time "by end of September"
- WHEN it becomes a card
- THEN the card shows the owner and the due phrase verbatim and no calendar date is set from it

---

### Requirement: Participants are names only, editable before and after, and shape the brief

A meeting MAY carry a list of participant names. The list SHALL be pre-filled from the linked calendar event's attendee NAMES when one exists, MAY be typed at recording start, and MUST remain editable on the finished session. An email address MUST be rejected from the list and MUST NEVER enter any AI prompt. The names the brief and action items use MUST be drawn from the participants, the calendar attendees' names, and people already known from the same project's past sessions — in that order, deduplicated, spelled exactly as recorded. Editing the participants after a brief exists MUST NOT change that brief on its own; the user MUST be told that regenerating applies the change.

#### Scenario: Calendar attendees pre-fill names, never emails

- GIVEN a recording started from a calendar event whose attendees have names and email addresses
- WHEN the recording controls open
- THEN the participant list is pre-filled with the names only, and an attendee with no name is skipped

#### Scenario: A forgotten participant is added afterwards

- GIVEN a finished session with a brief
- WHEN the user adds a participant name
- THEN the name is saved, the existing brief is unchanged, and the session shows that regenerating will apply the change

---

### Requirement: The brief language is a user setting

The language a brief and its action items are written in SHALL be a user setting: English by default, the transcript's own language on request (including the base language of a mixed-language transcription preset), or an explicit language. Choosing English MUST leave the prompts exactly as they were before the setting existed. The setting applies to the next generation; it MUST NOT rewrite briefs that already exist.

#### Scenario: Default English on a Czech meeting

- GIVEN a meeting transcribed under the Czech mixed-language preset and no brief-language choice
- WHEN a brief is generated
- THEN it is written in English

#### Scenario: "Same as transcript" follows the preset's base language

- GIVEN the brief language set to "same as transcript" and a Czech mixed-language preset
- WHEN a brief is generated
- THEN it is written in Czech

---

<!-- Add further requirements following the same pattern, one `### Requirement:` block per behavior/domain. -->
<!-- When this project graduates Tier 1 → Tier 2, each `### Requirement:` block can move into its own `specs/<domain>/spec.md` unchanged. -->
