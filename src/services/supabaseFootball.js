import { isSupabaseConfigured, requireSupabase } from '../lib/supabaseClient'
import { getTopMatches } from '../utils/analysisEngine'

const matchSelect = `
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
  analysis:match_analysis(
    id,
    team_strength_score,
    form_score,
    goal_quality_score,
    tactical_score,
    home_away_score,
    motivation_score,
    market_context_score,
    risk_score,
    confidence_score,
    recommendation,
    risk_level,
    thai_reason,
    raw,
    updated_at
  )
`

export async function getTodayMatches() {
  const client = requireSupabase()
  const { start, end } = todayRange()

  const { data, error } = await client
    .from('football_matches')
    .select(matchSelect)
    .gte('kickoff_at', start)
    .lt('kickoff_at', end)
    .order('kickoff_at', { ascending: true })

  if (error) throw error
  return (data ?? []).map(normalizeMatch)
}

export async function getTodayTopMatches() {
  const matches = await getTodayMatches()
  return getTopMatches(matches, 10)
}

export async function getMatchAnalysis(matchId) {
  const client = requireSupabase()
  const { data, error } = await client.from('football_matches').select(matchSelect).eq('id', matchId).single()

  if (error) throw error
  return normalizeMatch(data)
}

export async function getEnabledLeagues() {
  const client = requireSupabase()
  const { data, error } = await client
    .from('football_leagues')
    .select('id, api_league_id, name, country, logo, enabled, priority, updated_at')
    .order('priority', { ascending: true })
    .order('name', { ascending: true })

  if (error) throw error
  return data ?? []
}

export async function updateLeagueSettings(leagueId, patch) {
  const client = requireSupabase()
  const { data, error } = await client
    .from('football_leagues')
    .update({
      enabled: patch.enabled,
      priority: Number(patch.priority),
    })
    .eq('id', leagueId)
    .select('id, api_league_id, name, country, logo, enabled, priority, updated_at')
    .single()

  if (error) throw error
  return data
}

export async function getSyncLogs() {
  const client = requireSupabase()
  const { data, error } = await client
    .from('sync_logs')
    .select('id, sync_type, status, message, started_at, finished_at, raw')
    .order('started_at', { ascending: false })
    .limit(20)

  if (error) throw error
  return data ?? []
}

export async function triggerManualSync() {
  const client = requireSupabase()
  const { data, error } = await client.functions.invoke('sync-football-data', {
    body: { mode: 'manual' },
  })

  if (error) throw error
  return data
}

export async function resetTodayData() {
  const client = requireSupabase()
  const { data, error } = await client.functions.invoke('sync-football-data', {
    body: { mode: 'manual-reset-today', resetToday: true },
  })

  if (error) throw error
  return data
}

export function getConnectionState() {
  return {
    configured: isSupabaseConfigured,
    message: isSupabaseConfigured
      ? 'เชื่อมต่อ Supabase พร้อมใช้งาน'
      : 'ยังไม่ได้ตั้งค่า ENV สำหรับ Supabase',
  }
}

export function normalizeMatch(row) {
  const analysis = Array.isArray(row.analysis) ? row.analysis[0] : row.analysis
  const raw = row.raw ?? {}

  return {
    id: row.id,
    apiFixtureId: row.api_fixture_id,
    kickoffAt: row.kickoff_at,
    status: row.status,
    venue: row.venue,
    round: row.round,
    homeGoals: row.home_goals,
    awayGoals: row.away_goals,
    league: row.league,
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    analysis: analysis ?? {},
    homeForm: analysis?.raw?.homeForm ?? raw.homeForm ?? null,
    awayForm: analysis?.raw?.awayForm ?? raw.awayForm ?? null,
    raw,
    updatedAt: analysis?.updated_at ?? row.updated_at,
  }
}

function todayRange() {
  const now = new Date()
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(start.getDate() + 1)

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  }
}
