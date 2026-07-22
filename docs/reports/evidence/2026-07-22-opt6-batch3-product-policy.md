# OPT-6 Batch 3 ? product policy overlap evidence

## Current status

`IMPLEMENTATION COMPLETE / REVIEW PENDING / REMOTE WRITE PROHIBITED`

This is a current implementation checkpoint, not a historical remote result.
No Staging or Production statement for `00052` has been executed.

## Approved candidate

The local 00001?00051 replay inventory contains a pure `public.product`
SELECT overlap:

| Existing policy | Command | Predicate |
|---|---|---|
| `admin_all_product` | `*` | `get_user_role() = 'admin'` |
| `operator_select_product` | `r` | `get_user_role() = 'operator'` |

There is no warehouse, own-user, or command-specific `WITH CHECK` predicate in
this candidate. The other policy groups remain unchanged.

## Migration gates

`00052_optimize_product_rls_policy_overlap.sql`:

1. Sets bounded lock and statement timeouts.
2. Builds a fixed expected catalog and compares policy name, permissiveness,
   role OIDs, command, normalized complete `USING`, and normalized complete
   `WITH CHECK` before any drop.
3. Requires exactly the two reviewed baseline policies; an extra policy or
   drift raises `OPT-6 product policy baseline drift`.
4. Creates one shared Admin-or-Operator SELECT policy and three explicit
   Admin-only write policies.
5. Rechecks exactly the four reviewed post-migration catalog rows.

The SQL contains no table/function/index DDL, grants, business DML, old
Migration edits or history manipulation.

## Test evidence

- Static contract: [opt6-product-policy-overlap-migration.test.ts](../../../src/features/database/opt6-product-policy-overlap-migration.test.ts), 4/4 local PASS.
- PostgreSQL behavior contract:
  [opt6-product-policy-overlap.postgres.test.ts](../../../src/features/database/opt6-product-policy-overlap.postgres.test.ts).
  It compares anonymous, active Admin, active Operator and disabled-user
  SELECT/INSERT/UPDATE/DELETE behavior before/after and verifies both
  pre-drop drift guards preserve the baseline catalog. The isolated PostgreSQL
  17 run passed 3/3 tests locally.
- Continuous replay contract now includes the 00052 file and asserts the
  four-policy `public.product` catalog; its local run passed 6/6 tests.
- The combined database-contract command had 4 pre-existing locale-only
  failures in 00041?00049 English permission-message assertions; the 00052
  contract and replay remain green and this batch does not alter those tests.

## Review and remote stop gates

The submitted exact head is `6fd4537198d458fddad7baae174180d7fe478d3a`,
bound to CI run `29917354045` (quality and PostgreSQL jobs passed) and Vercel
Preview `AiTr8VWQjKGAbqcUJW9i55odhhFv` (READY). PR #11 remains Draft/Open.
The earlier `ce7e623ff396f099c3bf9256733973ce158beb9e` /
`29913122480` / `EeNmUmEaEajq3MnRVe7V3RCTfGph` values are historical
implementation-checkpoint evidence only. The first independent review found
only stale PR/documentation bindings; those bindings are now corrected and
the current re-review remains `FINAL REVIEW PENDING`.

Current hygiene evidence is green: `git diff --check` PASS, documentation
relative-link check `0 missing`, high-confidence secret scan `0`, orphan/temp
file check `0`, and worktree clean. Before any remote step, the exact
submitted head must have green quality and PostgreSQL CI jobs, lint/build/type
checks and an explicit independent reviewer `PASS`. That PASS authorizes only
preparation of a Staging SELECT-only preflight; it does not authorize
Production or Batch 4.
