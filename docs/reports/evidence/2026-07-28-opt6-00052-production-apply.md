# OPT-6 Batch 3 - 00052 Production apply packet evidence

## Current status

PRODUCTION SELECT-ONLY PREFLIGHT FINAL PASS / APPLY AND POSTCHECK EXECUTED / INDEPENDENT REVIEW PENDING / BATCH 4 PROHIBITED

The packet was executed once in Production and the independent postcheck passed.
Migration 00052 was registered exactly once; no old history row was changed. Final
evidence review is pending; Batch 4 has not started.

## Exact gates and canonical payload

- The packet takes the migration-history and active-sync locks before any policy
  DDL, then checks zero `in_progress` runs and absence of `00052`.
- A full join compares every reviewed `00001`-`00051` version/name/full
  `statements[]` summary. The expected version/name digest is
  `2d6174dce487614c3280456fff9169d0`; the expected full-payload digest is
  `0b7cba5a88fff139fb0ec65e4deaa142`.
- The pre-body product catalog is exactly the reviewed two-policy baseline; the
  post-body catalog is exactly the four-policy `00052` result.
- The embedded canonical migration payload is 5786 characters with MD5
  `580fd279b2f8d07f6c5a550acc82812a`; the wrapper registers only version `00052`.
- Postcheck requires 52 history rows, unchanged old history, exact canonical
  `00052`, four product policies, and zero active sync runs before `COMMIT`.

Any false gate is a hard stop. The controlled Production apply has completed once;
no further Production write, Migration replay outside the packet, or Batch 4 is allowed.

## Local verification

- Static contract: 6/6 focused tests PASS.
- PostgreSQL apply contract: full packet execution plus history/policy/active-sync drift rollback cases are included in `test:database-contract`.
- Lint with zero warnings: PASS.
- The remote apply was executed once in the controlled window; no additional
  apply or write has been attempted.

## Stop gate

Production apply was executed once in the controlled window and the independent
SELECT-only postcheck passed. Final post-apply evidence review is pending; do not
execute another Production write, replay an old Migration, or start Batch 4.


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

- SQL: [00052 Production apply packet](../sql/2026-07-28-opt6-00052-production-apply.sql)
- Main report: [apply packet report](../2026-07-28-opt6-00052-production-apply.md)
- Static contract: [apply packet static contract](../../../src/features/database/opt6-00052-production-apply.test.ts)
- PostgreSQL contract: [apply packet PostgreSQL contract](../../../src/features/database/opt6-00052-production-apply.postgres.test.ts)
- Production preflight evidence: [read-only PASS evidence](2026-07-28-opt6-00052-production-preflight.md)