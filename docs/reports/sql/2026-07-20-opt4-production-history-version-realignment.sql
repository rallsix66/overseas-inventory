-- OPT-4 Production history-only version realignment.
-- Target project: hzlhqyditalumhnxbaim (DIS Project / Production) only.
--
-- This is a maintenance-window script, not a Migration. Keep it outside
-- supabase/migrations/. It must not be run against Staging or another project.
--
-- Scope: update only supabase_migrations.schema_migrations.version.
-- It never executes Migration SQL and never changes application Schema.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

LOCK TABLE supabase_migrations.schema_migrations
  IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE opt4_history_version_snapshot
ON COMMIT DROP
AS
SELECT
  m.version AS old_version,
  substring(m.name FROM '^([0-9]{5})_') AS target_version,
  m.name,
  to_jsonb(m) - 'version' AS non_version_payload
FROM supabase_migrations.schema_migrations AS m;

DO $opt4_preflight$
DECLARE
  v_expected_versions text[];
  v_target_versions text[];
  v_version_name_digest text;
BEGIN
  SELECT array_agg(lpad(n::text, 5, '0') ORDER BY n)
  INTO v_expected_versions
  FROM generate_series(1, 48) AS expected(n);

  SELECT array_agg(target_version ORDER BY target_version)
  INTO v_target_versions
  FROM opt4_history_version_snapshot;

  SELECT md5(
    string_agg(old_version || '|' || name, E'\n' ORDER BY old_version)
  )
  INTO v_version_name_digest
  FROM opt4_history_version_snapshot;

  IF (SELECT count(*) FROM opt4_history_version_snapshot) <> 48 THEN
    RAISE EXCEPTION 'OPT-4 preflight failed: expected 48 history rows';
  END IF;

  IF (SELECT count(DISTINCT name) FROM opt4_history_version_snapshot) <> 48 THEN
    RAISE EXCEPTION 'OPT-4 preflight failed: expected 48 unique migration names';
  END IF;

  IF v_target_versions IS DISTINCT FROM v_expected_versions THEN
    RAISE EXCEPTION
      'OPT-4 preflight failed: migration names do not map exactly to 00001-00048';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM opt4_history_version_snapshot
    WHERE old_version !~ '^[0-9]{14}$'
  ) THEN
    RAISE EXCEPTION
      'OPT-4 preflight failed: current versions are not the reviewed timestamp baseline';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM opt4_history_version_snapshot
    WHERE old_version = target_version
  ) THEN
    RAISE EXCEPTION
      'OPT-4 preflight failed: history is already or partially realigned';
  END IF;

  IF v_version_name_digest IS DISTINCT FROM
     '06c450dcf0e265c7d20f3cf7b8ed71e1' THEN
    RAISE EXCEPTION
      'OPT-4 preflight failed: Production version/name baseline changed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.sync_run
    WHERE status = 'in_progress'
  ) THEN
    RAISE EXCEPTION
      'OPT-4 preflight failed: sync run is in progress';
  END IF;
END
$opt4_preflight$;

DO $opt4_update$
DECLARE
  v_updated integer;
BEGIN
  UPDATE supabase_migrations.schema_migrations AS m
  SET version = snapshot.target_version
  FROM opt4_history_version_snapshot AS snapshot
  WHERE m.version = snapshot.old_version
    AND m.name = snapshot.name;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated <> 48 THEN
    RAISE EXCEPTION
      'OPT-4 update failed: expected 48 updated rows, got %', v_updated;
  END IF;
END
$opt4_update$;

DO $opt4_postcheck$
DECLARE
  v_expected_versions text[];
  v_actual_versions text[];
BEGIN
  SELECT array_agg(lpad(n::text, 5, '0') ORDER BY n)
  INTO v_expected_versions
  FROM generate_series(1, 48) AS expected(n);

  SELECT array_agg(version ORDER BY version)
  INTO v_actual_versions
  FROM supabase_migrations.schema_migrations;

  IF v_actual_versions IS DISTINCT FROM v_expected_versions THEN
    RAISE EXCEPTION
      'OPT-4 postcheck failed: remote versions are not exactly 00001-00048';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM opt4_history_version_snapshot AS snapshot
    FULL JOIN supabase_migrations.schema_migrations AS m
      ON m.name = snapshot.name
    WHERE snapshot.name IS NULL
       OR m.name IS NULL
       OR m.version IS DISTINCT FROM snapshot.target_version
       OR (to_jsonb(m) - 'version') IS DISTINCT FROM snapshot.non_version_payload
  ) THEN
    RAISE EXCEPTION
      'OPT-4 postcheck failed: name or non-version history payload changed';
  END IF;
END
$opt4_postcheck$;

COMMIT;

-- Evidence returned after commit. Save this output for the specified reviewer.
SELECT
  count(*) AS history_rows,
  count(DISTINCT version) AS unique_versions,
  count(DISTINCT name) AS unique_names,
  min(version) AS first_version,
  max(version) AS last_version,
  md5(
    string_agg(
      name || '|' || md5(coalesce(array_to_string(statements, E'\x1f'), '<NULL>')),
      E'\n' ORDER BY name
    )
  ) AS name_statements_digest,
  md5(
    string_agg(
      version || '|' || md5((to_jsonb(m) - 'version')::text),
      E'\n' ORDER BY version
    )
  ) AS ordered_history_digest
FROM supabase_migrations.schema_migrations AS m;

SELECT
  version,
  name,
  cardinality(statements) AS statement_count,
  length(coalesce(array_to_string(statements, E'\x1f'), '')) AS statement_chars,
  md5(coalesce(array_to_string(statements, E'\x1f'), '<NULL>')) AS statement_digest
FROM supabase_migrations.schema_migrations
ORDER BY version;
