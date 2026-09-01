# MEA Recipes PM Harness Workflow

## Project identity and authority sources

This repository is the private MEA Recipes web application. It is a Next.js App Router application using React, TypeScript, Tailwind CSS, Firebase Authentication/Firestore, Firebase Admin, Vercel, and external recipe, nutrition, AI, calendar, and MyFitnessPal integrations.

For every run, follow the explicit milestone and this project-wide workflow. The milestone may come from a local file or an authenticated owner Slack New Task; a repository milestone file is not required for Slack work. Within the repository, consult `CLAUDE.md`, `PRD.md`, `README.md`, applicable design or audit documents, configuration, and then code and tests. `PRD.md` is the technical and product reference for routes, data models, domain invariants, business logic, known sharp edges, backlog, and external services. Report material conflicts or missing acceptance criteria as `OWNER_REQUIRED`; do not silently choose new product, data, or security policy.

The repository uses npm with the committed lockfile. `.nvmrc` and `README.md` specify Node 26.7.0 and `package.json` specifies npm 11.19.0, while the committed `package.json` engine currently says Node 24.x. Preserve that known discrepancy. Do not change or claim to resolve runtime, package-manager, framework, or dependency policy unless the milestone explicitly authorizes it; a required choice between the conflicting Node declarations is `OWNER_REQUIRED`.

## Role authority

- The PM is read-only. It captures the immutable baseline, interprets the milestone, assigns bounded work, evaluates evidence, and reevaluates failures. It must not edit, stage, commit, deploy, or mutate external systems.
- The Implementer is the only role allowed to make bounded working-tree changes. It may edit only unprotected paths inside this repository that are necessary for the accepted milestone and may run the local deterministic checks described below.
- The Verifier is fresh, independent, and read-only. It inspects the actual diff and baseline, tests the acceptance criteria, and reports PASS or FAIL with command evidence. It must not repair the implementation or expand scope.
- Only the PM may conclude `READY_FOR_OWNER_REVIEW`, and only after an independent Verifier PASS.

## Allowed repository work

- Make the smallest coherent source, test, style, or documentation change required by the milestone.
- Preserve the authentication, authorization, data-ownership, server/client boundary, SSRF protection, request-size limits, sanitization, idempotency, provenance, and domain invariants documented in `PRD.md`.
- Add or update focused regression tests when behavior changes. Do not weaken, delete, skip, or bypass tests or validation to obtain a pass.
- Update `PRD.md` only when the milestone changes documented routes/pages, the data model, domain invariants, business logic, backlog status, external-service behavior, or known sharp edges. Ordinary bug fixes and UI-only changes do not require a PRD rewrite unless they change architecture.
- Do not perform unrelated cleanup, broad reformatting, speculative refactors, corpus regeneration, data remediation, package upgrades, or toolchain changes. New dependencies and lockfile regeneration require explicit milestone authority and any required network or trust decision requires `OWNER_REQUIRED`.

## Protected owner work and local state

- Before delegation, capture one immutable baseline containing branch, HEAD, tracked changes, untracked paths, and relevant worktree state. Every path already dirty or untracked at that baseline is protected owner work.
- Do not modify, delete, rename, move, format, stage, reset, clean, stash, or silently adopt protected owner work. An unusual name, duplicate-looking file, debug log, or local configuration file is not evidence that it is disposable.
- If required milestone work overlaps a protected path, or cannot be distinguished safely from owner work, stop before editing and return `OWNER_REQUIRED` with the exact overlap.
- Do not read, print, copy, edit, or stage secret-bearing files such as `.env`, `.env.local`, other ignored environment files, Firebase credentials, Vercel credentials, session cookies, or local service tokens. Example/template environment files may be inspected and edited only when explicitly in scope and must contain placeholders, never live values.
- Treat `.vercel/`, `.claude/worktrees/`, local editor/launcher state, logs, `.next/`, coverage, build output, caches, generated audit reports, and other ignored artifacts as non-source local state. Validation may regenerate its normal disposable outputs, but agents must not treat those outputs as implementation, stage them, or delete pre-existing local artifacts to make checks pass.
- Never rebaseline after delegation to hide owner changes or unexpected drift. Any non-agent drift after the baseline is `OWNER_REQUIRED`.

## Required validation

Use focused tests or deterministic checks for the changed surface first. For application-code changes, the normal local gate is:

```text
npm run typecheck
npm run lint
npm test
npm run build
```

`npm run build` is required after application changes, as specified by `CLAUDE.md`. Stop after three consecutive attempts at the same failing build or validation problem; preserve the complete useful error evidence and return `OWNER_REQUIRED` rather than cycling or weakening the gate.

For a documentation-only or PM Harness authority change, inspect the exact diff and run `git diff --check`; repository application build/test gates are not required unless the milestone changes executable behavior or explicitly asks for them. Never report an unrun command as passed.

The `audit:*`, `validate:cooking-step-consensus-v9`, and `apply:cooking-step-mappings-v4` scripts are specialized corpus/audit/remediation tools, not ordinary validation. Run one only when the milestone explicitly names its dataset and expected artifacts. Any live service access, AI call, production read, full-corpus execution, manifest activation, or apply/write mode requires `OWNER_REQUIRED`; `apply:cooking-step-mappings-v4` must never be used as autonomous validation.

