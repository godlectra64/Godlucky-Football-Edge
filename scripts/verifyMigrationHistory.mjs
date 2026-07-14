import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const activeDir = path.join(root, 'supabase', 'migrations')
const archiveDir = path.join(root, 'supabase', 'migrations_archive')
const bootstrapPath = path.join(root, 'supabase', 'bootstrap', 'canonical_football_base.sql')

export const expectedRemoteFiles = Object.freeze({
  '20260625000000_schedule_football_sync_cron.sql': 'dd6c8755c2c157d3875d3497e53331aa05fa7c82133d1f72c791a49222455dc9',
  '20260712_add_daily_market_candidates.sql': 'f4fc4ef3369737905ddcc468a18c80db6cb96b5c4a0f6800f6bbcfa65ebdac20',
  '20260713_add_atomic_market_first_top10_repair.sql': '1cec8af7f00d2638ce6ecf5caee656133e0e8bfe49d278b8daf6962cf5bff2d7',
  '20260714_market_ready_dynamic_decision_board.sql': 'c3e3efd6e4beb366d7f072c8e9ff43d415ff058581c1e7f85492774b761a1df7',
})

export const pendingFiles = Object.freeze([
  '20260715000000_reconcile_unrecorded_schema.sql',
  '20260715010000_reconcile_post_market_schema.sql',
  '20260715020000_market_ready_core_recovery.sql',
])

export const forbiddenBackdatedFiles = Object.freeze([
  '20260621000000_canonical_football_base.sql',
  '20260711010000_reconcile_unrecorded_schema.sql',
  '20260714080000_reconcile_post_market_schema.sql',
  '20260714090000_market_ready_core_recovery.sql',
  '20260714100000_reconcile_unrecorded_schema.sql',
  '20260714110000_reconcile_post_market_schema.sql',
  '20260714120000_market_ready_core_recovery.sql',
])

export const unknownDataFiles = Object.freeze([
  '20260705_backfill_ai_final_picks_for_top10.sql',
  '20260705_update_ai_final_pick_no_market_copy.sql',
])

const expectedArchivedFiles = Object.freeze([
  '20260630_add_api_football_enrichment_tables.sql',
  '20260702_allow_api_football_enrichment_step_statuses.sql',
  '20260703_add_daily_sync_orchestrator.sql',
  '20260704_upgrade_daily_sync_orchestrator.sql',
  '20260705_add_ai_final_pick_market_signal.sql',
  ...unknownDataFiles,
  '20260706_add_daily_top10_lock.sql',
  '20260706_allow_partial_enrichment_status.sql',
  '20260707_add_result_sync_and_settlement_pipeline.sql',
  '20260708_add_enrichment_readiness_metadata.sql',
  '20260709_add_market_recompute_analysis_metadata.sql',
  '20260711_add_professional_pipeline_fields.sql',
])

const exactObsoleteCronNames = Object.freeze([
  'sync-football-data-0005-th',
  'sync-football-data-0030-th',
  'sync-football-data-0600-1200-1800-th',
  'sync-football-data-1200-th',
  'sync-football-data-hourly',
  'sync-football-data-prime-th',
])

export function normalizeSql(sql) {
  return String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function migrationVersion(filename) {
  const match = String(filename).match(/^(\d+)_/)
  assert(match, `Invalid migration filename: ${filename}`)
  return match[1]
}

export function duplicateVersions(filenames) {
  const grouped = new Map()
  for (const filename of filenames) {
    const version = migrationVersion(filename)
    grouped.set(version, [...(grouped.get(version) ?? []), filename])
  }
  return [...grouped.entries()].filter(([, files]) => files.length > 1)
}

function sqlFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
}

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8')
}

function normalizedHash(relativePath) {
  return sha256(normalizeSql(read(relativePath)))
}

