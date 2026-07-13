import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { classifyDecision, evaluateFinalMarketReadiness, normalizeDecisionStatus, readyThreshold } from '../src/utils/decisionClassification.js'
import { getBangkokDayRange } from '../src/utils/bangkokDateRange.js'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const selectionDate = process.env.SELECTION_DATE || process.argv[2] || getBangkokToday()
let failed = false

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables for Daily Decision Board verification.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)
const range = getBangkokDayRange(selectionDate)

console.log(`[verify:daily-decision-board] project_ref=${getProjectRef(supabaseUrl)}`)
console.log(`[verify:daily-decision-board] selectionDate=${selectionDate}`)
console.log('[verify:daily-decision-board] timezone=Asia/Bangkok')

const matches = await fetchMatches(range.startUtc, range.endUtc)
const matchIds = matches.map((row) => row.id).filter(Boolean)
const [oddsRows, top10Rows] = await Promise.all([
  fetchByMatchIds('football_match_odds', matchIds, 'id, match_id, market_focus, market_name, selection, line, price, is_latest, snapshot_at, created_at, bookmaker_name'),
  fetchTop10Rows(selectionDate),
])
const oddsByMatch = groupBy(oddsRows, (row) => row.match_id)
const rows = matches.map((match) => {
  const odds = oddsByMatch.get(match.id) ?? []
  const finalPick = inferFinalPick(match, odds)
  const decision = classifyDecision({ ...match, odds }, { finalPick })
  const ahReadiness = evaluateFinalMarketReadiness({ ...match, odds }, 'AH')
  const ouReadiness = evaluateFinalMarketReadiness({ ...match, odds }, 'OU')
  return { match: { ...match, odds }, finalPick, decision, ahReadiness, ouReadiness }
})

const readyRows = rows.filter((row) => normalizeDecisionStatus(row.decision.status) === 'READY')
const watchRows = rows.filter((row) => normalizeDecisionStatus(row.decision.status) === 'WATCH')
const rejectedRows = rows.filter((row) => normalizeDecisionStatus(row.decision.status) === 'REJECTED')

report('READY count allowed dynamic', 0, `ready=${readyRows.length}`)
report('READY count over maximum', readyRows.length > 10 ? readyRows.length - 10 : 0, `ready=${readyRows.length}`)
report('READY analysis incomplete', readyRows.filter((row) => !isAnalysisComplete(row.match)).length)
report('READY missing final pick', readyRows.filter((row) => !row.finalPick || row.finalPick.type === 'NO_DECISION').length)
report('READY final market unavailable', readyRows.filter((row) => !row.decision.market_readiness?.ready).length)
report('READY below threshold', readyRows.filter((row) => Number(row.decision.decision_readiness_score) < readyThreshold).length)
report('READY high/critical risk', readyRows.filter((row) => ['HIGH', 'CRITICAL'].includes(normalizeRisk(row.match.analysis?.risk_level ?? row.match.ai_final_pick?.risk_level))).length)
report('WATCH critical risk', watchRows.filter((row) => normalizeRisk(row.match.analysis?.risk_level ?? row.match.ai_final_pick?.risk_level) === 'CRITICAL').length)
report('REJECTED missing rejection reason', rejectedRows.filter((row) => !row.decision.decision_reason || !row.decision.decision_reason_codes?.length).length)
report('missing decision reason', rows.filter((row) => !row.decision.decision_reason || !row.decision.decision_reason_codes?.length).length)
report('invalid decision status', rows.filter((row) => !['READY', 'WATCH', 'WAIT', 'REJECTED'].includes(normalizeDecisionStatus(row.decision.status))).length)
report('duplicate fixture', findDuplicates(rows, (row) => row.match.id).length)
report('duplicate decision rank', findDuplicates(top10Rows, (row) => row.rank).length)
report('WAIT missing true wait reason', rows.filter((row) => normalizeDecisionStatus(row.decision.status) === 'WAIT' && !hasTrueWaitReason(row.decision.decision_reason_codes)).length)
report('SCORE_BELOW_WATCH incorrectly WAIT', rows.filter((row) => normalizeDecisionStatus(row.decision.status) === 'WAIT' && row.decision.decision_reason_codes?.includes('SCORE_BELOW_WATCH') && !hasPendingDependency(row.decision.decision_reason_codes)).length)
report('market_ready counted without valid final market', rows.filter((row) => row.decision.market_readiness?.ready && !row.decision.market_readiness?.reasonCodes?.includes('MARKET_READY')).length)
report('has_market_data true without valid odds row', rows.filter((row) => row.match.has_market_data && !hasValidOddsRow(row.match.odds)).length)
report('FINAL_PICK_MISSING without explanation', rows.filter((row) => row.decision.decision_reason_codes?.includes('FINAL_PICK_MISSING') && !hasFinalPickMissingExplanation(row)).length)

