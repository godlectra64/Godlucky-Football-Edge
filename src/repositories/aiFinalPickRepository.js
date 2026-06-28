export async function fetchAiFinalPicksByMatchIds(matchIds = []) {
  const ids = [...new Set(matchIds.filter(Boolean))]
  if (!ids.length) return { data: [], error: null }
  const client = await getSupabaseClient()
  return client
    .from('football_ai_final_picks')
    .select('*')
    .in('match_id', ids)
}

export async function fetchAiFinalPickByMatchId(matchId) {
  if (!matchId) return { data: null, error: null }
  const client = await getSupabaseClient()
  return client
    .from('football_ai_final_picks')
    .select('*')
    .eq('match_id', matchId)
    .maybeSingle()
}

async function getSupabaseClient() {
  const { requireSupabase } = await import('../lib/supabaseClient.js')
  return requireSupabase()
}
