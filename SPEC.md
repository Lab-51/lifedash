# Behavior Specification

<!-- This is a LIVING behavior register for the whole project — a single flat file. -->
<!-- A spec is a behavior CONTRACT, not an implementation plan. -->
<!-- If implementation can change without changing externally visible behavior, it doesn't belong here. -->
<!-- Avoid: internal class/function names, library choices, step-by-step implementation details. -->
<!-- Add new behaviors by appending another `### Requirement:` block under `## Requirements`. -->
<!-- A requirement with the SAME name is UPDATED in place, never duplicated — this file is a register, not a log. -->

## Purpose

LifeDash is a session-centric, local-first meeting-intelligence app. This register holds behavior contracts per domain; it currently covers the **Digital Twin** domain (V3.3 + V3.3.5 "Deep Creation"): the user profile that personalizes every AI surface, how it is authored — manually or via the deep-creation paths (deep interview, history mining, web enrichment) — and how the app behaves with and without it.

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

<!-- Add further requirements following the same pattern, one `### Requirement:` block per behavior/domain. -->
<!-- When this project graduates Tier 1 → Tier 2, each `### Requirement:` block can move into its own `specs/<domain>/spec.md` unchanged. -->
