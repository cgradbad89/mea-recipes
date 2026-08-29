# Cooking Mode Selective Promotion — Production Apply

Date: 2026-08-29

Result: **PASS**

Manifest SHA-256: `eb804ad43b50c42c72f02ab54136ef8d2a5f10a1c84301e4ab7d34a86c512a26`

Atomicity: all three authoritative states were checked and all three `cookingStepIngredientMap` values were merge-written in one Firestore transaction.

| Recipe | Runtime hash read back | Exact manifest value | Other root fields unchanged |
|---|---|---|---|
| `garlic-butter-herb-steak-bites-with-potatoes` | `44cda0f92ecc8ead28c21e8d43f6b3eda8071ac635158e6b3ddef4b4069bb1ef` | PASS | PASS |
| `caprese-salad` | `d89131deb41b79ac529c94a31a9db0ad4f438806f2a7ddaa7d1adb5ca42b7a8f` | PASS | PASS |
| `grilled-zucchini-and-summer-squash` | `ad77186403ef6d6715bd4c0e5823793635899d1fbfc4625bc9cec9c601eb757c` | PASS | PASS |

Production writes: 3. Unauthorized recipe writes detected: 0. AI calls: 0. Mapping recomputations: 0 (the deterministic approved→legacy conversion was frozen before apply and only equality-validated during preflight).

Rollback readiness: exact old values/hashes and expected current new hashes are retained in the immutable manifest. Rollback was not executed because production readback passed.
