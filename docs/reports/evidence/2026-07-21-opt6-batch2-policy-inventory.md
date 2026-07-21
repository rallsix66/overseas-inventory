# OPT-6 Batch 2 policy-overlap inventory evidence

## Status and scope

`LOCAL INVENTORY PASS / REMOTE WRITE PROHIBITED / REVIEW PENDING`

This evidence records the narrow, first Batch 2 candidate only. It does not
authorize applying `00051` to either remote environment or starting another
Batch 2 candidate.

- Execution date: 2026-07-21 (Asia/Shanghai).
- Candidate: the two permissive policies on `public.role` that both apply to
  `SELECT`.
- Excluded from this candidate: the remaining 22 overlapping table/action
  groups, all index findings, Auth settings, application runtime paths and
  synchronization scripts.

## Production read-only signal

The authenticated Production SQL Editor ran a `SELECT` over `pg_policy`,
`pg_class`, and `pg_namespace` restricted to the `public` schema. The result
contained 42 policy rows (the dashboard limit was 100). The visible first
records confirmed the expected permissive `{0}` role model: an `admin_all_*`
policy plus narrower Operator policies. No production SQL write was submitted.

The full candidate preflight remains intentionally deferred until after the
code packet receives independent review. It must require the exact reviewed
two-policy catalog before a Staging write is even considered.

## Isolated replay inventory

An ephemeral local PostgreSQL 17 database replayed migrations `00001` through
`00050` continuously: 5/5 replay checks passed. Its policy catalog had 42
policies and 23 same-table/action permissive overlap groups after expanding
`FOR ALL` to `SELECT`, `INSERT`, `UPDATE`, and `DELETE`.

The groups are not duplicate policies. They are deliberate unions such as
Admin-all plus Operator-select, or Admin-all plus own-user access. The group
counts are therefore not a deletion list. The Advisor's 115 findings are a
different aggregation of these overlaps; this catalog is the concrete
table/action/role inventory used for safe sequencing.

| First reviewed group | Effective action | Existing permissive union |
|---|---|---|
| `role` | `SELECT` | `admin_all_role` OR `operator_select_role` |

For this group, the reviewed predicates are exactly `get_user_role() =
'admin'` and `get_user_role() = 'operator'`; neither has a `WITH CHECK`
expression. The union can be represented by one `SELECT` policy. Admin-only
insert/update/delete are retained as explicit policies so the write surface is
unchanged and each action has one permissive policy.

## Candidate safety proof

`00051_optimize_role_rls_policy_overlap.sql` has all of the following guards:

1. It sets 5-second lock and 30-second statement timeouts.
2. Before any drop, it requires exactly the two complete reviewed role-table
   policy rows: name, permissiveness, role OIDs, command, normalized `USING`,
   and normalized `WITH CHECK`. Extra policies also reject the migration.
3. It replaces the two policies with one Admin-or-Operator `SELECT` policy and
   three explicit Admin-only write policies.
4. It then requires exactly the four new complete catalog rows. No table,
   function, ACL, index, trigger, business row, old Migration or history row
   is changed.

The isolated PostgreSQL behavior contract compares before/after anonymous,
active Admin, active Operator and disabled-user `SELECT`, `INSERT`, `UPDATE`,
and `DELETE` results. It also proves that an extra permissive policy or a full
Operator predicate drift rejects `00051` before either baseline policy drops.
The candidate suite passed 12/12 checks: static contract, continuous
`00001`–`00051` replay, behavior matrix and guard failures.

The broader local quality gate also passed 94 files / 3949 default tests, lint
with 0 errors / 0 warnings, the Next.js production build/TypeScript check, and
44/44 PostgreSQL concurrency tests in a separate fresh temporary database. The
full contract command retains four known locale-only English-message assertion
failures in pre-existing 00041–00049 tests; the new 00051 contract itself
passed, and CI remains the exact-head full-contract authority.

## Stop gate

- No `00051` remote write has occurred.
- The complete code/documentation packet must pass lint, tests, build, link,
  secret and diff checks, then receive an explicit PASS from the designated
  independent review task.
- Only then may a separate Staging exact preflight and controlled apply be
  prepared. Production remains prohibited until Staging has its own evidence
  and independent PASS.

## Navigation

- [Batch 2 report](../2026-07-21-opt6-quality-governance-batch-2.md)
- [Current task packet](../../tasks/current-task.md)
- [Optimization roadmap](../../tasks/system-optimization-roadmap-2026-07-17.md)
- [00051 migration](../../../supabase/migrations/00051_optimize_role_rls_policy_overlap.sql)
- [00051 static contract](../../../src/features/database/opt6-role-policy-overlap-migration.test.ts)
- [00051 PostgreSQL behavior contract](../../../src/features/database/opt6-role-policy-overlap.postgres.test.ts)
