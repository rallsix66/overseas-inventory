# OPT-6 Batch 3 - 00052 Production apply packet evidence

## Current status

PRODUCTION SELECT-ONLY PREFLIGHT FINAL PASS / APPLY PACKET PREPARED / INDEPENDENT REVIEW PENDING / REMOTE WRITE PROHIBITED

The packet is prepared only. It has not been run against Production, Migration
00052 has not been executed, and no Production policy or history row has been
changed.

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

Any false gate is a hard stop. This packet does not authorize a Production write,
Migration replay outside the packet, or Batch 4.

## Local verification

- Static contract: 6/6 focused tests PASS.
- Lint with zero warnings: PASS.
- No remote apply has been attempted.

## Stop gate

Independent review is required before a controlled Production apply window may be
requested. Even after review PASS, the packet must remain paused until the separate
window is explicitly opened; no Production SQL write or Batch 4 action is allowed.

## Reproducible files

- SQL: [00052 Production apply packet](../sql/2026-07-28-opt6-00052-production-apply.sql)
- Main report: [apply packet report](../2026-07-28-opt6-00052-production-apply.md)
- Static contract: [apply packet static contract](../../../src/features/database/opt6-00052-production-apply.test.ts)
- Production preflight evidence: [read-only PASS evidence](2026-07-28-opt6-00052-production-preflight.md)