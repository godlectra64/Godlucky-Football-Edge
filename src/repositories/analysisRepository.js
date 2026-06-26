export async function fetchEnabledLeagues() {
  const client = await getSupabaseClient()
  return client
    .from('football_leagues')
    .select('id, api_league_id, name, country, logo, enabled, priority, updated_at')
    .order('priority', { ascending: true })
    .order('name', { ascending: true })
}

export async function updateLeagueSettingsById(leagueId, patch) {
  const client = await getSupabaseClient()
  return client
    .from('football_leagues')
    .update({
      enabled: patch.enabled,
      priority: Number(patch.priority),
    })
    .eq('id', leagueId)
    .select('id, api_league_id, name, country, logo, enabled, priority, updated_at')
    .single()
}

async function getSupabaseClient() {
  const { requireSupabase } = await import('../lib/supabaseClient.js')
  return requireSupabase()
}
