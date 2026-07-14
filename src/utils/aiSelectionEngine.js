import { getLeagueQualityScore as calculateLeagueQualityScore } from './leagueQualityScoring.js'

const recommendationPriority = {
  BET: 1,
  LEAN: 2,
  WATCH: 3,
  'NO BET': 4,
}

export function runAiSelectionEngine(matches = [], options = {}) {
  const rows = (matches ?? []).map((match) => buildSelectionRow(match, options))
  const ranked = rows
    .filter((row) => row.data_validation_status !== 'INVALID')
    .sort(sortSelectionRows)

  const topIds = new Set(ranked.map((row) => row.match_id))
  const finalId = ranked[0]?.match_id ?? null
  const ranks = new Map(ranked.map((row, index) => [row.match_id, index + 1]))

  return rows.map((row) => {
    const finalRank = ranks.get(row.match_id) ?? null
    const isTopPick = topIds.has(row.match_id)
    const isFinalPick = row.match_id === finalId
    return {
      ...row,
      final_rank: finalRank,
      is_top_pick: isTopPick,
      is_final_pick: isFinalPick,
      final_pick_note: isFinalPick ? buildFinalPickNote(row.recommendation) : row.final_pick_note,
    }
  })
}

export function getLeagueQualityScore(source) {
  return calculateLeagueQualityScore(source)
}

export function sortSelectionRows(a, b) {
  const priorityDiff = getRecommendationPriority(a.recommendation) - getRecommendationPriority(b.recommendation)
  const rankingDiff = Number(b.ranking_score ?? 0) - Number(a.ranking_score ?? 0)
  const confidenceDiff = Number(b.confidence_score ?? 0) - Number(a.confidence_score ?? 0)
  const riskDiff = Number(a.risk_score ?? 100) - Number(b.risk_score ?? 100)
  return priorityDiff || rankingDiff || confidenceDiff || riskDiff
}

export function getRecommendationPriority(recommendation) {
  const normalized = normalizeRecommendation(recommendation)
  return recommendationPriority[normalized] ?? 5
}

function buildSelectionRow(match = {}, options = {}) {
  const analysis = getAnalysis(match)
  const validation = validateMatch(match, analysis, options)
  const leagueQualityScore = getLeagueQualityScore(match)
  const matchQualityScore = getMatchQualityScore(match, analysis)
  const base = getBaseScore(leagueQualityScore, analysis)
  const moduleScores = {
    team_strength_score: getScore(analysis.team_strength_score, analysis.raw?.modules?.teamStrength, base),
    form_score: getScore(analysis.form_score, analysis.raw?.modules?.recentForm, base),
    goal_scoring_score: getScore(analysis.goal_scoring_score, analysis.goal_quality_score, analysis.raw?.modules?.attackQuality, base),
    defensive_stability_score: getScore(analysis.defensive_stability_score, analysis.raw?.modules?.defensiveStability, base),
    tactical_matchup_score: getScore(analysis.tactical_matchup_score, analysis.tactical_score, base),
    motivation_score: getScore(analysis.motivation_score, analysis.raw?.modules?.motivationContext, base),
    market_reading_score: getScore(analysis.market_reading_score, analysis.market_context_score, analysis.market_risk_score, analysis.raw?.modules?.marketOddsRisk, base),
    home_away_score: getScore(analysis.home_away_score, analysis.home_advantage_score, analysis.raw?.modules?.homeAwayAdvantage, base + 2),
  }
  const aiScore = weightedAverage([
    [moduleScores.team_strength_score, 0.2],
    [moduleScores.form_score, 0.15],
    [moduleScores.goal_scoring_score, 0.15],
    [moduleScores.defensive_stability_score, 0.1],
    [moduleScores.tactical_matchup_score, 0.1],
    [moduleScores.motivation_score, 0.1],
    [moduleScores.market_reading_score, 0.1],
    [moduleScores.home_away_score, 0.1],
  ])
  const edgeScore = getEdgeScore(match, analysis, moduleScores.market_reading_score)
  const riskScore = getRiskScore(matchQualityScore, analysis)
  const confidenceScore = validation.status === 'INVALID'
    ? 0
    : roundScore(aiScore * 0.45 + edgeScore * 0.2 + leagueQualityScore * 0.15 + matchQualityScore * 0.15 - riskScore * 0.05)
  const recommendation = validation.status === 'INVALID' ? 'NO BET' : getRecommendation(confidenceScore, riskScore)
  const rankingScore = validation.status === 'INVALID'
    ? 0
    : roundScore(confidenceScore * 0.5 + aiScore * 0.25 + edgeScore * 0.15 + leagueQualityScore * 0.1 - riskScore * 0.1)

  return {
    match_id: getMatchId(match),
    data_validation_status: validation.status,
    data_validation_notes: validation.notes.join(', '),
    league_quality_score: leagueQualityScore,
    match_quality_score: matchQualityScore,
    ...moduleScores,
    risk_score: riskScore,
    edge_score: edgeScore,
    ai_score: aiScore,
    confidence_score: confidenceScore,
    ranking_score: rankingScore,
    final_rank: null,
    recommendation,
    recommendation_tier: getRecommendationTier(recommendation, confidenceScore, riskScore),
    final_pick_note: null,
    analysis_summary: buildAnalysisSummary({ recommendation, confidenceScore, riskScore, leagueQualityScore, matchQualityScore, edgeScore }),
    is_top_pick: false,
    is_final_pick: false,
  }
}

