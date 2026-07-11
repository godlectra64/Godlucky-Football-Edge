import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { getBangkokDayRange } from '../src/utils/bangkokDateRange.js'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const dateKey = process.env.SELECTION_DATE || process.argv[2] || getBangkokToday()

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, or SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)
const range = getBangkokDayRange(dateKey)

const matches = await selectAll('football_matches', `
  id,
  kickoff_at,
  status,
  status_short,
  match_status,
  api_sports_fixture_id,
  has_market_data,
  data_readiness_status
`, (query) => query.gte('kickoff_at', range.startUtc).lt('kickoff_at', range.endUtc))

const matchIds = matches.map((row) => row.id).filter(Boolean)
const todayOdds = matchIds.length
  ? await selectAll('football_match_odds', 'id, match_id, market_focus, market_name, selection, line, snapshot_at, updated_at', (query) => query.in('match_id', matchIds))
  : []
const selected = await selectAll('daily_top10_selections', 'id, rank, match_id', (query) => query.eq('selection_date', range.dateKey))
const selectedOrdered = [...selected].sort((a, b) => numericSort(a.rank, 999) - numericSort(b.rank, 999) || String(a.id ?? '').localeCompare(String(b.id ?? '')))
const selectedMatchIds = selectedOrdered.map((row) => row.match_id).filter(Boolean)
const selectedOdds = selectedMatchIds.length
  ? await selectAll('football_match_odds', 'id, match_id, market_focus, market_name, selection, line', (query) => query.in('match_id', selectedMatchIds))
  : []
const selectedMatches = selectedMatchIds.length
  ? await selectAll('football_matches', 'id, api_sports_fixture_id', (query) => query.in('id', selectedMatchIds))
  : []
const marketCandidates = await selectOptionalAll('daily_market_candidates', 'id, selection_date, match_id, api_fixture_id, candidate_rank, market_readiness_status, has_usable_ah, has_usable_ou, has_usable_match_winner, odds_rows_count', (query) => query.eq('selection_date', range.dateKey).order('candidate_rank', { ascending: true }))

const latestOddsTimestamp = await getLatestOddsTimestamp()
const latestOddsDates = await getLatestOddsMatchDates()
const todayFixtureIds = new Set(matchIds)
const oddsMatchIds = new Set(todayOdds.map((row) => row.match_id).filter(Boolean))
const selectedOddsMatchIds = new Set(selectedOdds.filter(isUsableFullTimeOddsRow).map((row) => row.match_id).filter(Boolean))
const selectedMatchById = new Map(selectedMatches.map((row) => [row.id, row]))
const selectedTop10FixtureIds = selectedMatchIds.map((matchId) => Number(selectedMatchById.get(matchId)?.api_sports_fixture_id ?? 0)).filter(Boolean)
const selectedTop10WithOddsFixtureIds = selectedMatchIds
  .filter((matchId) => selectedOddsMatchIds.has(matchId))
  .map((matchId) => Number(selectedMatchById.get(matchId)?.api_sports_fixture_id ?? 0))
  .filter(Boolean)
const selectedTop10WithoutOddsFixtureIds = selectedMatchIds
  .filter((matchId) => !selectedOddsMatchIds.has(matchId))
  .map((matchId) => Number(selectedMatchById.get(matchId)?.api_sports_fixture_id ?? 0))
  .filter(Boolean)
const candidateReadyRows = marketCandidates.filter((row) => String(row.market_readiness_status ?? '').toUpperCase() === 'READY')
const candidatePartialRows = marketCandidates.filter((row) => String(row.market_readiness_status ?? '').toUpperCase() === 'PARTIAL')
const candidateWaitingRows = marketCandidates.filter((row) => String(row.market_readiness_status ?? '').toUpperCase() === 'WAITING_MARKET')
const candidateNoMarketRows = marketCandidates.filter((row) => String(row.market_readiness_status ?? '').toUpperCase() === 'NO_MARKET_DATA')
const candidateWithOddsRows = marketCandidates.filter((row) => Boolean(row.has_usable_ah || row.has_usable_ou || row.has_usable_match_winner || Number(row.odds_rows_count ?? 0) > 0))
const candidateWithoutOddsRows = marketCandidates.filter((row) => !candidateWithOddsRows.includes(row))

const playableFixtures = matches.filter((match) => isPlayable(match))
const finishedFixtures = matches.filter((match) => isFinished(match))
const ahRows = todayOdds.filter(isAhLike)
const ouRows = todayOdds.filter(isOuLike)
const likelyRootCause = getLikelyRootCause({
  todayFixtures: matches.length,
  todayOddsRows: todayOdds.length,
  todayAhRows: ahRows.length,
  todayOuRows: ouRows.length,
  latestOddsDates,
  todayFixtureIds,
  oddsMatchIds,
})

