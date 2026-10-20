// === FILE PURPOSE ===
// Build-time switches for archived features. The code and stored data stay; a
// switch only stops the feature from running and hides its UI.

/**
 * Live proposals (proactive triage during a recording) — ARCHIVED 2026-10-20.
 * Measured on the user's database: 2,617 cloud calls (~$3.40, 36% of all AI
 * spend) produced 2,128 proposals of which 8 were accepted. Set to true to bring
 * back the triage loop, the in-meeting feed and the post-meeting section.
 */
export const LIVE_PROPOSALS_ENABLED = false;
