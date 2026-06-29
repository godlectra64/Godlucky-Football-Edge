export async function fetchPredictionSnapshots(limit = 500) {
  const client = await getSupabaseClient()
  return client
    .from('ai_prediction_snapshots')
    .select('id, match_id, fixture_id, home_team, away_team, league, kickoff, recommendation, confidence_score, ranking_score, risk_level, analysis_version, predicted_outcome, raw, created_at')
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 1000)))
}

export async function fetchPredictionResults(snapshotIds) {
  const client = await getSupabaseClient()
  return client
    .from('ai_prediction_results')
    .select('id, snapshot_id, match_id, status, home_goals, away_goals, result, finished_at, updated_at')
    .in('snapshot_id', snapshotIds)
}

export async function fetchPredictionEvaluations(snapshotIds) {
  const client = await getSupabaseClient()
  return client
    .from('ai_prediction_evaluations')
    .select('id, snapshot_id, match_id, evaluation_status, evaluation_reason, evaluated_at, updated_at')
    .in('snapshot_id', snapshotIds)
}

export async function fetchAiPickResultPerformanceRows(limit = 500) {
  const client = await getSupabaseClient()
  return client
    .from('football_ai_pick_results')
    .select(`
      id,
      selection_date,
      match_id,
      api_fixture_id,
      signal,
      market_focus,
      direction,
      confidence_score,
      risk_level,
      home_score,
      away_score,
      settlement_status,
      simulation_outcome,
      settlement_reason,
      settled_at,
      created_at,
      updated_at,
      match:football_matches(
        id,
        kickoff_at,
        league:football_leagues(name),
        homeTeam:football_teams!football_matches_home_team_id_fkey(name),
        awayTeam:football_teams!football_matches_away_team_id_fkey(name)
      )
    `)
    .order('selection_date', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 1000)))
}

async function getSupabaseClient() {
  const { requireSupabase } = await import('../lib/supabaseClient.js')
  return requireSupabase()
}