const report = {
  bangkokTodayDate: range.dateKey,
  todayFixturesCount: matches.length,
  todayPlayableFixturesCount: playableFixtures.length,
  todayFinishedFixturesCount: finishedFixtures.length,
  todayOddsRows: todayOdds.length,
  todayAhLikeRows: ahRows.length,
  todayOuLikeRows: ouRows.length,
  latestOddsMatchDatesAvailableInDb: latestOddsDates,
  latestFootballMatchOddsCreatedAt: latestOddsTimestamp.created_at,
  latestFootballMatchOddsSnapshotAt: latestOddsTimestamp.snapshot_at,
  currentBangkokDateHasAnyOdds: todayOdds.length > 0,
  dailyTop10SelectedFixtures: selected.length,
  dailyTop10SelectedFixturesWithOdds: selectedOddsMatchIds.size,
  dailyTop10SelectedFixturesWithoutOdds: Math.max(0, selected.length - selectedOddsMatchIds.size),
  selectedTop10FixtureIds,
  selectedTop10WithOddsFixtureIds,
  selectedTop10WithoutOddsFixtureIds,
  dailyMarketCandidates: marketCandidates.length,
  candidateReadyCount: candidateReadyRows.length,
  candidatePartialCount: candidatePartialRows.length,
  candidateWaitingMarketCount: candidateWaitingRows.length,
  candidateNoMarketDataCount: candidateNoMarketRows.length,
  candidateWithOddsFixtureIds: candidateWithOddsRows.map((row) => Number(row.api_fixture_id ?? 0)).filter(Boolean),
  candidateWithoutOddsFixtureIds: candidateWithoutOddsRows.map((row) => Number(row.api_fixture_id ?? 0)).filter(Boolean),
  readyCandidateFixtureIds: candidateReadyRows.map((row) => Number(row.api_fixture_id ?? 0)).filter(Boolean),
  likelyRootCause,
}

for (const [key, value] of Object.entries(report)) {
  console.log(`${key}: ${Array.isArray(value) ? value.join(', ') || 'none' : value}`)
}

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
    return await selectAll(table, columns, applyQuery)
  } catch (error) {
    const message = String(error?.message ?? error?.details ?? '')
    if (error?.code === '42P01' || /relation .* does not exist/i.test(message) || /Could not find the table/i.test(message)) return []
    throw error
  }
}

async function getLatestOddsTimestamp() {
  const createdAt = await tryLatestOddsColumn('created_at')
  const snapshotAt = await tryLatestOddsColumn('snapshot_at')
  return {
    created_at: createdAt,
    snapshot_at: snapshotAt,
  }
}

async function tryLatestOddsColumn(column) {
  const { data, error } = await supabase
    .from('football_match_odds')
    .select(column)
    .order(column, { ascending: false, nullsFirst: false })
    .limit(1)
  if (error) return null
  return data?.[0]?.[column] ?? null
}

async function getLatestOddsMatchDates() {
  const oddsRows = await selectAll('football_match_odds', 'match_id')
  const ids = [...new Set(oddsRows.map((row) => row.match_id).filter(Boolean))]
  if (!ids.length) return []

  const dates = new Set()
  for (let index = 0; index < ids.length; index += 500) {
    const chunk = ids.slice(index, index + 500)
    const { data, error } = await supabase
      .from('football_matches')
      .select('id, kickoff_at')
      .in('id', chunk)
    if (error) throw error
    for (const match of data ?? []) {
      if (match.kickoff_at) dates.add(getBangkokDayRange(match.kickoff_at).dateKey)
    }
  }

  return [...dates].sort()
}

function getLikelyRootCause({ todayFixtures, todayOddsRows, todayAhRows, todayOuRows, latestOddsDates }) {
  if (!todayFixtures) return 'UNKNOWN'
  if (marketCandidates.length === 0) return 'DAILY_MARKET_CANDIDATES_NOT_BUILT'
  if (candidateReadyRows.length >= 10 && selectedTop10WithOddsFixtureIds.length < 10) return 'TOP10_SELECTED_BEFORE_READY_CANDIDATES'
  if (candidateReadyRows.length > selectedTop10WithOddsFixtureIds.length) return 'READY_CANDIDATES_EXIST_OUTSIDE_TOP10'
  if (marketCandidates.length > 0 && candidateReadyRows.length < 10 && candidateWithoutOddsRows.length > 0) return 'CANDIDATE_ODDS_SYNC_INCOMPLETE_OR_PROVIDER_EMPTY'
  if (todayOddsRows > 0 && todayAhRows === 0 && todayOuRows === 0) return 'MARKET_NAME_MAPPING_MISSING'
  if (todayOddsRows > 0) return 'UNKNOWN'
  if (latestOddsDates.length && !latestOddsDates.includes(range.dateKey)) return 'ODDS_SYNC_NOT_RUN_FOR_TODAY'
  if (!latestOddsDates.length) return 'PROVIDER_NO_ODDS_FOR_TODAY'
  return 'UNKNOWN'
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

function isUsableFullTimeOddsRow(row) {
  return !isUnsupportedMainOddsMarket(row) && (isAhLike(row) || isOuLike(row) || String(row.market_focus ?? '').toUpperCase() === 'MATCH_WINNER' || String(row.market_name ?? '').toLowerCase().includes('match winner'))
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

function isFinished(match) {
  const status = String(match.status_short ?? match.status ?? match.match_status ?? '').toUpperCase()
  return ['FT', 'AET', 'PEN', 'FINISHED'].includes(status)
}

function isPlayable(match) {
  const status = String(match.status_short ?? match.status ?? match.match_status ?? '').toUpperCase()
  return !['FT', 'AET', 'PEN', 'CANC', 'PST', 'ABD', 'AWD', 'WO', 'FINISHED'].includes(status)
}

function getBangkokToday() {
  return getBangkokDayRange(new Date()).dateKey
}

function numericSort(value, fallback) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}