function assertNoDestructivePendingSql(filename, sql) {
  const normalized = normalizeSql(sql)
  assert(!/\btruncate\b/i.test(normalized), `${filename} contains TRUNCATE`)
  assert(!/\bdelete\s+from\b/i.test(normalized), `${filename} contains DELETE FROM`)
  assert(!/\bdrop\s+(table|schema|type|column)\b/i.test(normalized), `${filename} contains destructive DROP`)
  assert(!/\bdrop\b[^;]*\bcascade\b/i.test(normalized), `${filename} contains DROP ... CASCADE`)

  for (const statement of normalized.match(/(?:^|;)\s*update\s+[\s\S]*?;/gi) ?? []) {
    assert(/\bwhere\b/i.test(statement), `${filename} contains UPDATE without WHERE`)
  }
}

function hasRowDml(sql) {
  return /(?:^|;)\s*(?:insert\s+into|update\s+|delete\s+from|truncate\s+)/i.test(normalizeSql(sql))
}

function assertNoFixedCountPendingSql(filename, sql) {
  const normalized = normalizeSql(sql)
  assert(!/rank\s+between\s+1\s+and\s+10/i.test(normalized), `${filename} restores a fixed rank cap`)
  assert(!/jsonb_array_length\s*\([^)]*\)\s*(?:=|<>)\s*10/i.test(normalized), `${filename} requires exactly ten rows`)
  assert(!/count\s*\([^)]*\)\s*(?:=|<>|<|>)\s*10/i.test(normalized), `${filename} enforces a ten-row selection count`)
  const obsoleteRpc = ['repair_stale_market_first_', 'top10'].join('')
  const withoutDeprecationComment = normalized.replace(
    new RegExp(`comment\\s+on\\s+function\\s+public\\.${obsoleteRpc}\\s*\\([^;]+;`, 'gi'),
    '',
  )
  assert(!new RegExp(`\\b${obsoleteRpc}\\s*\\(`, 'i').test(withoutDeprecationComment), `${filename} invokes the deprecated fixed-count RPC`)
}

function assertCanonicalSourceDoesNotInvokeObsoleteRpc() {
  const obsoleteRpc = ['repair_stale_market_first_', 'top10'].join('')
  const roots = ['.github', 'src', 'supabase/functions', 'scripts']
  const ignored = new Set(['verifyMigrationHistory.mjs', 'migrationSafety.test.mjs'])
  const matches = []

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(fullPath)
      else if (!ignored.has(entry.name) && /\.(?:js|mjs|ts|tsx|jsx|yml|yaml)$/.test(entry.name)) {
        if (readFileSync(fullPath, 'utf8').includes(obsoleteRpc)) matches.push(path.relative(root, fullPath))
      }
    }
  }

  for (const relative of roots) {
    const directory = path.join(root, relative)
    if (existsSync(directory)) visit(directory)
  }
  assert.deepEqual(matches, [], `Canonical source invokes deprecated RPC: ${matches.join(', ')}`)
}

function assertBootstrapIsolation(activeFiles) {
  assert(existsSync(bootstrapPath), 'Canonical clean-clone bootstrap is missing')
  assert(!activeFiles.includes(path.basename(bootstrapPath)), 'Bootstrap is present in the active migration directory')

  const bootstrap = readFileSync(bootstrapPath, 'utf8')
  assert(!hasRowDml(bootstrap), 'Bootstrap contains row DML')
  assert(!/rank\s+between\s+1\s+and\s+10/i.test(normalizeSql(bootstrap)), 'Bootstrap restores a fixed rank cap')
  assert(!/\b(?:pg_cron|cron\.schedule|cron\.unschedule)\b/i.test(normalizeSql(bootstrap)), 'Bootstrap configures a scheduler')

  const bootstrapScript = read('scripts/bootstrapNewFootballEnvironment.mjs')
  assert(bootstrapScript.includes("process.argv.includes('--apply-local')"), 'Bootstrap local apply is not explicit')
  assert(bootstrapScript.includes("linkedProjectRef === productionProjectRef"), 'Bootstrap does not reject the linked Production project')
  assert(bootstrapScript.includes("configuredSupabaseUrl.includes(productionProjectRef)"), 'Bootstrap does not reject the Production URL')
  assert(bootstrapScript.includes("new Set(['localhost', '127.0.0.1', '::1'])"), 'Bootstrap does not restrict database hosts to local addresses')

  for (const relativePath of ['.github', 'src', 'supabase/functions']) {
    const directory = path.join(root, relativePath)
    const references = []
    function visit(current) {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const fullPath = path.join(current, entry.name)
        if (entry.isDirectory()) visit(fullPath)
        else if (readFileSync(fullPath, 'utf8').includes('canonical_football_base.sql')) references.push(path.relative(root, fullPath))
      }
    }
    if (existsSync(directory)) visit(directory)
    assert.deepEqual(references, [], `Deployment path references bootstrap SQL: ${references.join(', ')}`)
  }
}

