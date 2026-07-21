[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $OutputPath
)

$ErrorActionPreference = 'Stop'
$migrationPath = Join-Path $PSScriptRoot '..\supabase\migrations\00051_optimize_role_rls_policy_overlap.sql'
$body = [IO.File]::ReadAllText((Resolve-Path $migrationPath)).Replace("`r`n", "`n")
$bytes = [Text.Encoding]::UTF8.GetBytes($body)
$md5 = ([BitConverter]::ToString(([Security.Cryptography.MD5]::Create().ComputeHash($bytes))).Replace('-', '').ToLowerInvariant())

if ($body.Length -ne 5686 -or $md5 -ne 'aee8d4811b5382afc9786ef0dae195be') {
  throw '00051 canonical body digest mismatch; no SQL was generated.'
}

$sql = @'
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 50
     OR EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '00051')
     OR (SELECT array_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations)
        IS DISTINCT FROM ARRAY(SELECT lpad(i::text, 5, '0') FROM generate_series(1, 50) AS g(i)) THEN
    RAISE EXCEPTION '00051 history preflight failed; no policy was changed';
  END IF;
END;
$$;

__MIGRATION_BODY__

LOCK TABLE supabase_migrations.schema_migrations IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '00051') THEN
    RAISE EXCEPTION '00051 history already exists; rollback policy changes';
  END IF;
END;
$$;

WITH body AS (
  SELECT replace($migration$__MIGRATION_BODY__$migration$, E'\r\n', E'\n') AS value
)
INSERT INTO supabase_migrations.schema_migrations(version, name, statements)
SELECT '00051', '00051_optimize_role_rls_policy_overlap', ARRAY[value] FROM body
WHERE length(value) = 5686 AND md5(value) = 'aee8d4811b5382afc9786ef0dae195be';

DO $$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 51
     OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='00051' AND name='00051_optimize_role_rls_policy_overlap' AND cardinality(statements)=1 AND length(statements[1])=5686 AND md5(statements[1])='aee8d4811b5382afc9786ef0dae195be') THEN
    RAISE EXCEPTION '00051 history postcheck failed; rollback';
  END IF;
END;
$$;
COMMIT;
'@

$sql = $sql.Replace('__MIGRATION_BODY__', $body)
[IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath), $sql.Replace("`r`n", "`n"), [Text.UTF8Encoding]::new($false))
