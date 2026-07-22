# OPT-6 Quality Governance — Batch 2

## Status

`STAGING REMOTE APPLY/POSTCHECK FINAL PASS / PRODUCTION PREFLIGHT PASS / APPLY PACKET REVIEW PENDING`

This is the second independently reviewable OPT-6 batch. It does not mark
OPT-6 complete, does not authorize Batch 3, and has not executed a Production
write. The designated independent review returned `PASS` for head
`3885651309ac37f2bf5dd48ce905dfdfe6da8886`, with exact-head CI
`29798631677` and Vercel Preview green. That PASS authorizes only preparation
of the controlled Staging exact preflight/apply packet; it does not authorize
Production or a further Batch 2 candidate.

## Scope

- Branch: `agent/opt-6-batch-2-policy-inventory`.
- Base: Batch 1 evidence merge `2510b0e070b7fe637239cf0a8eecc3e63aec9570`.
- Date: 2026-07-21 (Asia/Shanghai).
- New forward-only migration: `00051_optimize_role_rls_policy_overlap.sql`.

The batch starts from a catalog inventory rather than treating the Advisor's
115 multiple-permissive-policy findings as a bulk cleanup. The inventory has
42 policies and 23 concrete same-table/action overlaps. Only the small
`public.role` SELECT overlap is in scope here.

## Change

The old role-table policy pair was:

- `admin_all_role`: Admin `FOR ALL`.
- `operator_select_role`: Operator `FOR SELECT`.

Their SELECT permissions are a permissive OR. Migration `00051` replaces the
pair with one shared Admin-or-Operator SELECT policy and three separate
Admin-only INSERT/UPDATE/DELETE policies. That maintains the original union
for every command while removing the only overlapping permissive pair for this
table/action.

The migration has exact pre/post catalog gates and rejects any role-table
policy drift before a `DROP POLICY` occurs. It has no business DML, no old
Migration edit/replay, and no remote history manipulation.

## Local verification

- 00051 static contract: 4/4 passed.
- Isolated PostgreSQL 17 replay `00001`–`00051`: 5/5 passed.
- Isolated PostgreSQL identity matrix and guard failures: 3/3 passed.
- Combined focused suite: 12/12 passed.
- Default non-PostgreSQL suite: 94 files / 3949 tests passed.
- Lint: 0 errors / 0 warnings.
- Next.js 16.2.9 production build and TypeScript: passed. The pre-existing
  sync-route NFT trace warning remains documented and was not changed.
- PostgreSQL concurrency: 44/44 passed in its own fresh temporary database.

The behavior matrix covers anonymous, active Admin, active Operator, and a
disabled user for SELECT/INSERT/UPDATE/DELETE before and after the migration.
It compares result success, row count and SQLSTATE. Drift tests prove that an
extra policy and a changed complete Operator predicate leave the baseline
catalog untouched because the migration rejects before policy removal.

The complete local database-contract command also exercised all five contract
files. The new 00051 suite and its replay passed; four pre-existing assertions
in 00041–00049 expect the English text `permission denied`, while this local
PostgreSQL installation emits the equivalent Chinese permission message. That
locale-only baseline is not changed by this batch; the CI PostgreSQL job is the
authoritative exact-head gate for the complete suite.

## Deferred work and stop gate

The other 22 groups remain deliberately unchanged. Their combinations include
warehouse scopes, own-user predicates and command-specific `WITH CHECK`
rules; they need their own equivalence matrices rather than a bulk transform.
Unused-index investigation, Auth configuration and the documented NFT trace
residual are also out of scope.

The complete packet received designated independent `PASS` on 2026-07-21.
The controlled Staging exact preflight/apply packet has now been executed and
postchecked successfully, and the designated independent review returned
`PASS` on 2026-07-21. This authorizes only preparation of a separate Production
exact preflight and maintenance-window packet. Production and every further
Batch 2 candidate remain prohibited.

The Staging read-only preflight is now `PASS`: the environment has exact
`00001`–`00050` history, no `00051`, and the complete two-policy
`public.role` baseline matches the reviewed catalog. This was the read-only
preparation checkpoint. The reviewed atomic Staging packet then returned
`Success. No rows returned`; its separate SELECT-only postcheck returned all
nine checks `true`. See the [Staging apply/postcheck evidence](evidence/2026-07-21-opt6-00051-staging-preflight.md).
The Staging remote apply/postcheck review is closed with `PASS`, bound to
documentation head `2905b5bfa54ab8a8cebe6ce746186495231af9fe`, CI
`29822891836`, and the green Vercel Preview. This does not authorize Production.

## Production gate preparation (2026-07-21)

The corrected read-only Production exact preflight was executed on 2026-07-22
against project `hzlhqyditalumhnxbaim` and returned one row with every history,
full-payload, role-catalog, and active-run gate passing. Actual and expected
version/name digest were both `f046958a6c39a8b240536a6f59b5cb18`; actual and
expected full-payload digest were both `7a743aa540a39a1f4d3fe7e2a01ea08d`.
See the [Production preflight evidence](evidence/2026-07-21-opt6-00051-production-preflight.md)
and [SELECT-only SQL packet](sql/2026-07-21-opt6-00051-production-preflight.sql).
The generated [Production apply packet](sql/2026-07-21-opt6-00051-production-apply.sql)
is now recorded as an audit artifact. It has not been executed; a separate
designated independent review `PASS` is required for this exact packet before
any Production maintenance window. Batch 3 remains prohibited.

## Review closure

- Designated review: `OPT-6 Batch 2 FINAL PASS`.
- Reviewed head: `3885651309ac37f2bf5dd48ce905dfdfe6da8886`.
- Draft PR: [#11](https://github.com/rallsix66/overseas-inventory/pull/11),
  open and mergeable; it remains unmerged.
- Exact-head CI: `29798631677`, with the quality and PostgreSQL jobs passed.
- Deployment evidence: [Vercel Preview](https://vercel.com/rallsix66s-projects/overseas-inventory/8KhF7SHrowPf3nCK69BRqAihtpZu)
  and Preview Comments passed.
- Review scope includes migration direction and catalog gates, identity and
  drift tests, repository scope, documentation navigation, CI, and Preview.
  It does not substitute for Staging postcheck or authorize Production.

## Navigation

- [Policy inventory evidence](evidence/2026-07-21-opt6-batch2-policy-inventory.md)
- [Staging read-only preflight evidence](evidence/2026-07-21-opt6-00051-staging-preflight.md)
- [Production exact preflight packet](evidence/2026-07-21-opt6-00051-production-preflight.md)
- [Production preflight SQL](sql/2026-07-21-opt6-00051-production-preflight.sql)
- [Production apply packet evidence](evidence/2026-07-22-opt6-00051-production-apply.md)
- [Production apply SQL](sql/2026-07-21-opt6-00051-production-apply.sql)
- [Production preflight static contract](../../src/features/database/opt6-production-preflight.test.ts)
- [Staging apply generator](../../scripts/prepare-opt6-00051-staging-apply.ps1)
- [Current task packet](../tasks/current-task.md)
- [Optimization roadmap](../tasks/system-optimization-roadmap-2026-07-17.md)
- [00051 migration](../../supabase/migrations/00051_optimize_role_rls_policy_overlap.sql)
- [00051 static contract](../../src/features/database/opt6-role-policy-overlap-migration.test.ts)
- [00051 PostgreSQL behavior contract](../../src/features/database/opt6-role-policy-overlap.postgres.test.ts)
