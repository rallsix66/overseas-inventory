# OPT-6 Quality Governance — Batch 2

## Status

`CODE COMPLETE / LOCAL VERIFY PASS / REVIEW PENDING / REMOTE WRITE PROHIBITED`

This is the second independently reviewable OPT-6 batch. It does not mark
OPT-6 complete, does not authorize Batch 3, and does not authorize a remote
Migration write before the designated independent review returns explicit
`PASS`.

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

Before any remote action, this exact packet needs full quality checks and an
explicit PASS from the designated review task. A PASS can authorize only the
next controlled Staging preflight/apply packet; it does not authorize
Production or a further Batch 2 candidate.

## Navigation

- [Policy inventory evidence](evidence/2026-07-21-opt6-batch2-policy-inventory.md)
- [Current task packet](../tasks/current-task.md)
- [Optimization roadmap](../tasks/system-optimization-roadmap-2026-07-17.md)
- [00051 migration](../../supabase/migrations/00051_optimize_role_rls_policy_overlap.sql)
- [00051 static contract](../../src/features/database/opt6-role-policy-overlap-migration.test.ts)
- [00051 PostgreSQL behavior contract](../../src/features/database/opt6-role-policy-overlap.postgres.test.ts)
