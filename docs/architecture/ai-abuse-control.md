# AI Abuse and Cost-Control Boundary

Status: implemented and regression-tested on 2026-08-29.
Repository-wide image/provider boundary extended on 2026-10-05.

## Architecture

All repository-owned model invocation goes through the server-only `lib/ai.ts` boundary.
Provider/model identity lives in `lib/aiConfig.ts`: language/structured output uses
`openai/gpt-5.6-luna`, and offline recipe photos use `openai/gpt-image-2`. Both use
Vercel AI Gateway exclusively, with no direct-provider fallback or caller-selected model.
Only `lib/ai.ts` imports Gateway at runtime and invokes AI SDK model primitives;
`lib/aiConfig.ts` retains a type-only Gateway import.

### Production application

The 11 paid-AI routes in the inventory below retain verified Firebase authentication.
When a route supplies its
server-verified Firebase uid, the helper acquires a Firestore Admin transaction-backed lease from
`lib/aiAbuseControl.ts` before calling Vercel AI Gateway. A denied acquisition prevents model
invocation. The lease is removed in `finally`; an invocation that crashes cannot lock the user out
permanently because leases expire after the class deadline plus 30 seconds.

Usage is stored at `_internalAiUsage/{namespaced-sha256(uid)}`. The uid comes only from
`verifyAuthToken`/`verifyAdminToken`; request bodies cannot select it. The opaque document ID and
state contain no raw uid, prompt, recipe, token, or provider response. One bounded document holds
five class counters and active leases, so no TTL migration or composite index is required. This
server-only Admin path does not require or authorize a rules/index deployment.

### Offline/manual repository tooling

Offline scripts/helpers also must use `lib/ai.ts`. Trusted manual maintenance may
intentionally omit `userId`; it then consumes no per-user Firestore quota/concurrency
lease, while retaining centralized model selection, finite profile deadlines and bounded
retries. These scripts are not application endpoints and are not part of the 11-route inventory.

`scripts/generate-photos.js` loads `lib/ai.ts` through the existing Vite SSR pattern
(repository-root `@` alias and offline `server-only` shim) and calls `generateAIImage`
sequentially with feature `recipe-photo-generation`. The helper defaults to `admin-batch`
(240-second deadline), prompt version `recipe-photo-v1`, one 1024×1024 image and at most
one provider retry. Caller deadlines are bounded by the selected profile; an AbortController
signal cancels the SDK/Gateway request at that deadline, and its timer is cleared in `finally`.
Gateway tags use `aiGatewayProviderOptions`. The helper returns only `{base64, mediaType}`.
The `[ai-image-usage]` event records provider, image model, bounded feature/prompt version,
size and image count, never prompt text, image bytes, uid, credentials or full responses.
Image provenance is separate from the unchanged language `AI_CACHE_ID`; images have no cache contract.

The photo script reports `{id, status:'WRITTEN', url, storagePath}` or
`{id, status:'FAILED', error}` without inferring provider-attempt counts. It remains
unrun and blocked by unprovisioned Firebase Storage; provisioning requires explicit owner action.

`tests/aiBoundaryCoverage.test.ts` deterministically scans runtime source for independent
SDK/Gateway imports, model primitives, direct-provider SDKs/endpoints/credentials and
invocation model literals outside central configuration. It also checks direct dependencies,
`.env.example` and the photo script. `tests/aiAbuseCoverage.test.ts` separately preserves
the production route authentication/uid/limiter inventory.

## Exact profiles

All short windows are 10 minutes. The global per-user ceiling is 500 logical AI calls per UTC day,
in addition to the lower class ceiling. A logical call may make at most one provider retry.

| Class | Calls / 10 min | Calls / UTC day | Concurrent leases | Model deadline | Max output tokens | Typical work |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| interactive | 60 | 180 | 3 | 45 s | 2,500 | one-line grocery parsing, cooking-step gap resolution |
| assistant | 80 | 240 | 3 | 45 s | 2,500 | recipe-assistant turns |
| generation | 20 | 60 | 2 | 90 s | 5,000 | recipe ingest/generation, suggestions, recommendations, grocery cleanup |
| nutrition | 100 | 300 | 4 | 75 s | interactive food/ingredient fallback |
| admin-batch | 80 | 240 | 2 | 240 s | mapping reviewers and authenticated nutrition batch routes |

These ceilings are deliberately above normal single-user UI frequency while bounding a stolen
token or loop. Batch routes reuse the same guard for every AI fallback rather than charging only
once for a potentially large fan-out. Counters reset by UTC day and rolling-window timestamp;
malformed persisted state fails closed with a sanitized denial.

## Active route inventory and fan-out

| Route | Class | AI fan-out after validation | Principal bounds |
| --- | --- | --- | --- |
| `/api/ai-ingest` | generation | exactly one for the selected parse/generate mode | 2 MB body; one active mode; URL/HTML/text/generate and output schema limits |
| `/api/grocery-cleanup` | generation or interactive | one cleanup or one single-line parse | 256 KB; 100 items; bounded fields/output |
| `/api/new-recipe-suggestions` | generation | one | 256 KB; 500 bounded strings per input list; six outputs |
| `/api/plan-suggestions` | generation | one | 256 KB; 21 planned recipes; 500 existing titles; three outputs per bucket |
| `/api/recommendations` | generation | one | 256 KB; 500 recipes/map entries; four outputs per bucket |
| `/api/recipe-assistant` | assistant | one | 256 KB; 40 messages; 64,000 history chars; 200 ingredients; 150 instructions; 16,000 recipe-context chars |
| `/api/nutrition-lookup` | nutrition | food: at most one; recipe: at most one per unresolved parsed ingredient | 32 KB; 500-char food name; 200 ingredient lines; 120 s route ceiling |
| `/api/nutrition-revalidate` | admin-batch | sequential unresolved-ingredient fallbacks, each separately charged; first denial aborts | 50 recipes; 200 ingredient lines each; 280 s route ceiling; apply requires admin |
| `/api/nutrition-canonical-dryrun` | admin-batch | sequential canonical-on/off unresolved fallbacks, each separately charged; first denial aborts | 50 recipes; 200 ingredient lines each; 280 s route ceiling; apply requires admin |
| `/api/cooking-step-map` | interactive | zero when deterministic, otherwise one | 128 KB; 64,000 content chars; 200 ingredients; 150 instructions; 4,000 chars/line |
| `/api/mapping/generate` | admin-batch | zero on reusable proposal; otherwise two reviewer slots with at most two logical attempts each | admin only; 2 KB body; bounded recipe source/output; 280 s route ceiling |

The nutrition batch routes cannot turn their large theoretical input product into unbounded spend:
they execute sequentially, every fallback acquires a lease, the admin-batch 80-call window applies,
and the route has a 280-second platform ceiling. Limiter errors are rethrown through optional
nutrition/mapping layers, preventing retries or fallback handling from converting a denial into a
provider call or a misleading success.

## Failure contract

All limiter denials return HTTP 429 with `Retry-After` and this stable body:

```json
{
  "error": "AI request limit reached. Try again later.",
  "code": "ai-request-limited"
}
```

The response never exposes the denial reason, quota document path, uid, provider response, stack,
or credential. Provider and parsing failures continue to use each route's existing sanitized
non-limiter contract.
