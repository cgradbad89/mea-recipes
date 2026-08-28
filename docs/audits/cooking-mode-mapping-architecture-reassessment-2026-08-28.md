# Cooking Mode Mapping Architecture Reassessment — 2026-08-28

## Executive decision

**ARCHITECTURE DECISION — AI-AT-INGESTION WITH REVIEW**

Select **Alternative C: two blind whole-recipe reviewers, candidate union, deterministic
evidence/risk routing, human review of uncertainty, and immutable approved persisted maps**.

The architecture keeps all required invariants:

- Cooking Mode runtime makes **0 AI calls**.
- AI output is a proposal, not canonical truth.
- Only a source-bound, approved persisted map may drive final runtime highlighting.
- Production apply calls no AI, recomputes no mapping, and writes only reviewed manifest values.
- Precision and recall remain independent release gates.

This task changed no runtime, mapping implementation, recipe, Firestore document, or UI. It made
zero AI calls and did not rerun the 228-recipe corpus.

## Deterministic-work decision

**ONE NARROW DETERMINISTIC SUPPORT LAYER REMAINS JUSTIFIED.**

That layer serves the reviewed ingestion architecture. It may extract evidence, identify risk,
prioritize review, and eventually auto-accept only a narrowly proven zero-FP subset. It must not
become V10H or another program of deterministic semantic mapping.

## Why the architecture must change

Production maps are precise but incomplete:

| Metric | Result |
|---|---:|
| TP / FP / FN | 1,375 / 12 / 2,677 |
| Precision | 99.13% |
| Recall | 33.93% |
| Explicit-active-use recall | 38.41% |
| CRITICAL recall | 24.90% |
| Seasoning/herb recall | 36.61% |
| Prepared-component recall | 4.07% |

The strongest discovery result is the original full-corpus reviewer union: it found 2,675 of
2,677 confirmed omissions, approximately 99.93%. The same evidence also proves that AI discovery
is not deterministic truth: temperature-zero repeats varied, and direct reviewer union contains
false positives.

V6–V10G show that downstream semantic decision layers do not close this gap safely:

| Stage | TP | FP | FN | Precision | Recall |
|---|---:|---:|---:|---:|---:|
| Frozen reviewer union | 833 | 28 | 35 | 96.75% | 95.97% |
| V9 final | 657 | 9 | 211 | 98.65% | 75.69% |
| V10B | 748 | 9 | 85 | 98.81% | 89.80% |
| V10C | 669 | 2 | 164 | 99.70% | 80.31% |
| V10D | 642 | 0 | 191 | 100% | 77.07% |
| V10G | 773 | 0 | 60 | 100% | 92.80% |

V10G materially improved recall by 15.7 points without adding a false positive, but it failed the
precommitted pronoun/deictic gate: 46/55, 83.64%, below 85%. Its remaining 60 false negatives span
collective aliases, transfer/assembly, serving/garnish, multi-component assembly, and broader
reference semantics. Another deterministic subsystem is not justified before adopting reviewed
AI-at-ingestion.

## Repository architecture boundary

The existing implementation already has useful seams:

- `lib/recipes.ts` parses final content, computes a deterministic map and source hash, optionally
  calls `/api/cooking-step-map`, validates the response, and includes the map in the initial recipe
  write.
- Queue publish and both Discover save flows finalize content before calling that helper.
- `types/recipe.ts` stores schema/parser/engine/source-hash metadata and per-reference provenance.
- `lib/cookingStepMapping.ts` binds maps to exact ordered ingredient/instruction arrays and validates
  schema, parser, supported engine, hash, indexes, provenance, and structure.
- `components/CookingMode.tsx` resolves the map asynchronously but performs no mapping network call
  or write.
- Existing v4/v5 apply tools demonstrate immutable-path and SHA locks, exact source-hash and
  update-time preconditions, field-only writes, exact readback, non-map comparison, and zero-write
  post-apply verification.

The future architecture can therefore replace the ingestion decision boundary without putting AI
in Cooking Mode or weakening the established migration/apply safety model.

## Reviewer agreement and disagreement

### Frozen 36-recipe benchmark

| Vote state | Correct | Incorrect | Total | Precision | Recall contribution |
|---|---:|---:|---:|---:|---:|
| Both reviewers accept | 763 | 9 | 772 | 98.83% | 87.90% |
| Exactly one accepts | 70 | 19 | 89 | 78.65% | 8.06% |
| Neither accepts, but truth is positive | 35 | — | 35 | — | 4.03% missed |
| Union | 833 | 28 | 861 | 96.75% | 95.97% |

