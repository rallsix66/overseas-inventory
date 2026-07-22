# Current Task Packet

## Task ID

### Current gate (2026-07-22)

Staging `00051` remote apply/postcheck has its designated independent `PASS`.
Production `00051` apply/postcheck evidence has been captured and the
SELECT-only postcheck passed. The current independent closing review returned
`PASS`, bound to exact head `96c87461afd444b2065059c98ba0cf08522b749e`, CI
`29908869113`, and Vercel Preview `87HAB8w8rTZhDtJAZCvt2kmaRM31`. The earlier
packet-review head
`f7acf211ac66e2b86a22e14254a1ffe75782c224` authorized the controlled
Production execution only; it is not the closing review result. The Batch 3
`public.product` implementation checkpoint is now active, but all remote
writes and every other policy group remain prohibited until this candidate's
own implementation review returns `PASS`.

### Current implementation checkpoint (2026-07-22)

Batch 3 targets only the pure `public.product` SELECT overlap and adds
forward-only `00052_optimize_product_rls_policy_overlap.sql`. Its static and
PostgreSQL behavior contracts, evidence and navigation are recorded in the
[Batch 3 report](../reports/2026-07-22-opt6-quality-governance-batch-3.md) and
[evidence](../reports/evidence/2026-07-22-opt6-batch3-product-policy.md).
The current exact head is `6fd4537198d458fddad7baae174180d7fe478d3a`, bound to
CI `29917354045` and Vercel Preview `AiTr8VWQjKGAbqcUJW9i55odhhFv`; both
exact-head checks are green. The earlier `ce7e623ff396f099c3bf9256733973ce158beb9e`
/ `29913122480` / `EeNmUmEaEajq3MnRVe7V3RCTfGph` values are historical
implementation-checkpoint evidence only. No Staging/Production SQL has been
run. The first independent review returned `CHANGES_REQUIRED` only for stale
PR/documentation bindings; those wording fixes are now pushed and the current
re-review remains `FINAL REVIEW PENDING`. Wait for `PASS`/`CHANGES_REQUIRED`
before preparing any remote preflight. A `PASS` authorizes only the next
controlled Staging read-only preflight, not Production or a later candidate
group.

**OPT-6-PROGRESSIVE-QUALITY-GOVERNANCE ? BATCH 2 REMOTE APPLY/POSTCHECK PASS / BATCH 3 IMPLEMENTATION REVIEW PENDING**

> The title above is a packet label. The current state is
> `STAGING REMOTE APPLY/POSTCHECK FINAL PASS / PRODUCTION APPLY/POSTCHECK
> FINAL PASS / BATCH 3 IMPLEMENTATION REVIEW PENDING`; no remote write is
> authorized for 00052.

## Handoff from OPT-5

- OPT-5 received designated independent `FINAL PASS`.
- PR #8 is merged to `master`; merge commit: `6c71c3f95bd75389b586c0389e01664a8936d053`.
- Master CI run `29719290873` passed both quality and PostgreSQL jobs.
- OPT-6 branch: `agent/opt-6-progressive-quality-governance`, based on that merge commit.
- OPT-5 evidence remains indexed in the [main report](../reports/2026-07-20-opt5-database-least-privilege.md), [Staging evidence](../reports/evidence/2026-07-20-opt5-staging-postcheck.md), and [Production evidence](../reports/evidence/2026-07-20-opt5-production-postcheck.md).

## User-authorized route and stop gates

The user authorized the existing OPT-6 route to continue without repeating stage-by-stage approval, while preserving the gate:

`implement ? complete evidence/quality verification ? designated independent review ? explicit PASS ? next stage`.

CHANGES_REQUIRED means stop and fix only the requested scope. This route does not authorize accidental deletion, direct rollback, old Migration replay, RLS bypass, secret exposure, or materially different architecture.

## Batch 1 result (2026-07-20)

- `npm run lint -- --max-warnings 0`: 0 warnings / 0 errors after removing the 31 unused symbols; CI budget is now `--max-warnings 0`.
- 00050 rewrites exactly six reviewed auth init-plan policies. Its pre/post
  catalog gate is exact for command, roles, PERMISSIVE state, and complete
  `USING`/`WITH CHECK`; isolated PostgreSQL tests cover identity plus own/cross
  INSERT and DELETE behavior and reject role/predicate/PERMISSIVE drift.
