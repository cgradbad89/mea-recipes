# CLAUDE.md — MEA Recipes

Operating rules for working in this repo. Read fully before acting. Domain knowledge,
data model, and business logic live in **PRD.md** — see **See Also** at the bottom.

## Workflow Rules
- Work directly on `main`. Do not create branches. If a branch is created automatically,
  merge it into `main` before pushing to GitHub.
- Run `npm run build` after all changes.
- If the build fails, fix the error and retry. Stop after **3 consecutive failures** —
  output the full error log and make no further changes.
- Never use `git add -A`. Stage files explicitly by path.
- Commit and push to `origin main` only after a successful build.

## PRD Maintenance
After every session, review PRD.md and update if any of these changed:
- New route or page added → update **Page Inventory**.
- Firestore collection/subcollection created or modified → update **Data Model**.
- Domain invariant or calculation rule changed → update the relevant section.
- Backlog item completed → mark **Done** in **Feature Backlog**.
- New gotcha discovered → add to **Known Sharp Edges**.
Do not update PRD.md for bug fixes or UI-only changes unless they affect architecture.
Commit PRD.md changes in the same commit as the feature work.

## Output Report Format
Every session must end with this exact report:

```
Files modified: [list with one-line reason each]
Files created: [list with one-line reason each]
Tests: [new count] new / [total] total
Build: PASSED or FAILED (include error if failed)
Deployment: committed and pushed to main (yes/no)
PRD.md updated: [yes — list sections changed] or [no — reason]
Unverifiable items: [description or "none"]
Anything deferred or not completed: [description or "none"]
```

## Key Constraints
- GitHub repo: github.com/cgradbad89/mea-recipes
- Firebase project: `malignant-metro` (web config hardcoded in `lib/firebase.ts`)
- Vercel project ID: `prj_f5PLUXXwIhiMMddPJAa8mR2GxpbT`
- Vercel team ID: `folstromjohn-1883s-projects`
- Production URL: mea-recipes.vercel.app
- Admin email: `folstromjohn@gmail.com` (only user with access; HubBanner gate)
- No `firestore.rules` file exists in the repo. Do not modify Firestore rules without
  explicit task instruction.

## Architecture Quick Reference
- Pages: `app/**/page.tsx` (App Router; per-route `layout.tsx`)
- API routes: `app/api/**/route.ts`
- Hooks: `hooks/`
- Domain/utilities: `lib/` (firebase, AuthContext, recipes, userdata, queue,
  groceryCategories, flavorPairings, utils)
- Components: `components/`
- Types: `types/`
- Path alias: `@/*` → repo root (see `tsconfig.json`)

## See Also
**PRD.md** — full technical reference: app overview, page inventory, data model,
domain invariants, business logic, sharp edges, feature backlog, and external services.
