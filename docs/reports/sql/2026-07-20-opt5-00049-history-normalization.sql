-- OPT-5 Migration 00049 history-only normalization.
--
-- Supabase apply_migration records a generated timestamp version and the
-- supplied logical name. The repository's canonical history is fixed-width:
--   00049 / 00049_database_least_privilege_hardening
--
-- This maintenance script updates only version and name for that one history
-- row. It does not execute Migration SQL or change application Schema/data.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

LOCK TABLE supabase_migrations.schema_migrations
  IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE opt5_00049_history_snapshot
ON COMMIT DROP
AS
SELECT
  m.version AS old_version,
  m.name AS old_name,
  to_jsonb(m) - 'version' - 'name' AS immutable_payload
FROM supabase_migrations.schema_migrations AS m;

DO $opt5_preflight$
DECLARE
  v_expected_versions text[];
  v_actual_existing_versions text[];
BEGIN
  SELECT array_agg(lpad(n::text, 5, '0') ORDER BY n)
  INTO v_expected_versions
  FROM generate_series(1, 48) AS expected(n);

  SELECT array_agg(old_version ORDER BY old_version)
  INTO v_actual_existing_versions
  FROM opt5_00049_history_snapshot
  WHERE old_version ~ '^[0-9]{5}$';

  IF (SELECT count(*) FROM opt5_00049_history_snapshot) <> 49 THEN
    RAISE EXCEPTION 'OPT-5 preflight failed: expected 49 history rows';
  END IF;

  IF v_actual_existing_versions IS DISTINCT FROM v_expected_versions THEN
    RAISE EXCEPTION
      'OPT-5 preflight failed: existing history is not exactly 00001-00048';
  END IF;

  IF (SELECT count(*) FROM opt5_00049_history_snapshot
      WHERE old_version ~ '^[0-9]{14}$'
        AND old_name = 'database_least_privilege_hardening') <> 1 THEN
    RAISE EXCEPTION
      'OPT-5 preflight failed: expected one generated 00049 history row';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM opt5_00049_history_snapshot
    WHERE old_version ~ '^[0-9]{14}$'
      AND old_name = 'database_least_privilege_hardening'
      AND (
        jsonb_array_length(immutable_payload -> 'statements') <> 1
        OR length(coalesce(immutable_payload -> 'statements' ->> 0, '')) <> 6413
        OR md5(coalesce(immutable_payload -> 'statements' ->> 0, '<NULL>'))
           <> '60a8e975f7a1a30e9938b6a43eb8aea5'
      )
  ) THEN
    RAISE EXCEPTION
      'OPT-5 preflight failed: generated 00049 statement payload changed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM opt5_00049_history_snapshot
    WHERE old_version = '00049'
       OR old_name = '00049_database_least_privilege_hardening'
  ) THEN
    RAISE EXCEPTION
      'OPT-5 preflight failed: canonical 00049 is already or partially present';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sync_run WHERE status = 'in_progress'
  ) THEN
    RAISE EXCEPTION 'OPT-5 preflight failed: sync run is in progress';
  END IF;
END
$opt5_preflight$;

DO $opt5_update$
DECLARE
  v_updated integer;
BEGIN
  UPDATE supabase_migrations.schema_migrations
  SET version = '00049',
      name = '00049_database_least_privilege_hardening'
  WHERE version ~ '^[0-9]{14}$'
    AND name = 'database_least_privilege_hardening';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated <> 1 THEN
    RAISE EXCEPTION
      'OPT-5 update failed: expected one updated row, got %', v_updated;
  END IF;
END
$opt5_update$;

DO $opt5_postcheck$
DECLARE
  v_expected_versions text[];
  v_actual_versions text[];
BEGIN
  SELECT array_agg(lpad(n::text, 5, '0') ORDER BY n)
  INTO v_expected_versions
  FROM generate_series(1, 49) AS expected(n);

  SELECT array_agg(version ORDER BY version)
  INTO v_actual_versions
  FROM supabase_migrations.schema_migrations;

  IF v_actual_versions IS DISTINCT FROM v_expected_versions THEN
    RAISE EXCEPTION
      'OPT-5 postcheck failed: history is not exactly 00001-00049';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations AS current_row
    JOIN opt5_00049_history_snapshot AS snapshot
      ON snapshot.old_version ~ '^[0-9]{14}$'
     AND snapshot.old_name = 'database_least_privilege_hardening'
    WHERE current_row.version = '00049'
      AND current_row.name = '00049_database_least_privilege_hardening'
      AND (to_jsonb(current_row) - 'version' - 'name')
          IS NOT DISTINCT FROM snapshot.immutable_payload
  ) THEN
    RAISE EXCEPTION
      'OPT-5 postcheck failed: canonical row or immutable payload mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM opt5_00049_history_snapshot AS snapshot
    JOIN supabase_migrations.schema_migrations AS current_row
      ON current_row.version = snapshot.old_version
    WHERE snapshot.old_version ~ '^[0-9]{5}$'
      AND (
        current_row.name IS DISTINCT FROM snapshot.old_name
        OR (to_jsonb(current_row) - 'version' - 'name')
           IS DISTINCT FROM snapshot.immutable_payload
      )
  ) THEN
    RAISE EXCEPTION
      'OPT-5 postcheck failed: existing history payload changed';
  END IF;
END
$opt5_postcheck$;

COMMIT;

SELECT
  count(*) AS history_rows,
  count(DISTINCT version) AS unique_versions,
  count(DISTINCT name) AS unique_names,
  min(version) AS first_version,
  max(version) AS last_version,
  md5(string_agg(version || '|' || name, E'\n' ORDER BY version))
    AS version_name_digest,
  md5(string_agg(
    version || '|' || md5((to_jsonb(m) - 'version')::text),
    E'\n' ORDER BY version
  )) AS ordered_history_digest
FROM supabase_migrations.schema_migrations AS m;
