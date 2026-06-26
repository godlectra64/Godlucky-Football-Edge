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

export async function getMatchDetail(matchId) {
  return getMatchAnalysis(matchId)
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

export async function getLatestSyncLog() {
  const client = requireSupabase()
  const { data, error } = await client
    .from('sync_logs')
    .select('id, sync_type, status, message, started_at, finished_at, raw')
    .in('status', ['success', 'partial_success'])
    .order('finished_at', { ascending: false, nullsFirst: false })
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data ?? null
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
  const footballIntelligence = {
    h2h: { score: 58, confidence: 'low', reason: 'ยังไม่มีข้อมูล H2H เพียงพอ', signals: ['missing_h2h'] },
    league_context: { type: 'unknown', score: 58, risk_modifier: 0, reason: 'ยังจำแนกประเภทการแข่งขันไม่ได้ชัด จึงให้ค่ากลาง' },
    rest_days: { home_rest_days: null, away_rest_days: null, score: 58, advantage: 'none', reason: 'ยังไม่มีข้อมูลวันพักทีมล่าสุด' },
    schedule_difficulty: { score: 58, difficulty: 'unknown', reason: 'ยังไม่มีข้อมูลคุณภาพคู่แข่ง 3-5 นัดล่าสุดเพียงพอ', confidence: 'low' },
    squad_context: { score: 58, confidence: 'low', reason: 'ยังไม่มีข้อมูลตัวผู้เล่น/อาการบาดเจ็บเพียงพอ', signals: ['missing_squad_data'] },
    momentum: { score: 56, momentum: 'unknown', signals: ['missing_detailed_form'], reason: 'ยังไม่มีข้อมูลโมเมนตัมละเอียด จึงไม่เดาเพิ่มจากข้อมูลที่ไม่มี' },
    match_importance: { score: 58, importance: 'unknown', risk_modifier: 0, reason: 'ยังไม่มี league table context เพียงพอ จึงไม่สรุป must-win เอง' },
    ai_explanation: {
      summary: 'Football intelligence v3 ใช้ข้อมูลที่มีแบบระมัดระวัง',
      signals: ['missing_h2h', 'missing_squad_data', 'missing_detailed_form', 'league_unknown'],
      data_confidence: 'low',
    },
    modifier: -1,
    signals: ['missing_h2h', 'missing_squad_data', 'missing_detailed_form', 'league_unknown'],
  }
  const summary = 'มีข้อมูลการแข่งขันจาก football_matches แล้ว แต่ยังไม่มีผลวิเคราะห์เต็ม ระบบจึงให้เป็น NO BET เพราะข้อมูล H2H/ตัวผู้เล่น/โมเมนตัมยังจำกัด และใช้ Football Intelligence v3 แบบระมัดระวัง'

  return {
    team_strength_score: 56,
    form_score: 56,
    home_advantage_score: 58,
    away_weakness_score: 0,
    goal_scoring_score: 57,
    defensive_stability_score: 58,
    motivation_score: 56,
    market_risk_score: 60,
    confidence_score: 59,
    recommendation: 'NO BET',
    risk_level: 'medium',
    analysis_summary: summary,
    thai_reason: summary,
    raw: {
      framework: 'football-intelligence-v3',
      base_confidence_score: 60,
      intelligence_modifier: -1,
      final_confidence_score: 59,
      analysis_summary: summary,
      analysis_breakdown: {
        team_strength: { score: 56, reason: 'ยังไม่มีผลวิเคราะห์เต็ม จึงใช้ข้อมูลคู่แข่งที่มีแบบจำกัด' },
        recent_form: { score: 56, reason: 'ข้อมูลฟอร์มล่าสุดยังไม่ครบ' },
        attack_quality: { score: 57, reason: 'ยังไม่มี xG หรือข้อมูลเกมรุกละเอียด' },
        defensive_stability: { score: 58, reason: 'ข้อมูลเกมรับยังจำกัด' },
        home_away_advantage: { score: 58, reason: 'ให้น้ำหนักเจ้าบ้านแบบระมัดระวัง' },
        motivation_context: { score: 56, reason: 'ข้อมูลบริบทและแรงจูงใจยังจำกัด' },
        market_odds_risk: { score: 60, reason: 'ไม่มีข้อมูลราคา จึงใช้ค่ากลางโดยไม่ยกระดับเป็น high risk' },
        football_intelligence: footballIntelligence,
        overall_risk: { level: 'medium', reason: 'ข้อมูลยังไม่ครบทุกมิติ แต่ไม่มีสัญญาณอันตรายชัด จึงคงความเสี่ยงระดับกลาง' },
      },
      fallback: true,
      homeForm: null,
      awayForm: null,
      standings: [],
    },
    updated_at: row.updated_at ?? row.created_at,
  }
}