### Full 228-recipe audit, recomputed from existing stored evidence

No corpus or AI rerun was performed. The following totals come from the existing audit JSON's
per-step reviewer A, reviewer B, and adjudicated index sets:

| Strategy | TP | FP | FN | Precision | Recall |
|---|---:|---:|---:|---:|---:|
| Reviewer A | 3,990 | 125 | 62 | 96.96% | 98.47% |
| Reviewer B | 4,004 | 122 | 48 | 97.04% | 98.82% |
| Intersection | 3,944 | 19 | 108 | 99.52% | 97.33% |
| Union | 4,050 | 228 | 2 | 94.67% | 99.95% |
| Disagreement only | 106 | 209 | — | 33.65% | 2.62% contribution |

There are 315 disagreement relationships across 82 recipes. Agreement is plainly useful as a
confidence signal: its precision is much higher than disagreement. It is not final truth: the
intersection still contains 9 frozen and 19 full-corpus false positives. Therefore:

```text
both agree + passes a separately proven no-risk contract
→ candidate for auto-accept

reviewer disagreement OR any risk/unsupported condition
→ human review
```

Agreement alone must never auto-accept.

## The 28 frozen reviewer-union false positives

The taxonomy below is mutually exclusive and preserves the existing adjudicated truth. It adds no
new correctness labels.

| Risk family | Count | Meaning |
|---|---:|---|
| Obvious lexical/lifecycle error | 5 | Serving-only continuation, process material, wrong/not-established alias, or a source group that excludes the candidate target |
| Passive component leakage | 7 | A raw row is carried into a later action on an assembled dish even though the benchmark does not treat it as independently active |
| Generic seasoning | 2 | Bare “taste and adjust seasoning” is expanded to salt/pepper without a row-specific target |
| Component boundary | 11 | A constituent crosses a named dressing/broth/mixture/pickle-component boundary |
| Genuinely semantically ambiguous | 3 | Continuing cook, serving, or refrigerating language plausibly supports either active-use policy |
| **Total** | **28** | Exact reconciliation |

Twenty-five of 28 errors fall into four repeated source-observable families. This concentration is
enough to justify risk routing. It is not enough to justify automatic semantic rejection: the
same lifecycle/component signals also occur on many correct relationships.

V10B proves that distinction. Its broad router found all 30 incorrect candidates, but it also
routed 447/833 correct candidates. That is acceptable as review metadata; it would be expensive as
the permanent routing frontier and destructive as a veto.

## Architecture alternatives

### Alternative A — continue deterministic refinement

Reject.

- Expected recall ceiling: the locked V10G result is 92.80% candidate recall, still below the final
  explicit-use and severity targets.
- Precision risk: every broader semantic subsystem reopens component/lifecycle collisions.
- Complexity: a collective alias resolver, transfer/assembly subsystem, serving/garnish subsystem,
  and additional lifecycle rules would interact rather than remain orthogonal.
- Test burden: every rule needs the 863-candidate frozen population, locked FP cases, class gates,
  quantity regressions, prepared components, and new-recipe generalization.
- Maintenance: cooking-language semantics, not simple identity matching, now dominate.
- Overfitting: V10F-Lite's 100% pronoun recovery on 10 selected cases became 83.64% on all 55.
- Generalization: the precommitted stop rule already fired.

### Alternative B — reviewer union directly persists maps

Reject as automatic architecture.

It is simple and has the best discovery recall, but direct persistence would canonize 28 frozen and
228 full-corpus false positives. Temperature-zero variation also means retries can silently change
the map. Human review can make this safe, but then the architecture is Alternative D.

### Alternative C — reviewer union, deterministic evidence/risk routing, review uncertainty

Recommend.

This preserves high-recall discovery while changing the role of deterministic logic. Evidence and
risk facts decide **where human judgment is required**, not whether every semantically difficult
relationship is globally suppressed. Approved results become immutable, source-bound data. Runtime
remains deterministic and AI-free.

### Alternative D — reviewer union plus full human review

Do not select for steady-state ingestion. Use its stricter policy for the one-time existing-corpus
remediation.

Full review provides the most control, but the existing corpus has 4,278 union relationships—18.76
per recipe—and all 228 recipes require review. That is reasonable once for remediation and excessive
as the permanent ingestion default if a narrow, proven routing contract can safely resolve most
relationships.

## Human-review burden

### Observed existing-corpus units

- Reviewer-union candidates: **4,278** total; **18.76 average**, **18 median** per recipe.
- Reviewer disagreements: **315** total; **1.38 average**, **0 median** per recipe.
- Recipes with any disagreement: **82/228**.