const statusCounts = countBy(rows, (row) => normalizeDecisionStatus(row.decision.status))
const reasonCounts = countReasonCodes(rows)
console.log('Daily Decision Diagnostics')
console.log(`date: ${selectionDate}`)
console.log('timezone: Asia/Bangkok')
console.log(`fixtures_discovered: ${matches.length}`)
console.log(`analysis_completed: ${rows.filter((row) => isAnalysisComplete(row.match)).length}`)
console.log(`market_any_ready: ${rows.filter((row) => row.ahReadiness.ready || row.ouReadiness.ready).length}`)
console.log(`market_rows_present: ${rows.filter((row) => row.ahReadiness.reasonCodes?.length || row.ouReadiness.reasonCodes?.length).length}`)
console.log(`READY: ${statusCounts.READY ?? 0}`)
console.log(`WATCH: ${statusCounts.WATCH ?? 0}`)
console.log(`WAIT: ${statusCounts.WAIT ?? 0}`)
console.log(`REJECTED: ${statusCounts.REJECTED ?? 0}`)
console.log(`Not READY reasons: ${formatReasonCounts(reasonCounts)}`)

if (failed) process.exit(1)
console.log('Daily Decision Board checks passed')

async function fetchMatches(startUtc, endUtc) {
  const { data, error } = await supabase
    .from('football_matches')
    .select(`
      id,
      api_sports_fixture_id,
      kickoff_at,
      status,
      status_short,
      match_status,
      has_market_data,
      has_fixture_detail,
      data_readiness_status,
      raw,
      league:football_leagues(id, name, country, priority),
      homeTeam:football_teams!football_matches_home_team_id_fkey(id, api_team_id, name),
      awayTeam:football_teams!football_matches_away_team_id_fkey(id, api_team_id, name),
      analysis:match_analysis(*),
      ai_final_pick:football_ai_final_picks(*)
    `)
    .gte('kickoff_at', startUtc)
    .lt('kickoff_at', endUtc)
    .order('kickoff_at', { ascending: true })
    .limit(300)
  if (error) throw error
  return (data ?? []).map((row) => ({
    ...row,
    analysis: Array.isArray(row.analysis) ? row.analysis[0] ?? {} : row.analysis ?? {},
    ai_final_pick: Array.isArray(row.ai_final_pick) ? row.ai_final_pick[0] ?? {} : row.ai_final_pick ?? {},
  }))
}

async function fetchByMatchIds(table, ids, columns) {
  if (!ids.length) return []
  const rows = []
  const pageSize = 1000
  for (const id of ids) {
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from(table)
        .select(columns)
        .eq('match_id', id)
        .range(from, from + pageSize - 1)
      if (error) throw error
      rows.push(...(data ?? []))
      if (!data || data.length < pageSize) break
    }
  }
  return rows
}

async function fetchTop10Rows(dateKey) {
  const { data, error } = await supabase
    .from('daily_top10_selections')
    .select('*')
    .eq('selection_date', dateKey)
    .order('rank', { ascending: true })
  if (error) return []
  return data ?? []
}

function inferFinalPick(match, odds) {
  const pick = match.ai_final_pick?.betting_decision?.final_pick ?? match.ai_final_pick?.final_pick ?? null
  if (pick?.type) return pick
  const market = String(match.ai_final_pick?.market_focus ?? match.ai_final_pick?.pick_market ?? '').toUpperCase()
  if (['AH', 'OU'].includes(market)) return { type: market }
  if (odds.some((row) => /asian|handicap|\bah\b/i.test(`${row.market_focus ?? ''} ${row.market_name ?? ''}`))) return { type: 'AH' }
  if (odds.some((row) => /over|under|goals|\bou\b/i.test(`${row.market_focus ?? ''} ${row.market_name ?? ''}`))) return { type: 'OU' }
  return { type: 'NO_DECISION' }
}

