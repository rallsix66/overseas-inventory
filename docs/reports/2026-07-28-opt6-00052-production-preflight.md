# OPT-6 Batch 3 - 00052 Production SELECT-only preflight

## Status

PRODUCTION SELECT-ONLY PREFLIGHT EXECUTED ONCE / RESULT PASS / INDEPENDENT REVIEW PENDING / REMOTE WRITE PROHIBITED

After the designated implementation-review PASS, this packet was run exactly once in
Production SQL Editor as one SELECT-only statement batch on 2026-07-28. It returned
one row with every hard-stop boolean true, the reviewed full-payload digest, two
product policies, and zero active sync runs. No Migration 00052, apply packet, or
write was executed.

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
- Production SQL Editor execution occurred exactly once after independent review
  PASS; it returned the read-only result recorded below.
- No apply packet was created or authorized.
- 00052 writes, Production policy changes, other policy groups, and Batch 4 remain
  prohibited until a separate review and controlled window.

## Verification record

Remote Production execution (2026-07-28, exactly once, SELECT-only) returned one row:

- `rows_51=true`, `unique_versions=true`, `unique_names=true`, `min_00001=true`,
  `max_00051=true`, `no_timestamp_versions=true`, `exact_version_set=true`, and
  `no_00052=true`.
- Actual/expected version-name digest:
  `2d6174dce487614c3280456fff9169d0` / `2d6174dce487614c3280456fff9169d0`;
  `expected_version_name_digest_is_reviewed=true`.
- Actual/expected full statements[] digest:
  `0b7cba5a88fff139fb0ec65e4deaa142` / `0b7cba5a88fff139fb0ec65e4deaa142`;
  `expected_history_payload_digest_is_reviewed=true`.
- `exact_version_name_history=true`, `exact_history_payload=true`,
  `product_policy_count_2=true`, `exact_product_policies=true`,
  `product_policy_digest=119e5878b2ddd6d3f7c1c01e614c4112`, and
  `in_progress_sync_runs=0`.

All hard-stop booleans were true; this result authorizes no write or Migration.

- SQL packet: [Production preflight SQL](sql/2026-07-28-opt6-00052-production-preflight.sql).
- Static contract: [Production packet contract](../../src/features/database/opt6-00052-production-preflight.test.ts).
- PostgreSQL executable contract: [Production PostgreSQL contract](../../src/features/database/opt6-00052-production-preflight.postgres.test.ts).
- Source Staging packet and prior independent PASS remain linked from the
  [Staging preflight report](2026-07-27-opt6-00052-staging-preflight.md) and
  [Staging evidence](evidence/2026-07-27-opt6-00052-staging-preflight.md).

## Stop gate

The one permitted Production SELECT-only run is complete and all hard-stop gates
passed. This execution result now requires independent review. Even an independent
PASS here does not authorize Migration 00052, an apply packet, a Production write,
or Batch 4; the next step remains reviewer-directed only.
