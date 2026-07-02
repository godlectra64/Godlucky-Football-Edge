import { fetchEnabledLeagues, updateLeagueSettingsById } from '../repositories/analysisRepository'
import { fetchMatchById, fetchMatchEnrichment, fetchMatchesByKickoffRange } from '../repositories/matchesRepository'
import { fetchAiPickResultPerformanceRows, fetchPredictionEvaluations, fetchPredictionResults, fetchPredictionSnapshots } from '../repositories/performanceRepository'
import { fetchResultTrackerRows } from '../repositories/resultTrackerRepository.js'
import { fetchLatestSyncLog, fetchSyncLogs, invokeSyncFootballData } from '../repositories/syncRepository'
import { getTopMatches } from '../utils/analysisEngine'
import { normalizeStoredAiFinalPick } from '../utils/aiFinalPickEngine.js'
import { getBangkokDayRange } from '../utils/bangkokDateRange.js'
import { normalizePerformanceRows } from '../utils/performanceIntelligence'

const isSupabaseConfigured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)

export async function getTodayMatches() {
  const { startUtc, endUtc } = getBangkokDayRange()
  const { data, error } = await fetchMatchesByKickoffRange(startUtc, endUtc)

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
  const { data, error } = await fetchMatchById(matchId)

  if (error) {
    logSupabaseReadError('getMatchDetail', error)
    return null
  }

  const enrichment = await fetchMatchEnrichment(data).catch((error) => {
    logSupabaseReadError('getMatchDetail.enrichment', error)
    return createEmptyEnrichment()
  })

  return normalizeMatch({ ...data, enrichment })
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
    return getAiPerformanceFromResultRows(limit)
  }
  const ids = (snapshots ?? []).map((item) => item.id)
  if (!ids.length) return getAiPerformanceFromResultRows(limit)

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

async function getAiPerformanceFromResultRows(limit) {
  const { data, error } = await fetchAiPickResultPerformanceRows(limit)
  if (error) {
    logSupabaseReadError('getAiPerformanceData.pickResults', error)
    return []
  }
  return (data ?? []).map((row) => {
    const match = row.match ?? {}
    const outcome = String(row.simulation_outcome ?? 'PENDING').toUpperCase()
    return {
      id: row.id,
      match_id: row.match_id,
      fixture_id: row.api_fixture_id ? String(row.api_fixture_id) : '',
      home_team: match.homeTeam?.name ?? null,
      away_team: match.awayTeam?.name ?? null,
      league: match.league?.name ?? null,
      kickoff: match.kickoff_at ?? row.selection_date,
      recommendation: row.signal === 'STRONG_SIGNAL' ? 'BET' : row.signal === 'WATCH' ? 'LEAN' : 'NO BET',
      confidence_score: row.confidence_score,
      ranking_score: row.confidence_score,
      risk_level: row.risk_level,
      analysis_version: 'ai-final-pick-results',
      predicted_outcome: row.direction,
      created_at: row.created_at,
      result: {
        status: ['HIT', 'MISS', 'PUSH', 'VOID'].includes(outcome) ? 'finished' : 'pending',
        home_goals: row.home_score,
        away_goals: row.away_score,
        result: outcome,
        finished_at: row.settled_at,
        updated_at: row.updated_at,
      },
      evaluation: {
        evaluation_status: outcome === 'HIT' ? 'correct' : outcome === 'MISS' ? 'incorrect' : outcome === 'PUSH' || outcome === 'VOID' ? 'no_evaluation' : 'pending',
        evaluation_reason: row.settlement_reason,
        evaluated_at: row.settled_at,
        updated_at: row.updated_at,
      },
    }
  })
}

