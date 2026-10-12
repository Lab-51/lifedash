// === FILE PURPOSE ===
// The twin profile's size limits - ONE source of truth for the IPC save schemas
// (main) and the wizard/section-card inputs (renderer). The values reach the DB and
// then every prompt budget, so main refuses anything over them; the renderer uses the
// same numbers so a user learns about a limit while typing, not after a failed save.
// Pure constants, safe to import from both processes.
//   SHORT_MAX  200  - one-line fields: names, roles, org/company/industry, a term
//   TEXT_MAX  4000  - free text: the brief, descriptions, meanings, goals, tone/style
//   LIST_MAX   500  - entries per list section

export const SHORT_MAX = 200;
export const TEXT_MAX = 4000;
export const LIST_MAX = 500;