### Alternative B

- Direct automatic persistence: 0 review relationships, but unsafe.
- Adding complete human review: 4,278 relationships, which is Alternative D.

### Alternative C

The exact full-corpus count is not yet measurable because the routing contract does not exist.
Existing evidence provides three planning points:

1. **Unsafe floor — disagreement only:** 315 relationships, 1.38 per recipe, 82 recipes. This leaves
   19 agreed false positives and is not acceptable.
2. **Frozen V10G frontier:** 773 of 861 reviewer-union candidates auto-accepted correctly; 88 went
   to review (60 correct, 28 incorrect), **2.44 per frozen recipe**, with 21/36 recipes requiring
   review. Auto-resolved share: 89.78%.
3. **Broad V10B routing:** 477/863 candidates routed. Applying that rate mechanically to 4,278
   candidates gives approximately 2,365 review relationships, 10.37 per recipe.

If the frozen V10G rate generalizes, the 228-recipe corpus would require approximately **437 review
relationships, 1.92 per recipe, across about 133 recipes**. This is a planning projection, not a
measured full-corpus result. It is also not yet deployable as a deterministic router: V10G's rescue
rule is deterministic, but the frozen 773-accept frontier includes the V10D baseline, whose experiment
used 392 bounded arbiter decisions.

### Alternative D

- Review relationships: **4,278**.
- Average/median: **18.76 / 18** per recipe.
- Recipes with review: **228/228**.

No review-time estimate is supplied because the repository contains no authoritative seconds/minutes
per relationship.

### Future ingestion planning

The existing corpus suggests a typical recipe produces about 18 union relationships. Alternative C
should target roughly 2 reviewed relationships per recipe if its narrow frontier generalizes;
Alternative D requires about 18. The next task must measure this before activation.

## V10G's remaining role

### Automatic safe-accept evidence

Retain conditionally. V10G added 131 correct accepts and no incorrect accepts across all 30 frozen
incorrect candidates. That is useful zero-FP evidence. It does not authorize production auto-accept
until the exact deterministic routing contract is extracted and independently frozen.

### Risk/suppression evidence

Do not use V10G/V10D as a broad global veto. V9's arbiter and hard safety, and V10B–V10D's semantic
decision layers, repeatedly traded hundreds of correct relationships for precision.

### Review prioritization metadata

Retain. Reviewer vote, source evidence, quantity state, component boundary, lifecycle state, semantic
class, and V10G basis make review faster and auditable without claiming they are truth.

### Discard entirely

Reject. The zero-FP evidence is valuable even though deterministic mapping refinement has stopped.

## Minimal future ingestion architecture

```text
Final exact recipe content
        ↓
Canonical parse + sourceHash
        ↓
Blind reviewer A       Blind reviewer B
        └──────────┬──────────┘
                   ↓
          Normalized candidate union
                   ↓
       Versioned deterministic evidence/risk
                   ↓
  safe auto-accept / review-required / clear structural reject
                   ↓
       Human decides every uncertain relationship
                   ↓
          Immutable approved map + provenance
                   ↓
      Persist approved version bound to sourceHash
                   ↓
  Cooking Mode validates and reads it; 0 runtime AI calls
```

### AI calls

Exactly two successful semantic reviewer calls per new source version: reviewer A and reviewer B.
A bounded transport/schema retry may repeat a failed call; it does not add a third semantic judge.

### Candidate generation

Both reviewers are blind to each other and to current/proposed maps. Their normalized union is a
proposal set. Candidate IDs are deterministic from recipe/source/step/ingredient identity.

### Nondeterminism

Store normalized reviewer outputs, attempt IDs, prompt/model identifiers, and output hashes. A repeat
creates a new proposal attempt. It never overwrites an approved map and cannot be cherry-picked merely
because it differs.

### Routing states

- `AUTO_ACCEPT_HIGH_CONFIDENCE`: only a versioned relation class with frozen zero-FP evidence, exact
  source grounding, reviewer support, and no risk flag. Agreement alone is insufficient. Disable this
  state initially for every unproven class.
- `REVIEW_REQUIRED`: any disagreement, risk flag, unsupported semantic class, component relation,
  ambiguous lifecycle/reference, or completeness concern.
- `AUTO_REJECT_CLEAR_ERROR`: structural impossibility only—out-of-range/header index, duplicate,
  malformed evidence, source-hash mismatch, or no support in the exact parsed source. Semantic risk
  routes to review rather than rejection.

### Provenance and versioning

Persist or retain with the approved artifact:

