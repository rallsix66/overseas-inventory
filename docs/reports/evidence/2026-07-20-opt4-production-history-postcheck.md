# OPT-4 Production History Postcheck Evidence

> Project: `hzlhqyditalumhnxbaim` (`DIS Project` / Production)
> Postcheck snapshot UTC: `2026-07-20 02:34:27.587011`
> Scope: `supabase_migrations.schema_migrations.version` history-only realignment
> Status: **EXECUTED / LOCAL AND REMOTE POSTCHECK PASS / INDEPENDENT FINAL REVIEW PENDING**

## Execution record

- Maintenance script: [2026-07-20-opt4-production-history-version-realignment.sql](../sql/2026-07-20-opt4-production-history-version-realignment.sql)
- Script LF-normalized SHA-256: `eb3dfb3e7117504be3249294bb73c53af4c4e78072ecbed853e4e5e78631f420`
- Script size at execution: 5,156 chars / 180 lines
- Prewrite snapshot UTC: `2026-07-20 02:31:59.225473`
- Prewrite history: 48 rows / 48 unique versions / 48 unique names / 48 timestamp versions / 0 aligned
- Prewrite version+name digest: `06c450dcf0e265c7d20f3cf7b8ed71e1`
- Prewrite name/statements digest: `8f08a8dee32cbca3aebe5f5861206699`
- Prewrite in-progress sync runs: 0
- The first connector submission ended with an HTTP transport error. A read-only ambiguity check proved the database remained at 48 timestamp versions, so no write had occurred.
- The exact transactional prefix through `COMMIT;` was then submitted once. The transaction updated 48/48 versions and returned success.
- Transaction assertions locked the history table, required the reviewed Production version/name digest, required 0 in-progress sync runs, and compared every row's `to_jsonb(row) - 'version'` payload before commit.
- No Migration SQL was replayed. No `public` Schema, ACL, RLS, Policy, Trigger, function, or business row was modified.

## Aggregate postcheck

- History rows: 48
- Unique versions: 48
- Unique names: 48
- Timestamp versions: 0
- Aligned versions: 48
- Version set: exactly `00001–00048`
- Name/statements digest: `8f08a8dee32cbca3aebe5f5861206699` (unchanged)
- Ordered history digest: `8a9ff2ad685dc8ca0c2633afc293175e`
- In-progress sync runs: 0

## Canonical catalog postcheck

Production and Staging were recomputed after the write and matched on all 14 groups:

| Scope | Kind | Count | Digest |
|---|---|---:|---|
| full | column | 161 | `74ca489873b0b9431086d4bbd79e335d` |
| full | constraint | 96 | `24bd952b8d3d63dc56c7a63b8493e563` |
| full | function | 75 | `4b53ac2a18eac623a0ae9ea7cc4d0f2b` |
| full | index | 88 | `af8d64cb4cfc76ea1536da914c859001` |
| full | policy | 42 | `8968e86899a4fdab5c6c21da91d725ce` |
| full | table_rls | 18 | `b1fe56656da7e9d0e4a048efcd10c89d` |
| full | trigger | 13 | `d90980ae9fa68ab8842b7d1cd3f19805` |
| known_drift_excluded | column | 161 | `74ca489873b0b9431086d4bbd79e335d` |
| known_drift_excluded | constraint | 96 | `24bd952b8d3d63dc56c7a63b8493e563` |
| known_drift_excluded | function | 74 | `74cfdc467040fa8e462131108002f751` |
| known_drift_excluded | index | 88 | `af8d64cb4cfc76ea1536da914c859001` |
| known_drift_excluded | policy | 42 | `8968e86899a4fdab5c6c21da91d725ce` |
| known_drift_excluded | table_rls | 18 | `b1fe56656da7e9d0e4a048efcd10c89d` |
| known_drift_excluded | trigger | 13 | `d90980ae9fa68ab8842b7d1cd3f19805` |

## Fixed CLI 2.109.1 verification

- The Supabase connector directly returned the true Production remote version set as `00001–00048`.
- A one-time PostgreSQL 17 history mirror was populated from the repository's 48 migration filenames and the true remote version set.
- `supabase migration list --db-url ...` returned 48 rows with local=remote for every version.
- `supabase db push --dry-run --db-url ...` returned `Remote database is up to date.`
- The temporary database was stopped and deleted. No token, password, service-role key, or connection string was written to the repository.
- CLI was not directly linked to Production because this execution environment has no Supabase platform access token. The independent reviewer must decide whether the connector plus fixed-CLI isomorphic comparison is sufficient for this narrow version-comparison proof.

