import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { buildSimpleBettingDecision } from '../src/utils/bettingDecision.js'
import { classifyDecision } from '../src/utils/decisionClassification.js'
import { buildUsableDailySelection } from '../src/utils/selectionEngineV2.js'
import { buildCanonicalSelectionWindow } from '../src/utils/selectionWindow.js'
import { fetchPaginatedOddsRows } from '../src/repositories/oddsRepository.js'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase environment variables for Daily Decision Board verification.')

const supabase = createClient(supabaseUrl, supabaseKey)
const window = buildCanonicalSelectionWindow()
let failed = false

console.log(`[verify:daily-decision-board] project_ref=${projectRef(supabaseUrl)}`)
console.log(`[verify:daily-decision-board] window=${window.start.toISOString()}..${window.end.toISOString()}`)
console.log('[verify:daily-decision-board] timezone=Asia/Bangkok')

const matches = await fetchMatches()
const oddsResult = await fetchPaginatedOddsRows(supabase, matches.map((row) => row.id))
if (oddsResult.error) report('odds pagination error', 1, oddsResult.error.message)
const oddsByMatch = groupBy(oddsResult.data, (row) => row.match_id)
const hydrated = matches.map((match) => ({ ...match, odds: oddsByMatch.get(match.id) ?? [] }))
const selection = buildUsableDailySelection(hydrated, window.options)
const rows = selection.selected.map((match) => {
  const decision = buildSimpleBettingDecision(match)
  const canonical = classifyDecision(match, { finalPick: decision.final_pick })
  return { match, decision, canonical }
})

report('duplicate fixture', duplicateCount(rows, (row) => row.match.id))
report('invalid status', rows.filter((row) => !['READY', 'WATCH', 'WAIT', 'REJECTED'].includes(row.decision.selection_status)).length)
report('UI/canonical status mismatch', rows.filter((row) => row.decision.selection_status !== row.canonical.selection_status).length)
report('READY missing market readiness', rows.filter((row) => row.decision.selection_status === 'READY' && row.decision.market_ready !== true).length)
report('READY missing actionable Final Pick', rows.filter((row) => row.decision.selection_status === 'READY' && !isActionable(row.decision.final_pick)).length)
report('WAIT has actionable Final Pick', rows.filter((row) => row.decision.selection_status === 'WAIT' && isActionable(row.decision.final_pick)).length)
report('REJECTED has actionable Final Pick', rows.filter((row) => row.decision.selection_status === 'REJECTED' && isActionable(row.decision.final_pick)).length)
report('missing reason code', rows.filter((row) => !row.decision.primary_reason_code || !row.decision.reason_codes?.length).length)
report('missing version fields', rows.filter((row) => !hasVersions(row.decision.version_fields)).length)

const counts = countBy(rows, (row) => row.decision.selection_status)
const reasons = countReasons(rows)
console.log(`fixtures_discovered: ${matches.length}`)
console.log(`candidate_count: ${rows.length}`)
console.log(`READY: ${counts.READY ?? 0}`)
console.log(`WATCH: ${counts.WATCH ?? 0}`)
console.log(`WAIT: ${counts.WAIT ?? 0}`)
console.log(`REJECTED: ${counts.REJECTED ?? 0}`)
console.log(`AH ready: ${rows.filter((row) => row.decision.selection_status === 'READY' && row.decision.market_focus === 'AH').length}`)
console.log(`OU ready: ${rows.filter((row) => row.decision.selection_status === 'READY' && row.decision.market_focus === 'OU').length}`)
console.log(`Alternative ready: ${rows.filter((row) => row.decision.selection_status === 'READY' && !['AH', 'OU'].includes(row.decision.market_focus)).length}`)
console.log(`Top reason codes: ${Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([key, value]) => `${key}=${value}`).join(', ') || 'none'}`)
console.log(`odds diagnostics: ${JSON.stringify(oddsResult.diagnostics)}`)

if (failed) process.exit(1)
console.log('Daily Decision Board checks passed')

async function fetchMatches() {
  const rows = []
  const pageSize = 500
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('football_matches')
      .select(`
        *,
        league:football_leagues(id, name, country, priority),
        homeTeam:football_teams!football_matches_home_team_id_fkey(id, api_team_id, name),
        awayTeam:football_teams!football_matches_away_team_id_fkey(id, api_team_id, name),
        analysis:match_analysis(*),
        ai_final_pick:football_ai_final_picks(*)
      `)
      .gte('kickoff_at', window.start.toISOString())
      .lt('kickoff_at', window.end.toISOString())
      .order('kickoff_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < pageSize) break
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

function hasVersions(value = {}) {
  return ['pipeline_version', 'selection_algorithm_version', 'decision_gate_version', 'decision_model_version', 'market_quality_version', 'analysis_engine_version'].every((key) => Boolean(value[key]))
}

function report(label, count, detail = '') {
  console.log(`${label}: ${count}${detail ? ` (${detail})` : ''}`)
  if (count > 0) failed = true
}

function groupBy(rows, keyFn) {
  const groups = new Map()
  for (const row of rows) groups.set(keyFn(row), [...(groups.get(keyFn(row)) ?? []), row])
  return groups
}

function duplicateCount(rows, keyFn) {
  const seen = new Set()
  let duplicates = 0
  for (const row of rows) {
    const key = keyFn(row)
    if (seen.has(key)) duplicates += 1
    else seen.add(key)
  }
  return duplicates
}

function countBy(rows, keyFn) {
  return rows.reduce((result, row) => ({ ...result, [keyFn(row)]: (result[keyFn(row)] ?? 0) + 1 }), {})
}

function countReasons(rows) {
  const counts = {}
  for (const row of rows) for (const code of row.decision.reason_codes ?? []) counts[code] = (counts[code] ?? 0) + 1
  return counts
}

function projectRef(value) {
  try { return new URL(value).host.split('.')[0] } catch { return 'unknown' }
}
