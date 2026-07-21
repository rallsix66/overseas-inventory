# OPT-6 Batch 2 — 00051 Production Exact Preflight Packet

## Status

`PRODUCTION PREFLIGHT PACKET PREPARED / REMOTE PREFLIGHT PENDING / NO WRITE AUTHORIZED`

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

The packet must return one row with every boolean below true before any
Production maintenance window can be considered:

| Check | Required result |
| --- | --- |
| history row count | `rows_50 = true` |
| unique history versions and names | `unique_versions = true`, `unique_names = true` |
| history range | `min_00001 = true`, `max_00050 = true` |
| no timestamp versions | `no_timestamp_versions = true` |
| exact `00001`–`00050` set | `exact_version_set = true` |
| candidate absent | `no_00051 = true` |
| existing history digests | compared with the reviewed Production baseline |
| `public.role` policy count | `role_policy_count_2 = true` |
| complete role policy catalog | `exact_role_policies = true` |
| active sync runs | `in_progress_sync_runs = 0` |

The role catalog comparison includes policy name, PERMISSIVE state, role OIDs,
command, complete normalized `USING`, and complete normalized `WITH CHECK`.
Any false value or digest drift is a hard stop before a write packet is even
considered.

## Controlled next gate

After this packet is executed read-only and its result is recorded, the result
must receive designated independent review. Only a separate explicit review
`PASS` for the Production preflight may permit assembling a single-transaction
apply packet. That later packet must still be independently reviewed before any
Production write. Staging `PASS` does not authorize Production.

No Production query or write was completed in this preparation phase. The
remaining remote step is the read-only preflight itself; no credentials or
secrets are recorded here.

## Navigation

- [Production preflight SQL](../sql/2026-07-21-opt6-00051-production-preflight.sql)
- [Batch 2 report](../2026-07-21-opt6-quality-governance-batch-2.md)
- [Staging apply/postcheck evidence](2026-07-21-opt6-00051-staging-preflight.md)
- [Current task packet](../../tasks/current-task.md)
- [Optimization roadmap](../../tasks/system-optimization-roadmap-2026-07-17.md)
