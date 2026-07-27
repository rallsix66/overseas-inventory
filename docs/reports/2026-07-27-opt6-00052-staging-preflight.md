# OPT-6 Batch 3 - 00052 Staging SELECT-only preflight

## Status

EXECUTION HARD STOP / STAGING BASELINE CORRECTED / REVALIDATION REVIEW PENDING / REMOTE WRITE PROHIBITED

Batch 3 implementation and documentation-only status-sync reviews are PASS.
This packet is a SELECT-only read-only preflight for the reviewed 00052 candidate.
The first approved Staging attempt on 2026-07-27 failed before returning a
result with PostgreSQL 42P01 because the final SELECT referenced an undefined
role_check CTE; no write, Migration, or apply packet ran. The corrected packet
was independently re-approved and retried once; that read-only run also made no
write.

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

## 2026-07-27 read-only execution and baseline reconciliation

The corrected packet returned one row without error and no write occurred. Shape,
version/name, policy and active-sync gates passed. The full history payload gate
returned exact_history_payload=false: actual digest
8ec295c38bc90f769dc35ca5fd64a500 versus the then-expected digest
0b7cba5a88fff139fb0ec65e4deaa142.

A separate SELECT-only per-version comparison located seven rows. Their names and
statement counts matched, while Staging retained the known trailing-newline
variant already recorded by the Staging postcheck:

| Version | chars | MD5 |
|---|---:|---|
| 00041 | 750 | adf5951cb448754b4a62e259a533eca1 |
| 00042 | 659 | da40777c08606c54b750f10c46006b52 |
| 00043 | 3487 | c85d29f5a213a6e54b378ce266760de2 |
| 00044 | 9936 | db8f65300c4ad5b7098f3a1fe8a33c90 |
| 00045 | 8812 | c4bd27c670a112ab58cbf86f21ccd10a |
| 00046 | 10499 | c6bbce9065096d1b53f3f1dc731e139b |
| 00047 | 5517 | 1cdf5e8f221e270fe183eddcfbb3b175 |

The packet's prior expected rows used the Production variant for these seven
Staging rows. The SELECT-only packet has now been corrected to the approved
Staging baseline; its expected full-payload digest is
8ec295c38bc90f769dc35ca5fd64a500. Fresh independent review is required before
one further SELECT-only revalidation. No write, Migration, or apply packet ran.

## Scope and safety

- One SELECT-only statement batch: no BEGIN/COMMIT, DDL, DML, ACL change,
  Migration execution or history registration.
- No apply packet was created or authorized.
- Production, remote 00052 apply and later candidate groups remain prohibited.

## Verification record

- Packet: docs/reports/sql/2026-07-27-opt6-00052-staging-preflight.sql.
- Static contract: src/features/database/opt6-00052-staging-preflight.test.ts.
- PostgreSQL contract: src/features/database/opt6-00052-staging-preflight.postgres.test.ts.
- Earlier correction exact head: 48c81ca6417b45bbd1bcd1ed5a46e2988861202e; CI
  30245747778; Vercel Preview 5UTs9Zqfgi7ECf9bF4Adz8AzUUdY.
- This baseline correction requires its own independent review and exact-head
  quality verification before revalidation.

## Navigation

- Batch 3 implementation report: docs/reports/2026-07-22-opt6-quality-governance-batch-3.md
- Batch 3 evidence: docs/reports/evidence/2026-07-22-opt6-batch3-product-policy.md
- Current task packet: docs/tasks/current-task.md
- Optimization roadmap: docs/tasks/system-optimization-roadmap-2026-07-17.md