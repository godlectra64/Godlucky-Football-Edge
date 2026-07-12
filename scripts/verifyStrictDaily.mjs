import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { getBangkokDayRange } from '../src/utils/bangkokDateRange.js'
import { derivePickTeamFromApiFootballOdds, getApiFootballOddsRows } from '../src/utils/marketDisplay.js'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const selectionDate = process.env.SELECTION_DATE || process.argv[2] || getBangkokToday()
let failed = false

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables for strict daily verification.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)
const range = getBangkokDayRange(selectionDate)

console.log(`[verify:strict-daily] project_ref=${getProjectRef(supabaseUrl)}`)
console.log(`[verify:strict-daily] selectionDate=${selectionDate}`)
console.log('[verify:strict-daily] timezone=Asia/Bangkok')

const matches = await fetchMatches(range.startUtc, range.endUtc)
const matchIds = matches.map((row) => row.id).filter(Boolean)
const [oddsRows, top10Rows] = await Promise.all([
  fetchByMatchIds('football_match_odds', matchIds, '*'),
  fetchTop10Rows(selectionDate),
])

const oddsByMatch = groupBy(oddsRows, (row) => row.match_id)
const matchById = new Map(matches.map((match) => [match.id, { ...match, odds: oddsByMatch.get(match.id) ?? [] }]))
const selected = top10Rows
  .map((row) => ({ row, match: matchById.get(row.match_id) }))
  .filter((item) => item.match)
  .sort((a, b) => Number(a.row.rank ?? 999) - Number(b.row.rank ?? 999))
  .map((item) => ({
    ...item,
    oddsRows: getApiFootballOddsRows(item.match),
    pick: derivePickTeamFromApiFootballOdds(item.match),
  }))

const totalMatchesWithOdds = matches.filter((match) => (oddsByMatch.get(match.id) ?? []).length > 0).length
const oddsRowsExistButHasMarketDataFalse = matches.filter((match) => (oddsByMatch.get(match.id) ?? []).length > 0 && !match.has_market_data).length
const hasMarketDataTrueButNoOddsRows = matches.filter((match) => Boolean(match.has_market_data) && (oddsByMatch.get(match.id) ?? []).length === 0).length
const selectedWithOdds = selected.filter((item) => item.oddsRows.length > 0).length
const duplicateRanks = findDuplicates(top10Rows, (row) => row.rank)
const duplicateMatches = findDuplicates(top10Rows, (row) => row.match_id)
const crossDateRows = selected.filter((item) => getBangkokDateKey(item.match.kickoff_at) !== selectionDate)
const oddsAfterNoOddsCount = countOddsAfterNoOdds(selected)
const selectedMissingFromDate = top10Rows.filter((row) => !matchById.has(row.match_id))
const noOddsPickTeamRows = selected.filter((item) => item.oddsRows.length === 0 && Boolean(item.row.pick_team))
const teamlessMarketRows = selected.filter((item) => ['OU', 'BTTS'].includes(String(item.row.pick_market ?? item.pick.pickMarket ?? '').toUpperCase()) && Boolean(item.row.pick_team))
const drawTeamRows = selected.filter((item) => String(item.row.pick_side ?? item.pick.pickSide ?? '').toUpperCase() === 'DRAW' && Boolean(item.row.pick_team))
const teamMarketWarnings = selected.filter((item) => ['AH', 'MATCH_WINNER'].includes(String(item.row.pick_market ?? item.pick.pickMarket ?? '').toUpperCase()) && ['HOME', 'AWAY'].includes(String(item.row.pick_side ?? item.pick.pickSide ?? '').toUpperCase()) && !Boolean(item.row.pick_team ?? item.pick.pickTeam))
const expectedOddsInBoard = Math.min(totalMatchesWithOdds, top10Rows.length)

report('locked rows exist', top10Rows.length ? 0 : 1, `locked=${top10Rows.length}`)
report('dynamic count valid', top10Rows.length > 0 && top10Rows.length <= 60 ? 0 : 1, `locked=${top10Rows.length}`)
report('duplicate rank per day', duplicateRanks.length)
report('duplicate match per day', duplicateMatches.length)
report('cross-date selection', crossDateRows.length)
report('daily rows missing same-date fixture', selectedMissingFromDate.length)
report('odds rows exists but has_market_data=false', oddsRowsExistButHasMarketDataFalse)
report('has_market_data=true but no odds rows', hasMarketDataTrueButNoOddsRows)
console.log(`odds bonus ordering note: oddsAfterNoOdds=${oddsAfterNoOddsCount}`)
console.log(`selected odds coverage: selectedWithOdds=${selectedWithOdds}/${expectedOddsInBoard} totalMatchesWithOdds=${totalMatchesWithOdds}`)
report('pick_team without API odds', noOddsPickTeamRows.length)
report('OU/BTTS rows with pick_team', teamlessMarketRows.length)
report('DRAW rows with pick_team', drawTeamRows.length)

if (teamMarketWarnings.length) {
  console.warn(`[verify:strict-daily] warning team-market rows missing pick_team=${teamMarketWarnings.length}`)
}

console.log(`[verify:strict-daily] selectedWithOddsCount=${selectedWithOdds}`)
console.log(`[verify:strict-daily] selectedWithoutOddsCount=${selected.length - selectedWithOdds}`)
console.log(`[verify:strict-daily] selectedWithPickTeamCount=${selected.filter((item) => Boolean(item.row.pick_team ?? item.pick.pickTeam)).length}`)
console.log(`[verify:strict-daily] selectedWithoutPickTeamCount=${selected.filter((item) => !Boolean(item.row.pick_team ?? item.pick.pickTeam)).length}`)
console.log('[verify:strict-daily] usedRollingWindow=false')
console.log('[verify:strict-daily] usedNextDateFallback=false')

if (failed) process.exit(1)
console.log('Strict daily checks passed')

function report(label, count, message = '') {
  console.log(`${label}: ${count}${message ? ` (${message})` : ''}`)
  if (count > 0) failed = true
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
  const rows = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .in('match_id', ids)
      .range(from, from + pageSize - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < pageSize) break
  }
  return rows
}

async function fetchTop10Rows(dateKey) {
  const { data, error } = await supabase
    .from('daily_top10_selections')
    .select('*')
    .eq('selection_date', dateKey)
    .order('rank', { ascending: true })
  if (error) throw error
  return data ?? []
}

function countOddsAfterNoOdds(items) {
  let seenWithoutOdds = false
  let count = 0
  for (const item of items) {
    if (item.oddsRows.length === 0) seenWithoutOdds = true
    if (seenWithoutOdds && item.oddsRows.length > 0) count += 1
  }
  return count
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
