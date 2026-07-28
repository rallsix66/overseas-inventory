# OPT-6 Batch 3 - 00052 Production apply packet

## Status

PRODUCTION SELECT-ONLY PREFLIGHT FINAL PASS / APPLY PACKET REVIEW FINAL PASS / CONTROLLED WINDOW PENDING / REMOTE WRITE PROHIBITED

This packet is prepared for a separately reviewed controlled Production window. It
has not been executed. Migration 00052 has not been replayed, no Production policy
has been changed, and Batch 4 has not started.

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

This is preparation only. Independent review returned PASS at head c8b679ecbfc00ca7d414a40d8f2a10f1228259a5, CI 30322612198, and Vercel 9cLc8DEK6mH35UdeoFen2i2yr76b. A separately controlled Production apply window is pending; review PASS does not execute the packet, and Production write, Migration replay outside this packet, and Batch 4 remain prohibited.

## Reproducible files

- SQL packet: [00052 Production apply SQL](sql/2026-07-28-opt6-00052-production-apply.sql)
- Evidence: [apply packet evidence](evidence/2026-07-28-opt6-00052-production-apply.md)
- Migration: [00052 migration](../../supabase/migrations/00052_optimize_product_rls_policy_overlap.sql)
- Static contract: [apply packet contract](../../src/features/database/opt6-00052-production-apply.test.ts)
- PostgreSQL contract: [apply packet PostgreSQL contract](../../src/features/database/opt6-00052-production-apply.postgres.test.ts)
- Prior read-only PASS: [Production preflight](2026-07-28-opt6-00052-production-preflight.md)
