# OPT-4 Staging History Postcheck Evidence

> Project: `hyarhvsjhkjpallbyifn` (`DIS Staging`)
> Snapshot UTC: `2026-07-20 01:31:28.643294`
> Scope: `supabase_migrations.schema_migrations` after history-only version realignment

## Aggregate

- History rows: 48
- Unique versions: 48
- Unique names: 48
- Timestamp versions: 0
- Aligned versions: 48
- Version set: exactly `00001–00048`
- Name/statements digest: `3566222cba075216b6c9a0d3065b7b93`
- Ordered history digest: `726c033e6386ad7e759c0545a467b8d9`
- In-progress sync runs: 0

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
| `00041` | `00041_replenishment_warehouse_params` | 1 | 750 | `adf5951cb448754b4a62e259a533eca1` |
| `00042` | `00042_replenishment_cancellation` | 1 | 659 | `da40777c08606c54b750f10c46006b52` |
| `00043` | `00043_forecast_stockout` | 1 | 3487 | `c85d29f5a213a6e54b378ce266760de2` |
| `00044` | `00044_replenishment_rpcs` | 1 | 9936 | `db8f65300c4ad5b7098f3a1fe8a33c90` |
| `00045` | `00045_product_overview_rpc` | 1 | 8812 | `c4bd27c670a112ab58cbf86f21ccd10a` |
| `00046` | `00046_war_room_variant_detail_rpc` | 1 | 10499 | `c6bbce9065096d1b53f3f1dc731e139b` |
| `00047` | `00047_dashboard_warehouse_health_overview` | 1 | 5517 | `1cdf5e8f221e270fe183eddcfbb3b175` |
| `00048` | `00048_restore_claim_sync_run_system` | 1 | 5596 | `0a4a0cb7b1bcae70346efda90333e2f9` |

The maintenance transaction compared every row's `to_jsonb(row) - 'version'` payload before commit. The table above is a post-commit audit extract; it is not an instruction to replay migration SQL.
