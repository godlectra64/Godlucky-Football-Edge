import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { getBangkokDayRange } from '../src/utils/bangkokDateRange.js'
import { buildStrictApiFootballSelection, derivePickTeamFromApiFootballOdds, getApiFootballOddsRows } from '../src/utils/marketDisplay.js'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const selectionDate = process.env.SELECTION_DATE || process.argv[2] || getBangkokToday()

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables for strict daily diagnostics.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)
const range = getBangkokDayRange(selectionDate)

console.log(`[diagnose:strict-daily] project_ref=${getProjectRef(supabaseUrl)}`)
console.log(`[diagnose:strict-daily] selectionDate=${selectionDate}`)
console.log('[diagnose:strict-daily] timezone=Asia/Bangkok')
console.log('[diagnose:strict-daily] usedRollingWindow=false')
console.log('[diagnose:strict-daily] usedNextDateFallback=false')

const matches = await fetchMatches(range.startUtc, range.endUtc)
const matchIds = matches.map((row) => row.id).filter(Boolean)
const [oddsRows, top10Rows] = await Promise.all([
  fetchByMatchIds('football_match_odds', matchIds, '*'),
  fetchTop10Rows(selectionDate),
])

const oddsByMatch = groupBy(oddsRows, (row) => row.match_id)
const matchesWithOdds = matches.map((match) => ({ ...match, odds: oddsByMatch.get(match.id) ?? [] }))
const strictSelection = buildStrictApiFootballSelection(matchesWithOdds, { limit: 10 })
const matchById = new Map(matchesWithOdds.map((match) => [match.id, match]))
const selectedRows = top10Rows
  .map((row) => ({ row, match: matchById.get(row.match_id) }))
  .filter((item) => item.match)
  .sort((a, b) => Number(a.row.rank ?? 999) - Number(b.row.rank ?? 999))

const actualStrict = selectedRows.map((item) => {
  const match = { ...item.match, odds: oddsByMatch.get(item.match.id) ?? [] }
  return {
    row: item.row,
    match,
    oddsRows: getApiFootballOddsRows(match),
    pick: derivePickTeamFromApiFootballOdds(match),
  }
})

const totalMatchesWithOdds = matchesWithOdds.filter((match) => getApiFootballOddsRows(match).length > 0).length
const oddsRowsExistButHasMarketDataFalse = matchesWithOdds.filter((match) => getApiFootballOddsRows(match).length > 0 && !match.has_market_data).length
const hasMarketDataTrueButNoOddsRows = matchesWithOdds.filter((match) => Boolean(match.has_market_data) && getApiFootballOddsRows(match).length === 0).length
const selectedMissingFromDate = top10Rows.filter((row) => !matchById.has(row.match_id))
const selectedWithOdds = actualStrict.filter((item) => item.oddsRows.length > 0).length
const selectedWithoutOdds = actualStrict.filter((item) => item.oddsRows.length === 0).length
const selectedWithPickTeam = actualStrict.filter((item) => Boolean(item.row.pick_team ?? item.pick.pickTeam)).length
const selectedWithoutPickTeam = Math.max(0, actualStrict.length - selectedWithPickTeam)
const primaryMarketCount = actualStrict.filter((item) => item.pick.hasPrimaryMarket).length
const crossDateSelectionViolation = selectedMissingFromDate.length + actualStrict.filter((item) => getBangkokDateKey(item.match.kickoff_at) !== selectionDate).length
const oddsPriorityViolation = hasOddsPriorityViolation(actualStrict)
const top10WithoutOddsReason = actualStrict
  .filter((item) => item.oddsRows.length === 0)
  .map((item) => ({
    rank: item.row.rank,
    matchId: item.match.id,
    fixtureId: item.match.api_sports_fixture_id,
    reason: item.pick.reason || 'ยังไม่มีข้อมูลราคา',
  }))

console.log('')
printCount('totalFixturesInDate', matches.length)
printCount('totalMatchesWithOdds', totalMatchesWithOdds)
printCount('oddsRowsExistsButHasMarketDataFalse', oddsRowsExistButHasMarketDataFalse)
printCount('hasMarketDataTrueButNoOddsRows', hasMarketDataTrueButNoOddsRows)
printCount('lockedTop10Rows', top10Rows.length)
printCount('selectedCount', top10Rows.length)
printCount('selectedWithOddsCount', selectedWithOdds)
printCount('selectedWithoutOddsCount', selectedWithoutOdds)
printCount('selectedWithPickTeamCount', selectedWithPickTeam)
printCount('selectedWithoutPickTeamCount', selectedWithoutPickTeam)
printCount('primaryMarketCount', primaryMarketCount)
console.log(`marketPrioritySummary=${JSON.stringify(summarizeMarketPriority(actualStrict.map((item) => item.pick)))}`)
console.log(`pickTeamCoverage=${JSON.stringify({ withPickTeam: selectedWithPickTeam, withoutPickTeam: selectedWithoutPickTeam })}`)
console.log(`crossDateSelectionViolation=${crossDateSelectionViolation}`)
console.log(`oddsPriorityViolation=${oddsPriorityViolation}`)
console.log(`top10WithoutOddsReason=${JSON.stringify(top10WithoutOddsReason)}`)

console.log('')
console.log('expectedStrictTop10=')
for (const [index, match] of strictSelection.selected.entries()) {
  const strict = match.strictApiFootball
  console.log(`${index + 1}. ${match.homeTeam?.name ?? '-'} vs ${match.awayTeam?.name ?? '-'} odds=${strict.hasApiFootballOdds} market=${strict.primaryMarket ?? 'NONE'} pickTeam=${strict.pickTeam ?? '-'}`)
}

function printCount(label, value) {
  console.log(`${label}=${value}`)
}

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
      analysis:match_analysis(*)
    `)
    .gte('kickoff_at', startUtc)
    .lt('kickoff_at', endUtc)
    .order('kickoff_at', { ascending: true })
    .limit(300)
  if (error) throw error
  return data ?? []
}

async function fetchByMatchIds(table, ids, columns) {
  if (!ids.length) return []
  const { data, error } = await supabase.from(table).select(columns).in('match_id', ids)
  if (error) {
    console.warn(`[diagnose:strict-daily] ${table} unavailable: ${error.message}`)
    return []
  }
  return data ?? []
}

async function fetchTop10Rows(dateKey) {
  const { data, error } = await supabase
    .from('daily_top10_selections')
    .select('*')
    .eq('selection_date', dateKey)
    .order('rank', { ascending: true })
  if (error) {
    console.warn(`[diagnose:strict-daily] daily_top10_selections unavailable: ${error.message}`)
    return []
  }
  return data ?? []
}

function hasOddsPriorityViolation(items) {
  let seenWithoutOdds = false
  for (const item of items) {
    if (item.oddsRows.length === 0) seenWithoutOdds = true
    if (seenWithoutOdds && item.oddsRows.length > 0) return true
  }
  return false
}

function summarizeMarketPriority(items) {
  return items.reduce((summary, item) => {
    const key = item.pickMarket ?? 'NONE'
    summary[key] = (summary[key] ?? 0) + 1
    return summary
  }, {})
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

function getBangkokToday() {
  return getBangkokDateKey(new Date())
}

function getBangkokDateKey(value) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value))
}

function getProjectRef(value) {
  try {
    return new URL(value).host.split('.')[0]
  } catch {
    return 'unknown'
  }
}
