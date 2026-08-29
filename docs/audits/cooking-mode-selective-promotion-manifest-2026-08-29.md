# Cooking Mode Selective Promotion Manifest

Date: 2026-08-29

Status: **FROZEN FOR APPLY**

Canonical manifest SHA-256: `eb804ad43b50c42c72f02ab54136ef8d2a5f10a1c84301e4ab7d34a86c512a26`

The JSON artifact contains exactly three authorized recipes, each recipe's exact old runtime value and rollback value, the exact approved-map-derived new runtime value, hashes, write target, and fail-closed preconditions. Hashing uses recursively key-sorted compact JSON without a trailing newline.

| Recipe | Recipe revision | Approved map | Old runtime hash | New runtime hash |
|---|---|---|---|---|
| `garlic-butter-herb-steak-bites-with-potatoes` | `recipe-content-v1:sha256:12d66c715191dea38fb8cd26c21100b252ca1466b0ccfc9a580d380e607de31c` | `am1:2e1a048556bb2d533ee6aff418e6b7c7393cd99e48c5ece6cdc0781d804148f3` | `4e8adac082fb7d69005454dd09627e56c2f97534f690cae48e0f15ec3bb3478f` | `44cda0f92ecc8ead28c21e8d43f6b3eda8071ac635158e6b3ddef4b4069bb1ef` |
| `caprese-salad` | `recipe-content-v1:sha256:18a822baf7f445bf2e21608bf808aac3d06d1568aab70f9c9eaa3ae72615c2fe` | `am1:ecf8ef1f73f5bc5e5d890872a210def2c4bc7723f018b44c6fff558023f1bc59` | `17c735d36cdaed36d044fd4cc73adabdb93eb720866f54a7a97def3613bb781c` | `d89131deb41b79ac529c94a31a9db0ad4f438806f2a7ddaa7d1adb5ca42b7a8f` |
| `grilled-zucchini-and-summer-squash` | `recipe-content-v1:sha256:7ed87f545dc6bfb7edae65d1616add9b31c003d2567270db45012ddb57ba011e` | `am1:592d74d63c9b64c3bb465a92d6dc945efc787aa126d0896d9705d2a5e00f90d1` | `042946e214472f4375dcc0864987fb30e078e23dbed0ab98342b540615f07f0d` | `ad77186403ef6d6715bd4c0e5823793635899d1fbfc4625bc9cec9c601eb757c` |

Apply rule: verify this SHA, recheck all three authoritative preconditions, and commit all three field-only writes in one Firestore transaction. No AI, review change, routing change, candidate generation, or runtime recomputation is permitted during apply.

Rollback rule: require the current runtime hash to equal the recorded new hash, then restore the exact recorded old value for all three in one transaction.
