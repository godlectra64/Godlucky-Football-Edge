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
    analysis_summary,
    thai_reason,
    raw,
    updated_at
  )
`

export async function getTodayMatches() {
  const client = requireSupabase()
  const { start, end } = todayAndTomorrowRangeBangkok()

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
  const fallbackAnalysis = createFallbackAnalysis(row)
  const activeAnalysis = analysis ?? fallbackAnalysis
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
    analysis: activeAnalysis,
    homeForm: activeAnalysis?.raw?.homeForm ?? raw.homeForm ?? null,
    awayForm: activeAnalysis?.raw?.awayForm ?? raw.awayForm ?? null,
    standings: activeAnalysis?.raw?.standings ?? raw.standings ?? [],
    raw,
    updatedAt: activeAnalysis?.updated_at ?? row.updated_at ?? row.created_at,
  }
}

function todayAndTomorrowRangeBangkok() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const today = formatter.format(new Date())
  const start = new Date(`${today}T00:00:00+07:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 2)

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  }
}

function createFallbackAnalysis(row) {
  const summary = 'มีข้อมูลการแข่งขันจาก football_matches แล้ว แต่ยังไม่มีผลวิเคราะห์ Football Master Framework แบบเต็ม'

  return {
    team_strength_score: 8,
    form_score: 8,
    home_advantage_score: 5,
    away_weakness_score: 5,
    goal_scoring_score: 8,
    defensive_stability_score: 8,
    motivation_score: 5,
    market_risk_score: 5,
    confidence_score: 60,
    recommendation: 'NO BET',
    risk_level: 'medium',
    analysis_summary: summary,
    thai_reason: summary,
    raw: {
      framework: 'football-master',
      analysis_summary: summary,
      fallback: true,
      homeForm: null,
      awayForm: null,
      standings: [],
    },
    updated_at: row.updated_at ?? row.created_at,
  }
}