function assertArchive(activeFiles) {
  const manifestPath = path.join(archiveDir, 'manifest.json')
  assert(existsSync(manifestPath), 'Archive manifest is missing')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  assert.equal(manifest.schema_version, 1, 'Unsupported archive manifest schema')
  assert.equal(manifest.entries.length, expectedArchivedFiles.length, 'Archive manifest entry count mismatch')

  const manifestNames = manifest.entries.map((entry) => entry.filename).sort()
  assert.deepEqual(manifestNames, [...expectedArchivedFiles].sort(), 'Archive manifest is incomplete')

  for (const entry of manifest.entries) {
    assert.equal(entry.must_not_execute, true, `${entry.filename} must be non-executable`)
    assert(!activeFiles.includes(entry.filename), `${entry.filename} remains active`)
    const archivedPath = path.join(root, entry.archived_path)
    assert(existsSync(archivedPath), `${entry.archived_path} is missing`)
    const raw = readFileSync(archivedPath)
    assert.equal(sha256(raw), entry.raw_sha256, `${entry.filename} raw hash mismatch`)
    assert.equal(sha256(normalizeSql(raw.toString('utf8'))), entry.normalized_sha256, `${entry.filename} normalized hash mismatch`)
    assert.equal(entry.remote_history_present, false, `${entry.filename} incorrectly claims remote history`)
  }

  for (const filename of unknownDataFiles) {
    const entry = manifest.entries.find((candidate) => candidate.filename === filename)
    assert(entry, `${filename} is absent from the manifest`)
    assert.equal(entry.data_effect_status, 'UNKNOWN', `${filename} must retain UNKNOWN data status`)
    assert.equal(entry.replacement_migration, null, `${filename} must not have an executable replacement`)
  }
}

function assertOrder(activeFiles) {
  const versions = new Map(activeFiles.map((filename) => [filename, migrationVersion(filename)]))
  const requiredOrder = [
    '20260712_add_daily_market_candidates.sql',
    '20260713_add_atomic_market_first_top10_repair.sql',
    '20260714_market_ready_dynamic_decision_board.sql',
    '20260715000000_reconcile_unrecorded_schema.sql',
    '20260715010000_reconcile_post_market_schema.sql',
    '20260715020000_market_ready_core_recovery.sql',
  ]
  for (const filename of requiredOrder) assert(versions.has(filename), `Required migration is missing: ${filename}`)
  const actualVersions = requiredOrder.map((filename) => versions.get(filename))
  const sortedVersions = [...actualVersions].sort((left, right) => left.localeCompare(right))
  assert.deepEqual(actualVersions, sortedVersions, `Canonical migration order is invalid: ${actualVersions.join(' -> ')}`)
  for (const filename of pendingFiles) {
    assert(migrationVersion(filename).localeCompare('20260714') > 0, `${filename} is not forward-only after remote version 20260714`)
  }
}