function hasTrueWaitReason(codes = []) {
  return codes.some((code) => ['ANALYSIS_PENDING', 'WAIT_ANALYSIS', 'MARKET_MISSING', 'AH_MISSING', 'OU_MISSING', 'MARKET_STALE', 'WAIT_REFRESH', 'LINEUP_NOT_AVAILABLE_YET', 'FINAL_PICK_MISSING'].includes(String(code)))
}

function hasPendingDependency(codes = []) {
  return codes.some((code) => ['ANALYSIS_PENDING', 'WAIT_ANALYSIS', 'MARKET_MISSING', 'AH_MISSING', 'OU_MISSING', 'MARKET_STALE', 'WAIT_REFRESH', 'LINEUP_NOT_AVAILABLE_YET', 'DATA_PARTIAL', 'FINAL_PICK_MISSING'].includes(String(code)))
}

function hasValidOddsRow(odds = []) {
  return odds.some((row) => {
    const price = Number(row.price ?? row.odd ?? row.odds)
    const marketText = `${row.market_focus ?? ''} ${row.market_name ?? ''} ${row.market ?? ''}`.toLowerCase()
    return Number.isFinite(price) && price > 1 && /(asian|handicap|over|under|goals|\bah\b|\bou\b|match winner|home\/away)/.test(marketText)
  })
}

function hasFinalPickMissingExplanation(row) {
  const analysis = row.match.analysis ?? {}
  const pick = row.match.ai_final_pick ?? {}
  const hasAnalysisDirection = ['BET', 'LEAN', 'WATCH'].includes(String(analysis.recommendation ?? '').toUpperCase().replace('_', ' ')) || Boolean(analysis.pick_side && String(analysis.pick_side).toUpperCase() !== 'NONE')
  const persistedNoPick = ['NONE', '', 'NO_DECISION'].includes(String(pick.market_focus ?? pick.pick_market ?? '').toUpperCase())
  return !hasAnalysisDirection || persistedNoPick || row.finalPick?.type === 'NO_DECISION'
}

function isAnalysisComplete(match) {
  const analysis = match.analysis ?? {}
  if (analysis.analysis_complete !== undefined) return Boolean(analysis.analysis_complete)
  if (analysis.analysis_status) return !['PENDING', 'QUEUED', 'RUNNING'].includes(String(analysis.analysis_status).toUpperCase())
  return Boolean(analysis.recommendation || analysis.confidence_score || match.ai_final_pick?.id)
}

function report(label, count, message = '') {
  console.log(`${label}: ${count}${message ? ` (${message})` : ''}`)
  if (count > 0) failed = true
}

function groupBy(rows, keyFn) {
  const map = new Map()
  for (const row of rows) {
    const key = keyFn(row)
    const items = map.get(key) ?? []
    items.push(row)
    map.set(key, items)
  }
  return map
}

function findDuplicates(rows, keyFn) {
  const seen = new Set()
  const duplicates = []
  for (const row of rows) {
    const key = String(keyFn(row) ?? '')
    if (!key) continue
    if (seen.has(key)) duplicates.push(row)
    else seen.add(key)
  }
  return duplicates
}

function countBy(rows, keyFn) {
  return rows.reduce((summary, row) => {
    const key = keyFn(row)
    summary[key] = (summary[key] ?? 0) + 1
    return summary
  }, {})
}

function countReasonCodes(rows) {
  const counts = {}
  for (const row of rows) {
    if (normalizeDecisionStatus(row.decision.status) === 'READY') continue
    for (const code of row.decision.decision_reason_codes ?? []) {
      counts[code] = (counts[code] ?? 0) + 1
    }
  }
  return counts
}

function formatReasonCounts(counts) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([key, value]) => `${key}:${value}`)
    .join(',') || 'none'
}

function normalizeRisk(value) {
  const risk = String(value ?? '').toUpperCase()
  return ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(risk) ? risk : 'MEDIUM'
}

function getBangkokToday() {
  return getBangkokDayRange().dateKey
}

function getProjectRef(value) {
  try {
    return new URL(value).host.split('.')[0]
  } catch {
    return 'unknown'
  }
}
