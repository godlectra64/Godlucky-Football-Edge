import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { getBangkokDayRange } from '../src/utils/bangkokDateRange.js'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const allowedRootCauses = new Set([
  'OK',
  'DAILY_MARKET_CANDIDATES_NOT_BUILT',
  'READY_CANDIDATES_LESS_THAN_10',
  'ODDS_PROVIDER_EMPTY_FOR_SELECTED_FIXTURES',
  'DAILY_SYNC_REUSED_COMPLETED_RUN',
  'FIXTURE_SYNC_LOW_COUNT',
  'TOP10_SELECTED_BEFORE_MARKET_READY',
  'TOP10_ODDS_SYNC_INCOMPLETE',
  'DYNAMIC_OFFSET_DUPLICATE_FIXTURES',
])

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
let failed = false

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables for daily production health verification.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)
const range = getBangkokDayRange(new Date())

console.log(`[verify:daily-production-health] project_ref=${getProjectRef(supabaseUrl)}`)
console.log(`[verify:daily-production-health] bangkokToday=${range.dateKey}`)

const matches = await selectAll('football_matches', 'id, kickoff_at, status, status_short, match_status, api_sports_fixture_id, has_market_data', (query) =>
  query.gte('kickoff_at', range.startUtc).lt('kickoff_at', range.endUtc)
)
const matchIds = matches.map((row) => row.id).filter(Boolean)
const playableMatches = matches.filter(isPlayable)
const todayOdds = matchIds.length
  ? await selectAll('football_match_odds', 'id, match_id, market_focus, market_name, selection, line, price, api_bookmaker_id, is_latest', (query) => query.in('match_id', matchIds))
  : []
const top10Rows = await selectAll('daily_top10_selections', 'id, rank, match_id, ai_final_pick_id', (query) =>
  query.eq('selection_date', range.dateKey).order('rank', { ascending: true })
)
const top10MatchIds = top10Rows.map((row) => row.match_id).filter(Boolean)
const top10Odds = top10MatchIds.length
  ? await selectAll('football_match_odds', 'match_id, market_focus, market_name, selection, line, price', (query) => query.in('match_id', top10MatchIds))
  : []
const candidateRowsResult = await selectOptionalAll('daily_market_candidates', 'id, match_id, api_fixture_id, candidate_rank, market_readiness_status, has_usable_ah, has_usable_ou, has_usable_match_winner, odds_rows_count', (query) =>
  query.eq('selection_date', range.dateKey).order('candidate_rank', { ascending: true })
)

const oddsChecks = await buildOddsChecks(matches, todayOdds)
const top10WithOddsMatchIds = new Set(top10Odds.filter(isUsableFullTimeOddsRow).map((row) => row.match_id).filter(Boolean))
const duplicateTop10Ranks = countDuplicates(top10Rows.map((row) => row.rank).filter((rank) => rank !== null && rank !== undefined))
const duplicateTop10Matches = countDuplicates(top10MatchIds)
const aiFinalPickCoverage = top10Rows.filter((row) => row.ai_final_pick_id).length
const candidateCounts = countCandidateReadiness(candidateRowsResult.rows)
const dailyTop10SelectedFixturesWithOdds = top10WithOddsMatchIds.size
const rootCause = determineRootCause({
  fixturesToday: matches.length,
  playableFixtures: playableMatches.length,
  candidateTableMissing: candidateRowsResult.missing,
  dailyMarketCandidates: candidateRowsResult.rows.length,
  candidateReadyCount: candidateCounts.READY,
  dailyTop10Count: top10Rows.length,
  dailyTop10SelectedFixturesWithOdds,
  duplicateTop10Ranks,
  duplicateTop10Matches,
  aiFinalPickCoverage,
  oddsChecks,
})

