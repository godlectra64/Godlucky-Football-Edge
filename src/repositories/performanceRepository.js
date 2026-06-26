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

async function getSupabaseClient() {
  const { requireSupabase } = await import('../lib/supabaseClient.js')
  return requireSupabase()
}
