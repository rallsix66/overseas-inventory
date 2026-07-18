import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const MIGRATION_00010_PATH = path.resolve(
  process.cwd(),
  'supabase/migrations/00010_claim_sync_run_system.sql',
);
const MIGRATION_00048_PATH = path.resolve(
  process.cwd(),
  'supabase/migrations/00048_restore_claim_sync_run_system.sql',
);
const MIGRATION_00011_PATH = path.resolve(
  process.cwd(),
  'supabase/migrations/00011_add_variant_soft_archive.sql',
);
const DATABASE_TYPES_PATH = path.resolve(process.cwd(), 'src/types/database.ts');

function extractClaimFunction(source: string): string {
  const match = source.match(
    /CREATE OR REPLACE FUNCTION public\.claim_sync_run_system\([\s\S]*?\nEND;\s*\n\$\$;/,
  );
  if (!match) throw new Error('claim_sync_run_system definition not found');
  return match[0];
}

function canonicalSql(source: string): string {
  return source
    .replace(/--.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('OPT-4 migration 00048 forward repair', () => {
  let migration00010: string;
  let migration00048: string;
  let migration00011: string;
  let databaseTypes: string;

  beforeAll(() => {
    migration00010 = fs.readFileSync(MIGRATION_00010_PATH, 'utf8');
    migration00048 = fs.readFileSync(MIGRATION_00048_PATH, 'utf8');
    migration00011 = fs.readFileSync(MIGRATION_00011_PATH, 'utf8');
    databaseTypes = fs.readFileSync(DATABASE_TYPES_PATH, 'utf8');
  });

  it('recreates the audited 00010 function definition without semantic drift', () => {
    expect(canonicalSql(extractClaimFunction(migration00048))).toBe(
      canonicalSql(extractClaimFunction(migration00010)),
    );
  });

  it('keeps the system RPC security boundary service_role-only', () => {
    expect(migration00048).toMatch(/SECURITY DEFINER\s+SET search_path = ''/);
    expect(migration00048).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.claim_sync_run_system[\s\S]*FROM PUBLIC;/,
    );
    expect(migration00048).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.claim_sync_run_system[\s\S]*FROM anon;/,
    );
    expect(migration00048).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.claim_sync_run_system[\s\S]*FROM authenticated;/,
    );
    expect(migration00048).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.claim_sync_run_system[\s\S]*TO service_role;/,
    );
  });

  it('refuses to remove legacy columns when archive data exists', () => {
    expect(migration00048).toContain("column_name IN ('is_archived', 'archived_at', 'archived_by')");
    expect(migration00048).toContain('IF v_has_legacy_data THEN');
    expect(migration00048).toContain('OPT-4 refused to drop legacy product_variant archive columns');
  });

  it('removes only the five audited obsolete schema objects idempotently', () => {
    expect(migration00048).toContain('DROP INDEX IF EXISTS public.idx_variant_is_archived;');
    expect(migration00048).toContain(
      'DROP CONSTRAINT IF EXISTS product_variant_archived_by_fkey;',
    );
    expect(migration00048).toContain('DROP COLUMN IF EXISTS archived_by,');
    expect(migration00048).toContain('DROP COLUMN IF EXISTS archived_at,');
    expect(migration00048).toContain('DROP COLUMN IF EXISTS is_archived;');
    expect(migration00048).not.toMatch(/\bCASCADE\b/i);
  });

  it('keeps 00011 immutable while generated types match the 00048 final schema', () => {
    expect(migration00011).toContain('ADD COLUMN IF NOT EXISTS is_archived');
    expect(migration00011).toContain('ADD COLUMN IF NOT EXISTS archived_at');
    expect(migration00011).toContain('ADD COLUMN IF NOT EXISTS archived_by');
    expect(migration00011).not.toMatch(/DROP COLUMN[\s\S]*is_archived/i);

    const productVariantBlock = databaseTypes.match(
      /product_variant:\s*\{([\s\S]*?)\n\s{6}warehouse:\s*\{/,
    )?.[1];
    expect(productVariantBlock).toBeDefined();
    expect(productVariantBlock).not.toMatch(/\b(is_archived|archived_at|archived_by)\b/);
  });
});