export async function getResultTrackerData(limit = 80) {
  try {
    return await fetchResultTrackerRows(limit)
  } catch (error) {
    logSupabaseReadError('getResultTrackerData', error)
    return []
  }
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
  const calibratedConfidence = activeAnalysis?.calibrated_confidence_score ?? activeAnalysis?.confidence_score
  const odds = source.odds ?? source.matchOdds ?? source.match_odds ?? source.enrichment?.odds ?? []
  const aiFinalPick = normalizeStoredAiFinalPick(source.aiFinalPick ?? source.ai_final_pick, {
    ...source,
    analysis: activeAnalysis,
    odds,
  })

  return {
    id: source.id,
    apiFixtureId: source.api_fixture_id,
    apiProvider: source.api_provider,
    api_provider: source.api_provider,
    apiSportsFixtureId: source.api_sports_fixture_id,
    api_sports_fixture_id: source.api_sports_fixture_id,
    enrichmentStatus: source.enrichment_status,
    enrichment_status: source.enrichment_status,
    enrichmentUpdatedAt: source.enrichment_updated_at,
    enrichmentAttemptCount: source.enrichment_attempt_count,
    enrichment_attempt_count: source.enrichment_attempt_count,
    enrichmentLastAttemptAt: source.enrichment_last_attempt_at,
    enrichment_last_attempt_at: source.enrichment_last_attempt_at,
    enrichmentNextRetryAt: source.enrichment_next_retry_at,
    enrichment_next_retry_at: source.enrichment_next_retry_at,
    enrichmentError: source.enrichment_error,
    enrichment_error: source.enrichment_error,
    enrichmentBreakdown: source.enrichment_breakdown,
    enrichment_breakdown: source.enrichment_breakdown,
    hasMarketData: source.has_market_data,
    has_market_data: source.has_market_data,
    hasFixtureDetail: source.has_fixture_detail,
    has_fixture_detail: source.has_fixture_detail,
    dataReadinessScore: source.data_readiness_score,
    data_readiness_score: source.data_readiness_score,
    dataReadinessStatus: source.data_readiness_status,
    data_readiness_status: source.data_readiness_status,
    oddsUpdatedAt: source.odds_updated_at,
    statsUpdatedAt: source.stats_updated_at,
    injuriesUpdatedAt: source.injuries_updated_at,
    lineupsUpdatedAt: source.lineups_updated_at,
    kickoffAt: source.kickoff_at,
    status: source.status_short ?? source.match_status ?? source.status,
    statusShort: source.status_short ?? source.match_status ?? source.status,
    status_short: source.status_short ?? source.match_status ?? source.status,
    statusLong: source.status_long,
    status_long: source.status_long,
    venue: source.venue,
    round: source.round,
    homeGoals: source.home_score ?? source.home_goals,
    awayGoals: source.away_score ?? source.away_goals,
    league: source.league,
    homeTeam: source.homeTeam,
    awayTeam: source.awayTeam,
    analysis: activeAnalysis,
    homeForm: activeAnalysis?.raw?.homeForm ?? raw.homeForm ?? null,
    awayForm: activeAnalysis?.raw?.awayForm ?? raw.awayForm ?? null,
    standings: activeAnalysis?.raw?.standings ?? raw.standings ?? [],
    raw,
    odds,
    matchOdds: odds,
    match_odds: odds,
    aiFinalPick,
    ai_final_pick: aiFinalPick,
    enrichment: normalizeEnrichment(source.enrichment),
    confidence: calibratedConfidence,
    calibratedConfidence: activeAnalysis?.calibrated_confidence_score,
    calibrated_confidence_score: activeAnalysis?.calibrated_confidence_score,
    marketEdgeScore: activeAnalysis?.market_edge_score,
    market_edge_score: activeAnalysis?.market_edge_score,
    oddsConfidenceScore: activeAnalysis?.odds_confidence_score,
    odds_confidence_score: activeAnalysis?.odds_confidence_score,
    oddsMovementScore: activeAnalysis?.odds_movement_score,
    odds_movement_score: activeAnalysis?.odds_movement_score,
    teamStatsScore: activeAnalysis?.team_stats_score,
    team_stats_score: activeAnalysis?.team_stats_score,
    injuriesScore: activeAnalysis?.injuries_score,
    injuries_score: activeAnalysis?.injuries_score,
    lineupsScore: activeAnalysis?.lineups_score,
    lineups_score: activeAnalysis?.lineups_score,
    dataDepthScore: activeAnalysis?.data_depth_score,
    data_depth_score: activeAnalysis?.data_depth_score,
    learningAdjustmentScore: activeAnalysis?.learning_adjustment_score,
    learning_adjustment_score: activeAnalysis?.learning_adjustment_score,
    historicalAccuracyScore: activeAnalysis?.historical_accuracy_score,
    historical_accuracy_score: activeAnalysis?.historical_accuracy_score,
    modelVersion: activeAnalysis?.model_version,
    model_version: activeAnalysis?.model_version,
    valueSide: activeAnalysis?.value_side,
    value_side: activeAnalysis?.value_side,
    valueMarket: activeAnalysis?.value_market,
    value_market: activeAnalysis?.value_market,
    valueLine: activeAnalysis?.value_line,
    value_line: activeAnalysis?.value_line,
    oddsMovementSummary: activeAnalysis?.odds_movement_summary,
    odds_movement_summary: activeAnalysis?.odds_movement_summary,
    enrichedSummary: activeAnalysis?.enriched_summary,
    enriched_summary: activeAnalysis?.enriched_summary,
    learningSummary: activeAnalysis?.learning_summary,
    learning_summary: activeAnalysis?.learning_summary,
    dataIntelligenceV4: {
      calibratedConfidence: activeAnalysis?.calibrated_confidence_score,
      marketEdge: activeAnalysis?.market_edge_score,
      oddsConfidence: activeAnalysis?.odds_confidence_score,
      oddsMovement: activeAnalysis?.odds_movement_score,
      teamStats: activeAnalysis?.team_stats_score,
      injuries: activeAnalysis?.injuries_score,
      lineups: activeAnalysis?.lineups_score,
      dataDepth: activeAnalysis?.data_depth_score,
      learningAdjustment: activeAnalysis?.learning_adjustment_score,
      historicalAccuracy: activeAnalysis?.historical_accuracy_score,
      valueMarket: activeAnalysis?.value_market,
      valueSide: activeAnalysis?.value_side,
      valueLine: activeAnalysis?.value_line,
      summary: activeAnalysis?.enriched_summary,
    },
    recommendation: activeAnalysis?.recommendation,
    riskLevel: activeAnalysis?.risk_level,
    rankingScore: activeAnalysis?.ranking_score ?? activeAnalysis?.calibrated_confidence_score,
    ranking_score: activeAnalysis?.ranking_score ?? activeAnalysis?.calibrated_confidence_score,
    aiScore: activeAnalysis?.ai_score,
    ai_score: activeAnalysis?.ai_score,
    finalRank: activeAnalysis?.final_rank,
    final_rank: activeAnalysis?.final_rank,
    recommendationTier: activeAnalysis?.recommendation_tier,
    recommendation_tier: activeAnalysis?.recommendation_tier,
    finalPickNote: activeAnalysis?.final_pick_note,
    final_pick_note: activeAnalysis?.final_pick_note,
    isTopPick: activeAnalysis?.is_top_pick,
    is_top_pick: activeAnalysis?.is_top_pick,
    isFinalPick: activeAnalysis?.is_final_pick,
    is_final_pick: activeAnalysis?.is_final_pick,
    dataValidationStatus: activeAnalysis?.data_validation_status,
    data_validation_status: activeAnalysis?.data_validation_status,
    updatedAt: activeAnalysis?.updated_at ?? source.updated_at ?? source.created_at,
  }
}

