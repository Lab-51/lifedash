# ADR — CODE-Q.1: Bronze-gate code-quality remediation

Date: 2026-04-18
Status: Accepted
Supersedes: —
Scope: code-quality audit dimension (weight 10%)

## Context

The `/nexus-production:dimensions:code-quality` audit against LifeDash v2.2.39
reported **Below-Bronze** on the code-quality dimension — 4 of 7 Bronze-REQ
items failing:

1. 4 circular dependencies (`madge --circular`)
2. `no-explicit-any` is `warn`, not `error` (87 raw matches)
3. `no-floating-promises` not configured
4. `complexity` rule not configured

The project is otherwise at Gold (90/100) overall per `PROD-AUDIT.1-6`. This
ADR records why we are fixing *these four* and not more, why we are doing it
*now*, and why we chose specific thresholds.

## Decision

Fix exactly the 4 failing Bronze-REQ items, in a single plan (CODE-Q.1) with
three tasks and mandatory smoke-test gates between them. Keep all Silver/Gold
items out of scope.

### Specifically

1. Break all 4 circular dependencies by extracting shared types/state into
   leaf modules. No dynamic-import workarounds.
2. Promote `@typescript-eslint/no-explicit-any` from `warn` → `error`.
   Keep the existing test override (`off`) as-is.
3. Add `@typescript-eslint/no-floating-promises: 'error'`.
4. Add `complexity: ['error', { max: 15 }]` — Bronze threshold, not
   Silver's 10.

## Alternatives considered

### A. Go straight to Silver in one plan (CODE-Q.1 + 2 combined)

Rejected. Silver adds: cyclomatic 10, cognitive complexity via sonarjs,
`max-lines`, `max-lines-per-function`, `max-params`, `max-depth`,
duplication <3%, dependency-cruiser, custom error hierarchy. This would
force decomposition of ~27 files over 500 lines and introduce architectural
boundaries that warrant their own design discussion. Bundled with Bronze
work it would be a multi-session plan with high regression risk. Split
into a separate CODE-Q.2 if prioritised.

### B. Raise complexity threshold to 20 to minimise refactoring pain

Rejected. The audit spec defines Bronze as `<= 15`. Raising the ceiling
makes the ratchet meaningless. If a function legitimately must exceed 15,
a targeted `// eslint-disable-next-line complexity` with a one-line
justification is the right escape hatch.

### C. Leave `no-explicit-any` at `warn`

Rejected. A `warn`-level rule silently rots: CI doesn't block on warnings,
new `any`s land in every feature PR. The whole point of the Bronze gate is
that the rule be CI-enforced. Test files get a per-glob override because
mocking infrastructure legitimately needs loose types — the override is
already in place at `eslint.config.mjs:30-33` and stays.

### D. Use dynamic imports to break circular dependencies

Rejected. Dynamic imports mask the cycle instead of resolving it — the
coupling still exists at runtime, and tooling stops reporting it.
Extracting shared code into leaf modules (or inverting the dependency via
an injected callback) genuinely resolves the cycle and produces clearer
module boundaries.

### E. Ship without smoke tests, rely on CI + vitest

Rejected. Three of the four fixes can change runtime behaviour:
- Cycle-breaking can reorder module initialisation (Zustand stores
  particularly).
- Fixing floating promises can change async await ordering.
- Refactoring over-complex functions can shift control flow.
Vitest (425/425) is a necessary gate but not sufficient for an Electron
app with heavy IPC. The `feedback_manual_smoke_test.md` memory and the
release-process rule in `MEMORY.md` ("ALWAYS test the packaged app") both
point in the same direction: user-driven smoke tests are cheap compared
to shipping a silent regression.

## Rationale

- **Scope discipline.** Bronze is a concrete, measurable target with a small
  blast radius. Silver/Gold involve architectural decisions that deserve
  their own design step.
- **Enforceability.** Every rule change goes into `eslint.config.mjs` where
  husky pre-commit (`lint-staged` → `eslint --max-warnings=0`) already runs
  them on changed files. Rules become ratchets automatically.
- **Risk management.** Each of the three tasks has a clear rollback (revert
  the commit). The smoke-test gates between tasks isolate blame if a
  regression surfaces.
- **Known-unknown handling.** Task 3's scope is unknown; a stop condition
  (>30 violations → split plan) prevents runaway work.

## Consequences

Positive:
- Code-quality dimension moves to Bronze (all 7 Bronze-REQ pass).
- `lint-staged` pre-commit hook blocks new `any`, new floating promises,
  and new cyclomatic-15+ functions.
- Circular-dep detection can be added to CI as a separate non-blocking
  ratchet in a follow-up.

Negative / open:
- Some `// eslint-disable-next-line complexity` comments will be required
  for genuinely flat-but-wide functions (discriminated-union switches).
  Each must carry a one-line justification.
- `no-explicit-any: error` may block quick prototyping in feature branches
  — mitigated by the `unknown` + narrowing pattern and by Zod schemas
  already in the codebase.
- Silver/Gold work (file/function length, cognitive complexity, dep
  boundaries) remains. CODE-Q.2 to be opened when prioritised.

## Out-of-scope items (explicit)

- `sonarjs/cognitive-complexity` plugin
- `max-lines`, `max-lines-per-function`, `max-params`, `max-depth`
- `dependency-cruiser` layer rules
- `noUncheckedIndexedAccess` in `tsconfig.json`
- Custom `Error` class hierarchy
- `neverthrow` or Result/Either pattern
- Decomposing the 27 files over 500 lines

## References

- Code-quality audit output (this session, in conversation transcript)
- `MEMORY.md` — release-process rules, fork-safety, smoke-test discipline
- `memory/feedback_manual_smoke_test.md` — smoke-test protocol
- `PLAN.md` — CODE-Q.1 execution plan
- `.planning/stories/CODE-Q.1-task{1,2,3}-*.md` — per-task story files