function validateMatch(match, analysis, options) {
  const notes = []
  if (!getMatchId(match)) notes.push('missing match_id')
  if (!getHomeTeam(match)) notes.push('missing home_team')
  if (!getAwayTeam(match)) notes.push('missing away_team')
  if (!getLeagueName(match)) notes.push('missing league')
  if (!getKickoff(match)) notes.push('missing kickoff_time')
  if (options.syncDate && !isSameSyncDate(getKickoff(match), options.syncDate)) notes.push('sync date mismatch')

  const hasMinimum = Boolean(getMatchId(match) && getHomeTeam(match) && getAwayTeam(match) && getLeagueName(match) && getKickoff(match))
  if (!hasMinimum) return { status: 'INVALID', notes }

  const hasAnalysisData = Boolean(analysis.recommendation || analysis.confidence_score || analysis.analysis_summary || analysis.raw)
  if (!hasAnalysisData) notes.push('limited analysis data')

  return {
    status: notes.length ? 'PARTIAL' : 'VALID',
    notes: notes.length ? notes : ['ready'],
  }
}

function getMatchQualityScore(match, analysis) {
  const checks = [
    Boolean(getHomeTeam(match)),
    Boolean(getAwayTeam(match)),
    Boolean(getLeagueName(match)),
    Boolean(getKickoff(match)),
    Boolean(analysis.recommendation || analysis.confidence_score || analysis.analysis_summary),
    Boolean(getFirstText(analysis.market_line, analysis.raw?.market_line, match.raw?.market_line, match.raw?.odds)),
    Boolean(analysis.team_strength_score || analysis.form_score || analysis.raw?.modules),
  ]
  const score = 35 + checks.filter(Boolean).length * 9
  return roundScore(score)
}

function getBaseScore(leagueQualityScore, analysis) {
  const confidence = numberValue(analysis.confidence_score)
  const rec = normalizeRecommendation(analysis.recommendation)
  const recBoost = rec === 'BET' ? 8 : rec === 'LEAN' ? 4 : rec === 'WATCH' ? 1 : -2
  return roundScore(60 + (leagueQualityScore - 65) * 0.1 + recBoost + (confidence ? (confidence - 60) * 0.08 : 0))
}

function getEdgeScore(match, analysis, marketReadingScore) {
  const fairLine = parseLine(getFirstText(analysis.fair_line, analysis.raw?.fair_line, match.raw?.fair_line))
  const marketLine = parseLine(getFirstText(analysis.market_line, analysis.raw?.market_line, match.raw?.market_line, match.raw?.odds?.line))
  if (fairLine !== null && marketLine !== null) {
    const edge = Math.abs(fairLine - marketLine)
    if (edge >= 0.5) return 95
    if (edge >= 0.35) return 88
    if (edge >= 0.25) return 80
    if (edge >= 0.15) return 70
    if (edge >= 0.05) return 60
    return 50
  }
  const confidence = numberValue(analysis.confidence_score)
  return roundScore(marketReadingScore * 0.65 + (confidence || 58) * 0.35)
}

function getRiskScore(matchQualityScore, analysis) {
  const marketRisk = numberValue(analysis.risk_score)
  if (marketRisk) return roundScore(marketRisk)
  const marketReading = numberValue(analysis.market_risk_score ?? analysis.market_reading_score)
  if (marketReading) return roundScore(100 - marketReading)
  return roundScore(100 - matchQualityScore)
}

function getRecommendation(confidence, risk) {
  if (confidence >= 85 && risk <= 45) return 'BET'
  if (confidence >= 80 && risk <= 55) return 'BET'
  if (confidence >= 70) return 'LEAN'
  if (confidence >= 60) return 'WATCH'
  return 'NO BET'
}