function assertStatusContract() {
  const bridge = read('supabase/migrations/20260715010000_reconcile_post_market_schema.sql')
  const target = read('supabase/migrations/20260715020000_market_ready_core_recovery.sql')
  for (const status of ['READY', 'WATCH', 'WAIT', 'WAITING_MARKET', 'REJECTED']) {
    assert(new RegExp(`'${status}'`).test(bridge), `Post-market bridge does not accept ${status}`)
  }
  assert(/unknown_statuses[\s\S]*raise exception/i.test(bridge), 'Post-market bridge does not abort on unknown statuses')
  assert(/selection_status\s+is\s+null[\s\S]*'READY'[\s\S]*'WATCH'[\s\S]*'WAIT'[\s\S]*'REJECTED'/i.test(target), 'Target final-pick constraint is not canonical')
}

function assertProvenanceAndCronSafety() {
  const target = read('supabase/migrations/20260715020000_market_ready_core_recovery.sql')
  const normalized = normalizeSql(target)
  assert(!/provider_source_at\s*=\s*(?:coalesce\s*\()?fetched_at/i.test(normalized), 'provider_source_at is fabricated from fetched_at')

  const names = [...target.matchAll(/'((?:sync-football-data)[^']+)'/g)].map((match) => match[1]).sort()
  assert.deepEqual([...new Set(names)], [...exactObsoleteCronNames], 'Cron unschedule target set changed')
  assert(/cron\.unschedule\s*\(legacy_job\.jobid\)/i.test(target), 'Target does not use exact selected cron job IDs')
  assert(!/cron\.unschedule\s*\([^)]*jobname/i.test(target), 'Target passes an unverified job name to cron.unschedule')
}

export function verifyMigrationHistory() {
  const activeFiles = sqlFiles(activeDir)
  assert.deepEqual(duplicateVersions(activeFiles), [], 'Duplicate active migration versions detected')

  for (const [filename, expectedHash] of Object.entries(expectedRemoteFiles)) {
    assert(activeFiles.includes(filename), `Remote historical counterpart is missing: ${filename}`)
    assert.equal(normalizedHash(`supabase/migrations/${filename}`), expectedHash, `${filename} no longer matches remote statements`)
  }

  for (const filename of unknownDataFiles) assert(!activeFiles.includes(filename), `${filename} must not be active`)
  for (const filename of forbiddenBackdatedFiles) assert(!activeFiles.includes(filename), `Backdated migration remains active: ${filename}`)
  for (const filename of pendingFiles) assert(activeFiles.includes(filename), `Pending reconciliation migration is missing: ${filename}`)

  assertArchive(activeFiles)
  assertBootstrapIsolation(activeFiles)
  assertOrder(activeFiles)
  assertStatusContract()
  assertProvenanceAndCronSafety()
  assertCanonicalSourceDoesNotInvokeObsoleteRpc()

  for (const filename of pendingFiles) {
    const sql = read(`supabase/migrations/${filename}`)
    assertNoDestructivePendingSql(filename, sql)
    assertNoFixedCountPendingSql(filename, sql)
  }

  const base = read('supabase/bootstrap/canonical_football_base.sql')
  const reconcile = read('supabase/migrations/20260715000000_reconcile_unrecorded_schema.sql')
  assert(!hasRowDml(base), 'Canonical base contains row DML')
  assert(!hasRowDml(reconcile), 'Unrecorded reconciliation contains row DML')
  assert(/create table if not exists/i.test(base), 'Canonical base is not idempotent')
  assert(/non-canonical definition|mismatch/i.test(base), 'Canonical base does not fail on definition mismatch')
  assert(/non-canonical definition|mismatch/i.test(reconcile), 'Unrecorded reconciliation does not fail on definition mismatch')

  return {
    activeTotal: activeFiles.length,
    duplicateVersions: 0,
    restoredRemoteFiles: Object.keys(expectedRemoteFiles).length,
    archivedTotal: expectedArchivedFiles.length,
    bootstrapActive: false,
    backdatedPending: 0,
    expectedPending: pendingFiles,
  }
}

function main() {
  const summary = verifyMigrationHistory()
  console.log(JSON.stringify({ status: 'PASS', ...summary }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main()
  } catch (error) {
    console.error(JSON.stringify({ status: 'FAIL', error: error.message }, null, 2))
    process.exitCode = 1
  }
}
