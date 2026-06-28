import { readFile } from 'node:fs/promises'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const source = await readFile('supabase/functions/sync-football-data/index.ts', 'utf8')

assertIncludes(source, "'daily-sync-start'", 'daily-sync-start must be registered as an enrichment/admin mode')
assertIncludes(source, 'const authError = await getServiceAuthError(request, mode)', 'handler must call the shared authorize helper')
assertIncludes(source, 'value === serviceRoleKey', 'shared auth helper must accept the Supabase service role key')
assertIncludes(source, 'secretKeys.includes(value)', 'shared auth helper must accept configured SUPABASE_SECRET_KEYS')
assertIncludes(source, 'await isAdminJwt(bearerToken)', 'shared auth helper must accept admin JWT bearer tokens')
assertIncludes(source, "token.startsWith('sb_secret_')", 'admin auth debug must classify sb_secret tokens without logging the key')
assertIncludes(source, "passedPath: 'admin_jwt'", 'admin auth debug must log the admin_jwt pass path')
assertIncludes(source, "passedPath: 'denied'", 'admin auth debug must log denied auth attempts')
assertIncludes(source, 'splitSupabaseSecretKeys(trimmed)', 'SUPABASE_SECRET_KEYS must support single or comma-separated sb_secret values')
assertIncludes(source, 'normalizeSupabaseSecretKeyList(parsed)', 'SUPABASE_SECRET_KEYS must support JSON object/array values')

const authIndex = source.indexOf('const authError = await getServiceAuthError(request, mode)')
const configIndex = source.indexOf('assertRuntimeConfig(mode)')
if (authIndex === -1 || configIndex === -1 || authIndex > configIndex) {
  throw new Error('daily sync auth order must be: parse body -> shared authorize helper -> assertRuntimeConfig')
}

const authCallCount = source.match(/getServiceAuthError\(request, mode\)/g)?.length ?? 0
if (authCallCount !== 1) {
  throw new Error(`expected exactly one shared request auth call, found ${authCallCount}`)
}

const serviceKey = process.env.TEST_DAILY_SYNC_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
if (process.env.TEST_DAILY_SYNC_AUTH_INTEGRATION === '1' && serviceKey && supabaseUrl) {
  const response = await fetch(`${supabaseUrl}/functions/v1/sync-football-data`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
    },
    body: JSON.stringify({
      mode: 'daily-sync-start',
      date: '2026-06-28',
      limit: 1,
      enrichmentLimit: 1,
      phaseLimits: {
        core: 1,
        'fixture-enrichment': 1,
        'team-enrichment': 1,
        'league-enrichment': 1,
        ranking: 1,
      },
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (response.status === 401 || payload.code === 'ADMIN_AUTH_REQUIRED') {
    throw new Error('SERVICE_KEY must authorize daily-sync-start, but got ADMIN_AUTH_REQUIRED')
  }
  if (!response.ok || payload.ok === false) {
    throw new Error(`daily-sync-start service key auth failed with status ${response.status}: ${payload.message ?? 'unknown error'}`)
  }
} else {
  console.log('daily-sync-start service key integration skipped: set TEST_DAILY_SYNC_AUTH_INTEGRATION=1 and TEST_DAILY_SYNC_SERVICE_KEY to call the deployed function')
}

console.log('daily sync auth unit tests passed')

function assertIncludes(text, needle, message) {
  if (!text.includes(needle)) throw new Error(message)
}