- schema, parser, mapping-contract, reviewer-prompt, and model identifiers;
- exact source hash;
- reviewer attempt IDs and normalized-output hashes;
- per-candidate votes, deterministic evidence/risk flags, routing state, and human decision;
- approved map hash, approver, and approval timestamp.

Approved versions are immutable. A new source hash or mapping contract creates a new proposal and map
version; prior versions remain audit evidence.

### Retry and failure behavior

Retry only bounded transport/schema failures under an idempotency key. A successful but semantically
different output is a separate attempt, not an invisible retry. If generation or review is incomplete,
fail closed: no proposal is approved. A last approved map remains usable only if its exact source hash
still matches. Otherwise no provisional AI map drives runtime.

### Recipe edits

Changes to parsed ingredient text/order or instruction text/order change `sourceHash`, mark the prior
map stale, and require two fresh reviews plus routing/approval. Metadata-only edits do not invalidate
the map.

### Runtime

Cooking Mode validates approved status, schema, supported version, source hash, step structure, and
indexes, then reads the persisted map. Runtime performs no AI call, no generation, and no write.

## Existing corpus remediation

Use stricter full review for the one-time 228-recipe remediation:

```text
Locked exact recipe sources
        ↓
Offline two-reviewer high-recall proposals
        ↓
Complete human map + source-completeness review
        ↓
Immutable approved mapping values
        ↓
Sorted manifest + approval evidence + SHA locks
        ↓
Live dry-run/readback preflight
        ↓
Separate explicit production-apply prompt
        ↓
Exact approved field-only writes with update-time preconditions
        ↓
Exact readback + non-map comparison + zero-write post-dry-run
```

The apply stage must make zero AI calls, run zero deterministic or hybrid mapping generation, perform
zero candidate substitution, and write only the values already approved in the locked manifest.
Rollback evidence must include exact prior map values/hashes (or explicit absence) and a reverse
manifest. Post-apply verification must cover exact candidate equality, source hashes, validator
success, non-map fields, excluded/skipped rows, and idempotent zero-write rerun.

Prepared components need a separate quality gate. The existing component evidence—40.49% V10A
arbiter precision and label-sensitive truth—does not justify folding component auto-acceptance into
the ingredient contract.

## Cost and operations

No model price is estimated because the evidence contains no authoritative current pricing.

| Alternative | AI calls/new recipe | Human review | Code/maintenance | Main failure mode | Runtime cost |
|---|---:|---|---|---|---|
| A — deterministic refinement | 0 | none | Very high | Semantic ceiling and benchmark overfit | Local persisted/fallback read |
| B — direct union persistence | 2 | 0 | Low | Nondeterministic false positives become canonical | Approved-looking persisted read, unsafe |
| C — reviewed routing | 2 | Uncertain only | Moderate | Router too broad or too permissive; human queue backlog | Approved persisted read |
| D — full review | 2 | Every relationship | Low code, high operations | Review throughput/fatigue | Approved persisted read |

Alternative C is the most debuggable: every final relationship has reviewer votes, source evidence,
risk classification, routing decision, and—where needed—a human decision. Runtime and migration remain
simple because they consume only a finalized immutable map.

## Final quality and release gates

The architecture is plausible only if a future frozen validation demonstrates:

- precision = 100%;
- explicit-active-use recall at least 99%;
- CRITICAL recall = 100%;
- HIGH recall at least 99%;
- seasoning/herb recall at least 98%;
- a separately defined prepared-component gate;
- exact source/version/provenance coverage;
- zero AI calls in Cooking Mode and production apply.

## Exactly one next task

**DESIGN REVIEW-ROUTING CONTRACT**

Specify deterministic candidate IDs, evidence fields, exact state transitions, initial conservative
auto-accept rules, review-manifest shape, idempotency/retry behavior, and frozen benchmark arithmetic.
The task must make no AI calls, generate no production maps, and change no runtime. It is the smallest
step that can turn V10G's zero-FP evidence into a testable support contract and measure Alternative C's
real review burden without restarting deterministic mapper research.

## Unverifiable items

- Exact full-228 Alternative C review burden until a routing contract exists.
- Whether V10G's combined 773-accept frontier can be expressed as a standalone deterministic router;
  its V10D baseline included bounded arbiter decisions.
- Prepared-component review burden under a future canonical component contract.
- Provider dollar cost and model revision metadata.

## Production mutation

- Firestore writes: **0**
- Recipe writes: **0**
- Mapping writes: **0**
- AI calls: **0**
- Full-corpus reruns: **0**
- Runtime/UI changes: **0**
