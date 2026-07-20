# OPT-5 Production postcheck evidence

> Environment: `hzlhqyditalumhnxbaim` (`DIS Project` / Production)
>
> Execution date: 2026-07-20 (UTC+8)
>
> Scope: Migration `00049`, canonical Migration history, complete catalog and
> ACL equality, rollback-only behavior probes and Advisors

## Remote release gate

- Repository checkpoint: `350b1b594d73a4f493170e097dd5b2d5dd64d71d`
- Draft PR: [#8](https://github.com/rallsix66/overseas-inventory/pull/8)
- Exact-head GitHub Actions: `29717356909`
  - Tests, lint, and build: PASS
  - PostgreSQL concurrency/replay/contracts: PASS
- Vercel Preview: PASS / deployment completed
- Migration SHA-256: `0338ad6312bfb2c418da3599ec2cc5bad893ca26dca370b4068a25ec21c277ae`
- History normalization SQL SHA-256: `a1e601f69cbb7f47122a84e7ab382406b1cde95371c0156b6f81e2b7a09949df`

## Immediate preflight

At `2026-07-20T04:41:03.267745Z` Production was `ACTIVE_HEALTHY` on
PostgreSQL 17.6. The official connector and read-only SQL returned:

| Check | Result |
| --- | --- |
| Migration rows / range | 48 / `00001–00048` |
| timestamp versions | 0 |
| version/name digest | `4da6073c0bcfcd0e719e86bdb297fa32` |
| in-progress sync runs | 0 |
| public tables / RLS enabled | 18 / 18 |
| policies / triggers | 42 / 13 |
| token-cache rows | 1 |
| token-cache secret-safe digest | `0e3952ec0ba1903a3d7161b4f16e53c7` |
| service_role direct token-table grants | 7 |
| Security Advisor | 22 (1 INFO / 21 WARN) |

The target matrix was still the reviewed pre-00049 baseline: five mutable
search paths, unnecessary direct API execution on trigger helpers, authenticated
user-management invokers plus service_role defaults, and service_role-only
token RPCs. No preflight value had drifted from the earlier baseline.

## Execution and canonical history

The official migration interface applied the exact reviewed file once. The same
[bounded history-only normalization](../sql/2026-07-20-opt5-00049-history-normalization.sql)
used for Staging then asserted exact `00001–00048`, one generated timestamp
row, the 6413-character statement payload and zero running sync jobs. It changed
only that new row's `version` and `name`; all immutable history payload was
compared inside the transaction.

Final Production history:

| Check | Result |
| --- | --- |
| rows / unique versions / unique names | 49 / 49 / 49 |
| range | `00001–00049` |
| version/name digest | `f534c4d5445051211eb3f04fb25d1f12` |
| ordered history digest | `f5272e7e806dc1ba5e4b6ef9d0fb39e8` |
| 00049 statement count / chars / MD5 | 1 / 6413 / `60a8e975f7a1a30e9938b6a43eb8aea5` |

The version/name digest equals Staging. The ordered digest intentionally differs
because older environments retain different non-version history metadata; the
normalization transaction proved those older payloads unchanged.

## Production/Staging equality

At `2026-07-20T04:43:02.337218Z` and
`2026-07-20T04:43:08.601684Z`, the same canonical query returned exact equality
for all seven object groups, including all target functions:

| Kind | Count | Shared digest |
| --- | ---: | --- |
| column | 161 | `74ca489873b0b9431086d4bbd79e335d` |
| constraint | 96 | `24bd952b8d3d63dc56c7a63b8493e563` |
| function | 75 | `f0fbad373662620d2d33fefe1b375726` |
| index | 88 | `af8d64cb4cfc76ea1536da914c859001` |
| policy | 42 | `8968e86899a4fdab5c6c21da91d725ce` |
| table/RLS | 18 | `b1fe56656da7e9d0e4a048efcd10c89d` |
| trigger | 13 | `d90980ae9fa68ab8842b7d1cd3f19805` |

Both environments also had zero in-progress sync runs, RLS enabled on all 18
public tables, 42 policies, 13 triggers, token-cache RLS enabled with zero
ordinary-user policies, and no service_role direct token-table grant.

The complete ten-function matrix matched Staging:

- `get_user_role()` remains DEFINER/empty-path and authenticated-only;
- Auth/ordinary trigger helpers are not directly executable by API/system roles;
- both user-management RPCs remain INVOKER/empty-path and authenticated-only;
- all three lease RPCs remain DEFINER/empty-path and service_role-only.

## Rollback-only behavior and data preservation

Production probes selected one active Admin and one active Operator without
recording personal fields. Explicit transactions verified:

1. Admin `get_user_role()` and a same-role protected user-management call;
2. Operator `get_user_role()`;
3. Auth insertion still invokes `handle_new_user()`;
4. timestamp triggers still execute despite direct EXECUTE revocation;
5. service_role can still acquire a token lease through the RPC.

Every transaction rolled back. Final checks returned zero probe profiles, zero
probe token rows, one original token-cache row, and the unchanged preflight
digest `0e3952ec0ba1903a3d7161b4f16e53c7`. No business row persisted from testing.

## Advisors and residual findings

- Security: 14 (1 INFO / 13 WARN), matching Staging and removing the five
  mutable-search-path plus three unnecessary callable-function findings.
- Performance: 158 (37 INFO / 121 WARN), identical to the Production baseline.
- Remaining Security findings are intentional authenticated definer APIs,
  public-schema `pg_trgm`, leaked-password protection disabled, and the
  intentional token-cache RLS/no-policy INFO.
- Leaked-password protection is an Auth platform setting, not a database
  Migration. The available controlled connector has no Auth configuration write
  method; compatibility was assessed and the setting remains an explicit
  platform residual rather than requesting or storing credentials.

## Stop condition

OPT-5 is implemented and fully postchecked, but it is not marked DONE. This
evidence, the repository diff, latest PR/CI/Preview and both live environments
must receive explicit PASS from the designated independent review task before
OPT-6 begins.
