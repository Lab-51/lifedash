# Behavior Specification

<!-- This is a LIVING behavior register for the whole project — a single flat file. -->
<!-- A spec is a behavior CONTRACT, not an implementation plan. -->
<!-- If implementation can change without changing externally visible behavior, it doesn't belong here. -->
<!-- Avoid: internal class/function names, library choices, step-by-step implementation details. -->
<!-- Add new behaviors by appending another `### Requirement:` block under `## Requirements`. -->
<!-- A requirement with the SAME name is UPDATED in place, never duplicated — this file is a register, not a log. -->

## Purpose

LifeDash is a session-centric, local-first meeting-intelligence app. This register holds behavior contracts per domain; it currently covers the **Digital Twin** domain (V3.3): the user profile that personalizes every AI surface, how it is authored, and how the app behaves with and without it.

## Requirements

### Requirement: Twin profile authoring works fully without AI

The app SHALL let the user create and refine their twin profile through a guided multi-step wizard (identity → domain → projects → people → vocabulary → goals → preferences → review) in which every step is completable by manual form entry alone. AI assistance MUST be optional per step and MUST NOT be required to complete any step or the wizard.

#### Scenario: Manual creation end-to-end

- GIVEN no twin profile exists
- WHEN the user opens the Twin section and chooses "Create your twin", fills steps manually, and confirms the review step
- THEN the profile is saved with the entered sections
- AND the review step shows what the twin now knows before saving

#### Scenario: Refinement pre-fills, never restarts

- GIVEN a twin profile already exists
- WHEN the user relaunches the wizard
- THEN every step is pre-filled with the existing profile values for editing
- AND clearing a field or section in the wizard persists the clear on save

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

<!-- Add further requirements following the same pattern, one `### Requirement:` block per behavior/domain. -->
<!-- When this project graduates Tier 1 → Tier 2, each `### Requirement:` block can move into its own `specs/<domain>/spec.md` unchanged. -->