The Verifier must independently inspect the diff, protected-path baseline, relevant invariants, and test changes, then rerun proportionate deterministic validation where its read-only environment permits. For a full application change, PASS requires credible evidence for all four normal gates, including a successful build, and focused evidence for the acceptance criteria.

## Git rules

- Work only in the existing checkout. PM Harness work must not create branches, worktrees, commits, tags, or remotes, even though `CLAUDE.md` describes the repository's ordinary human commit/push flow.
- Do not stage files. Do not run `git add`, including `git add .` or `git add -A`.
- Do not commit, amend, cherry-pick, rebase, merge, push, force-push, fetch-and-integrate, or change upstream/remote configuration.
- Do not rewrite history, delete branches, create tags, or merge to `main` or another protected branch.
- Do not use destructive or owner-state-changing Git operations, including reset, clean, stash, checkout/restore of paths, or any equivalent attempt to discard or conceal work.
- Read-only Git inspection and diff commands are allowed. The owner reviews and decides how to stage, commit, merge, and push after harness completion.

## External systems, data, and deployment

- No autonomous production or preview deployment, Vercel project linking, environment mutation, domain/cron/provider configuration, release, publish, or hosting change. Do not run Vercel deployment commands.
- Never run `firebase deploy` or deploy Firestore rules or indexes. Firestore rules and indexes for the shared `malignant-metro` project are owner-managed in Firebase Console. Never add a `firestore` target to `firebase.json`.
- Do not write, delete, migrate, backfill, normalize, seed, repair, or approve production Firebase data. Do not invoke admin/apply modes or authenticated product endpoints to manufacture verification evidence.
- Do not rotate, reveal, or alter credentials, secrets, OAuth consent/scopes, Firebase Auth providers, owner/admin identity, billing, account settings, or external provider configuration.
- Do not make live calls to Vercel AI Gateway, USDA, MyFitnessPal, Google Calendar, or other paid/authenticated services during ordinary implementation or verification. Stub or mock external boundaries in tests. MyFitnessPal session material and Google Calendar access tokens are especially sensitive and must never appear in logs or artifacts.
- The existing local Firebase emulator flow (`npm run dev:emulator`) may be used only when the milestone needs it and can remain fully local. It grants no authority to connect to, import from, or mutate production.
- A milestone requiring external network access, owner credentials, production reads/writes, irreversible remote decisions, or provider-side verification stops at `OWNER_REQUIRED` unless the owner separately performs the action and supplies bounded evidence.

## Approval boundaries and owner stops

PM Harness approval requests are not a route around this contract. Do not request or retry elevated authority for a prohibited action. Return `OWNER_REQUIRED` for any of the following:

- unavoidable overlap with protected owner work, ambiguous ownership, or unexpected workspace drift;
- ambiguous or conflicting product requirements, acceptance criteria, data ownership, provenance, or security behavior;
- authentication/authorization, Firestore rules/indexes, schema/migration, owner/admin identity, secret, billing, provider, or deployment decisions;
- a dependency, runtime, package-manager, lockfile, framework, or external network change without explicit bounded authority;
- production data/corpus work, live external calls, full-corpus generation/review, migration/apply modes, or destructive/local cleanup;
- a command that requests interactive approval, credentials, broader filesystem access, network access, or external mutation;
- inability to prove the acceptance criteria, a required gate blocked by the environment, or the same validation failure after three reasoned attempts;
- any need to expand the milestone or weaken a safety, test, lint, type, build, or approval boundary.

## Verification and readiness

The Implementer must hand off the exact diff, paths touched, commands run with outcomes, acceptance evidence, and any residual risks. The Verifier must confirm that changes are bounded to the milestone, protected owner work is unchanged, tests genuinely exercise the behavior, repository invariants remain intact, the validation evidence is credible, and no external or Git authority was exercised.

The PM may return `READY_FOR_OWNER_REVIEW` only when:

- every acceptance criterion is satisfied with repository evidence;
- the independent Verifier reports PASS;
- required focused and normal validation passed, with any proportionate omission explicitly justified;
- only intended unprotected repository paths changed and the baseline remains intact;
- required `PRD.md` documentation was updated, or its omission is correctly justified;
- no secret, generated artifact, production data, external system, deployment, stage, commit, or remote was changed; and
- there is no unresolved security, data, ownership, scope, or validation ambiguity.

`READY_FOR_OWNER_REVIEW` means only that the bounded working-tree change is ready for the owner's review. It does not authorize staging, committing, pushing, deploying, or production verification.

## Recovery expectations

On failure, preserve owner work and useful diagnostics, identify the smallest failing command or invariant, distinguish pre-existing failures from milestone regressions using baseline evidence, and let the PM reevaluate. Do not reset, clean, stash, delete local state, broaden the fix, or repeatedly rerun unchanged commands. If safe local recovery is not possible within scope, return `OWNER_REQUIRED` with the exact blocker and the smallest owner action needed.
