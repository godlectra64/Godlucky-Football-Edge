import { getBangkokDayRange } from '../utils/bangkokDateRange.js'
import { getResultTrackerStatusLabel, getScoreDisplay, isFinishedMatch, isFinishedStatus, normalizeStatusCode } from '../utils/matchStatus.js'

const resultSelect = `
  id,
  selection_date,
  match_id,
  api_fixture_id,
  ai_final_pick_id,
  signal,
  market_focus,
  direction,
  confidence_score,
  risk_level,
  home_score,
  away_score,
  status_short,
  status_long,
  settlement_status,
  simulation_outcome,
  settlement_reason,
  settled_at,
  created_at,
  updated_at,
  match:football_matches(
    id,
    api_fixture_id,
    api_sports_fixture_id,
    kickoff_at,
    status,
    status_short,
    status_long,
    match_status,
    home_goals,
    away_goals,
    home_score,
    away_score,
    league:football_leagues(id, name, country, logo),
    homeTeam:football_teams!football_matches_home_team_id_fkey(id, name, logo, country),
    awayTeam:football_teams!football_matches_away_team_id_fkey(id, name, logo, country)
  )
`

const legacyResultSelect = `
  id,
  selection_date,
  match_id,
  api_fixture_id,
  ai_final_pick_id,
  signal,
  market_focus,
  direction,
  confidence_score,
  risk_level,
  home_score,
  away_score,
  status_short,
  status_long,
  settlement_status,
  simulation_outcome,
  settlement_reason,
  settled_at,
  created_at,
  updated_at
`

export async function fetchResultTrackerRows(limit = 80) {
  const client = await getSupabaseClient()
  const maxRows = Math.max(1, Math.min(limit, 200))
  const result = await client
    .from('football_ai_pick_results')
    .select(resultSelect)
    .order('selection_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(maxRows)

  let resultRows = []
  if (!isSchemaError(result.error)) {
    resultRows = mapResultRows(result.data ?? []).filter((row) => isFinishedStatus(row.statusShort ?? row.status_short ?? row.status))
  } else {
    const legacy = await client
      .from('football_ai_pick_results')
      .select(legacyResultSelect)
      .order('selection_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(maxRows)

    if (legacy.error) {
      if (!isSchemaError(legacy.error)) throw legacy.error
    } else {
      resultRows = mapResultRows(legacy.data ?? []).filter((row) => isFinishedStatus(row.statusShort ?? row.status_short ?? row.status))
    }
  }

  const fallbackRows = await fetchFinishedFallbackRows(client, maxRows)
  return mergeResultRows(resultRows, fallbackRows).slice(0, maxRows)
}

export function mapResultRows(rows = []) {
  return rows.map((row) => {
    const match = row.match ?? row.football_matches ?? {}
    const homeScore = coalesceNumber(row.home_score, match.home_score, match.home_goals)
    const awayScore = coalesceNumber(row.away_score, match.away_score, match.away_goals)
    const statusShort = normalizeStatusCode(row.status_short ?? match.status_short ?? match.match_status ?? match.status)
    const settlementStatus = String(row.settlement_status ?? 'PENDING').toUpperCase()
    const mapped = {
      id: row.id,
      selectionDate: row.selection_date,
      selection_date: row.selection_date,
      matchId: row.match_id ?? match.id,
      match_id: row.match_id ?? match.id,
      apiFixtureId: row.api_fixture_id ?? match.api_fixture_id ?? match.api_sports_fixture_id,
      kickoffAt: match.kickoff_at,
      league: match.league,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      signal: row.signal,
      marketFocus: row.market_focus,
      market_focus: row.market_focus,
      direction: row.direction,
      confidenceScore: row.confidence_score,
      confidence_score: row.confidence_score,
      riskLevel: row.risk_level,
      risk_level: row.risk_level,
      homeScore,
      awayScore,
      statusShort,
      status_short: statusShort,
      statusLong: row.status_long ?? match.status_long,
      settlementStatus,
      settlement_status: settlementStatus,
      simulationOutcome: String(row.simulation_outcome ?? 'PENDING').toUpperCase(),
      simulation_outcome: String(row.simulation_outcome ?? 'PENDING').toUpperCase(),
      settlementReason: row.settlement_reason,
      settledAt: row.settled_at,
      updatedAt: row.updated_at ?? row.created_at,
      match,
    }
    return {
      ...mapped,
      statusLabel: getResultTrackerStatusLabel(mapped),
      scoreDisplay: getScoreDisplay(mapped),
    }
  })
}

async function getSupabaseClient() {
  const { requireSupabase } = await import('../lib/supabaseClient.js')
  return requireSupabase()
}

function isSchemaError(error) {
  if (!error) return false
  const message = String(error.message ?? error.details ?? '')
  return (
    error.code === '42703' ||
    error.code === 'PGRST200' ||
    error.code === 'PGRST205' ||
    /column .* does not exist/i.test(message) ||
    /relationship .* could not be found/i.test(message) ||
    /Could not find the table/i.test(message)
  )
}

function coalesceNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return numeric
  }
  return null
}