## Advisors

- Production Security Advisor: 22 total (1 INFO / 21 WARN), unchanged from the reviewed baseline.
- Production Performance Advisor: 158 total (37 INFO / 121 WARN), unchanged from the reviewed baseline.
- Neither advisor contains a `claim_sync_run_system` finding. Existing findings remain assigned to OPT-5 and OPT-6; this history-only operation did not attempt to change them.

## Repository quality gate

- Default Vitest suite: 91 files / 3,932 tests PASS.
- ESLint: 0 errors / 31 warnings, exactly within the established warning budget.
- Next.js 16.2.9 production build: PASS; application TypeScript check completed successfully during build.
- PostgreSQL concurrency: 44/44 PASS.
- PostgreSQL migration replay and RPC/RLS contract: 14/14 PASS after setting the one-time Windows PostgreSQL instance to CI-equivalent `lc_messages=C`. The initial Chinese-locale run rejected the same two unauthorized calls correctly but did not match the test's English error-message regex.
- Relative documentation links: PASS. New report, maintenance SQL, and evidence are indexed from `docs/README.md`, `current-state.md`, the current task, roadmap, and Production report.
- Secret scan: no access token, database password, service-role key, or credential-bearing connection string.
- `npm audit --omit=dev`: 2 moderate findings from the Next.js-bundled PostCSS advisory, with no fix available in the current dependency tree. This is recorded as OPT-6/dependency-governance residual risk rather than changed in the OPT-4 history-only scope.
- Draft PR #7 head `34f5c27`: GitHub Actions run `29713652260` PASS for both `Tests, lint, and build` and `PostgreSQL concurrency tests`; Vercel Preview `9BbHcVa3eXZixvksgQ5RwbdvDrEz` PASS.

## Rows

