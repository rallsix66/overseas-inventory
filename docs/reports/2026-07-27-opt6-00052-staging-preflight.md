# OPT-6 Batch 3 - 00052 Staging SELECT-only preflight

## Status

PREFLIGHT PREPARED / REVIEW PENDING / REMOTE READ-ONLY EXECUTION PROHIBITED

Batch 3 implementation and documentation-only status-sync reviews are PASS.
This packet is a new SELECT-only read-only preflight for the reviewed 00052
candidate. It has not been executed in Staging or Production, and it is not
an apply packet.

## Target and exact gates

- Target: Staging project hyarhvsjhkjpallbyifn.
- Expected history: exactly 00001-00051; 00052 must be absent.
- Expected 00051 payload: one statement, 5686 characters, MD5
  aee8d4811b5382afc9786ef0dae195be.
- The SQL compares every expected version/name row and complete statements[]
  summary using cardinality, normalized array length and MD5, with explicit
  exact_version_name_history and exact_history_payload booleans.
- The public.product baseline must contain exactly admin_all_product FOR ALL
  Admin and operator_select_product FOR SELECT Operator, with exact
  permissiveness, roles, command, normalized USING and WITH CHECK expressions.
- public.sync_run must have zero status = in_progress rows.
- Any false boolean or digest/policy mismatch is a hard stop.

## Scope and safety

- The packet is one SELECT-only statement batch: no BEGIN/COMMIT, DDL, DML,
  ACL change, Migration execution or history registration.
- It does not create an apply packet and does not authorize 00052 execution.
- No Staging/Production SQL has been executed for 00052.

## Verification record

- Static contract: src/features/database/opt6-00052-staging-preflight.test.ts.
- Packet: docs/reports/sql/2026-07-27-opt6-00052-staging-preflight.sql.
- Implementation review PASS: head 23d92d3, CI 30230526963, Vercel 5F5tvSTDP7A14aCaD217Pxh2yFh3.
- Status-sync review PASS: head 27a05f5, CI 30235057506, Vercel 3paYznmNCuxke9zJK8VziNL2M856.
- This preflight packet requires its own independent review before any
  read-only execution. A false result stops the route.

## Navigation

- Batch 3 implementation report: docs/reports/2026-07-22-opt6-quality-governance-batch-3.md
- Batch 3 evidence: docs/reports/evidence/2026-07-22-opt6-batch3-product-policy.md
- Current task packet: docs/tasks/current-task.md
- Optimization roadmap: docs/tasks/system-optimization-roadmap-2026-07-17.md