const finishedMatchSelect = `
  id,
  api_fixture_id,
  api_sports_fixture_id,
  kickoff_at,
  status,
  status_short,
  status_long,
  match_status,
  home_goals,
  away_goals,
  home_score,
  away_score,
  updated_at,
  league:football_leagues(id, name, country, logo),
  homeTeam:football_teams!football_matches_home_team_id_fkey(id, name, logo, country),
  awayTeam:football_teams!football_matches_away_team_id_fkey(id, name, logo, country)
`

async function fetchFinishedFallbackRows(client, limit) {
  const { dateKey } = getBangkokDayRange()
  const recentFromDate = shiftDateKey(dateKey, -14)
  const recentFromRange = getBangkokDayRange(recentFromDate)
  const todayRange = getBangkokDayRange(dateKey)

  const [recentMatches, top10Rows] = await Promise.all([
    client
      .from('football_matches')
      .select(finishedMatchSelect)
      .gte('kickoff_at', recentFromRange.startUtc)
      .lt('kickoff_at', todayRange.endUtc)
      .in('status_short', ['FT', 'AET', 'PEN'])
      .order('kickoff_at', { ascending: false })
      .limit(limit),
    client
      .from('daily_top10_selections')
      .select('*')
      .gte('selection_date', recentFromDate)
      .lte('selection_date', dateKey)
      .order('selection_date', { ascending: false })
      .order('rank', { ascending: true }),
  ])

  const finishedMatches = isSchemaError(recentMatches.error) ? [] : recentMatches.data ?? []
  const locks = isSchemaError(top10Rows.error) ? [] : top10Rows.data ?? []
  if (recentMatches.error && !isSchemaError(recentMatches.error)) throw recentMatches.error
  if (top10Rows.error && !isSchemaError(top10Rows.error)) throw top10Rows.error

  const top10MatchIds = [...new Set(locks.map((row) => row.match_id).filter(Boolean))]
  const top10Matches = top10MatchIds.length ? await fetchMatchesByIds(client, top10MatchIds) : []
  const matches = mergeById(finishedMatches, top10Matches).filter(isFinishedMatch)
  const matchIds = matches.map((row) => row.id).filter(Boolean)
  if (!matchIds.length) return []

  const [finalPicksResult, pickResultsResult] = await Promise.all([
    client.from('football_ai_final_picks').select('*').in('match_id', matchIds),
    client.from('football_ai_pick_results').select(legacyResultSelect).in('match_id', matchIds),
  ])
  const finalPicks = isSchemaError(finalPicksResult.error) ? [] : finalPicksResult.data ?? []
  const pickResults = isSchemaError(pickResultsResult.error) ? [] : pickResultsResult.data ?? []
  if (finalPicksResult.error && !isSchemaError(finalPicksResult.error)) throw finalPicksResult.error
  if (pickResultsResult.error && !isSchemaError(pickResultsResult.error)) throw pickResultsResult.error

  const lockByMatchId = new Map(locks.map((row) => [row.match_id, row]))
  const finalPickByMatchId = new Map(finalPicks.map((row) => [row.match_id, row]))
  const pickResultByMatchId = new Map(pickResults.map((row) => [row.match_id, row]))

  return matches.map((match) => mapFinishedMatchRow(match, {
    lock: lockByMatchId.get(match.id),
    finalPick: finalPickByMatchId.get(match.id),
    pickResult: pickResultByMatchId.get(match.id),
  }))
}

async function fetchMatchesByIds(client, ids) {
  const rows = []
  const uniqueIds = [...new Set(ids)]
  for (let index = 0; index < uniqueIds.length; index += 80) {
    const chunk = uniqueIds.slice(index, index + 80)
    const { data, error } = await client
      .from('football_matches')
      .select(finishedMatchSelect)
      .in('id', chunk)
    if (error) {
      if (isSchemaError(error)) return rows
      throw error
    }
    rows.push(...(data ?? []))
  }
  return rows
}

