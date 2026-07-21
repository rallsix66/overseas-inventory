# OPT-6 Batch 2 — 00051 Staging Read-only Preflight

## Status

`READ-ONLY PREFLIGHT REVIEW PASS / STAGING APPLY PACKET PREPARATION / NO REMOTE WRITE`

## Scope and boundary

- Environment: DIS Staging (`hyarhvsjhkjpallbyifn`).
- Date: 2026-07-21 (Asia/Shanghai).
- Candidate: `00051_optimize_role_rls_policy_overlap.sql` from reviewed head
  `3885651309ac37f2bf5dd48ce905dfdfe6da8886`.
- Documentation-review head: `a493bc126314311f53892f9ec0bfefd5223747ce`;
  exact-head CI is green.
- The SQL Editor query was `SELECT`-only. It performed no transaction control,
  DDL, DML, policy change, Migration-history registration, or configuration
  change.

## Exact read-only results

The SQL Editor returned one row with all five checks `true`:

| Check | Result |
| --- | --- |
| `schema_migrations` has exactly 50 rows | true |
| ordered history is exactly `00001`–`00050` | true |
| version `00051` is absent | true |
| `public.role` has exactly two policies | true |
| both policies exactly match the reviewed pre-00051 catalog | true |

The policy comparison includes name, PERMISSIVE state, role OIDs, command,
and normalized full `USING`/`WITH CHECK` expressions. The two confirmed
baseline policies are `admin_all_role` (`FOR ALL`, Admin) and
`operator_select_role` (`FOR SELECT`, Operator).

## Next stop gate

The designated independent review task returned `PASS` for this read-only
preflight packet. That permits preparation of the controlled Staging
apply/postcheck packet only; it does not execute or itself authorize `00051`.
The atomically applied Migration/history-registration script and its expected
postcheck must be independently reviewed before a Staging write. Production
and all remaining policy groups remain prohibited.

## Apply packet prepared for review

- Generator: [prepare-opt6-00051-staging-apply.ps1](../../../scripts/prepare-opt6-00051-staging-apply.ps1).
- It normalizes the reviewed `00051` body to LF, verifies 5686 characters and
  MD5 `aee8d4811b5382afc9786ef0dae195be`, then emits one `BEGIN`/`COMMIT`
  transaction.
- The generated SQL gates exact 50-row history before executing the reviewed
  Migration; it then locks only the migration history, inserts exactly one
  `00051` body row, and requires exact 51-row/history-payload postchecks.
- Local generator verification passed: one transaction, one commit, two body
  occurrences (execution plus literal registration), and one history INSERT.
- This generator has not been executed against any remote database.

## Navigation

- [Batch 2 report](../2026-07-21-opt6-quality-governance-batch-2.md)
- [Current task packet](../../tasks/current-task.md)
- [Optimization roadmap](../../tasks/system-optimization-roadmap-2026-07-17.md)
- [00051 migration](../../../supabase/migrations/00051_optimize_role_rls_policy_overlap.sql)
- [Staging apply generator](../../../scripts/prepare-opt6-00051-staging-apply.ps1)
