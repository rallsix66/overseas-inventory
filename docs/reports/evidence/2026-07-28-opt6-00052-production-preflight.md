# OPT-6 Batch 3 - 00052 Production preflight evidence

## Current status

PRODUCTION SELECT-ONLY PREFLIGHT PREPARED / REVIEW PENDING / REMOTE EXECUTION PROHIBITED

No Production SQL was executed for this evidence. This file records the prepared
packet, its expected baseline, and local verification only.

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

## Reproducible files

- SQL: [Production preflight SQL](../sql/2026-07-28-opt6-00052-production-preflight.sql)
- Static contract: [Production static contract](../../src/features/database/opt6-00052-production-preflight.test.ts)
- PostgreSQL contract: [Production PostgreSQL contract](../../src/features/database/opt6-00052-production-preflight.postgres.test.ts)
- Main report: [Production preflight report](../2026-07-28-opt6-00052-production-preflight.md)
- Staging result: [Staging evidence](2026-07-27-opt6-00052-staging-preflight.md)

## Local verification

- The static contract checks the complete 51-row Production baseline, both reviewed
  digest constants, SELECT-only verbs, product policy catalog, and active-sync gate.
- The PostgreSQL contract executes the complete packet in an isolated local schema
  and checks the result shape and all required gate columns.
- Production has not been queried or modified.

## Stop gate

Independent review of this prepared packet is required before one controlled
Production SELECT-only run. Even after a read-only PASS, Production apply,
Migration execution, and Batch 4 remain prohibited.
