import { getResultTrackerStatusLabel, getScoreDisplay, normalizeStatusCode } from '../utils/matchStatus.js'

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
  const result = await client
    .from('football_ai_pick_results')
    .select(resultSelect)
    .order('selection_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 200)))

  if (!isSchemaError(result.error)) return mapResultRows(result.data ?? [])

  const legacy = await client
    .from('football_ai_pick_results')
    .select(legacyResultSelect)
    .order('selection_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 200)))

  if (legacy.error) {
    if (isSchemaError(legacy.error)) return []
    throw legacy.error
  }
  return mapResultRows(legacy.data ?? [])
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
