import { fetchEnabledLeagues, updateLeagueSettingsById } from '../repositories/analysisRepository'
import { fetchMatchById, fetchMatchesByKickoffRange } from '../repositories/matchesRepository'
import { fetchPredictionEvaluations, fetchPredictionResults, fetchPredictionSnapshots } from '../repositories/performanceRepository'
import { fetchLatestSyncLog, fetchSyncLogs, invokeSyncFootballData } from '../repositories/syncRepository'
import { getTopMatches } from '../utils/analysisEngine'
import { normalizePerformanceRows } from '../utils/performanceIntelligence'

const isSupabaseConfigured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)

export async function getTodayMatches() {
  const { start, end } = todayAndTomorrowRangeBangkok()
  const { data, error } = await fetchMatchesByKickoffRange(start, end)

  if (error) {
    logSupabaseReadError('getTodayMatches', error)
    return []
  }
  return (data ?? []).map(normalizeMatch)
}

export async function getTodayTopMatches() {
  const matches = await getTodayMatches()
  return getTopMatches(matches, 10)
}

export async function getMatchAnalysis(matchId) {
  const { data, error } = await fetchMatchById(matchId)

  if (error) {
    logSupabaseReadError('getMatchAnalysis', error)
    return null
  }
  return normalizeMatch(data)
}

export async function getMatchDetail(matchId) {
  return getMatchAnalysis(matchId)
}

export async function getEnabledLeagues() {
  const { data, error } = await fetchEnabledLeagues()

  if (error) {
    logSupabaseReadError('getEnabledLeagues', error)
    return []
  }
  return data ?? []
}

export async function updateLeagueSettings(leagueId, patch) {
  const { data, error } = await updateLeagueSettingsById(leagueId, patch)

  if (error) throw error
  return data
}

export async function getSyncLogs() {
  const { data, error } = await fetchSyncLogs(20)

  if (error) {
    logSupabaseReadError('getSyncLogs', error)
    return []
  }
  return data ?? []
}

export async function getLatestSyncLog() {
  const { data, error } = await fetchLatestSyncLog()

  if (error) {
    logSupabaseReadError('getLatestSyncLog', error)
    return null
  }
  return data ?? null
}

export async function getAiPerformanceData(limit = 500) {
  const { data: snapshots, error } = await fetchPredictionSnapshots(limit)

  if (error) {
    logSupabaseReadError('getAiPerformanceData.snapshots', error)
    return []
  }
  const ids = (snapshots ?? []).map((item) => item.id)
  if (!ids.length) return []

  const [{ data: results, error: resultsError }, { data: evaluations, error: evaluationsError }] = await Promise.all([
    fetchPredictionResults(ids),
    fetchPredictionEvaluations(ids),
  ])

  if (resultsError) {
    logSupabaseReadError('getAiPerformanceData.results', resultsError)
    return []
  }
  if (evaluationsError) {
    logSupabaseReadError('getAiPerformanceData.evaluations', evaluationsError)
    return []
  }
  return normalizePerformanceRows(snapshots ?? [], results ?? [], evaluations ?? [])
}

export async function triggerManualSync() {
  const { data, error } = await invokeSyncFootballData({ mode: 'manual' })

  if (error) throw error
  return data
}

export async function resetTodayData() {
  const { data, error } = await invokeSyncFootballData({ mode: 'manual-reset-today', resetToday: true })

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

export function normalizeMatch(row = {}) {
  const source = row ?? {}
  const analysis = Array.isArray(source.analysis) ? source.analysis[0] : source.analysis
  const fallbackAnalysis = createFallbackAnalysis(source)
  const activeAnalysis = analysis ?? fallbackAnalysis
  const raw = source.raw ?? {}

  return {
    id: source.id,
    apiFixtureId: source.api_fixture_id,
    kickoffAt: source.kickoff_at,
    status: source.status,
    venue: source.venue,
    round: source.round,
    homeGoals: source.home_goals,
    awayGoals: source.away_goals,
    league: source.league,
    homeTeam: source.homeTeam,
    awayTeam: source.awayTeam,
    analysis: activeAnalysis,
    homeForm: activeAnalysis?.raw?.homeForm ?? raw.homeForm ?? null,
    awayForm: activeAnalysis?.raw?.awayForm ?? raw.awayForm ?? null,
    standings: activeAnalysis?.raw?.standings ?? raw.standings ?? [],
    raw,
    updatedAt: activeAnalysis?.updated_at ?? source.updated_at ?? source.created_at,
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
    away_weakness_score: 55,
    goal_scoring_score: 57,
    defensive_stability_score: 58,
    motivation_score: 56,
    market_risk_score: 52,
    confidence_score: 59,
    recommendation: 'NO BET',
    risk_level: 'MEDIUM',
    pick_side: 'NONE',
    pick_team: null,
    pick_reason: 'ไม่แนะนำเดิมพัน เพราะข้อมูลวิเคราะห์ยังไม่ครบพอให้เลือกฝั่ง',
    market_type: null,
    market_line: null,
    fair_line: null,
    model_probability: 59,
    value_status: 'NOT_APPLICABLE',
    value_reason: 'ไม่ใช่จังหวะเดิมพัน จึงไม่ประเมิน Value เชิงรุก',
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
        away_weakness: { score: 55, reason: 'ข้อมูลจุดอ่อนทีมเยือนยังจำกัด' },
        motivation_context: { score: 56, reason: 'ข้อมูลบริบทและแรงจูงใจยังจำกัด' },
        market_odds_risk: { score: 52, reason: 'ข้อมูลราคาตลาดยังจำกัด จึงให้คะแนน conservative และไม่ใช้เป็นเหตุผลหนุน BET เต็มตัว', has_market_data: false },
        football_intelligence: footballIntelligence,
        overall_risk: { level: 'MEDIUM', reason: 'ข้อมูลยังไม่ครบทุกมิติ แต่ไม่มีสัญญาณอันตรายชัด จึงคงความเสี่ยงระดับกลาง' },
      },
      fallback: true,
      homeForm: null,
      awayForm: null,
      standings: [],
    },
    updated_at: row.updated_at ?? row.created_at,
  }
}

function logSupabaseReadError(context, error) {
  if (!error) return
  console.warn(`[supabase:${context}] returning safe empty result`, {
    code: error.code,
    message: error.message,
  })
}
