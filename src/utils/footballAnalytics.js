import { normalizeAnalysisStatus } from './analysisStatus.js'

export const FOOTBALL_ANALYTICS_PIPELINE_VERSION = 'football-analytics-pipeline-v1'
export const FOOTBALL_ANALYSIS_MODEL_VERSION = 'football-analysis-model-v1'
export const EXPECTED_SCORE_DISCLAIMER_TH = 'เป็นการประเมินความน่าจะเป็นจากโมเดล ไม่ใช่การรับประกันผลการแข่งขัน'

export function buildFootballAnalyticsOutput(match = {}, options = {}) {
  const analysis = getAnalysis(match)
  const raw = analysis.raw ?? match.raw ?? {}
  const status = normalizeAnalysisStatus(firstText(
    options.analysisStatus,
    match.analysis_status,
    match.analysisStatus,
    match.selection_status,
    match.selectionStatus,
    match.decisionStatus,
    match.bettingDecision?.status,
    analysis.analysis_status,
    match.status_short,
  ))
  const dataQuality = buildDataQuality(match, analysis)
  const confidenceBreakdown = buildConfidenceBreakdown(match, analysis, dataQuality)
  const confidence = deriveConfidence(match, analysis, dataQuality, confidenceBreakdown)
  const probabilities = normalizeProbabilities(
    match.win_draw_loss_probabilities ??
      match.winDrawLossProbabilities ??
      raw.win_draw_loss_probabilities ??
      deriveWinDrawLossProbabilities(match, analysis),
  )
  const expectedGoals = normalizeExpectedGoals(match.expected_goals ?? match.expectedGoals ?? raw.expected_goals ?? deriveExpectedGoals(match, analysis, probabilities))
  const expectedScorePredictions = normalizeScorePredictions(
    match.expected_score_predictions ?? match.expectedScorePredictions ?? raw.expected_score_predictions ?? deriveScorePredictions(expectedGoals, probabilities),
  )
  const modelOutlook = buildModelOutlook(probabilities)
  const reasonCodes = uniqueText([
    ...(Array.isArray(match.analysis_reason_codes) ? match.analysis_reason_codes : []),
    ...(Array.isArray(match.reasonCodes) ? match.reasonCodes : []),
    status,
    modelOutlook.direction,
    dataQuality.level,
  ]).slice(0, 8)

  return {
    fixtureId: firstText(options.fixtureId, match.fixtureId, match.fixture_id, match.api_sports_fixture_id, match.api_fixture_id, match.id, match.match_id) || null,
    selectionDate: firstText(options.selectionDate, match.selectionDate, match.selection_date) || null,
    analysisStatus: status,
    matchOutlook: probabilities,
    expectedGoals,
    expectedScorePredictions,
    modelOutlook,
    confidence,
    confidenceBreakdown,
    dataQuality,
    reasonCodes,
    thaiReasons: buildThaiReasons({ status, modelOutlook, dataQuality, confidence }),
    pipelineVersion: FOOTBALL_ANALYTICS_PIPELINE_VERSION,
    analysisModelVersion: FOOTBALL_ANALYSIS_MODEL_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    disclaimer: EXPECTED_SCORE_DISCLAIMER_TH,
  }
}

function deriveWinDrawLossProbabilities(match, analysis) {
  const homeStrength = scoreValue(analysis.home_advantage_score ?? analysis.team_strength_score ?? match.homeStrengthScore, 56)
  const awayStrength = scoreValue(analysis.away_strength_score ?? analysis.away_weakness_score ? 100 - Number(analysis.away_weakness_score) : match.awayStrengthScore, 52)
  const form = scoreValue(analysis.form_score ?? match.formScore, 55) - 55
  const homeRaw = 0.36 + (homeStrength - 55) / 220 + form / 400
  const awayRaw = 0.32 + (awayStrength - 55) / 230 - form / 500
  const drawRaw = 0.28 + (100 - Math.abs(homeStrength - awayStrength)) / 1000
  return { homeWin: homeRaw, draw: drawRaw, awayWin: awayRaw }
}

