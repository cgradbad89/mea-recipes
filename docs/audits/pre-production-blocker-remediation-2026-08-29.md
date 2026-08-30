# Pre-Production Blocker Remediation Status — 2026-08-29

This document is a remediation addendum to the frozen
`docs/audits/pre-production-audit-2026-08-29.md`. It does not replace or rewrite that historical
baseline. Evidence below is based on repository commits and mocked/local verification only; no
production data or external Calendar event was mutated.

## Authorized blocker status

| Audit finding | Status | Structural remediation | Primary evidence |
| --- | --- | --- | --- |
| DATA-001 — recipe overwrite | REMEDIATED | New recipes use a Firestore create transaction with an existence precondition; existing edits retain exact-ID update semantics. Discover preserves a collided draft. Queue publication atomically couples create-only recipe persistence to pending→published state. | `69064ab`; `tests/recipeWriteBoundary.test.ts`, `tests/discoverRecipeCollision.test.tsx`, `tests/queuePublication.test.ts` |
| PRIV-010 — implicit plan sharing | REMEDIATED in application code | Private is the default. Publish/update and unpublish are explicit actions, publication state is subscribed/persisted, private changes are visible as not shared, and the mirror contains flat recipe IDs only. | `63578bf`; `tests/sharedPlanPublication.test.ts`, `tests/planErrorHandling.test.tsx` |
| DATA-011 — delete-first grocery rebuild | REMEDIATED | The complete derived replacement is read, parsed, merged, validated, and assigned collision-safe IDs before mutation; one bounded Firestore batch replaces derived items while preserving manual items/flags. Any precompute or capacity failure leaves the old list intact. | `c500765`; grocery lifecycle/preparation/error tests |
| REL-012 — cook/log/undo divergence | REMEDIATED | A deterministic local-day cook-event key and Firestore transaction update the plan plus nutrition snapshot atomically; retries converge, zero nutrition is rejected, later-day cooks remain distinct, and undo transactionally removes deterministic/legacy cook logs while unmarking the plan. | `c500765`; `tests/cookEventTransactions.test.ts`, `tests/CookingMode.test.tsx` |
| REL-014 — Queue partial publication | REMEDIATED | Queue pending→published and create-only recipe creation are one transaction. Retry detects the stored target and avoids duplicate enrichment; collision makes no writes and keeps the queue item editable. | `69064ab`; `tests/queuePublication.test.ts` |
| REL-013 — Calendar duplicate recovery | REMEDIATED | New day events receive a server-derived opaque `mea{sha256(uid,week,day)}` Google event ID. POST 409 reconciles with PATCH of that exact ID; legacy stored IDs update/delete in place; missing legacy events heal to deterministic identity; delete 404/410 is converged success. No list/search flow exists. | `e4fa394`; `tests/calendarPushRoute.test.ts` |
| SEC-010 — unbounded AI spend | REMEDIATED | Every active AI route uses the centralized Firestore-transactional verified-uid guard with class/window/day/global/concurrency limits, expiring leases, finite deadlines/retries/output, input/fan-out bounds, and sanitized 429 denial before model invocation. | `badc41e`; `docs/architecture/ai-abuse-control.md`; AI guard/coverage/route tests |
| GATE-010 — machine-local release test | REMEDIATED | The arbiter regression reconstructs state from immutable repository evidence instead of `/tmp/cooking-step-arbiter-v10a-2026-08-28-state.json`. Vitest owns its `server-only` marker and the Firestore transaction test starts an isolated dynamic-port emulator rather than accepting another process on port 8080. | `2a2c0d7`, `475ef9c`; clean archive evidence below |

## Verification

Active checkout:

- `npm test`: 104 files passed, 1 skipped; 1,378 tests passed, 1 skipped (1,379 total).
- `npm run build`: passed; Next.js 16.3.1 compiled and generated 30 static pages.
- `npm run lint`: passed with 0 errors and the six pre-existing warnings (five `no-img-element`, one unused eslint-disable).
- `npm run typecheck`: passed.
- `npm audit --audit-level=low`: passed; 0 vulnerabilities.
- `git diff --check`: passed.

Clean committed archive on the repository-required Node 24.19.0:

- fresh `npm ci`: passed, 796 packages installed, 0 vulnerabilities;
- Vitest: 104 files passed, 1 skipped; 1,378 tests passed, 1 skipped;
- Next production build: passed;
- ESLint: 0 errors, the same six warnings;
- TypeScript: passed.

The first two clean-archive attempts correctly exposed and led to fixes for a machine-local
`server-only` stub and a fixed-port emulator collision. The final archive contains neither
dependency on local `node_modules` nor dependency on an arbitrary listener at port 8080.

## Remaining pre-production blockers

The authorized remediation areas above are closed, but the application remains **NOT READY** for
broader production because the frozen audit contains independent P1 work outside this session:

- CFG-010: owner review/publication and proof of the complete Console-managed shared-project ruleset;
- OPS-010: ordinary local development still needs a fail-closed safe-project/emulator workflow;
- SEC-011: Insights CSV still needs RFC 4180 escaping and spreadsheet-formula neutralization;
- the remaining P1 continuity, accessibility, UX, integration, and live-configuration findings in
  the frozen audit, plus its §16 manual checklist, still require closure/reverification.

Existing unintended shared-plan mirror documents, if any, were not inspected or removed because
that would be a production Firestore mutation. Live Calendar behavior and OAuth prerequisites were
not exercised; Calendar verification used mocks only.

## Mutation declaration

None. No Firebase deploy, Firestore rules/index change, production Firestore read/write migration,
nutrition apply route, real Google Calendar mutation, destructive MyFitnessPal operation,
credential rotation, or Vercel/Firebase/GCP configuration change occurred in this remediation.
