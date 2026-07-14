import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const productionProjectRef = 'fzjbnxomflqopwhzxfog'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sqlPath = path.join(root, 'supabase', 'bootstrap', 'canonical_football_base.sql')
const linkedRefPath = path.join(root, 'supabase', '.temp', 'project-ref')
const applyLocal = process.argv.includes('--apply-local')
const unsupportedArguments = process.argv.slice(2).filter((argument) => argument !== '--apply-local')

assert.deepEqual(unsupportedArguments, [], 'Bootstrap accepts only --apply-local; credentials must not be command arguments')
assert(existsSync(sqlPath), 'Canonical football bootstrap SQL is missing')

const sql = readFileSync(sqlPath, 'utf8')
const normalizedSql = sql
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/--.*$/gm, '')
  .replace(/\s+/g, ' ')
  .trim()

assert(!/(?:^|;)\s*(?:insert\s+into|update\s+|delete\s+from|truncate\s+)/i.test(normalizedSql), 'Bootstrap must not contain row DML')
assert(!/rank\s+between\s+1\s+and\s+10/i.test(normalizedSql), 'Bootstrap must not restore fixed-count rank behavior')
const legacyRepairRpc = ['repair_stale_market_first_', 'top10'].join('')
assert(!new RegExp(`${legacyRepairRpc}\\s*\\(`, 'i').test(normalizedSql), 'Bootstrap must not include the legacy repair RPC')
assert(!/\b(?:pg_cron|cron\.schedule|cron\.unschedule)\b/i.test(normalizedSql), 'Bootstrap must not configure a scheduler')

const objectPlan = {
  tables: [...sql.matchAll(/create\s+table\s+if\s+not\s+exists\s+public\.([a-z0-9_]+)/gi)].map((match) => match[1]),
  functions: [...sql.matchAll(/create\s+function\s+public\.([a-z0-9_]+)/gi)].map((match) => match[1]),
  indexes: [...sql.matchAll(/create\s+(?:unique\s+)?index\s+if\s+not\s+exists\s+([a-z0-9_]+)/gi)].map((match) => match[1]),
  triggers: [...sql.matchAll(/create\s+trigger\s+([a-z0-9_]+)/gi)].map((match) => match[1]),
}

const linkedProjectRef = existsSync(linkedRefPath) ? readFileSync(linkedRefPath, 'utf8').trim() : null

if (!applyLocal) {
  console.log(JSON.stringify({
    mode: 'dry-run',
    sqlFile: path.relative(root, sqlPath).replaceAll('\\', '/'),
    databaseConnectionAttempted: false,
    databaseWriteAttempted: false,
    linkedProductionProjectBlocked: linkedProjectRef === productionProjectRef,
    objectPlan,
  }, null, 2))
  process.exit(0)
}

if (linkedProjectRef === productionProjectRef) {
  throw new Error('Local bootstrap refused: this repository is linked to the Production project')
}

const configuredProjectRef = String(process.env.SUPABASE_PROJECT_REF ?? '').trim()
if (configuredProjectRef === productionProjectRef) {
  throw new Error('Local bootstrap refused: SUPABASE_PROJECT_REF identifies Production')
}

const configuredSupabaseUrl = String(process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '').trim()
if (configuredSupabaseUrl.includes(productionProjectRef)) {
  throw new Error('Local bootstrap refused: configured Supabase URL identifies Production')
}

const localHosts = new Set(['localhost', '127.0.0.1', '::1'])
const pgHost = String(process.env.PGHOST ?? '').trim().toLowerCase()
if (!localHosts.has(pgHost)) {
  throw new Error('Local bootstrap requires PGHOST to be localhost, 127.0.0.1, or ::1')
}

for (const requiredName of ['PGPORT', 'PGUSER', 'PGDATABASE']) {
  if (!String(process.env[requiredName] ?? '').trim()) throw new Error(`Local bootstrap requires ${requiredName}`)
}

console.log(JSON.stringify({
  mode: 'apply-local',
  sqlFile: path.relative(root, sqlPath).replaceAll('\\', '/'),
  targetHost: pgHost,
  objectPlan,
}, null, 2))

const result = spawnSync('psql', ['--set', 'ON_ERROR_STOP=1', '--single-transaction', '--file', sqlPath], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
  shell: false,
})

if (result.error) throw result.error
if (result.status !== 0) throw new Error(`Local bootstrap failed with exit code ${result.status}`)
