import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { buildNearKickoffExecutionKey, getNearKickoffWindow, nearKickoffWindows } from '../src/utils/nearKickoffPolicy.js'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase environment variables for near-kickoff verification.')

const supabase = createClient(supabaseUrl, supabaseKey)
const now = new Date()
const horizon = new Date(now.getTime() + 105 * 60_000)
let failed = false
console.log(`[verify:near-kickoff] project_ref=${projectRef(supabaseUrl)}`)
console.log(`[verify:near-kickoff] windows=${nearKickoffWindows.map((value) => `T-${value}`).join(',')}`)
console.log('[verify:near-kickoff] mode=read-only')

const { data: fixtures, error: fixtureError } = await supabase
  .from('football_matches')
  .select('id, api_sports_fixture_id, kickoff_at, status_short, odds_updated_at, ai_final_pick:football_ai_final_picks(*)')
  .gte('kickoff_at', new Date(now.getTime() - 30 * 60_000).toISOString())
  .lt('kickoff_at', horizon.toISOString())
  .order('kickoff_at', { ascending: true })
if (fixtureError) throw fixtureError

const { data: logs, error: logError } = await supabase
  .from('api_football_enrichment_sync_log')
  .select('id, api_fixture_id, endpoint, status, started_at, finished_at')
  .ilike('endpoint', '%near-kickoff%')
  .gte('started_at', new Date(now.getTime() - 3 * 60 * 60_000).toISOString())
  .order('started_at', { ascending: true })
if (logError) throw logError

const executionKeys = (logs ?? []).map((row) => parseExecutionKey(row.endpoint)).filter(Boolean)
report('duplicate window execution', duplicateCount(executionKeys))
report('refresh after kickoff', (logs ?? []).filter((row) => {
  const fixture = (fixtures ?? []).find((item) => Number(item.api_sports_fixture_id) === Number(row.api_fixture_id))
  return fixture?.kickoff_at && new Date(row.started_at) >= new Date(fixture.kickoff_at)
}).length)

let missingTransition = 0
let staleReady = 0
for (const fixture of fixtures ?? []) {
  const window = getNearKickoffWindow(fixture.kickoff_at, now)
  const pick = Array.isArray(fixture.ai_final_pick) ? fixture.ai_final_pick[0] : fixture.ai_final_pick
  if (window) {
    const key = buildNearKickoffExecutionKey(fixture.id, fixture.kickoff_at, window)
    if (!executionKeys.includes(key)) missingTransition += 1
  }
  if (pick?.selection_status === 'READY') {
    const refreshed = new Date(pick.last_market_refresh_at ?? fixture.odds_updated_at ?? 0).getTime()
    if (!Number.isFinite(refreshed) || now.getTime() - refreshed > 90 * 60_000) staleReady += 1
  }
}
report('missing transition audit', missingTransition)
report('stale READY', staleReady)
console.log(`fixtures_in_horizon=${fixtures?.length ?? 0}`)
console.log(`transition_logs=${logs?.length ?? 0}`)

if (failed) process.exit(1)
console.log('Near-kickoff checks passed')

function duplicateCount(values) {
  return values.length - new Set(values).size
}

function parseExecutionKey(endpoint = '') {
  const match = String(endpoint).match(/near-kickoff:([^:]+):(\d+):(\d+)/)
  return match ? `${match[1]}|${new Date(Number(match[2])).toISOString()}|T-${match[3]}` : null
}

function report(label, count) {
  console.log(`${label}: ${count}`)
  if (count > 0) failed = true
}

function projectRef(value) {
  try { return new URL(value).host.split('.')[0] } catch { return 'unknown' }
}
