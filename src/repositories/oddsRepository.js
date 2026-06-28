export async function fetchOddsByMatchIds(matchIds = []) {
  const ids = [...new Set(matchIds.filter(Boolean))]
  if (!ids.length) return { data: [], error: null }
  const client = await getSupabaseClient()
  return client
    .from('football_match_odds')
    .select('*')
    .in('match_id', ids)
    .order('is_latest', { ascending: false })
    .order('snapshot_at', { ascending: false })
}

export async function fetchOddsByMatchId(matchId) {
  if (!matchId) return { data: [], error: null }
  const client = await getSupabaseClient()
  return client
    .from('football_match_odds')
    .select('*')
    .eq('match_id', matchId)
    .order('is_latest', { ascending: false })
    .order('snapshot_at', { ascending: false })
}

async function getSupabaseClient() {
  const { requireSupabase } = await import('../lib/supabaseClient.js')
  return requireSupabase()
}
