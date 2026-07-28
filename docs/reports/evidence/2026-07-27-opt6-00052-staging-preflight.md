# OPT-6 Batch 3 - 00052 Staging preflight evidence

## Current status

STAGING SELECT-ONLY REVALIDATION FINAL PASS / PRODUCTION 00052 APPLY-POSTCHECK COMPLETE / FINAL EVIDENCE REVIEW PENDING

The reviewed 00052 implementation and status-sync record are PASS. This evidence
records the prepared SELECT-only packet; the Staging packet performed no write.
The reviewed Production 00052 apply/postcheck has since completed once and passed;
the current gate is final evidence review only.

## Read-only result and reconciliation

The corrected packet ran once after independent PASS, returned one row and made no
write. History shape/set, version-name mapping, product policy catalog and zero
active sync runs were true. The full statements[] gate was false because the packet
used the Production variant for known Staging rows 00041-00047:
actual digest 8ec295c38bc90f769dc35ca5fd64a500; prior expected digest
0b7cba5a88fff139fb0ec65e4deaa142.

A separate SELECT-only row comparison matched the prior Staging postcheck:
00041-00047 retain the 750/659/3487/9936/8812/10499/5517 character payloads and
MD5s adf5951cb448754b4a62e259a533eca1,
da40777c08606c54b750f10c46006b52,
c85d29f5a213a6e54b378ce266760de2,
db8f65300c4ad5b7098f3a1fe8a33c90,
c4bd27c670a112ab58cbf86f21ccd10a,
c6bbce9065096d1b53f3f1dc731e139b,
1cdf5e8f221e270fe183eddcfbb3b175.
The packet expected baseline is now corrected to this approved Staging variant;
its expected full-payload digest is 8ec295c38bc90f769dc35ca5fd64a500.
Fresh independent review and one further SELECT-only revalidation were required; the completed result is recorded below.
## Corrected revalidation result (2026-07-27)

The corrected packet was run once as SELECT-only in Staging after independent review PASS. It returned one row and made no write. All hard-stop booleans were true: exact 51-row history/set, no 00052, exact version/name mapping, exact full statements[] payload, two exact public.product policies, and zero in-progress sync runs. Actual and expected version/name digest were both 2d6174dce487614c3280456fff9169d0; actual and expected full-payload digest were both 8ec295c38bc90f769dc35ca5fd64a500; observed product-policy digest was 119e5878b2ddd6d3f7c1c01e614c4112.

The designated independent reviewer returned PASS for this read-only result at head a2e319eeb587474b71e66888bdbccbc27f38813c, CI 30266046505, and Vercel 7Py8GVBM1NhfendWozqvRwvLCT2G. This historical Staging PASS was not itself an apply authorization; the reviewed Production 00052 apply/postcheck has since completed once and passed. No further Production write, old Migration replay, or Batch 4 is allowed while final evidence review is pending.

## Hard-stop assertions

1. History is exactly 00001-00051; 00052 is absent.
2. All 51 expected version/name/full statements[] summaries match the reviewed
   Staging baseline; both explicit equality booleans must be true.
3. The single 00051 payload is 5686 characters with MD5
   aee8d4811b5382afc9786ef0dae195be.
4. public.product has exactly the two reviewed baseline policies with full
   catalog equality.
5. public.sync_run has zero in-progress rows.

Any false result is a hard stop. This Staging packet did not authorize or perform a
write; after the separate reviewed Production apply completed once, no further
Production write, old Migration replay, or Batch 4 is allowed.

## Reproducible files

- SQL: docs/reports/sql/2026-07-27-opt6-00052-staging-preflight.sql
- Static contract: src/features/database/opt6-00052-staging-preflight.test.ts
- PostgreSQL contract: src/features/database/opt6-00052-staging-preflight.postgres.test.ts
- Main report: docs/reports/2026-07-27-opt6-00052-staging-preflight.md
- Batch 3 report: docs/reports/2026-07-22-opt6-quality-governance-batch-3.md

## Stop gate

The packet received independent implementation review PASS and was executed once
read-only after the Staging baseline correction. Every history, payload, policy,
and active-sync gate passed. The reviewed Production 00052 apply/postcheck has since
completed once and passed; the result awaits final independent evidence review only.
No further Production write, old Migration replay, or Batch 4 is allowed.