function normalizeEnrichment(enrichment = {}) {
  const topPlayers = enrichment.topPlayers ?? []
  return {
    statistics: enrichment.statistics ?? [],
    events: enrichment.events ?? [],
    lineups: enrichment.lineups ?? [],
    players: enrichment.players ?? [],
    injuries: enrichment.injuries ?? [],
    venue: enrichment.venue ?? null,
    round: enrichment.round ?? null,
    coverage: enrichment.coverage ?? null,
    topPlayers: {
      top_scorers: topPlayers.filter((item) => item.category === 'top_scorers'),
      top_assists: topPlayers.filter((item) => item.category === 'top_assists'),
      top_yellow_cards: topPlayers.filter((item) => item.category === 'top_yellow_cards'),
      top_red_cards: topPlayers.filter((item) => item.category === 'top_red_cards'),
    },
    odds: enrichment.odds ?? [],
  }
}

function createEmptyEnrichment() {
  return {
    statistics: [],
    events: [],
    lineups: [],
    players: [],
    injuries: [],
    venue: null,
    round: null,
    coverage: null,
    topPlayers: [],
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
    analysis_status: 'INSUFFICIENT_DATA',
    recommendation_reason: 'ข้อมูลตลาด/ราคา/รายละเอียดคู่แข่งยังไม่พร้อม จึงไม่ยกระดับเป็นคู่แนะนำ',
    risk_level: 'MEDIUM',
    pick_side: 'NONE',
    pick_team: null,
    pick_reason: 'Skip เพราะข้อมูลวิเคราะห์ยังไม่ครบพอให้เลือกฝั่ง',
    market_type: null,
    market_line: null,
    fair_line: null,
    model_probability: 59,
    value_status: 'NOT_APPLICABLE',
    value_reason: 'Data Direction ยังไม่พร้อม จึงไม่ประเมิน Value เชิงรุก',
    analysis_summary: summary,
    thai_reason: summary,
    raw: {
      framework: 'football-intelligence-v3',
      base_confidence_score: 60,
      intelligence_modifier: -1,
      final_confidence_score: 59,
      analysis_status: 'INSUFFICIENT_DATA',
      recommendation_reason: 'ข้อมูลตลาด/ราคา/รายละเอียดคู่แข่งยังไม่พร้อม จึงไม่ยกระดับเป็นคู่แนะนำ',
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
