# OPT-5 Staging postcheck evidence

> Environment: `hyarhvsjhkjpallbyifn` (`DIS Staging`)
>
> Execution date: 2026-07-20 (UTC+8)
>
> Scope: Migration `00049`, Migration history, function ACL/search path,
> RLS/policy/trigger invariants, rollback-only identity probes and Advisors

## Execution identity

- Project status: `ACTIVE_HEALTHY`
- PostgreSQL: 17.6
- Repository commit used for the write: `ca56f2af9f3d190c9e076f932da0398fbf7de338`
- Draft PR: [#8](https://github.com/rallsix66/overseas-inventory/pull/8)
- Exact-head CI: `29716503314`; quality and PostgreSQL jobs PASS
- Migration file SHA-256: `0338ad6312bfb2c418da3599ec2cc5bad893ca26dca370b4068a25ec21c277ae`

## Immediate preflight

At `2026-07-20T04:19:59.881375Z` the project was healthy and history was
exactly `00001–00048`. The write gate also returned:

| Check | Result |
| --- | ---: |
| in-progress sync runs | 0 |
| public tables / RLS enabled | 18 / 18 |
| policies | 42 |
| triggers | 13 |
| token-cache rows | 0 |
| token-cache secret-safe digest | `d41d8cd98f00b204e9800998ecf8427e` |
| target-function baseline digest | `2a420a78d203855ee872c635c8bf9e3b` |
| non-target-function baseline digest | `92578b3823388f20d3ae7a52ce52411e` |

## Migration and canonical history

The official Supabase migration interface applied the reviewed 6413-character
payload once. The interface initially registered its generated version
`20260720042210` and logical name `database_least_privilege_hardening`; Schema
and ACL postconditions were already correct, but that generated history key did
not match the repository's fixed-width convention.

The indexed [history-only normalization script](../sql/2026-07-20-opt5-00049-history-normalization.sql)
then ran in one bounded transaction. It locked only
`supabase_migrations.schema_migrations`, required exact `00001–00048` plus one
reviewed timestamp row, checked statement length/MD5, updated only that row's
`version` and `name`, and compared all immutable payload before commit. Script
SHA-256: `a1e601f69cbb7f47122a84e7ab382406b1cde95371c0156b6f81e2b7a09949df`.

Final history:

| Check | Result |
| --- | --- |
| rows / unique versions / unique names | 49 / 49 / 49 |
| range | `00001–00049` |
| final name | `00049_database_least_privilege_hardening` |
| statement count / chars / MD5 | 1 / 6413 / `60a8e975f7a1a30e9938b6a43eb8aea5` |
| version/name digest | `f534c4d5445051211eb3f04fb25d1f12` |
| ordered history digest | `26610827968b633a535a7e2da6076896` |

No Migration SQL was replayed by the normalization step, and it did not touch
application Schema or business data.

## ACL and search-path postcheck

At `2026-07-20T04:24:22.635898Z` all ten target functions had the expected
matrix:

| Function group | Security | anon | authenticated | service_role |
| --- | --- | ---: | ---: | ---: |
| `get_user_role()` | DEFINER, empty path | no | yes | no |
| `handle_new_user()` | DEFINER, empty path | no | no | no |
| three non-Auth trigger functions | INVOKER, empty path | no | no | no |
| two user-management RPCs | INVOKER, empty path | no | yes | no |
| three token-lease RPCs | DEFINER, empty path | no | no | yes |

`provider_token_cache` remained RLS enabled with zero ordinary-user policies;
service_role direct table privileges became an empty set. The token cache still
contained zero rows and retained its preflight digest.

## Catalog invariants

The write-postcheck catalog was compared with the still-untouched Production
baseline using the same canonical query and excluding only the ten intentional
target functions. Every count and digest matched:

| Kind | Count | Staging = Production digest |
| --- | ---: | --- |
| column | 161 | `74ca489873b0b9431086d4bbd79e335d` |
| constraint | 96 | `24bd952b8d3d63dc56c7a63b8493e563` |
| non-target function | 65 | `12dba1d4be536d08e2667a0339f4c83c` |
| index | 88 | `af8d64cb4cfc76ea1536da914c859001` |
| policy | 42 | `8968e86899a4fdab5c6c21da91d725ce` |
| table/RLS | 18 | `b1fe56656da7e9d0e4a048efcd10c89d` |
| trigger | 13 | `d90980ae9fa68ab8842b7d1cd3f19805` |

The live counters also remained 18 public tables, 18 RLS-enabled tables, 42
policies, 13 triggers and zero in-progress sync runs.

## Rollback-only behavior probes

Five live probes ran inside explicit transactions and rolled back:

1. active Admin identity and same-role user-management RPC;
2. active Operator identity through `get_user_role()`;
3. Auth user insertion proving `handle_new_user()` still fires;
4. timestamp update proving the trigger-only functions still fire;
5. service_role token-lease acquisition proving the RPC path still works.

The final residue check returned zero probe profiles and zero probe token rows.
Local PostgreSQL contracts additionally cover Operator, disabled, caller-ID
mismatch and anon rejection paths.

## Advisors and residual findings

- Security: 14 total (1 INFO / 13 WARN), down from 22. The five mutable
  search-path findings and three unnecessary callable-function findings were
  removed. Remaining classes are 11 intentional authenticated definer RPCs,
  `pg_trgm` in public, leaked-password protection disabled, and the intentional
  token-cache no-policy INFO.
- Performance: 168 total (47 INFO / 121 WARN). WARN stayed at 121; the ten-item
  movement from the earlier 158 baseline is only dynamic `unused_index` INFO
  and is unrelated to this Migration, which creates or drops no index.

This Staging checkpoint authorizes only the already reviewed Production
application of the same `00049`; it is not an OPT-5 final PASS and does not
authorize entry into OPT-6.