report('fixturesToday', matches.length, { failWhen: (value) => value <= 0 })
report('playableFixtures', playableMatches.length, { failWhen: (value) => value <= 0 })
report('dailyTop10 count valid', top10Rows.length > 0 && top10Rows.length <= 10 ? 0 : 1, { details: `count ${top10Rows.length}` })
report('dailyTop10 count over 10', top10Rows.length > 10 ? top10Rows.length - 10 : 0)
report('duplicate selected Top10 ranks', duplicateTop10Ranks)
report('duplicate selected Top10 fixtures', duplicateTop10Matches)
report('aiFinalPick coverage incomplete', top10Rows.length - aiFinalPickCoverage, { details: `${aiFinalPickCoverage}/${top10Rows.length}` })
if (top10Rows.length === 10) report('aiFinalPick coverage 10/10 required', aiFinalPickCoverage === 10 ? 0 : 10 - aiFinalPickCoverage, { details: `${aiFinalPickCoverage}/10` })
report('invalid odds marketFocus', oddsChecks.invalidMarketFocus)
report('null odds price', oddsChecks.nullPrice)
report('invalid odds price', oddsChecks.invalidPrice)
console.log(`oddsIntegritySource: ${oddsChecks.oddsIntegritySource}`)
report('duplicateLatestOdds', oddsChecks.duplicateLatestOdds)
report('odds rows exists but has_market_data=false', oddsChecks.oddsRowsExistButHasMarketDataFalse)
report('has_market_data=true but no odds rows', oddsChecks.hasMarketDataTrueButNoOddsRows)
report('daily_market_candidates table exists', candidateRowsResult.missing ? 1 : 0, { details: candidateRowsResult.missing ? 'daily_market_candidates table missing. Apply migration 20260712_add_daily_market_candidates.sql.' : 'ok' })

console.log(`dailyMarketCandidates: ${candidateRowsResult.rows.length}`)
console.log(`candidateReadyCount: ${candidateCounts.READY}`)
console.log(`candidatePartialCount: ${candidateCounts.PARTIAL}`)
console.log(`candidateWaitingMarketCount: ${candidateCounts.WAITING_MARKET}`)
console.log(`candidateNoMarketDataCount: ${candidateCounts.NO_MARKET_DATA}`)
console.log(`dailyTop10SelectedFixturesWithOdds: ${dailyTop10SelectedFixturesWithOdds}`)

if (candidateRowsResult.rows.length > 0) {
  report('candidateReadyCount available', Number.isFinite(candidateCounts.READY) ? 0 : 1)
  if (candidateCounts.READY >= 10) {
    report('Top10 with odds must be 10 when READY candidates >= 10', dailyTop10SelectedFixturesWithOdds === 10 ? 0 : 10 - dailyTop10SelectedFixturesWithOdds)
  }
}

console.log(`likelyRootCause: ${rootCause}`)
if (!allowedRootCauses.has(rootCause) || rootCause === 'UNKNOWN') {
  report('likelyRootCause specific', 1, { details: rootCause })
}

if (failed) process.exit(1)
console.log('Daily production health checks passed')

async function selectAll(table, columns, applyQuery = (query) => query) {
  const rows = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const query = applyQuery(supabase.from(table).select(columns).range(from, from + pageSize - 1))
    const { data, error } = await query
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < pageSize) break
  }
  return rows
}

async function selectOptionalAll(table, columns, applyQuery = (query) => query) {
  try {
    return { rows: await selectAll(table, columns, applyQuery), missing: false }
  } catch (error) {
    if (isMissingTableError(error)) return { rows: [], missing: true, error }
    throw error
  }
}

async function buildOddsChecks(todayMatches, oddsRows) {
  const allowedMarkets = new Set(['AH', 'OU', 'MATCH_WINNER', 'BTTS', 'NONE'])
  const oddsMatchIds = new Set(oddsRows.map((row) => row.match_id).filter(Boolean))

  return {
    oddsIntegritySource: 'verifyOddsIntegrity-compatible',
    invalidMarketFocus: oddsRows.filter((row) => row.market_focus && !allowedMarkets.has(row.market_focus)).length,
    nullPrice: oddsRows.filter((row) => row.price === null || row.price === undefined).length,
    invalidPrice: oddsRows.filter((row) => row.price !== null && row.price !== undefined && Number(row.price) <= 0).length,
    duplicateLatestOdds: await countDuplicateLatestOddsCompatible(),
    oddsRowsExistButHasMarketDataFalse: todayMatches.filter((match) => oddsMatchIds.has(match.id) && !match.has_market_data).length,
    hasMarketDataTrueButNoOddsRows: todayMatches.filter((match) => match.has_market_data && !oddsMatchIds.has(match.id)).length,
  }
}

async function countDuplicateLatestOddsCompatible() {
  const { data, error } = await supabase
    .from('football_match_odds')
    .select('match_id, api_bookmaker_id, market_focus, market_name, selection, line, is_latest')
    .eq('is_latest', true)
    .limit(10000)
  if (error) throw error

  const seen = new Set()
  let duplicates = 0
  for (const row of data ?? []) {
    const key = [row.match_id, row.api_bookmaker_id, row.market_focus, row.market_name, row.selection, row.line].join('|')
    if (seen.has(key)) duplicates += 1
    else seen.add(key)
  }
  return duplicates
}

