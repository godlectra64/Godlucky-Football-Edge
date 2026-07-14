import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { buildSimpleBettingDecision } from '../src/utils/bettingDecision.js'
import { buildUsableDailySelection } from '../src/utils/selectionEngineV2.js'
import { buildCanonicalSelectionWindow } from '../src/utils/selectionWindow.js'
import { fetchPaginatedOddsRows } from '../src/repositories/oddsRepository.js'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase environment variables for AI Final Pick verification.')

const supabase = createClient(supabaseUrl, supabaseKey)
const window = buildCanonicalSelectionWindow()
let failed = false
console.log(`[verify:ai-final-pick] project_ref=${projectRef(supabaseUrl)}`)
console.log(`[verify:ai-final-pick] window=${window.start.toISOString()}..${window.end.toISOString()}`)
console.log('[verify:ai-final-pick] mode=read-only')

const matches = await fetchMatches()
const odds = await fetchPaginatedOddsRows(supabase, matches.map((row) => row.id))
if (odds.error) report('odds query', 1, odds.error.message)
const oddsByMatch = groupBy(odds.data, (row) => row.match_id)
const hydrated = matches.map((match) => ({ ...match, odds: oddsByMatch.get(match.id) ?? [] }))
const selected = buildUsableDailySelection(hydrated, window.options).selected
const decisions = selected.map((match) => ({ match, decision: buildSimpleBettingDecision(match) }))

report('candidate missing persisted AI final-pick row', decisions.filter(({ match }) => !match.ai_final_pick?.id).length)
report('READY missing actionable Final Pick', decisions.filter(({ decision }) => decision.selection_status === 'READY' && !isActionable(decision.final_pick)).length)
report('READY missing supported market', decisions.filter(({ decision }) => decision.selection_status === 'READY' && !['AH', 'OU', 'MATCH_WINNER', 'DOUBLE_CHANCE'].includes(decision.market_focus)).length)
report('WAIT persisted as strong signal', decisions.filter(({ match, decision }) => decision.selection_status === 'WAIT' && match.ai_final_pick?.signal === 'STRONG_SIGNAL').length)
report('REJECTED persisted as strong signal', decisions.filter(({ match, decision }) => decision.selection_status === 'REJECTED' && match.ai_final_pick?.signal === 'STRONG_SIGNAL').length)
report('invalid confidence', decisions.filter(({ match }) => match.ai_final_pick?.id && !inRange(match.ai_final_pick?.confidence_score, 0, 100)).length)
report('invalid risk', decisions.filter(({ match }) => match.ai_final_pick?.risk_level && !['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(String(match.ai_final_pick.risk_level).toUpperCase())).length)
console.log(`candidate_count=${decisions.length}`)
console.log(`persisted_count=${decisions.filter(({ match }) => match.ai_final_pick?.id).length}`)

if (failed) process.exit(1)
console.log('AI Final Pick integrity checks passed')

async function fetchMatches() {
  const rows = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabase
      .from('football_matches')
      .select('*, homeTeam:football_teams!football_matches_home_team_id_fkey(id, api_team_id, name), awayTeam:football_teams!football_matches_away_team_id_fkey(id, api_team_id, name), analysis:match_analysis(*), ai_final_pick:football_ai_final_picks(*)')
      .gte('kickoff_at', window.start.toISOString())
      .lt('kickoff_at', window.end.toISOString())
      .order('kickoff_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + 499)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < 500) break
  }
  return rows.map((row) => ({
    ...row,
    analysis: Array.isArray(row.analysis) ? row.analysis[0] ?? {} : row.analysis ?? {},
    ai_final_pick: Array.isArray(row.ai_final_pick) ? row.ai_final_pick[0] ?? {} : row.ai_final_pick ?? {},
  }))
}

function isActionable(pick = {}) {
  return ['TEAM', 'AH', 'OU', 'MATCH_WINNER', 'DOUBLE_CHANCE'].includes(String(pick.type ?? '').toUpperCase())
}

function inRange(value, minimum, maximum) {
  const number = Number(value)
  return Number.isFinite(number) && number >= minimum && number <= maximum
}

function groupBy(rows, keyFn) {
  const groups = new Map()
  for (const row of rows) groups.set(keyFn(row), [...(groups.get(keyFn(row)) ?? []), row])
  return groups
}

function report(label, count, detail = '') {
  console.log(`${label}: ${count}${detail ? ` (${detail})` : ''}`)
  if (count > 0) failed = true
}

function projectRef(value) {
  try { return new URL(value).host.split('.')[0] } catch { return 'unknown' }
}