- `next.config.ts` pins Turbopack root to `__dirname`; the workspace-root warning is gone. The remaining sync NFT trace is a documented residual.
- Historical checkpoints: Draft PR #9 head `4110a65` / CI `29730301451`, then
  remediation code head `1106edc` / CI `29732371606`; both were green.
- Designated independent review returned `OPT-6 BATCH 1 FINAL PASS` for final
  head `d2eef9cbf09d35de3e0ab01bd2f84991ad59cb51`; CI `29732535403` and Vercel
  Preview `BqS7bgtX77Y9wD9t8LUkvgtf9M9W` are green. The next controlled stage is
  remote 00050 apply/postcheck; Batch 2 remains prohibited until that stage is
  separately evidenced and reviewed.
- PR #9 was merged as `d9acf51e0cfbfd2e21f243f41273de7278f4e80a`;
  master CI `29733960202` and production deployment
  `BKDzcK4k9noxQgzAboJB6h2XjmeF` passed. The controlled remote stage then
  applied 00050 to Staging and Production. Both are now exact `00001`?`00050`,
  with the canonical one-statement 00050 body and six reviewed optimized
policies. See [remote postcheck evidence](../reports/evidence/2026-07-20-opt6-00050-remote-postcheck.md).
- The documentation-only evidence checkpoint was PR #10 head
  `5c80755f25a48496427e59aaa9635027dd989768`; exact-head CI `29739465796` and
  Vercel Preview `sBfgQG7cstb2n5YZkv1w2mvQgEGM` passed. Any later
  documentation head must bind its own exact CI/Vercel result before review.
- The final evidence head `1fbc6b042caf289698d60d2697a909787002968d`
  passed CI `29739720283` and Vercel Preview
  `obXa1wmkxzMorYz9k8AmpkhBSZmG`. The designated review task independently
  confirmed both remote projects and returned `OPT-6 BATCH 1 REMOTE FINAL
  PASS`. PR #10 was merged as `2510b0e070b7fe637239cf0a8eecc3e63aec9570`.
  Batch 1 is closed; this packet is the separately reviewable Batch 2 role
  policy-overlap candidate.
- OPT-6 policy targets from the reviewed roadmap: 6 `auth_rls_initplan`, 115 `multiple_permissive_policies`, and unused-index findings that must not be bulk-deleted from one Advisor snapshot.
- Turbopack workspace-root misdetection is fixed by `turbopack.root = __dirname`; one NFT trace warning remains because the sync route intentionally uses the project-root runtime path. No further path rewrite is allowed without proving runtime equivalence.
- `npm audit --omit=dev` has 2 moderate PostCSS advisories with no available fix; do not claim audit zero or force an unsafe override.

## Implementation order

1. ? Create this isolated branch and record the OPT-5 handoff.
2. ? Re-run lint and collect a machine-readable warning inventory; fix unused symbols in small test-backed batches until warning count is zero.
3. ? Batch 1: capture the reviewed policy targets, rewrite only six `auth.uid()` init expressions to equivalent scalar subqueries, and prove anonymous, disabled, Admin, Operator, and cross-warehouse behavior unchanged. See [Batch 1 report](../reports/2026-07-20-opt6-quality-governance-batch-1.md).
4. Inventory multiple-permissive policies by table/command/role. The local
   `00001`?`00050` replay catalog has 42 policies and 23 concrete overlap
   groups. Batch 2 changes only `public.role`: `00051` proves the Admin OR
   Operator SELECT union and preserves Admin write checks as separate policies.
   The remaining 22 groups stay unchanged until separately proven. Never edit
   00001?00050.
5. Investigate the Turbopack trace warning and dependency residuals without changing runtime artifact paths, cron schedules, secrets, or provider behavior.
6. Run full local tests, lint budget 0, TypeScript/build, PostgreSQL concurrency/contracts, migration replay, `git diff --check`, links, secret/orphan checks, and available Staging/Production postchecks.
7. Record every batch in `docs/reports/` and indexes, then send it to the
   designated review task. Batch 2 must receive explicit PASS before any
   Staging preflight/apply is prepared; Production and all remaining groups
   remain prohibited.

