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
  ? await selectAll('football_match_odds', 'id, match_id, market_focus, market_name, snapshot_at, updated_at', (query) => query.in('match_id', matchIds))
  : []
const selected = await selectAll('daily_top10_selections', 'id, rank, match_id', (query) => query.eq('selection_date', range.dateKey))
const selectedOrdered = [...selected].sort((a, b) => numericSort(a.rank, 999) - numericSort(b.rank, 999) || String(a.id ?? '').localeCompare(String(b.id ?? '')))
const selectedMatchIds = selectedOrdered.map((row) => row.match_id).filter(Boolean)
const selectedOdds = selectedMatchIds.length
  ? await selectAll('football_match_odds', 'id, match_id, market_focus, market_name', (query) => query.in('match_id', selectedMatchIds))
  : []
const selectedMatches = selectedMatchIds.length
  ? await selectAll('football_matches', 'id, api_sports_fixture_id', (query) => query.in('id', selectedMatchIds))
  : []

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
  if (todayOddsRows > 0 && todayAhRows === 0 && todayOuRows === 0) return 'MARKET_NAME_MAPPING_MISSING'
  if (todayOddsRows > 0) return 'UNKNOWN'
  if (latestOddsDates.length && !latestOddsDates.includes(range.dateKey)) return 'ODDS_SYNC_NOT_RUN_FOR_TODAY'
  if (!latestOddsDates.length) return 'PROVIDER_NO_ODDS_FOR_TODAY'
  return 'UNKNOWN'
}

function isAhLike(row) {
  const focus = String(row.market_focus ?? '').toUpperCase()
  const name = String(row.market_name ?? '').toLowerCase()
  return focus === 'AH' || name.includes('handicap')
}

function isOuLike(row) {
  const focus = String(row.market_focus ?? '').toUpperCase()
  const name = String(row.market_name ?? '').toLowerCase()
  return focus === 'OU' || name.includes('over/under') || name.includes('goals over')
}

function isUsableFullTimeOddsRow(row) {
  return isAhLike(row) || isOuLike(row) || String(row.market_focus ?? '').toUpperCase() === 'MATCH_WINNER' || String(row.market_name ?? '').toLowerCase().includes('match winner')
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
