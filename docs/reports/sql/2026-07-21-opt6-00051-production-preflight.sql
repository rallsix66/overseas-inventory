-- OPT-6 Batch 2 / 00051 Production exact preflight (read-only).
-- Target project: hzlhqyditalumhnxbaim (DIS Project / Production).
--
-- This packet contains SELECT statements only. It does not begin a write
-- transaction, execute a Migration, alter policy, or register 00051. Run it
-- only as the Production preflight before a separately reviewed maintenance
-- window. A false result is a hard stop.

WITH history AS (
  SELECT version, name, statements
  FROM supabase_migrations.schema_migrations
),
actual_history AS (
  SELECT
    version,
    name,
    coalesce(cardinality(statements), -1) AS statement_count,
    length(coalesce(array_to_string(statements, E'\x1f'), '<NULL>'))
      AS statement_chars,
    md5(coalesce(array_to_string(statements, E'\x1f'), '<NULL>'))
      AS statement_digest
  FROM history
),
-- Reviewed Production baseline. The statement digest is over the complete
-- statements array joined with E'\\x1f', never a first-element-only projection.
expected_history(version, name, statement_count, statement_chars, statement_digest) AS (
  VALUES
    ('00001', '00001_initial_schema', 1, 15219, 'b9ffd51f5f16c72c95a86a55ab053419'),
    ('00002', '00002_create_shipment_transaction', 1, 1691, '8c647673acebe9b4b7fd1dcb209822dd'),
    ('00003', '00003_tighten_variant_rls', 1, 421, '62660676007d10db7f120a8e83da2e8b'),
    ('00004', '00004_batch_match_variants', 1, 3405, 'ccee90203eae8712f3fbce5a51ab5dbe'),
    ('00005', '00005_fix_shipment_rpc', 1, 3165, 'e0e58cbbebfa55d44f710add8861e35c'),
    ('00006', '00006_sync_warehouse_inventory', 1, 24605, 'c4a955105f61d84033b1dc83228b432e'),
    ('00007', '00007_sync_run', 1, 55386, 'e6c259016263bfced80ae8cfae1d7e39'),
    ('00008', '00008_sync_run_for_update_dry_run', 1, 8066, '077fc1101ff3a9706c2369551b5f3bee'),
    ('00009', '00009_generalize_sync_warehouse_country', 1, 17791, 'd4a5642b55aec308bb22a606d9986851'),
    ('00010', '00010_claim_sync_run_system', 1, 8242, 'c396f25e48d68512bf8522774b3941ee'),
    ('00011', '00011_add_variant_soft_archive', 1, 1921, 'b3d5c67c7f6c1cc90096134d93e482f5'),
    ('00012', '00012_user_variant_preference', 1, 3133, '42c567d557dbb1c04037898dfe3667bb'),
    ('00013', '00013_extend_user_variant_preference_favorited', 1, 1151, '0ff7a8d9f76d8187f7f4ce2a2bcd5977'),
    ('00014', '00014_dynamic_alert_fields', 1, 21523, 'fd9c40844c1202ca212a56e43b2faef4'),
    ('00015', '00015_user_warehouses', 1, 22225, '4bcb9b30e454405e729b2f10ba512bab'),
    ('00016', '00016_update_user_warehouses_rpc', 1, 2955, '17cf700f65bea8440096e2f718702c56'),
    ('00017', '00017_shipment_external_ref', 1, 6634, 'b709928fb0d299803fb0467410e8cddf'),
    ('00018', '00018_add_shipment_no', 1, 4328, '6c643bbb11e5d5d6e4dde4917ef7d1f2'),
    ('00019', '00019_change_shipment_status_rpc', 1, 2405, '7ffee2f13858f63113ac101d4acfa761'),
    ('00020', '00020_add_purchase_order_no_to_shipment', 1, 3576, '9296268d564a00b61a5c6accb2230d88'),
    ('00021', '00021_change_shipment_status_admin_only', 1, 2202, '01a08e7b8be03a1f0f61bfb5381495c3'),
    ('00022', '00022_status_flow_validation', 1, 3432, '6f9dd68d1ea14a471d62147505ca0ba8'),
    ('00023', '00023_warehouse_shipment_transactional', 1, 4701, '778440407a670891a3e7b87894522eb6'),
    ('00024', '00024_atomic_user_admin_guard', 1, 3223, '07891e8bca384326f2c7030b14121169'),
    ('00025', '00025_rpc_caller_identity_binding', 1, 6354, '318661c6ad6a3f235baaf4c4d0d56085'),
    ('00026', '00026_partial_warehouse_shipment', 1, 7970, 'db1ce4f0b301ded875d12ecca622090d'),
    ('00027', '00027_overseas_inventory_performance_rpc', 1, 13364, '8adc771cc01ca9d690068a8d94d20c6d'),
    ('00028', '00028_low_stock_rpc', 1, 4020, '3defee936849f9fe071f3735cfa6e971'),
    ('00029', '00029_sync_runs_pagination', 1, 9110, 'b839bf13c6e36401b2aa4d026bc16123'),
    ('00030', '00030_fix_paginated_sync_runs_operator_warehouse_filter', 1, 7313, '7a722794406b40d5777cd4cea7e68c6b'),
    ('00031', '00031_phase_e_index_optimization', 1, 8152, 'f1e37f8e5463b15dcc8cb1ecc9652b0c'),
    ('00032', '00032_sync_warehouse_overview', 1, 5314, '483207774fbcf65020acd662ad861592'),
    ('00033', '00033_drop_unused_inventory_quantity_indexes', 1, 1186, '863591d306ea688d97af56f585da1e28'),
    ('00034', '00034_add_variant_name_to_rpcs', 1, 9357, 'b995cac2ef0fb97db0f70e7f8ca3ea1c'),
    ('00035', '00035_tokenized_overseas_inventory_search', 1, 7161, '9f9bc09e96ea1261cca05491eb75fce1'),
    ('00036', '00036_pg_trgm_search_indexes', 1, 2899, '4914c528fcf11e7eb6f6c4b401ce01c7'),
    ('00037', '00037_add_in_transit_stock_status', 1, 7478, '8f6c5d2a1d63acf292f1211c13cb6c77'),
    ('00038', '00038_golucky_schema', 1, 7017, 'e8883456d9d87922d52d0d0a299e1444'),
    ('00039', '00039_golucky_rls_rpc', 1, 14775, '4353afb962502eea441a563644eff4de'),
    ('00040', '00040_golucky_token_cache', 1, 7517, 'd7e2eef48f84936af77b53fdd6455bf2'),
    ('00041', '00041_replenishment_warehouse_params', 1, 752, 'dbe56c84bd30d389743043231452ec24'),
    ('00042', '00042_replenishment_cancellation', 1, 661, 'bbf8ad8299aa3b3e7e7181eb807accf4'),
    ('00043', '00043_forecast_stockout', 1, 3489, 'cc4a53ddd50f0c2a16d0f793feb7e6ba'),
    ('00044', '00044_replenishment_rpcs', 1, 9938, 'fefb4f40c5c8e233aef1c6d0497f345e'),
    ('00045', '00045_product_overview_rpc', 1, 8814, 'b35210ab8d809e7985e3b9d9d055f270'),
    ('00046', '00046_war_room_variant_detail_rpc', 1, 10501, '66b76a6365d44c069577c3b2d5681a33'),
    ('00047', '00047_dashboard_warehouse_health_overview', 1, 5519, '2e68149556947358eb11f41963a2b607'),
    ('00048', '00048_restore_claim_sync_run_system', 1, 5596, '0a4a0cb7b1bcae70346efda90333e2f9'),
    ('00049', '00049_database_least_privilege_hardening', 1, 6413, '60a8e975f7a1a30e9938b6a43eb8aea5'),
    ('00050', '00050_optimize_auth_rls_initplan', 1, 6519, 'f5758671947c61dc1fb3bf3e94d8e8d0')
),
history_check AS (
  SELECT
    count(*) = 50 AS rows_50,
    count(DISTINCT version) = 50 AS unique_versions,
    count(DISTINCT name) = 50 AS unique_names,
    min(version) = '00001' AS min_00001,
    max(version) = '00050' AS max_00050,
    count(*) FILTER (WHERE version !~ '^[0-9]{5}$') = 0 AS no_timestamp_versions,
    array_agg(version ORDER BY version) IS NOT DISTINCT FROM
      ARRAY(
        SELECT lpad(i::text, 5, '0')
        FROM generate_series(1, 50) AS series(i)
    ) AS exact_version_set,
    NOT EXISTS (
      SELECT 1 FROM history WHERE version = '00051'
    ) AS no_00051
  FROM history
),
history_compare AS (
  SELECT
    md5(string_agg(version || '|' || name, E'\n' ORDER BY version))
      AS actual_version_name_digest,
    md5((SELECT string_agg(version || '|' || name, E'\n' ORDER BY version)
         FROM expected_history)) AS expected_version_name_digest,
    md5(string_agg(
      version || '|' || name || '|' || statement_count || '|' || statement_chars
        || '|' || statement_digest,
      E'\n' ORDER BY version
    )) AS actual_history_payload_digest,
    md5((SELECT string_agg(
      version || '|' || name || '|' || statement_count || '|' || statement_chars
        || '|' || statement_digest,
      E'\n' ORDER BY version
    ) FROM expected_history)) AS expected_history_payload_digest,
    (
      (SELECT count(*) FROM actual_history) = (SELECT count(*) FROM expected_history)
      AND NOT EXISTS (
        SELECT 1
        FROM expected_history AS expected
        FULL JOIN actual_history AS actual USING (version)
        WHERE actual.version IS NULL
           OR expected.version IS NULL
           OR actual.name IS DISTINCT FROM expected.name
      )
    ) AS exact_version_name_history,
    (
      (SELECT count(*) FROM actual_history) = (SELECT count(*) FROM expected_history)
      AND NOT EXISTS (
        SELECT 1
        FROM expected_history AS expected
        FULL JOIN actual_history AS actual USING (version)
        WHERE actual.version IS NULL
           OR expected.version IS NULL
           OR actual.name IS DISTINCT FROM expected.name
           OR actual.statement_count IS DISTINCT FROM expected.statement_count
           OR actual.statement_chars IS DISTINCT FROM expected.statement_chars
           OR actual.statement_digest IS DISTINCT FROM expected.statement_digest
      )
    ) AS exact_history_payload
  FROM actual_history
),
actual_role_policy AS (
  SELECT
    policy.polname AS policy_name,
    policy.polpermissive AS permissive,
    policy.polroles::text AS roles,
    policy.polcmd::text AS command,
    regexp_replace(
      coalesce(pg_get_expr(policy.polqual, policy.polrelid), ''),
      '\s+', '', 'g'
    ) AS using_expression,
    regexp_replace(
      coalesce(pg_get_expr(policy.polwithcheck, policy.polrelid), ''),
      '\s+', '', 'g'
    ) AS with_check_expression
  FROM pg_policy AS policy
  JOIN pg_class AS relation ON relation.oid = policy.polrelid
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public' AND relation.relname = 'role'
),
expected_role_policy(policy_name, permissive, roles, command, using_expression, with_check_expression) AS (
  VALUES
    ('admin_all_role', true, '{0}', '*', '(get_user_role()=''admin''::text)', ''),
    ('operator_select_role', true, '{0}', 'r', '(get_user_role()=''operator''::text)', '')
),
role_check AS (
  SELECT
    (SELECT count(*) FROM actual_role_policy) = 2 AS role_policy_count_2,
    (
      SELECT count(*)
      FROM expected_role_policy AS expected
      LEFT JOIN actual_role_policy AS actual USING (policy_name)
      WHERE actual.policy_name IS NULL
         OR actual.permissive IS DISTINCT FROM expected.permissive
         OR actual.roles IS DISTINCT FROM expected.roles
         OR actual.command IS DISTINCT FROM expected.command
         OR actual.using_expression IS DISTINCT FROM expected.using_expression
         OR actual.with_check_expression IS DISTINCT FROM expected.with_check_expression
    ) = 0 AS exact_role_policies,
    md5(
      (
        SELECT string_agg(
          policy_name || '|' || permissive || '|' || roles || '|' || command || '|'
            || using_expression || '|' || with_check_expression,
          E'\n' ORDER BY policy_name
        )
        FROM actual_role_policy
      )
    ) AS role_policy_digest
)
SELECT
  history_check.*,
  history_compare.*,
  role_check.*,
  (
    SELECT count(*) FROM public.sync_run WHERE status = 'in_progress'
  ) AS in_progress_sync_runs
FROM history_check
CROSS JOIN history_compare
CROSS JOIN role_check;
