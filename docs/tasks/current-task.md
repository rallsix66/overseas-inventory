# Current Task Packet

## Task ID

**OPT-6-PROGRESSIVE-QUALITY-GOVERNANCE — BATCH 1 CODE COMPLETE / REVIEW PENDING**

## Handoff from OPT-5

- OPT-5 received designated independent `FINAL PASS`.
- PR #8 is merged to `master`; merge commit: `6c71c3f95bd75389b586c0389e01664a8936d053`.
- Master CI run `29719290873` passed both quality and PostgreSQL jobs.
- OPT-6 branch: `agent/opt-6-progressive-quality-governance`, based on that merge commit.
- OPT-5 evidence remains indexed in the [main report](../reports/2026-07-20-opt5-database-least-privilege.md), [Staging evidence](../reports/evidence/2026-07-20-opt5-staging-postcheck.md), and [Production evidence](../reports/evidence/2026-07-20-opt5-production-postcheck.md).

## User-authorized route and stop gates

The user authorized the existing OPT-6 route to continue without repeating stage-by-stage approval, while preserving the gate:

`implement → complete evidence/quality verification → designated independent review → explicit PASS → next stage`.

CHANGES_REQUIRED means stop and fix only the requested scope. This route does not authorize accidental deletion, direct rollback, old Migration replay, RLS bypass, secret exposure, or materially different architecture.

## Batch 1 result (2026-07-20)

- `npm run lint -- --max-warnings 0`: 0 warnings / 0 errors after removing the 31 unused symbols; CI budget is now `--max-warnings 0`.
- 00050 rewrites exactly six reviewed auth init-plan policies. Its pre/post
  catalog gate is exact for command, roles, PERMISSIVE state, and complete
  `USING`/`WITH CHECK`; isolated PostgreSQL tests cover identity plus own/cross
  INSERT and DELETE behavior and reject role/predicate/PERMISSIVE drift.
- `next.config.ts` pins Turbopack root to `__dirname`; the workspace-root warning is gone. The remaining sync NFT trace is a documented residual.
- Draft PR #9 final documentation-synced head `4110a65`: CI run `29730301451` quality/PostgreSQL jobs and Vercel Preview are green; remote database apply and independent review remain pending.
- Independent review returned `CHANGES_REQUIRED`; remediation code head
  `1106edc` adds exact pre/post catalog drift gates plus INSERT/DELETE and
  guard-failure tests. Exact-head CI run `29732371606` and Vercel Preview
  `CYdqHVXh7BQiszVQnJLrnLctU8sg` are green. A documentation-only sync and second
  independent review remain pending; remote database apply is still prohibited.
- OPT-6 policy targets from the reviewed roadmap: 6 `auth_rls_initplan`, 115 `multiple_permissive_policies`, and unused-index findings that must not be bulk-deleted from one Advisor snapshot.
- Turbopack workspace-root misdetection is fixed by `turbopack.root = __dirname`; one NFT trace warning remains because the sync route intentionally uses the project-root runtime path. No further path rewrite is allowed without proving runtime equivalence.
- `npm audit --omit=dev` has 2 moderate PostCSS advisories with no available fix; do not claim audit zero or force an unsafe override.

## Implementation order

1. ✅ Create this isolated branch and record the OPT-5 handoff.
2. ✅ Re-run lint and collect a machine-readable warning inventory; fix unused symbols in small test-backed batches until warning count is zero.
3. ✅ Batch 1: capture the reviewed policy targets, rewrite only six `auth.uid()` init expressions to equivalent scalar subqueries, and prove anonymous, disabled, Admin, Operator, and cross-warehouse behavior unchanged. See [Batch 1 report](../reports/2026-07-20-opt6-quality-governance-batch-1.md).
4. Inventory multiple-permissive policies by table/command/role. Merge only groups whose OR semantics and `WITH CHECK` behavior can be proven; use forward-only Migration(s), never edit 00001–00049.
5. Investigate the Turbopack trace warning and dependency residuals without changing runtime artifact paths, cron schedules, secrets, or provider behavior.
6. Run full local tests, lint budget 0, TypeScript/build, PostgreSQL concurrency/contracts, migration replay, `git diff --check`, links, secret/orphan checks, and available Staging/Production postchecks.
7. Record every batch in `docs/reports/` and indexes, then send Batch 1 to the designated review task. Do not mark OPT-6 DONE, apply 00050 remotely, or start Batch 2 before explicit PASS.

## Current prohibitions

- No changes to 00001–00049; all database changes must be 00050+ forward-only and replayable.
- No policy merge without a before/after identity matrix and exact OR/WITH CHECK equivalence evidence.
- No index deletion from a single Advisor snapshot; require a production statistics window and separate approval boundary.
- No Auth platform setting write unless a controlled connector exists and login regression evidence is available.
- Do not touch user synchronization scripts, `.claude` state, or project-summary files.
