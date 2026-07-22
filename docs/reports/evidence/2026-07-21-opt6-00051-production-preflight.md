# OPT-6 Batch 2 ??00051 Production Exact Preflight Packet

## Status

`PRODUCTION READ-ONLY PREFLIGHT PASS / PRODUCTION WRITE STILL PROHIBITED`

## Scope and safety boundary

- Target: DIS Production project `hzlhqyditalumhnxbaim` only.
- Candidate: reviewed forward-only `00051_optimize_role_rls_policy_overlap.sql`.
- This phase prepares the read-only preflight and maintenance-window boundary.
  It does not apply `00051`, alter `public.role`, update migration history, or
  enter Batch 3.
- The SQL packet contains SELECT statements only. It has no `BEGIN`, `COMMIT`,
  `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, `DROP`, `GRANT`, `REVOKE`, or
  Migration body execution.

## Required preflight results

The corrected packet was executed read-only in the Supabase SQL Editor on
2026-07-22 (Asia/Shanghai), against Production project
`hzlhqyditalumhnxbaim`, as the signed-in `postgres` database role. It returned
one row. Every boolean below was true; the actual and expected full-payload
digests were equal, the reviewed role catalog matched, and there were zero
in-progress sync runs:

| Check | Required result |
| --- | --- |
| history row count | `rows_50 = true` |
| unique history versions and names | `unique_versions = true`, `unique_names = true` |
| history range | `min_00001 = true`, `max_00050 = true` |
| no timestamp versions | `no_timestamp_versions = true` |
| exact `00001`??00050` set | `exact_version_set = true` |
| candidate absent | `no_00051 = true` |
| exact version/name history | `exact_version_name_history = true` |
| exact full history payload | `exact_history_payload = true` |
| expected version/name digest | `f046958a6c39a8b240536a6f59b5cb18` |
| actual full-payload digest | `7a743aa540a39a1f4d3fe7e2a01ea08d` |
| expected full-payload digest | `7a743aa540a39a1f4d3fe7e2a01ea08d` |
| history digest equality | actual and expected version/name and full-payload digests equal |
| `public.role` policy count | `role_policy_count_2 = true` |
| complete role policy catalog | `exact_role_policies = true` |
| active sync runs | `in_progress_sync_runs = 0` |

The history baseline is the reviewed Production `00001`??00050` row catalog in
the SQL packet's `expected_history` CTE. Each row pins version, name,
`cardinality(statements)`, normalized payload length, and the MD5 of the full
`array_to_string(statements, E'\x1f')` payload (with `<NULL>` normalization).
`exact_version_name_history` compares the complete version-to-name mapping;
`exact_history_payload` additionally compares every row's complete payload
summary. The packet returns both actual and expected aggregate digests, but the
row-by-row equality booleans??ot a digest display alone??re the hard gate.

The role catalog comparison includes policy name, PERMISSIVE state, role OIDs,
command, complete normalized `USING`, and complete normalized `WITH CHECK`.
Every listed boolean was true, `in_progress_sync_runs` was zero, and both
actual/expected history digest pairs were equal. Any false value, payload
mismatch, or digest drift is a hard stop before a write packet is even
considered.

## Controlled next gate

This read-only result must receive designated independent review. Only a
separate explicit review `PASS` for the Production preflight may permit
assembling a single-transaction apply packet. That later packet must still be
independently reviewed before any Production write. Staging `PASS` does not
authorize Production. No apply packet was assembled or executed, and no
credentials or secrets are recorded here.

## Navigation

- [Production preflight SQL](../sql/2026-07-21-opt6-00051-production-preflight.sql)
- [Production preflight static contract](../../../src/features/database/opt6-production-preflight.test.ts)
- [Batch 2 report](../2026-07-21-opt6-quality-governance-batch-2.md)
- [Staging apply/postcheck evidence](2026-07-21-opt6-00051-staging-preflight.md)
- [Current task packet](../../tasks/current-task.md)
- [Optimization roadmap](../../tasks/system-optimization-roadmap-2026-07-17.md)

