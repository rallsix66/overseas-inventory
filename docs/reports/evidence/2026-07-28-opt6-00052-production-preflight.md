# OPT-6 Batch 3 - 00052 Production preflight evidence

## Current status

PRODUCTION SELECT-ONLY PREFLIGHT FINAL PASS / REMOTE WRITE PROHIBITED

The packet was run exactly once in Production SQL Editor on 2026-07-28 after its
implementation-review PASS. It returned one row with every hard-stop boolean true.
No Migration 00052, apply packet, or write was executed.

## Expected baseline and hard stops

- Production history must be exactly 51 rows, versions 00001-00051, with 00052 absent.
- Full version/name digest must equal 2d6174dce487614c3280456fff9169d0.
- Full statements[] payload digest must equal 0b7cba5a88fff139fb0ec65e4deaa142.
- exact_version_name_history, exact_history_payload,
  expected_version_name_digest_is_reviewed, and
  expected_history_payload_digest_is_reviewed must all be true.
- public.product policy count and exact catalog comparison must both be true.
- in_progress_sync_runs must be 0.

Any false result is a hard stop. The packet is SELECT-only and does not authorize
Migration 00052, an apply packet, a Production write, or Batch 4.

## Remote execution result

The single SELECT-only run returned:

- history/set gates all `true`: `rows_51`, `unique_versions`, `unique_names`,
  `min_00001`, `max_00051`, `no_timestamp_versions`, `exact_version_set`, and
  `no_00052`;
- version/name actual and expected digest both
  `2d6174dce487614c3280456fff9169d0`, with reviewed-constant gate `true`;
- complete statements[] actual and expected digest both
  `0b7cba5a88fff139fb0ec65e4deaa142`, with reviewed-constant gate `true`;
- `exact_version_name_history=true`, `exact_history_payload=true`,
  `product_policy_count_2=true`, `exact_product_policies=true`,
  `product_policy_digest=119e5878b2ddd6d3f7c1c01e614c4112`, and
  `in_progress_sync_runs=0`.

All hard-stop booleans were true. The designated independent reviewer returned PASS at head `7f83f01c847d685e865d2c4c7c4d8012267ed085`, CI `30276563343`, and Vercel `4QSHNyh9PDfbnpWMrMeiadV2YBts`. This is a read-only result and does not authorize
Production apply, Migration 00052, or Batch 4.

## Reproducible files

- SQL: [Production preflight SQL](../sql/2026-07-28-opt6-00052-production-preflight.sql)
- Static contract: [Production static contract](../../../src/features/database/opt6-00052-production-preflight.test.ts)
- PostgreSQL contract: [Production PostgreSQL contract](../../../src/features/database/opt6-00052-production-preflight.postgres.test.ts)
- Main report: [Production preflight report](../2026-07-28-opt6-00052-production-preflight.md)
- Staging result: [Staging evidence](2026-07-27-opt6-00052-staging-preflight.md)

## Local verification

- The static contract checks the complete 51-row Production baseline, both reviewed
  digest constants, SELECT-only verbs, product policy catalog, and active-sync gate.
- The PostgreSQL contract executes the complete packet in an isolated local schema
  and checks the result shape and all required gate columns.
- Production was queried exactly once by the SELECT-only packet; it was not modified.

## Stop gate

The permitted read-only run is complete with all gates true and received independent
PASS. Production apply, Migration execution, and Batch 4 remain prohibited until
the next separately reviewed controlled window.