function determineRootCause(input) {
  if (input.fixturesToday <= 0 || input.playableFixtures <= 0) return 'FIXTURE_SYNC_LOW_COUNT'
  if (input.candidateTableMissing || input.dailyMarketCandidates <= 0) return 'DAILY_MARKET_CANDIDATES_NOT_BUILT'
  if (input.duplicateTop10Ranks > 0 || input.duplicateTop10Matches > 0) return 'DYNAMIC_OFFSET_DUPLICATE_FIXTURES'
  if (input.oddsChecks.oddsRowsExistButHasMarketDataFalse > 0 || input.oddsChecks.hasMarketDataTrueButNoOddsRows > 0) return 'TOP10_ODDS_SYNC_INCOMPLETE'
  if (input.candidateReadyCount >= 10 && input.dailyTop10SelectedFixturesWithOdds < 10) return 'TOP10_SELECTED_BEFORE_MARKET_READY'
  if (input.dailyTop10Count > 0 && input.dailyTop10SelectedFixturesWithOdds < input.dailyTop10Count && input.candidateReadyCount < 10) return 'READY_CANDIDATES_LESS_THAN_10'
  if (input.dailyTop10Count > 0 && input.dailyTop10SelectedFixturesWithOdds < input.dailyTop10Count) return 'ODDS_PROVIDER_EMPTY_FOR_SELECTED_FIXTURES'
  return 'OK'
}

function countCandidateReadiness(rows) {
  const counts = { READY: 0, PARTIAL: 0, WAITING_MARKET: 0, NO_MARKET_DATA: 0 }
  for (const row of rows) {
    const status = String(row.market_readiness_status ?? 'WAITING_MARKET').toUpperCase()
    if (status in counts) counts[status] += 1
  }
  return counts
}

function countDuplicates(values) {
  const seen = new Set()
  let duplicates = 0
  for (const value of values) {
    if (seen.has(value)) duplicates += 1
    else seen.add(value)
  }
  return duplicates
}

function report(label, value, options = {}) {
  const count = typeof value === 'number' ? value : Number(value)
  const failedCheck = options.failWhen ? options.failWhen(value) : count > 0
  console.log(`${label}: ${value}${options.details ? ` (${options.details})` : ''}`)
  if (failedCheck) failed = true
}

function isPlayable(match) {
  const status = String(match.status_short ?? match.status ?? match.match_status ?? '').toUpperCase()
  return !['FT', 'AET', 'PEN', 'CANC', 'PST', 'ABD', 'AWD', 'WO', 'FINISHED'].includes(status)
}

function isUsableFullTimeOddsRow(row) {
  return !isUnsupportedMainOddsMarket(row) && (isAhLike(row) || isOuLike(row) || String(row.market_focus ?? '').toUpperCase() === 'MATCH_WINNER' || String(row.market_name ?? '').toLowerCase().includes('match winner'))
}

function isAhLike(row) {
  if (isUnsupportedMainOddsMarket(row)) return false
  const focus = String(row.market_focus ?? '').toUpperCase()
  const name = String(row.market_name ?? '').toLowerCase()
  return focus === 'AH' || name.includes('handicap')
}

function isOuLike(row) {
  if (isUnsupportedMainOddsMarket(row)) return false
  const focus = String(row.market_focus ?? '').toUpperCase()
  const name = String(row.market_name ?? '').toLowerCase()
  const line = parseLine(row.line ?? row.selection)
  if (line !== null && Math.abs(line) >= 6.5) return false
  return focus === 'OU' || name.includes('over/under') || name.includes('goals over')
}

function isUnsupportedMainOddsMarket(row) {
  const text = `${row.market_focus ?? ''} ${row.market_name ?? ''} ${row.selection ?? ''}`.toUpperCase()
  return ['CORNER', 'CARD', 'BOOKING', 'FIRST HALF', '1ST HALF', 'SECOND HALF', '2ND HALF', 'HALF TIME', 'HT/FT', 'TEAM TOTAL', 'TEAM GOALS', 'PLAYER', 'SPECIAL', 'EXACT SCORE', 'DOUBLE CHANCE', 'EXTRA TIME', 'PENALT'].some((blocked) => text.includes(blocked))
}

function parseLine(value) {
  const match = String(value ?? '').match(/-?\d+(?:\.\d+)?/)
  if (!match) return null
  const numeric = Number(match[0])
  return Number.isFinite(numeric) ? numeric : null
}

function isMissingTableError(error) {
  const message = String(error?.message ?? error?.details ?? '')
  return error?.code === '42P01' || /relation .* does not exist/i.test(message) || /Could not find the table/i.test(message)
}

function getProjectRef(value) {
  try {
    return new URL(value).host.split('.')[0]
  } catch {
    return 'unknown'
  }
}
