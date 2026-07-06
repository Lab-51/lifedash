# Decisions Register (append-only)

## [2026-07-06] Live-agent initiative — three-phase direction (LIVE.1 = Phase A)
**Context:** User wants LifeDash to shift from post-hoc pipeline (record → review later) to a live experience: an AI partner during recording, evolving toward Graphify-style structured knowledge (entities + typed edges + confidence tags, queryable by the agent).
**Decision:** Three sequential phases: A) Live Assistant (drawer with live transcript + on-demand agent chat with tools), B) ambient auto-triage feed (proactive suggestions, one-tap accept), C) knowledge-graph substrate (entity/edge tables in PGlite, extraction post-meeting first). LIVE.1 covers A only.
**Alternatives:** Building the knowledge graph first (rejected — most experimental, needs the live surface to be useful); one mega-plan for all three (rejected — exceeds 6-task limit, bundles unrelated smoke tests).
**Rationale:** Each phase validates the next; A reuses proven infra (streaming transcription, card-agent tool loop) so it's the cheapest slice that changes the product's feel.

## [2026-07-06] "Live Assistant" naming (not "Copilot")
**Context:** User asked whether "copilot" meant Microsoft Copilot — the term is now trademark-loaded and could read as a Microsoft integration.
**Decision:** User-facing name "Live Assistant"; internal naming `meeting_agent` (schema, service, IPC), task type `live_assistant`.
**Alternatives:** "Meeting Partner", "Live Intelligence", keeping "Copilot".
**Rationale:** Avoids brand confusion in a privacy-positioned product; "Live Assistant" is descriptive and pairs with the existing "Meeting Intelligence" naming.

## [2026-07-06] Local-first model policy for the Live Assistant
**Context:** Privacy is important but not a hard product line; user runs LM Studio with hardware for up to 14B models. Research (2026-07-06) tiered local models and ranked API privacy postures.
**Decision:** Live Assistant defaults to the user-configured local provider (LM Studio, Qwen3-14B class recommended) via the existing `resolveTaskModel` per-task routing — no new provider infra in Phase A. Cloud fallback stays user-chosen per task; future work may add Mistral/Groq and provider privacy badges.
**Alternatives:** Dual-model local tiering now (4B triage + 14B chat — deferred to Phase B where the triage loop exists); adding privacy-ranked cloud providers now (deferred, tracked in STATE.md pending items).
**Rationale:** Phase A is on-demand only, so one 14B model suffices; the per-task routing already expresses "local by default, escalate by choice". Research: complex KG relationship extraction (Phase C) exceeds 14B-class local models — revisit there.

## [2026-07-06] Live transcript state moves to recordingStore; drawer is a global portal
**Context:** The only `onTranscriptSegment` subscriber is MeetingsModern, so live segments are invisible on other views; child overlays hit a known stacking-context trap (standup picker precedent).
**Decision:** Single store-level transcript subscription (recordingStore) consumed by both MeetingsModern and the new LiveMeetingDrawer; drawer renders via `createPortal(document.body)` from AppLayout, only while recording.
**Alternatives:** Dedicated live-meeting route (rejected by user — leaves the Kanban); per-component IPC subscriptions (rejected — duplicate listeners, lost segments off-view).
**Rationale:** The user's core ask is working in Kanban while the meeting runs; one subscription avoids drift between surfaces.
