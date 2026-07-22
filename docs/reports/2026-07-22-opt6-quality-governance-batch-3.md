# OPT-6 Quality Governance — Batch 3

## Status

`IMPLEMENTATION COMPLETE / REVIEW PENDING / REMOTE WRITE PROHIBITED`

This is the next independently reviewable policy-overlap candidate after the
Batch 2 `public.role` closure. It is not a remote apply authorization and it
does not start a later candidate group.

## Scope and candidate selection

- Date: 2026-07-22 (Asia/Shanghai).
- Candidate: the pure `SELECT` overlap on `public.product`.
- Existing policies: `admin_all_product` (`FOR ALL`, Admin) and
  `operator_select_product` (`FOR SELECT`, Operator).
- New forward-only Migration: [00052](../../supabase/migrations/00052_optimize_product_rls_policy_overlap.sql).
- Remaining policy groups, index findings, Auth platform settings, runtime
  paths and synchronization scripts are out of scope.

The candidate was selected from the 00001–00051 replay inventory because its
Operator predicate is a simple role check with no warehouse scope, own-user
condition or command-specific `WITH CHECK`. The migration still requires the
complete two-policy catalog before any `DROP POLICY` and the complete four-
policy catalog after recreation; an extra policy or any predicate/role/
permissiveness/command drift aborts before policy removal.

## Implementation

00052 replaces the two permissive SELECT policies with one
`product_select_admin_or_operator` policy and retains explicit Admin-only
INSERT/UPDATE/DELETE policies. It does not alter tables, functions, grants,
indexes, business rows, old migrations or remote history. The full
`USING`/`WITH CHECK` catalog is normalized with `pg_get_expr` for both gates.

## Verification record

- 00052 static contract: 4/4 passed locally.
- Isolated PostgreSQL 17 behavior and replay contracts: 2 files / 9 tests
  passed locally (product behavior 3/3; continuous 00001–00052 replay 6/6).
  The same suite remains an exact-head CI gate.
- The combined six-file database-contract command ran 39 tests: 35 passed
  and 4 pre-existing locale-only failures in 00041–00049 assertions that match
  English `permission denied` while this PostgreSQL installation emits the
  equivalent Chinese message. The new 00052 contract and the extended replay
  contract are both fully green; CI remains the authoritative full-suite gate.
- Exact-head remote gate: `ce7e623ff396f099c3bf9256733973ce158beb9e`, GitHub
  Actions run `29913122480` (quality and PostgreSQL jobs passed), and Vercel
  Preview `EeNmUmEaEajq3MnRVe7V3RCTfGph` (READY, exact-head match). PR #11 is
  Draft/Open; the first independent review returned `CHANGES_REQUIRED` only
  for stale PR/documentation bindings, so the current status remains FINAL
  REVIEW PENDING and no remote write is authorized.
- Product behavior contract covers anonymous, active Admin, active Operator
  and disabled identities for SELECT/INSERT/UPDATE/DELETE before and after the
  migration, comparing success, row count and SQLSTATE. Guard cases reject an
  extra permissive policy and a changed complete Operator predicate before any
  baseline policy is dropped.
- `git diff --check` and documentation/secret/orphan checks remain required
  before submission. No Staging or Production SQL has been executed for 00052.

Detailed evidence and the exact stop gate are in the
[Batch 3 evidence record](evidence/2026-07-22-opt6-batch3-product-policy.md).

## Stop gate

The complete local/CI quality gate and the designated independent review must
return `PASS` for this exact head before a Staging read-only preflight or any
apply packet is prepared. `CHANGES_REQUIRED` stops the route and limits the
next edit to the reviewer's requested scope. Production, Batch 4 and all
remaining policy groups remain prohibited.

## Navigation

- [Batch 3 evidence](evidence/2026-07-22-opt6-batch3-product-policy.md)
- [Current task packet](../tasks/current-task.md)
- [Optimization roadmap](../tasks/system-optimization-roadmap-2026-07-17.md)
- [Batch 2 report](2026-07-21-opt6-quality-governance-batch-2.md)
- [00052 migration](../../supabase/migrations/00052_optimize_product_rls_policy_overlap.sql)
- [00052 static contract](../../src/features/database/opt6-product-policy-overlap-migration.test.ts)
- [00052 PostgreSQL contract](../../src/features/database/opt6-product-policy-overlap.postgres.test.ts)
