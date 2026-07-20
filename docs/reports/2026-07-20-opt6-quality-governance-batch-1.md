# OPT-6 Quality Governance — Batch 1

## Status

`CODE COMPLETE / LOCAL VERIFY PASS / CI + VERCEL PASS / REMOTE APPLY AND INDEPENDENT REVIEW PENDING`

This is the first independently reviewable OPT-6 batch. It does not mark OPT-6
complete and does not authorize the next batch until the designated review task
returns an explicit `PASS`.

## Scope and timestamp

- Branch: `agent/opt-6-progressive-quality-governance`
- Base: OPT-5 merge commit `6c71c3f95bd75389b586c0389e01664a8936d053`
- Worktree: `opt4-realignment-worktree`
- Execution date: 2026-07-20 (Asia/Shanghai)
- Database scope: one new forward-only Migration `00050`; no remote database write
  was attempted in this batch because the current tool context has no Supabase
  connector and no safe direct database link.

## Changes

1. Removed all 31 pre-existing `@typescript-eslint/no-unused-vars` warnings and
   tightened `.github/workflows/ci.yml` lint budget from 31 to 0.
2. Added `supabase/migrations/00050_optimize_auth_rls_initplan.sql`.
   It rewrites exactly six reviewed policies using `(SELECT auth.uid())`:
   two on `profiles`, three on `user_variant_preference`, and one on
   `user_warehouses`. Bounded lock/statement timeouts and exact pre/post gates
   reject drift. No table/function/ACL/index/business-data operation is present.
3. Added static and PostgreSQL behavior contracts. The behavior test compares
   anonymous, Admin, two active Operators, disabled user, own-row and
   cross-user visibility/update behavior before and after 00050; the matrices
   are identical.
4. Pinned Turbopack's workspace root to `__dirname` in `next.config.ts`, which
   removes the workstation-level lockfile root misdetection. The remaining NFT
   trace warning is recorded as residual because the sync route intentionally
   starts Python from the project root and accesses its runtime artifact tree;
   changing that path would alter production behavior and is out of this batch.

## Review remediation (2026-07-20)

The first independent review returned `CHANGES_REQUIRED` for two safety gaps;
both were fixed before any remote apply:

1. Migration `00050` now materializes the reviewed 00001-00049 catalog baseline
   for all six policies and compares schema/table/name, PERMISSIVE state, role
   OIDs, command, and normalized complete `USING`/`WITH CHECK` expressions
   before `DROP POLICY`. A second exact comparison after `CREATE POLICY` accepts
   only the reviewed scalar-subquery form of `auth.uid()`. Any mismatch raises
   before a policy is changed; the migration remains forward-only and has no
   public DDL/DML or ACL operation.
2. The PostgreSQL contract now runs transaction-rolled-back own/cross-user
   INSERT and DELETE attempts for anonymous, Admin, active Operators, and the
   disabled user. It compares the complete result/error/row-count matrix before
   and after 00050, asserts the four seed rows remain, and has three guard-failure
   cases proving role, full predicate, and permissiveness drift is rejected
   without dropping any target policy.

## Verification

- `npm.cmd run lint -- --max-warnings 0`: PASS, 0 errors / 0 warnings.
- `npm.cmd test -- --run`: PASS, 93 files / 3945 tests.
- 00050 static contract: PASS, 5 tests.
- 00050 isolated PostgreSQL identity/write matrix and guard-failure cases: PASS,
  4 tests (own/cross INSERT and DELETE for anonymous, Admin, active Operators,
  disabled user; role/predicate/PERMISSIVE drift rejection).
- Continuous 00001–00050 replay: PASS in the isolated PostgreSQL catalog run; the dedicated 00050 identity test also passes independently.
- `npm.cmd run build`: PASS, TypeScript and Next production build pass. One
  known NFT trace warning remains; workspace-root warning is gone.
- `npm.cmd audit --omit=dev`: 2 moderate / 0 high / 0 critical, PostCSS
  advisory `GHSA-qx2v-qp2m-jg93`; npm reports no safe current fix. The
  suggested Next 9.3.3 downgrade was not applied.
- `git diff --check`: PASS (Git may display the repository's existing EOL
  normalization notices).

The full database contract command was also attempted in the isolated test
database. Four pre-existing assertions compare the English text
`permission denied`; this local PostgreSQL instance emits the equivalent
Chinese `权限不够`. The new 00050 replay and behavior assertions pass; this
locale-only mismatch is not a 00050 failure and remains a CI verification item.

## Deferred / stop gates

- The roadmap's 115 `multiple_permissive_policies` findings remain an inventory,
  not a bulk-delete target. The next batch must capture a production policy
  catalog and prove OR / `WITH CHECK` equivalence table-by-table before any
  merge. No policy merge was included here.
- Unused-index findings remain deferred until a production statistics window;
  no index was deleted.
- Code head `99fae34` checks were green in workflow run `29730076706`. The
  final documentation-synced head is `4110a65`; its exact-head workflow run
  `29730301451` quality and PostgreSQL jobs passed, and Vercel Preview is READY
  at `https://vercel.com/rallsix66s-projects/overseas-inventory/ChDcSUo2Hd6GgxW3GyoBw39JyfRg`.
- Supabase Staging/Production apply/postchecks and independent review remain
  pending. Do not apply 00050 remotely or enter OPT-6 Batch 2 before the
  designated review task returns `PASS`.

## Navigation

- Active task packet: [current-task](../tasks/current-task.md)
- OPT-6 roadmap: [system optimization roadmap](../tasks/system-optimization-roadmap-2026-07-17.md)
- Migration: [00050](../../supabase/migrations/00050_optimize_auth_rls_initplan.sql)
- Static contract: [00050 static test](../../src/features/database/opt6-auth-rls-initplan-migration.test.ts)
- PostgreSQL contract: [00050 behavior test](../../src/features/database/opt6-auth-rls-initplan.postgres.test.ts)
