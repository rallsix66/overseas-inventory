# OPT-6 Batch 3 - 00052 Production SELECT-only preflight

## Status

PRODUCTION SELECT-ONLY PREFLIGHT PREPARED / REVIEW PENDING / REMOTE EXECUTION PROHIBITED

This packet is read-only preparation only. It has not been run against Production,
has not executed Migration 00052, and has not created or executed any apply packet.

## Target and exact gates

- Target: Production project hzlhqyditalumhnxbaim.
- Expected history: exactly 00001-00051; 00052 must be absent.
- The expected Production full statements[] digest is
  0b7cba5a88fff139fb0ec65e4deaa142; expected version/name digest is
  2d6174dce487614c3280456fff9169d0.
- The packet compares every expected version/name row and complete statements[]
  summary using cardinality, normalized array length and MD5, with explicit
  exact_version_name_history and exact_history_payload booleans.
- It separately asserts the expected digest constants are the reviewed Production
  baseline, so a changed expected CTE cannot silently authorize a run.
- public.product must contain exactly admin_all_product FOR ALL Admin and
  operator_select_product FOR SELECT Operator, with exact permissiveness, roles,
  command, normalized USING and WITH CHECK expressions.
- public.sync_run must have zero status = in_progress rows.
- Every false boolean or digest/policy mismatch is a hard stop.

## Production baseline provenance

The 00001-00040 and 00048-00051 rows match the repository/Production evidence.
Production 00041-00047 use the known Production payload variant recorded in
[OPT-4 Production history evidence](evidence/2026-07-20-opt4-production-history-postcheck.md):
752/dbe56c84..., 661/bbf8ad82..., 3489/cc4a53dd..., 9938/fefb4f40...,
8814/b35210ab..., 10501/66b76a63..., and 5519/2e681495....
The packet keeps the complete statements[] cardinality/length/MD5 rule; it does
not compare only statements[1].

## Scope and safety

- One SELECT-only statement batch; no BEGIN/COMMIT, DDL, DML, ACL change,
  Migration execution, or history registration.
- Production SQL has not been executed.
- No apply packet was created or authorized.
- 00052 writes, Production policy changes, other policy groups, and Batch 4 remain
  prohibited until a separate review and controlled window.

## Verification record

- SQL packet: [Production preflight SQL](sql/2026-07-28-opt6-00052-production-preflight.sql).
- Static contract: [Production packet contract](../../src/features/database/opt6-00052-production-preflight.test.ts).
- PostgreSQL executable contract: [Production PostgreSQL contract](../../src/features/database/opt6-00052-production-preflight.postgres.test.ts).
- Source Staging packet and prior independent PASS remain linked from the
  [Staging preflight report](2026-07-27-opt6-00052-staging-preflight.md) and
  [Staging evidence](evidence/2026-07-27-opt6-00052-staging-preflight.md).

## Stop gate

This preparation must receive an independent PASS before the packet may be run
once as Production SELECT-only. A PASS for this read-only preflight would not
authorize Migration 00052, an apply packet, a Production write, or Batch 4.
