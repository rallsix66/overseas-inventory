# OPT-6 Batch 2 — 00051 Production Apply Packet

## Status

`APPLY PACKET PREPARED / FINAL REVIEW PENDING / NOT EXECUTED`

## Scope and safety boundary

- Target: Production project `hzlhqyditalumhnxbaim` only.
- Candidate: forward-only `00051_optimize_role_rls_policy_overlap.sql`.
- Packet: [Production apply SQL](../sql/2026-07-21-opt6-00051-production-apply.sql).
- The packet is a single transaction with lock and statement timeouts,
  history preflight, the migration's exact policy catalog gates, exact body
  registration, and post-apply catalog/history assertions.
- The packet has not been executed. No Production policy, migration history,
  or business data was changed. Batch 3 remains prohibited.

## Preconditions already satisfied

The designated reviewer returned `PASS` for the read-only Production exact
preflight at head `5f9464730ec93633c5d9dd9e1173e7257e3dcf86`. Its recorded
result was one row with every history, full-payload, role-catalog, and
in-progress-run gate passing; actual and expected version/name digest were
`f046958a6c39a8b240536a6f59b5cb18`, and actual and expected full-payload digest
were `7a743aa540a39a1f4d3fe7e2a01ea08d`.

## Packet gates

The SQL is generated from the canonical migration body and refuses to proceed
unless the candidate is absent, the existing history set is exactly
`00001`–`00050`, the pre-migration `public.role` catalog matches the reviewed
two-policy baseline, and the canonical body is inserted as exactly one
`00051` history row. After policy replacement it requires exactly four reviewed
role policies and the exact normalized predicates/commands/roles. Any failed
gate raises an exception and the transaction rolls back.

Only a separate independent review `PASS` for this exact packet may authorize
execution in a separately announced Production maintenance window. Until then
the packet is an audit artifact, not an instruction to run.

## Navigation

- [Production exact preflight evidence](2026-07-21-opt6-00051-production-preflight.md)
- [Batch 2 report](../2026-07-21-opt6-quality-governance-batch-2.md)
- [Current task packet](../../tasks/current-task.md)
- [Optimization roadmap](../../tasks/system-optimization-roadmap-2026-07-17.md)
