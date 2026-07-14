import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { buildSimpleBettingDecision } from '../src/utils/bettingDecision.js'
import { getBangkokDayRange } from '../src/utils/bangkokDateRange.js'
import { fetchPaginatedOddsRows } from '../src/repositories/oddsRepository.js'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase environment variables for final-lock verification.')

const supabase = createClient(supabaseUrl, supabaseKey)
const date = process.env.SELECTION_DATE || process.argv[2] || getBangkokDayRange().dateKey
let failed = false
console.log(`[verify:final-lock] project_ref=${projectRef(supabaseUrl)}`)
console.log(`[verify:final-lock] selection_date=${date}`)
console.log('[verify:final-lock] mode=read-only')

const { data: locks, error } = await supabase
  .from('daily_top10_selections')
  .select('*')
  .eq('selection_date', date)
  .order('rank', { ascending: true })
if (error) throw error

const rows = locks ?? []
const matchIds = rows.map((row) => row.match_id).filter(Boolean)
const matches = await fetchMatches(matchIds)
const odds = await fetchPaginatedOddsRows(supabase, matchIds)
if (odds.error) report('odds pagination error', 1)
const oddsByMatch = groupBy(odds.data, (row) => row.match_id)
const decisions = new Map(matches.map((match) => [match.id, buildSimpleBettingDecision({ ...match, odds: oddsByMatch.get(match.id) ?? [] })]))

report('duplicate lock', duplicateCount(rows, (row) => row.match_id))
report('duplicate rank', duplicateCount(rows, (row) => row.rank))
report('WAIT locked', rows.filter((row) => decisions.get(row.match_id)?.selection_status === 'WAIT').length)
report('stale market locked', rows.filter((row) => isStale(decisions.get(row.match_id)?.last_market_refresh_at)).length)
report('missing Final Pick', rows.filter((row) => {
  const decision = decisions.get(row.match_id)
  return decision?.selection_status === 'READY' && !isActionable(decision.final_pick)
}).length)
report('mutation after lock without audit', rows.filter((row) => row.locked_at && row.updated_at && new Date(row.updated_at) > new Date(row.locked_at)).length)
console.log(`locked_rows=${rows.length}`)

if (failed) process.exit(1)
console.log('Final-lock checks passed')

async function fetchMatches(ids) {
  if (!ids.length) return []
  const result = []
  for (let index = 0; index < ids.length; index += 100) {
    const { data, error } = await supabase
      .from('football_matches')
      .select('*, homeTeam:football_teams!football_matches_home_team_id_fkey(id, api_team_id, name), awayTeam:football_teams!football_matches_away_team_id_fkey(id, api_team_id, name), analysis:match_analysis(*), ai_final_pick:football_ai_final_picks(*)')
      .in('id', ids.slice(index, index + 100))
    if (error) throw error
    result.push(...(data ?? []))
  }
  return result.map((row) => ({
    ...row,
    analysis: Array.isArray(row.analysis) ? row.analysis[0] ?? {} : row.analysis ?? {},
    ai_final_pick: Array.isArray(row.ai_final_pick) ? row.ai_final_pick[0] ?? {} : row.ai_final_pick ?? {},
  }))
}

function isActionable(pick = {}) {
  return ['TEAM', 'AH', 'OU', 'MATCH_WINNER', 'DOUBLE_CHANCE'].includes(String(pick.type ?? '').toUpperCase())
}

function isStale(timestamp) {
  if (!timestamp) return true
  return Date.now() - new Date(timestamp).getTime() > 12 * 60 * 60_000
}

function groupBy(values, keyFn) {
  const groups = new Map()
  for (const value of values) groups.set(keyFn(value), [...(groups.get(keyFn(value)) ?? []), value])
  return groups
}

function duplicateCount(values, keyFn) {
  const seen = new Set()
  let count = 0
  for (const value of values) {
    const key = keyFn(value)
    if (seen.has(key)) count += 1
    else seen.add(key)
  }
  return count
}

function report(label, count) {
  console.log(`${label}: ${count}`)
  if (count > 0) failed = true
}

function projectRef(value) {
  try { return new URL(value).host.split('.')[0] } catch { return 'unknown' }
}
