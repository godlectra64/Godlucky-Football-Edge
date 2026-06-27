const analysisCoreSelect = `
    id,
    team_strength_score,
    form_score,
    home_advantage_score,
    away_weakness_score,
    goal_scoring_score,
    defensive_stability_score,
    goal_quality_score,
    tactical_score,
    home_away_score,
    motivation_score,
    market_context_score,
    market_risk_score,
    risk_score,
    confidence_score,
    recommendation,
    risk_level,
    pick_side,
    pick_team,
    pick_reason,
    analysis_summary,
    thai_reason,
    raw,
    updated_at
`

const analysisFinalPickSelect = `
${analysisCoreSelect},
    market_type,
    market_line,
    fair_line,
    model_probability,
    value_status,
    value_reason
`

const analysisSelectionV2Select = `
${analysisFinalPickSelect},
    data_validation_status,
    data_validation_notes,
    league_quality_score,
    match_quality_score,
    tactical_matchup_score,
    market_reading_score,
    edge_score,
    ai_score,
    ranking_score,
    final_rank,
    recommendation_tier,
    final_pick_note,
    is_top_pick,
    is_final_pick
`

export const matchSelect = `
  id,
  api_fixture_id,
  kickoff_at,
  status,
  venue,
  round,
  home_goals,
  away_goals,
  raw,
  created_at,
  updated_at,
  league:football_leagues(id, api_league_id, name, country, logo, enabled, priority),
  homeTeam:football_teams!football_matches_home_team_id_fkey(id, api_team_id, name, logo, country),
  awayTeam:football_teams!football_matches_away_team_id_fkey(id, api_team_id, name, logo, country),
  analysis:match_analysis(${analysisSelectionV2Select})
`

const legacyMatchSelect = `
  id,
  api_fixture_id,
  kickoff_at,
  status,
  venue,
  round,
  home_goals,
  away_goals,
  raw,
  created_at,
  updated_at,
  league:football_leagues(id, api_league_id, name, country, logo, enabled, priority),
  homeTeam:football_teams!football_matches_home_team_id_fkey(id, api_team_id, name, logo, country),
  awayTeam:football_teams!football_matches_away_team_id_fkey(id, api_team_id, name, logo, country),
  analysis:match_analysis(${analysisCoreSelect})
`

export async function fetchMatchesByKickoffRange(start, end) {
  const client = await getSupabaseClient()
  const result = await client
    .from('football_matches')
    .select(matchSelect)
    .gte('kickoff_at', start)
    .lt('kickoff_at', end)
    .order('kickoff_at', { ascending: true })

  if (!isMissingColumnError(result.error)) return result

  return client
    .from('football_matches')
    .select(legacyMatchSelect)
    .gte('kickoff_at', start)
    .lt('kickoff_at', end)
    .order('kickoff_at', { ascending: true })
}

export async function getTodayAiPicks(start, end) {
  const result = await fetchMatchesByKickoffRange(start, end)
  if (result.error) return result
  return {
    ...result,
    data: (result.data ?? [])
      .filter((row) => {
        const analysis = Array.isArray(row.analysis) ? row.analysis[0] : row.analysis
        return Boolean(analysis?.is_top_pick)
      })
      .sort((a, b) => {
        const analysisA = Array.isArray(a.analysis) ? a.analysis[0] : a.analysis
        const analysisB = Array.isArray(b.analysis) ? b.analysis[0] : b.analysis
        return Number(analysisA?.final_rank ?? 999) - Number(analysisB?.final_rank ?? 999)
      }),
  }
}

export async function getTodayAnalyzedMatches(start, end) {
  const result = await fetchMatchesByKickoffRange(start, end)
  if (result.error) return result
  return {
    ...result,
    data: (result.data ?? []).filter((row) => {
      const analysis = Array.isArray(row.analysis) ? row.analysis[0] : row.analysis
      const status = String(analysis?.data_validation_status ?? 'VALID').toUpperCase()
      return ['VALID', 'PARTIAL'].includes(status)
    }),
  }
}

export async function fetchMatchById(matchId) {
  const client = await getSupabaseClient()
  const result = await client.from('football_matches').select(matchSelect).eq('id', matchId).single()
  if (!isMissingColumnError(result.error)) return result
  return client.from('football_matches').select(legacyMatchSelect).eq('id', matchId).single()
}

async function getSupabaseClient() {
  const { requireSupabase } = await import('../lib/supabaseClient.js')
  return requireSupabase()
}

function isMissingColumnError(error) {
  if (!error) return false
  const message = String(error.message ?? error.details ?? '')
  return error.code === '42703' || /column .* does not exist/i.test(message) || /Could not find .* column/i.test(message)
}
