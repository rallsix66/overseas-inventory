# OPT-6 Batch 1 — 00050 remote apply and postcheck evidence

## Status

`STAGING PASS / PRODUCTION PASS / INDEPENDENT REVIEW PENDING`

This report records the controlled remote application of
`00050_optimize_auth_rls_initplan.sql`. It does not mark OPT-6 complete and it
does not authorize Batch 2 before the designated independent review returns an
explicit `PASS`.

## Binding and execution window

- Batch 1 reviewed head: `d2eef9cbf09d35de3e0ab01bd2f84991ad59cb51`
- PR #9 merge commit: `d9acf51e0cfbfd2e21f243f41273de7278f4e80a`
- Master CI: `29733960202` — quality and PostgreSQL jobs passed
- Production deployment: `BKDzcK4k9noxQgzAboJB6h2XjmeF` — Vercel status passed
- Environment order: Staging `hyarhvsjhkjpallbyifn`, then Production
  `hzlhqyditalumhnxbaim`
- Completed: 2026-07-20 19:33 +08:00 (Asia/Shanghai)
- Documentation checkpoint: PR #10 head `5c80755f25a48496427e59aaa9635027dd989768`,
  CI run `29739465796` (both jobs passed), Vercel Preview
  `sBfgQG7cstb2n5YZkv1w2mvQgEGM` (passed).
- Execution surface: authenticated Supabase SQL Editor. The current task had no
  Supabase connector and the fixed CLI was not safely linked; no database
  password, access token, service-role key, or connection string was requested
  or stored.

## Scope and safety gates

1. Before either environment was changed, an exact preflight required the
   history set `00001`–`00049` with 49 unique names and no `00050` row.
2. The same preflight compared all six reviewed policies by schema, table,
   policy name, `polpermissive`, role OIDs, command, complete normalized
   `USING`, and complete normalized `WITH CHECK` expressions. Any drift raised
   before a `DROP POLICY`.
3. The policy write was one short transaction with a 5-second lock timeout and
   30-second statement timeout. It dropped and recreated only the six reviewed
   policies, changing direct `auth.uid()` calls to `(SELECT auth.uid())`.
4. History registration used an `ACCESS EXCLUSIVE` lock on
   `supabase_migrations.schema_migrations`, exact 49-row/set gates, one INSERT,
   and post-insert assertions before COMMIT. It did not update old history,
   replay an old Migration, or execute business-data DML.
5. The stored Migration body was normalized to LF before insertion. Canonical
   body facts: 6519 characters, MD5
   `f5758671947c61dc1fb3bf3e94d8e8d0`, SHA-256
   `a15a9839fea50df45537f205b030bd330d85bd1e26754836362a1f60895cfce8`.

The first Staging history-registration attempt intentionally failed its strict
body digest assertion and rolled back completely because the editor had
normalized line endings. A read-only check confirmed no `00050` row remained.
The corrected LF-normalized transaction then passed. Production used only the
corrected transaction.

## History postcheck

Both environments returned the same result:

| Check | Staging | Production |
|---|---:|---:|
| Rows | 50 | 50 |
| Unique versions | 50 | 50 |
| Unique names | 50 | 50 |
| Min / max | `00001` / `00050` | `00001` / `00050` |
| Non-five-digit/timestamp versions | 0 | 0 |
| Exact ordered `00001`–`00050` set | true | true |
| Exact `00050` name/body/count/MD5 | 1 | 1 |

The `00050` row in each environment has name
`00050_optimize_auth_rls_initplan`, one statement, 6519 characters, and MD5
`f5758671947c61dc1fb3bf3e94d8e8d0`. Actor metadata was verified in-session
but is intentionally omitted from repository evidence.

## Policy catalog postcheck

Both environments returned exactly six target rows. Staging was checked before
Production work began; Production was checked again after history registration.

| Table / policy | Command | Roles | Permissive | Complete optimized predicate |
|---|---|---|---|---|
| `profiles.operator_update_own_profile` | `w` | `{0}` | true | `USING` and `WITH CHECK`: scalar uid = id AND role = operator |
| `profiles.user_read_own_profile` | `r` | `{0}` | true | `USING`: scalar uid = id |
| `user_variant_preference.user_delete_own_preferences` | `d` | `{0}` | true | `USING`: scalar uid = user_id |
| `user_variant_preference.user_insert_own_preferences` | `a` | `{0}` | true | `WITH CHECK`: scalar uid = user_id |
| `user_variant_preference.user_select_own_preferences` | `r` | `{0}` | true | `USING`: scalar uid = user_id |
| `user_warehouses.operator_select_own_user_warehouses` | `r` | `{0}` | true | `USING`: scalar uid = user_id |

No table, function, ACL, index, trigger, business row, synchronization script,
Auth setting, or old Migration was changed in this remote stage.

## Stop gate

- Remote apply/postcheck is complete for both environments.
- Repository documentation, links, secret/orphan scan, quality checks, CI and
  Vercel evidence must remain green on the final documentation head.
- The designated independent review task must return explicit `PASS` before
  current-task may move to OPT-6 Batch 2.

## Navigation

- [OPT-6 Batch 1 main report](../2026-07-20-opt6-quality-governance-batch-1.md)
- [Current task packet](../../tasks/current-task.md)
- [System optimization roadmap](../../tasks/system-optimization-roadmap-2026-07-17.md)
- [Migration 00050](../../../supabase/migrations/00050_optimize_auth_rls_initplan.sql)