function deriveExpectedGoals(match, analysis, probabilities) {
  const attack = scoreValue(analysis.goal_scoring_score ?? analysis.attacking_score ?? match.goalScoringScore, 56)
  const defense = scoreValue(analysis.defensive_stability_score ?? match.defensiveStabilityScore, 54)
  const baseTotal = clamp(2.1 + (attack - 55) / 50 - (defense - 55) / 90, 1.2, 3.8)
  const homeShare = clamp(0.45 + (probabilities.homeWin - probabilities.awayWin) * 0.35, 0.28, 0.72)
  return {
    home: round(baseTotal * homeShare, 2),
    away: round(baseTotal * (1 - homeShare), 2),
    total: round(baseTotal, 2),
  }
}

function deriveScorePredictions(expectedGoals, probabilities) {
  const home = Math.max(0, Math.round(expectedGoals.home))
  const away = Math.max(0, Math.round(expectedGoals.away))
  const direction = probabilities.homeWin >= probabilities.awayWin ? 1 : -1
  const candidates = [
    { home, away, probability: 0.34 },
    { home: Math.max(0, home + direction), away: Math.max(0, away - direction), probability: 0.26 },
    { home: Math.max(0, home - 1), away: Math.max(0, away - 1), probability: 0.18 },
    { home: 1, away: 1, probability: 0.12 },
  ]
  return uniqueScores(candidates).slice(0, 3)
}

function buildModelOutlook(probabilities) {
  const spread = Math.abs(probabilities.homeWin - probabilities.awayWin)
  const direction = spread < 0.06 ? 'BALANCED' : probabilities.homeWin > probabilities.awayWin ? 'HOME_ADVANTAGE' : 'AWAY_ADVANTAGE'
  const labelTh = direction === 'HOME_ADVANTAGE' ? 'เจ้าบ้านได้เปรียบ' : direction === 'AWAY_ADVANTAGE' ? 'ทีมเยือนได้เปรียบ' : 'ภาพรวมสูสี'
  return {
    direction,
    labelTh,
    signalStrength: round(clamp(spread * 180 + 45, 0, 100), 1),
  }
}

function buildDataQuality(match, analysis) {
  const checks = [
    ['fixture_identity', firstText(match.id, match.fixtureId, match.api_sports_fixture_id)],
    ['teams', firstText(match.homeTeam?.name, match.home_team?.name, match.home_team) && firstText(match.awayTeam?.name, match.away_team?.name, match.away_team)],
    ['league', firstText(match.league?.name, match.competition?.name)],
    ['kickoff', firstText(match.kickoffAt, match.kickoff_at, match.utcDate)],
    ['analysis', Boolean(analysis && Object.keys(analysis).length)],
    ['statistics', Boolean(match.enrichment?.statistics?.length || analysis.team_stats_score)],
    ['recent_form', Boolean(analysis.form_score || analysis.raw?.homeForm || match.homeForm)],
    ['tactical_context', Boolean(analysis.tactical_matchup_score || analysis.motivation_score)],
  ]
  const available = checks.filter(([, ok]) => Boolean(ok)).map(([key]) => key)
  const missing = checks.filter(([, ok]) => !ok).map(([key]) => key)
  const stored = numberOrNull(match.data_quality?.score ?? match.dataQuality?.score ?? match.data_quality_score ?? analysis.data_quality_score)
  const score = stored ?? Math.round((available.length / checks.length) * 100)
  return {
    score: clamp(score, 0, 100),
    level: score >= 75 ? 'HIGH' : score >= 50 ? 'MEDIUM' : 'LOW',
    available,
    missing,
    fixtureOnly: available.length <= 4,
  }
}