| Version | Name | Statements | Statement chars | Statement MD5 |
|---|---|---:|---:|---|
| `00001` | `00001_initial_schema` | 1 | 15219 | `b9ffd51f5f16c72c95a86a55ab053419` |
| `00002` | `00002_create_shipment_transaction` | 1 | 1691 | `8c647673acebe9b4b7fd1dcb209822dd` |
| `00003` | `00003_tighten_variant_rls` | 1 | 421 | `62660676007d10db7f120a8e83da2e8b` |
| `00004` | `00004_batch_match_variants` | 1 | 3405 | `ccee90203eae8712f3fbce5a51ab5dbe` |
| `00005` | `00005_fix_shipment_rpc` | 1 | 3165 | `e0e58cbbebfa55d44f710add8861e35c` |
| `00006` | `00006_sync_warehouse_inventory` | 1 | 24605 | `c4a955105f61d84033b1dc83228b432e` |
| `00007` | `00007_sync_run` | 1 | 55386 | `e6c259016263bfced80ae8cfae1d7e39` |
| `00008` | `00008_sync_run_for_update_dry_run` | 1 | 8066 | `077fc1101ff3a9706c2369551b5f3bee` |
| `00009` | `00009_generalize_sync_warehouse_country` | 1 | 17791 | `d4a5642b55aec308bb22a606d9986851` |
| `00010` | `00010_claim_sync_run_system` | 1 | 8242 | `c396f25e48d68512bf8522774b3941ee` |
| `00011` | `00011_add_variant_soft_archive` | 1 | 1921 | `b3d5c67c7f6c1cc90096134d93e482f5` |
| `00012` | `00012_user_variant_preference` | 1 | 3133 | `42c567d557dbb1c04037898dfe3667bb` |
| `00013` | `00013_extend_user_variant_preference_favorited` | 1 | 1151 | `0ff7a8d9f76d8187f7f4ce2a2bcd5977` |
| `00014` | `00014_dynamic_alert_fields` | 1 | 21523 | `fd9c40844c1202ca212a56e43b2faef4` |
| `00015` | `00015_user_warehouses` | 1 | 22225 | `4bcb9b30e454405e729b2f10ba512bab` |
| `00016` | `00016_update_user_warehouses_rpc` | 1 | 2955 | `17cf700f65bea8440096e2f718702c56` |
| `00017` | `00017_shipment_external_ref` | 1 | 6634 | `b709928fb0d299803fb0467410e8cddf` |
| `00018` | `00018_add_shipment_no` | 1 | 4328 | `6c643bbb11e5d5d6e4dde4917ef7d1f2` |
| `00019` | `00019_change_shipment_status_rpc` | 1 | 2405 | `7ffee2f13858f63113ac101d4acfa761` |
| `00020` | `00020_add_purchase_order_no_to_shipment` | 1 | 3576 | `9296268d564a00b61a5c6accb2230d88` |
| `00021` | `00021_change_shipment_status_admin_only` | 1 | 2202 | `01a08e7b8be03a1f0f61bfb5381495c3` |
| `00022` | `00022_status_flow_validation` | 1 | 3432 | `6f9dd68d1ea14a471d62147505ca0ba8` |
| `00023` | `00023_warehouse_shipment_transactional` | 1 | 4701 | `778440407a670891a3e7b87894522eb6` |
| `00024` | `00024_atomic_user_admin_guard` | 1 | 3223 | `07891e8bca384326f2c7030b14121169` |
| `00025` | `00025_rpc_caller_identity_binding` | 1 | 6354 | `318661c6ad6a3f235baaf4c4d0d56085` |
| `00026` | `00026_partial_warehouse_shipment` | 1 | 7970 | `db1ce4f0b301ded875d12ecca622090d` |
| `00027` | `00027_overseas_inventory_performance_rpc` | 1 | 13364 | `8adc771cc01ca9d690068a8d94d20c6d` |
| `00028` | `00028_low_stock_rpc` | 1 | 4020 | `3defee936849f9fe071f3735cfa6e971` |
| `00029` | `00029_sync_runs_pagination` | 1 | 9110 | `b839bf13c6e36401b2aa4d026bc16123` |
| `00030` | `00030_fix_paginated_sync_runs_operator_warehouse_filter` | 1 | 7313 | `7a722794406b40d5777cd4cea7e68c6b` |
| `00031` | `00031_phase_e_index_optimization` | 1 | 8152 | `f1e37f8e5463b15dcc8cb1ecc9652b0c` |
| `00032` | `00032_sync_warehouse_overview` | 1 | 5314 | `483207774fbcf65020acd662ad861592` |
| `00033` | `00033_drop_unused_inventory_quantity_indexes` | 1 | 1186 | `863591d306ea688d97af56f585da1e28` |
| `00034` | `00034_add_variant_name_to_rpcs` | 1 | 9357 | `b995cac2ef0fb97db0f70e7f8ca3ea1c` |
| `00035` | `00035_tokenized_overseas_inventory_search` | 1 | 7161 | `9f9bc09e96ea1261cca05491eb75fce1` |
| `00036` | `00036_pg_trgm_search_indexes` | 1 | 2899 | `4914c528fcf11e7eb6f6c4b401ce01c7` |
| `00037` | `00037_add_in_transit_stock_status` | 1 | 7478 | `8f6c5d2a1d63acf292f1211c13cb6c77` |
| `00038` | `00038_golucky_schema` | 1 | 7017 | `e8883456d9d87922d52d0d0a299e1444` |
| `00039` | `00039_golucky_rls_rpc` | 1 | 14775 | `4353afb962502eea441a563644eff4de` |
| `00040` | `00040_golucky_token_cache` | 1 | 7517 | `d7e2eef48f84936af77b53fdd6455bf2` |
| `00041` | `00041_replenishment_warehouse_params` | 1 | 752 | `dbe56c84bd30d389743043231452ec24` |
| `00042` | `00042_replenishment_cancellation` | 1 | 661 | `bbf8ad8299aa3b3e7e7181eb807accf4` |
| `00043` | `00043_forecast_stockout` | 1 | 3489 | `cc4a53ddd50f0c2a16d0f793feb7e6ba` |
| `00044` | `00044_replenishment_rpcs` | 1 | 9938 | `fefb4f40c5c8e233aef1c6d0497f345e` |
| `00045` | `00045_product_overview_rpc` | 1 | 8814 | `b35210ab8d809e7985e3b9d9d055f270` |
| `00046` | `00046_war_room_variant_detail_rpc` | 1 | 10501 | `66b76a6365d44c069577c3b2d5681a33` |
| `00047` | `00047_dashboard_warehouse_health_overview` | 1 | 5519 | `2e68149556947358eb11f41963a2b607` |
| `00048` | `00048_restore_claim_sync_run_system` | 1 | 5596 | `0a4a0cb7b1bcae70346efda90333e2f9` |

The table records the Production payload exactly as stored after commit. The known 00041–00047 trailing-newline difference from Staging remains unchanged and was not normalized.
