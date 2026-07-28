# OPT-6 Batch 3 - 00052 Production apply packet

## Status

PRODUCTION SELECT-ONLY PREFLIGHT FINAL PASS / APPLY AND POSTCHECK EXECUTED / INDEPENDENT REVIEW PENDING / BATCH 4 PROHIBITED

The reviewed packet was executed once in the controlled Production window and its independent postcheck passed. Migration 00052 is registered exactly once, old history was unchanged, and Batch 4 has not started. Final evidence review is pending.

## Packet safety gates

- One explicit `BEGIN`/`COMMIT`; `schema_migrations` is locked `ACCESS EXCLUSIVE`
  and `public.sync_run` is locked `SHARE` before any policy DDL or Migration body.
- The in-transaction preflight requires zero `in_progress` sync runs, no existing
  `00052`, and exact row-by-row `00001`-`00051` version/name/full `statements[]`
  cardinality, normalized length, and MD5 equality against the reviewed Production
  baseline (`2d6174dce487614c3280456fff9169d0` version/name and
  `0b7cba5a88fff139fb0ec65e4deaa142` full-payload digest).
- The preflight compares the complete two-policy `public.product` catalog,
  including schema/table/name, permissiveness, roles, command, normalized USING,
  and normalized WITH CHECK expressions, before the embedded body.
- The canonical `00052_optimize_product_rls_policy_overlap.sql` body is embedded
  byte-for-byte twice. Its payload is length `5786`, MD5
  `580fd279b2f8d07f6c5a550acc82812a`, and only one new history row (`00052`) can
  be registered.
- Postcheck requires exactly 52 history rows, the canonical `00052` payload, the
  unchanged `00001`-`00051` full history, the four reviewed product policies, and
  zero active sync runs. Any mismatch raises before commit.

## Verification

- Static packet contract: 6/6 focused tests passed.
- PostgreSQL apply contract: the complete packet is included in `test:database-contract` with normal execution and history/policy/active-sync drift rollback cases.
- `npm run lint -- --max-warnings 0`: PASS.
- Packet SQL is indexed from the evidence and task navigation below.

## Scope and stop gate

Production apply was executed once in the controlled window and the independent postcheck passed. The current gate is final evidence review only; do not execute another Production write, replay an old Migration, or start Batch 4.


## Controlled Production apply and postcheck (2026-07-28T11:06:50+08:00)

The reviewed packet was executed once in the Production SQL Editor after the
independent packet PASS. Supabase returned `Success. No rows returned` and the
single transaction committed. The earlier editor submission that showed a
syntax error was caused by stale editor text before execution; it produced no
remote write and was not treated as an apply.

Independent SELECT-only postcheck results:

- `history_rows=52`, `unique_versions=52`, `unique_names=52`, range
  `00001..00052`, and `timestamp_versions=0`.
- `00052_optimize_product_rls_policy_overlap`, one statement, 5786 characters,
  MD5 `580fd279b2f8d07f6c5a550acc82812a`.
- Unchanged `00001..00051` full-payload digest
  `0b7cba5a88fff139fb0ec65e4deaa142`; version/name digest
  `2d6174dce487614c3280456fff9169d0`; old history row count 51.
- Four permissive `public.product` policies with roles `{0}` and commands
  `d`, `a`, `r`, `w`: `product_delete_admin`, `product_insert_admin`,
  `product_select_admin_or_operator`, and `product_update_admin`; the reviewed
  admin/operator predicates and admin UPDATE `WITH CHECK` are present.
- `in_progress_sync_runs=0`.

No old Migration was replayed, no old history row was updated, and no Batch 4
operation started. Final post-apply evidence is submitted for independent review.
## Reproducible files

- SQL packet: [00052 Production apply SQL](sql/2026-07-28-opt6-00052-production-apply.sql)
- Evidence: [apply packet evidence](evidence/2026-07-28-opt6-00052-production-apply.md)
- Migration: [00052 migration](../../supabase/migrations/00052_optimize_product_rls_policy_overlap.sql)
- Static contract: [apply packet contract](../../src/features/database/opt6-00052-production-apply.test.ts)
- PostgreSQL contract: [apply packet PostgreSQL contract](../../src/features/database/opt6-00052-production-apply.postgres.test.ts)
- Prior read-only PASS: [Production preflight](2026-07-28-opt6-00052-production-preflight.md)