function mapFinishedMatchRow(match = {}, context = {}) {
  const lock = context.lock ?? {}
  const finalPick = context.finalPick ?? {}
  const pickResult = context.pickResult ?? {}
  const homeScore = coalesceNumber(pickResult.home_score, match.home_score, match.home_goals)
  const awayScore = coalesceNumber(pickResult.away_score, match.away_score, match.away_goals)
  const statusShort = normalizeStatusCode(pickResult.status_short ?? match.status_short ?? match.match_status ?? match.status)
  const mapped = {
    id: pickResult.id ?? `match-${match.id}`,
    source: pickResult.id ? 'football_ai_pick_results' : lock.id ? 'daily_top10_finished_match' : 'football_matches_finished',
    selectionDate: pickResult.selection_date ?? lock.selection_date ?? getBangkokDayRange(match.kickoff_at).dateKey,
    selection_date: pickResult.selection_date ?? lock.selection_date ?? getBangkokDayRange(match.kickoff_at).dateKey,
    matchId: match.id,
    match_id: match.id,
    apiFixtureId: pickResult.api_fixture_id ?? finalPick.api_fixture_id ?? lock.api_fixture_id ?? match.api_fixture_id ?? match.api_sports_fixture_id,
    kickoffAt: match.kickoff_at,
    league: match.league,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    signal: pickResult.signal ?? finalPick.signal ?? lock.signal,
    marketFocus: pickResult.market_focus ?? finalPick.market_focus ?? lock.market_focus,
    market_focus: pickResult.market_focus ?? finalPick.market_focus ?? lock.market_focus,
    direction: pickResult.direction ?? finalPick.direction ?? lock.direction,
    confidenceScore: pickResult.confidence_score ?? finalPick.confidence_score ?? lock.confidence_score,
    confidence_score: pickResult.confidence_score ?? finalPick.confidence_score ?? lock.confidence_score,
    riskLevel: pickResult.risk_level ?? finalPick.risk_level ?? lock.risk_level,
    risk_level: pickResult.risk_level ?? finalPick.risk_level ?? lock.risk_level,
    homeScore,
    awayScore,
    statusShort,
    status_short: statusShort,
    statusLong: pickResult.status_long ?? match.status_long,
    status_long: pickResult.status_long ?? match.status_long,
    settlementStatus: String(pickResult.settlement_status ?? 'PENDING').toUpperCase(),
    settlement_status: String(pickResult.settlement_status ?? 'PENDING').toUpperCase(),
    simulationOutcome: String(pickResult.simulation_outcome ?? 'PENDING').toUpperCase(),
    simulation_outcome: String(pickResult.simulation_outcome ?? 'PENDING').toUpperCase(),
    settlementReason: pickResult.settlement_reason,
    settledAt: pickResult.settled_at,
    updatedAt: pickResult.updated_at ?? pickResult.created_at ?? match.updated_at,
    finalPick,
    dailyTop10Lock: lock,
    match,
  }
  return {
    ...mapped,
    statusLabel: getResultTrackerStatusLabel(mapped),
    scoreDisplay: getScoreDisplay(mapped),
  }
}

export function mergeResultRows(resultRows = [], fallbackRows = []) {
  const rowsByMatchId = new Map()
  for (const row of [...fallbackRows, ...resultRows]) {
    const key = row.matchId ?? row.match_id ?? row.id
    if (!key) continue
    rowsByMatchId.set(key, row)
  }
  return [...rowsByMatchId.values()]
    .filter((row) => isFinishedStatus(row.statusShort ?? row.status_short ?? row.status))
    .sort((a, b) => new Date(b.kickoffAt ?? b.updatedAt ?? 0) - new Date(a.kickoffAt ?? a.updatedAt ?? 0))
}

function mergeById(...collections) {
  const byId = new Map()
  for (const collection of collections) {
    for (const row of collection ?? []) {
      if (row?.id) byId.set(row.id, row)
    }
  }
  return [...byId.values()]
}

function shiftDateKey(dateKey, offsetDays) {
  const start = new Date(`${dateKey}T00:00:00+07:00`)
  const shifted = new Date(start.getTime() + offsetDays * 24 * 60 * 60 * 1000)
  return getBangkokDayRange(shifted).dateKey
}
