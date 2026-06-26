export async function fetchSyncLogs(limit = 20) {
  const client = await getSupabaseClient()
  return client
    .from('sync_logs')
    .select('id, sync_type, status, message, started_at, finished_at, raw')
    .order('started_at', { ascending: false })
    .limit(limit)
}

export async function fetchLatestSyncLog() {
  const client = await getSupabaseClient()
  return client
    .from('sync_logs')
    .select('id, sync_type, status, message, started_at, finished_at, raw')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
}

export async function invokeSyncFootballData(body) {
  const client = await getSupabaseClient()
  return client.functions.invoke('sync-football-data', { body })
}

async function getSupabaseClient() {
  const { requireSupabase } = await import('../lib/supabaseClient.js')
  return requireSupabase()
}