function buildConfidenceBreakdown(match, analysis, dataQuality) {
  return {
    modelSignal: scoreValue(analysis.calibrated_confidence_score ?? analysis.confidence_score ?? match.confidence, 55),
    dataQuality: dataQuality.score,
    recentForm: scoreValue(analysis.form_score, 50),
    teamStrength: scoreValue(analysis.team_strength_score, 50),
    tacticalContext: scoreValue(analysis.tactical_matchup_score ?? analysis.tactical_score, 50),
  }
}

function deriveConfidence(match, analysis, dataQuality, breakdown) {
  const stored = numberOrNull(match.confidence ?? match.confidence_score ?? analysis.calibrated_confidence_score ?? analysis.confidence_score)
  const calculated = stored ?? (
    breakdown.modelSignal * 0.34 +
    breakdown.dataQuality * 0.28 +
    breakdown.recentForm * 0.16 +
    breakdown.teamStrength * 0.14 +
    breakdown.tacticalContext * 0.08
  )
  const capped = dataQuality.fixtureOnly ? Math.min(calculated, 60) : calculated
  return Math.round(clamp(capped, 0, 100))
}

function buildThaiReasons({ status, modelOutlook, dataQuality, confidence }) {
  const reasons = [
    `สถานะข้อมูล: ${status}`,
    `มุมมองโมเดล: ${modelOutlook.labelTh}`,
    `ความมั่นใจโมเดล ${confidence}/100`,
    `คุณภาพข้อมูล ${dataQuality.level}`,
  ]
  if (dataQuality.fixtureOnly) reasons.push('ข้อมูลยังเป็นระดับ fixture จึงจำกัดความมั่นใจสูงสุดไว้')
  return reasons
}

function normalizeProbabilities(input) {
  const homeWin = numberOrNull(input?.homeWin ?? input?.home_win ?? input?.home) ?? 0
  const draw = numberOrNull(input?.draw) ?? 0
  const awayWin = numberOrNull(input?.awayWin ?? input?.away_win ?? input?.away) ?? 0
  const total = homeWin + draw + awayWin
  if (total <= 0) return { homeWin: 0.36, draw: 0.29, awayWin: 0.35 }
  return {
    homeWin: round(homeWin / total, 4),
    draw: round(draw / total, 4),
    awayWin: round(awayWin / total, 4),
  }
}

function normalizeExpectedGoals(input) {
  const home = numberOrNull(input?.home ?? input?.home_xg) ?? 1.1
  const away = numberOrNull(input?.away ?? input?.away_xg) ?? 1.0
  return {
    home: round(clamp(home, 0, 8), 2),
    away: round(clamp(away, 0, 8), 2),
    total: round(clamp(numberOrNull(input?.total) ?? home + away, 0, 12), 2),
  }
}

function normalizeScorePredictions(input) {
  const rows = Array.isArray(input) ? input : []
  const normalized = rows.map((row) => ({
    home: Math.max(0, Math.round(numberOrNull(row.home ?? row.home_goals) ?? 0)),
    away: Math.max(0, Math.round(numberOrNull(row.away ?? row.away_goals) ?? 0)),
    probability: round(clamp(numberOrNull(row.probability) ?? 0.1, 0, 1), 4),
  }))
  return uniqueScores(normalized).slice(0, 3)
}

function uniqueScores(rows) {
  const seen = new Set()
  const result = []
  for (const row of rows) {
    const key = `${row.home}-${row.away}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ ...row, score: key })
  }
  return result.sort((a, b) => b.probability - a.probability)
}

function getAnalysis(match = {}) {
  return (Array.isArray(match.analysis) ? match.analysis[0] : match.analysis ?? match.match_analysis ?? {}) ?? {}
}

function uniqueText(values) {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))]
}

function firstText(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue
    const text = String(value).trim()
    if (text) return text
  }
  return ''
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function scoreValue(value, fallback = 0) {
  const number = numberOrNull(value)
  return clamp(number ?? fallback, 0, 100)
}

function round(value, precision = 0) {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
}