## Batch 2 review result (2026-07-21)

- The designated review task returned `OPT-6 Batch 2 FINAL PASS` for head
  `3885651309ac37f2bf5dd48ce905dfdfe6da8886`. It independently confirmed the
  forward-only `00051` catalog gates, the four-identity CRUD matrix, drift
  rejection before policy removal, documentation navigation, and clean scope.
- Exact-head CI `29798631677` passed the quality and PostgreSQL jobs; the
  associated Vercel Preview and Preview Comments checks are green. Draft PR
  #11 remains open and mergeable.
- At this code-review checkpoint `00051` had not been written to either remote
  environment. Subsequent Staging and Production apply/postcheck results are
  recorded below; this historical checkpoint did not authorize a further
  policy-overlap candidate or PR #11 merge.
- Staging read-only preflight subsequently passed: exact `00001`?`00050`, no
  `00051`, and the full `public.role` two-policy catalog all match the
  reviewed baseline. See [preflight evidence](../reports/evidence/2026-07-21-opt6-00051-staging-preflight.md).
  The designated review task returned `PASS` for this preflight evidence. It
  permits preparation, not execution, of the Staging apply/postcheck packet;
  that atomic write packet needs its own review before any remote write.

## Batch 2 Staging remote result (2026-07-21)

- After the designated review returned `PASS` for the atomic packet, the exact
  generated SQL was executed in Staging project `hyarhvsjhkjpallbyifn` as
  role `postgres`. The SQL Editor returned `Success. No rows returned`.
- A separate SELECT-only postcheck returned one row with all nine checks
  `true`: exact 00001?00051 history, unique version/name sets, no timestamp
  versions, exact 00051 body payload, four policies, and exact normalized
  policy catalog. See [Staging apply/postcheck evidence](../reports/evidence/2026-07-21-opt6-00051-staging-preflight.md).
- This is the historical Staging-only remote evidence. The designated independent review
  returned `PASS` on 2026-07-21, bound to documentation head
  `2905b5bfa54ab8a8cebe6ce746186495231af9fe`, CI `29822891836`, and the green
  Vercel Preview. The later Production apply/postcheck is recorded in the
  Production evidence below; Batch 3 and the remaining policy groups remain
  prohibited.

## Production gate preparation (2026-07-21)

- The SELECT-only Production `00051` exact preflight packet is prepared and
  indexed in the [preflight evidence](../reports/evidence/2026-07-21-opt6-00051-production-preflight.md)
  and [SQL packet](../reports/sql/2026-07-21-opt6-00051-production-preflight.sql).
- Its `expected_history` CTE pins all reviewed `00001`?`00050` version/name and
  full `statements[]` payload summaries; `exact_version_name_history` and
  `exact_history_payload` are executable row-by-row equality gates, with the
  static read-only contract indexed here:
  [preflight contract](../../src/features/database/opt6-production-preflight.test.ts).
- The packet was executed read-only on 2026-07-22 and all history, full-payload,
  role-catalog, and active-run gates passed. The separately reviewed Production
  apply packet then committed in the approved window; its [apply/postcheck
  evidence](../reports/evidence/2026-07-22-opt6-00051-production-apply.md) and
  [SQL packet](../reports/sql/2026-07-21-opt6-00051-production-apply.sql) record
  exact 00001?00051 history, the canonical payload, four role policies, and
  zero active sync runs. Batch 3 remains a separate implementation/review gate.

## Current prohibitions

- No changes to 00001?00049; all database changes must be 00050+ forward-only and replayable.
- No policy merge without a before/after identity matrix and exact OR/WITH CHECK equivalence evidence.
- No index deletion from a single Advisor snapshot; require a production statistics window and separate approval boundary.
- No Auth platform setting write unless a controlled connector exists and login regression evidence is available.
- Do not touch user synchronization scripts, `.claude` state, or project-summary files.
- Do not prepare a remote preflight/apply packet, write Staging/Production, or
  start another candidate until this Batch 3 implementation has complete
  evidence and designated independent review `PASS`.
