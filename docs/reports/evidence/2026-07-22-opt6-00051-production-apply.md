# OPT-6 Batch 2 — 00051 Production Apply Packet

## Status

`PRODUCTION APPLY/POSTCHECK FINAL PASS / BATCH 3 PROHIBITED`

## Scope and safety boundary

- Target: Production project `hzlhqyditalumhnxbaim` only.
- Candidate: forward-only `00051_optimize_role_rls_policy_overlap.sql`.
- Packet: [Production apply SQL](../sql/2026-07-21-opt6-00051-production-apply.sql).
- The packet is a single transaction with lock and statement timeouts. It takes
  `ACCESS EXCLUSIVE` on `schema_migrations` and `SHARE` on `sync_run` before
  any policy DDL, then rechecks the full 50-row version/name/statement payload
  baseline and `in_progress=0` in that same transaction.
- It retains the migration's exact policy catalog gates, exact body
  registration, and post-apply catalog/history assertions, including a second
  full old-history payload comparison.
- The approved packet was executed in the Production SQL Editor on 2026-07-22
  (Asia/Shanghai), as the signed-in `postgres` role. The SQL Editor reported
  `Success. No rows returned`; the packet ends with `COMMIT` and the transaction
  committed. The separate SELECT-only postcheck below produced the result row.
  No old Migration was replayed and no business-table data was changed. Batch 3
  remains prohibited.

## Preconditions already satisfied

The designated reviewer returned `PASS` for the read-only Production exact
preflight at head `5f9464730ec93633c5d9dd9e1173e7257e3dcf86`. Its recorded
result was one row with every history, full-payload, role-catalog, and
in-progress-run gate passing; actual and expected version/name digest were
`f046958a6c39a8b240536a6f59b5cb18`, and actual and expected full-payload digest
were `7a743aa540a39a1f4d3fe7e2a01ea08d`.

## Packet gates

The SQL is generated from the canonical migration body and refuses to proceed
unless the candidate is absent, the existing history is exactly the reviewed
`00001`–`00050` version/name/full-array payload baseline, no sync run is
`in_progress`, the pre-migration `public.role` catalog matches the reviewed
two-policy baseline, and the canonical body is inserted as exactly one
`00051` history row. After policy replacement it requires exactly four reviewed
role policies and the exact normalized predicates/commands/roles, while also
reconfirming the complete old-history payload and zero active sync runs. Any
failed gate raises an exception and the transaction rolls back.

The designated packet review returned `PASS` for the executable packet at head
`f7acf211ac66e2b86a22e14254a1ffe75782c224`, with CI `29891089089` and Vercel
Preview `BE2eahGEhTZsb83MTjs6xmKFAFc8`. That historical packet review
authorized this controlled Production apply/postcheck only. The current
closing review returned `PASS` at exact head
`96c87461afd444b2065059c98ba0cf08522b749e`, with CI `29908869113` and Vercel
Preview `87HAB8w8rTZhDtJAZCvt2kmaRM31`; it does not authorize Batch 3.

The focused apply contract reports `6/6` tests: transaction/lock ordering,
full-array preflight and active-sync guards, canonical body preservation,
single expected-history `VALUES` clause, deterministic structural SQL sanity,
and repeated post-body guards. No local PostgreSQL execution was attempted;
the packet is Production-only and the deterministic parser-level contract was
the pre-execution syntax gate.

## Production postcheck (2026-07-22)

The separate SELECT-only postcheck returned `rows_total=51`,
`unique_versions=51`, `unique_names=51`, `min=00001`, `max=00051`,
`timestamp_versions=0`, exact canonical `00051` payload
(`cardinality=1`, `length=5686`, MD5 `aee8d4811b5382afc9786ef0dae195be`),
exact version set `00001`–`00051`, `in_progress_sync_runs=0`, and
`public.role` policy count `4`.

The policy catalog query returned the four reviewed policies with
`PERMISSIVE=true`, roles `{0}`, commands `d/a/r/w`, and the approved normalized
USING/WITH CHECK predicates: Admin-only delete/insert/update plus the shared
Admin-or-Operator SELECT predicate. No credentials or secret values were
recorded.

## Navigation

- [Production exact preflight evidence](2026-07-21-opt6-00051-production-preflight.md)
- [Production apply static contract](../../../src/features/database/opt6-production-apply.test.ts)
- [Batch 2 report](../2026-07-21-opt6-quality-governance-batch-2.md)
- [Current task packet](../../tasks/current-task.md)
- [Optimization roadmap](../../tasks/system-optimization-roadmap-2026-07-17.md)