function getRecommendationTier(recommendation, confidence, risk) {
  if (recommendation === 'BET' && confidence >= 85 && risk <= 45) return '*****'
  if (recommendation === 'BET') return '****'
  if (recommendation === 'LEAN') return '***'
  if (recommendation === 'WATCH') return '**'
  return '*'
}

function buildFinalPickNote(recommendation) {
  if (recommendation === 'LEAN') return 'อันดับ 1 วันนี้ยังไม่ถึงระดับ BET แต่เป็นคู่ที่ AI ประเมินดีที่สุด'
  if (recommendation === 'WATCH' || recommendation === 'NO BET') return 'อันดับ 1 วันนี้ยังมีความเสี่ยงสูง AI ให้สถานะ Skip แต่เป็นคู่ที่น่าติดตามที่สุดของวัน'
  return 'วันนี้ AI เลือกคู่นี้เป็นอันดับ 1 ของวัน'
}

function buildAnalysisSummary({ recommendation, confidenceScore, riskScore, leagueQualityScore, matchQualityScore, edgeScore }) {
  if (recommendation === 'BET') {
    return `คู่นี้ผ่านการคัดเลือกด้วยคะแนนรวม ${confidenceScore} จากคุณภาพลีก ${leagueQualityScore}, คุณภาพข้อมูล ${matchQualityScore} และ Edge Score ${edgeScore} โดยมีความเสี่ยง ${riskScore} จึงอยู่ในระดับ BET`
  }
  if (recommendation === 'LEAN') return `คู่นี้มีแนวโน้มดีแต่ยังไม่ชัดพอสำหรับ BET จึงจัดเป็น LEAN ด้วยความมั่นใจ ${confidenceScore} และความเสี่ยง ${riskScore}`
  if (recommendation === 'WATCH') return `คู่นี้น่าติดตาม แต่ยังมีปัจจัยเสี่ยงหรือข้อมูลไม่ชัดพอ จึงจัดเป็น WATCH ด้วยความมั่นใจ ${confidenceScore}`
  return `คู่นี้ยังเป็นสถานะ Skip เนื่องจากคะแนนความมั่นใจ ${confidenceScore} หรือความเสี่ยง ${riskScore} ยังไม่ผ่านเกณฑ์`
}

function getAnalysis(match) {
  const analysis = Array.isArray(match.analysis) ? match.analysis[0] : match.analysis
  return analysis ?? match.match_analysis ?? {}
}

function getMatchId(match) {
  return match.id ?? match.match_id ?? match.api_fixture_id ?? null
}

function getHomeTeam(match) {
  return match.homeTeam?.name ?? match.home_team?.name ?? match.home_team ?? match.raw?.homeTeam?.name ?? ''
}

function getAwayTeam(match) {
  return match.awayTeam?.name ?? match.away_team?.name ?? match.away_team ?? match.raw?.awayTeam?.name ?? ''
}

function getLeagueName(match) {
  return match.league?.name ?? match.competition?.name ?? match.raw?.competition?.name ?? ''
}

function getKickoff(match) {
  return match.kickoffAt ?? match.kickoff_at ?? match.utcDate ?? match.raw?.utcDate ?? null
}

function isSameSyncDate(kickoff, syncDate) {
  if (!kickoff || !syncDate) return false
  return new Date(kickoff).toISOString().slice(0, 10) === String(syncDate).slice(0, 10)
}

function weightedAverage(items) {
  return roundScore(items.reduce((total, [score, weight]) => total + score * weight, 0))
}

function getScore(...values) {
  const found = values.map(numberValue).find((value) => value > 0)
  return roundScore(found ?? 60)
}

function parseLine(value) {
  if (value === null || value === undefined || value === '') return null
  const match = String(value).replace(',', '.').match(/-?\d+(?:\.\d+)?/)
  if (!match) return null
  const numeric = Number(match[0])
  return Number.isFinite(numeric) ? numeric : null
}

function getFirstText(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue
    const text = String(value).trim()
    if (text) return text
  }
  return ''
}

function normalizeRecommendation(value) {
  const normalized = String(value ?? '').toUpperCase().replace('_', ' ')
  if (['BET', 'LEAN', 'WATCH', 'NO BET'].includes(normalized)) return normalized
  return 'NO BET'
}

function numberValue(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function roundScore(value) {
  return Math.round(clamp(value, 0, 100) * 10) / 10
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
}
