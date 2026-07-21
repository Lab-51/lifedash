# Behavior Specification

<!-- This is a LIVING behavior register for the whole project — a single flat file. -->
<!-- A spec is a behavior CONTRACT, not an implementation plan. -->
<!-- If implementation can change without changing externally visible behavior, it doesn't belong here. -->
<!-- Avoid: internal class/function names, library choices, step-by-step implementation details. -->
<!-- Add new behaviors by appending another `### Requirement:` block under `## Requirements`. -->
<!-- A requirement with the SAME name is UPDATED in place, never duplicated — this file is a register, not a log. -->

## Purpose

LifeDash is a session-centric, local-first meeting-intelligence app. This register holds behavior contracts per domain. It covers the **Digital Twin** domain (V3.3 + V3.3.5 "Deep Creation"): the user profile that personalizes every AI surface, how it is authored — manually or via the deep-creation paths (deep interview, history mining, web enrichment) — and how the app behaves with and without it. It also covers the **V3.4 living layer**: the twin that keeps learning from finished sessions (auditable memory with a safety triad), semantic search with a grounded "Ask", the embedding index (local-by-default, no silent cloud), and the Brain's first flat person/topic entities. It also covers the **Recording Guard** domain (GUARD.1): the inactivity auto-stop safeguard for forgotten recordings, and the transcription-provider privacy controls (local-only enforcement, cloud-switch consent).

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

After a session's brief is generated, the twin SHALL learn a small number of durable, discrete FACTS about the user's world (people, projects, preferences, domain, commitments). Learning MUST be extracted ONLY from already-distilled, session-scoped material — the session brief and the suggestions the user ACCEPTED live — and MUST NEVER read the raw transcript and MUST NEVER run live during a meeting. A learned fact SHALL be applied IMMEDIATELY (no approval queue), and MUST carry the full **safety triad**: (1) per-fact PROVENANCE to the source session, (2) a one-tap FORGET, and (3) a global learning PAUSE kill-switch. Learning MUST be error-isolated — a learning failure can NEVER fail or delay brief generation.

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

<!-- Add further requirements following the same pattern, one `### Requirement:` block per behavior/domain. -->
<!-- When this project graduates Tier 1 → Tier 2, each `### Requirement:` block can move into its own `specs/<domain>/spec.md` unchanged. -->
