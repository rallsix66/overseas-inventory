# OPT-6 Quality Governance — Batch 1

## Status

`CODE COMPLETE / LOCAL VERIFY PASS / CI + VERCEL PASS / BATCH REVIEW PASS / REMOTE APPLY PASS / REMOTE REVIEW PENDING`

This is the first independently reviewable OPT-6 batch. It does not mark OPT-6
complete and does not authorize the next batch until the designated review task
returns an explicit `PASS`.

## Scope and timestamp

- Branch: `agent/opt-6-progressive-quality-governance`
- Base: OPT-5 merge commit `6c71c3f95bd75389b586c0389e01664a8936d053`
- Worktree: `opt4-realignment-worktree`
- Execution date: 2026-07-20 (Asia/Shanghai)
- Database scope: one new forward-only Migration `00050`. After Batch 1 review
  PASS and PR #9 merge, the controlled remote stage applied it to Staging and
  then Production; see the indexed remote postcheck evidence below.

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
3. Review-remediation code head `1106edc` passed exact-head workflow run
   `29732371606` (quality and PostgreSQL jobs) and its Vercel Preview is READY at
   `https://vercel.com/rallsix66s-projects/overseas-inventory/CYdqHVXh7BQiszVQnJLrnLctU8sg`.
   This is the code-remediation checkpoint; the final documentation-synced head
   below carries the same tested Migration and contracts.

## Final independent review (2026-07-20)

The designated review task returned `OPT-6 BATCH 1 FINAL PASS` for final head
`d2eef9cbf09d35de3e0ab01bd2f84991ad59cb51`. Exact-head CI run `29732535403`
passed both jobs; Vercel Preview `BqS7bgtX77Y9wD9t8LUkvgtf9M9W` and Preview
Comments passed. The review confirmed the exact catalog gates, write matrix,
drift-failure cases, clean worktree, five-file remediation scope, and project
tree/index integrity. This PASS authorizes the next controlled 00050 remote
apply/postcheck stage only; it does not mean 00050 has been applied and does
not authorize OPT-6 Batch 2.

## Merge and remote apply checkpoint (2026-07-20)

PR #9 was merged as `d9acf51e0cfbfd2e21f243f41273de7278f4e80a`.
Master CI run `29733960202` passed both jobs and Vercel production deployment
`BKDzcK4k9noxQgzAboJB6h2XjmeF` passed. The controlled remote stage then ran
Staging before Production. Both environments now have the exact ordered
`00001`–`00050` history set, 50 unique versions and names, zero timestamp
versions, and a single canonical `00050` payload (6519 characters, MD5
`f5758671947c61dc1fb3bf3e94d8e8d0`). All six policies match the reviewed
optimized command/roles/permissiveness/full-predicate catalog. No old
Migration, business data, ACL, function, trigger, index, synchronization script
or Auth setting was changed. The remote evidence is complete but remains under
independent review; Batch 2 is still blocked.

The documentation-only evidence checkpoint is PR #10 head
`5c80755f25a48496427e59aaa9635027dd989768`; exact-head CI run `29739465796`
passed both jobs and Vercel Preview `sBfgQG7cstb2n5YZkv1w2mvQgEGM` passed.

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
- Historical checkpoints: code head `99fae34` / workflow `29730076706`, then
  documentation checkpoint `4110a65` / workflow `29730301451`; both were green
  and are retained only for audit history.
- The independent review then required the exact catalog gate and write matrix
  remediation recorded above. Code head `1106edc` passed exact-head CI run
  `29732371606` and Vercel Preview `CYdqHVXh7BQiszVQnJLrnLctU8sg`.
- Historical Batch 1 review checkpoint is documentation-synced head `d2eef9c` /
  `d2eef9cbf09d35de3e0ab01bd2f84991ad59cb51`, CI `29732535403`, Vercel
  `BqS7bgtX77Y9wD9t8LUkvgtf9M9W`; independent Batch review is PASS.
- PR #9 merge `d9acf51`, master CI `29733960202`, production deployment
  `BKDzcK4k9noxQgzAboJB6h2XjmeF`, and the two-environment remote postcheck are
  now complete. Remote-stage independent review remains pending. Do not enter
  OPT-6 Batch 2 before the designated review task returns `PASS`.

## Navigation

- Active task packet: [current-task](../tasks/current-task.md)
- OPT-6 roadmap: [system optimization roadmap](../tasks/system-optimization-roadmap-2026-07-17.md)
- Migration: [00050](../../supabase/migrations/00050_optimize_auth_rls_initplan.sql)
- Static contract: [00050 static test](../../src/features/database/opt6-auth-rls-initplan-migration.test.ts)
- PostgreSQL contract: [00050 behavior test](../../src/features/database/opt6-auth-rls-initplan.postgres.test.ts)
- Remote apply/postcheck evidence: [Staging and Production](evidence/2026-07-20-opt6-00050-remote-postcheck.md)
