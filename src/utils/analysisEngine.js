export const recommendationLabels = {
  bet: 'BET',
  lean: 'LEAN',
  noBet: 'NO BET',
}

export const riskLabels = {
  low: 'low',
  medium: 'medium',
  high: 'high',
}

export const analysisModuleLabels = {
  team_strength_score: 'ความแข็งแรงทีม',
  form_score: 'ฟอร์มล่าสุด',
  goal_quality_score: 'คุณภาพโอกาสทำประตู',
  tactical_score: 'ภาพรวมแท็กติก',
  home_away_score: 'เหย้า / เยือน',
  motivation_score: 'แรงจูงใจ',
  market_context_score: 'บริบทตลาด',
  risk_score: 'ความเสี่ยง',
}

const scoreKeys = [
  'team_strength_score',
  'form_score',
  'goal_quality_score',
  'home_away_score',
  'motivation_score',
  'market_context_score',
  'risk_score',
]

export function calculateAnalysisScore(match) {
  const analysis = match.analysis ?? match.match_analysis ?? match

  const weightedScore =
    numberValue(analysis.team_strength_score) * 0.2 +
    numberValue(analysis.form_score) * 0.2 +
    numberValue(analysis.goal_quality_score) * 0.15 +
    numberValue(analysis.home_away_score) * 0.15 +
    numberValue(analysis.motivation_score) * 0.1 +
    numberValue(analysis.market_context_score) * 0.1 +
    numberValue(analysis.risk_score) * 0.1

  return Math.round(clamp(weightedScore, 0, 100))
}

export function getRiskLevel(match) {
  const analysis = match.analysis ?? match.match_analysis ?? match
  const risk = String(analysis.risk_level ?? '').toLowerCase()
  if (['low', 'medium', 'high'].includes(risk)) return risk

  const score = numberValue(analysis.risk_score)
  if (score >= 72) return 'low'
  if (score >= 48) return 'medium'
  return 'high'
}

export function getRecommendation(match) {
  const analysis = match.analysis ?? match.match_analysis ?? match
  const stored = normalizeRecommendation(analysis.recommendation)
  if (stored) return stored

  return getRiskAdjustedRecommendation(getConfidence(match), getRiskLevel(match))
}

export function getRiskAdjustedRecommendation(confidence, riskLevel) {
  let recommendation = confidence >= 78 && riskLevel !== 'high'
    ? recommendationLabels.bet
    : confidence >= 62
      ? recommendationLabels.lean
      : recommendationLabels.noBet

  if (riskLevel === 'high') {
    if (recommendation === recommendationLabels.bet) recommendation = recommendationLabels.lean
    else if (recommendation === recommendationLabels.lean) recommendation = recommendationLabels.noBet
  }

  return recommendation
}

export function getConfidence(match) {
  const analysis = match.analysis ?? match.match_analysis ?? match
  const confidence = numberValue(analysis.confidence_score)
  return confidence > 0 ? Math.round(clamp(confidence, 0, 100)) : calculateAnalysisScore(match)
}

export function getModuleScores(match) {
  const analysis = match.analysis ?? match.match_analysis ?? match

  return scoreKeys.map((key) => ({
    key,
    label: analysisModuleLabels[key],
    score: Math.round(clamp(numberValue(analysis[key]), 0, 100)),
  }))
}

export function getDataCompleteness(match) {
  const checks = [
    Boolean(match.id),
    Boolean(match.kickoffAt ?? match.kickoff_at),
    Boolean(match.league?.name),
    Boolean(match.homeTeam?.name),
    Boolean(match.awayTeam?.name),
    Boolean(match.analysis),
    Boolean(match.homeForm),
    Boolean(match.awayForm),
    getConfidence(match) > 0,
    getModuleScores(match).some((module) => module.score > 0),
  ]

  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}

export function getTopMatches(matches, limit = 10) {
  return [...matches]
    .map((match) => enrichMatch(match))
    .sort(compareForTopMatches)
    .slice(0, limit)
}

export function enrichMatch(match) {
  return {
    ...match,
    confidence: getConfidence(match),
    recommendation: getRecommendation(match),
    riskLevel: getRiskLevel(match),
    totalAnalysisScore: calculateAnalysisScore(match),
    dataCompleteness: getDataCompleteness(match),
  }
}

export function compareForTopMatches(a, b) {
  const confidenceDiff = getConfidence(b) - getConfidence(a)
  const riskDiff = riskRank(getRiskLevel(a)) - riskRank(getRiskLevel(b))
  const leagueDiff = leaguePriorityRank(a) - leaguePriorityRank(b)
  const dataDiff = getDataCompleteness(b) - getDataCompleteness(a)
  const kickoffA = new Date(a.kickoffAt ?? a.kickoff_at ?? 0).getTime()
  const kickoffB = new Date(b.kickoffAt ?? b.kickoff_at ?? 0).getTime()

  return confidenceDiff || riskDiff || leagueDiff || dataDiff || kickoffA - kickoffB
}

export function calculateStats(matches) {
  const enriched = matches.map((match) => enrichMatch(match))
  const settled = enriched.filter((match) => ['FT', 'AET', 'PEN', 'FINISHED'].includes(match.status))
  const bet = enriched.filter((match) => match.recommendation === recommendationLabels.bet)
  const lean = enriched.filter((match) => match.recommendation === recommendationLabels.lean)
  const noBet = enriched.filter((match) => match.recommendation === recommendationLabels.noBet)
  const lowRisk = enriched.filter((match) => getRiskLevel(match) === 'low')
  const mediumRisk = enriched.filter((match) => getRiskLevel(match) === 'medium')
  const highRisk = enriched.filter((match) => getRiskLevel(match) === 'high')
  const averageConfidence = enriched.length
    ? Math.round(enriched.reduce((total, match) => total + match.confidence, 0) / enriched.length)
    : 0

  return {
    total: enriched.length,
    settled: settled.length,
    strongCount: bet.length,
    watchCount: lean.length,
    skippedCount: noBet.length,
    lowRiskCount: lowRisk.length,
    mediumRiskCount: mediumRisk.length,
    highRiskCount: highRisk.length,
    averageConfidence,
    updatedCount: enriched.filter((match) => match.analysis?.updated_at).length,
  }
}

function normalizeRecommendation(value) {
  const normalized = String(value ?? '').toUpperCase()
  if (normalized === recommendationLabels.bet) return recommendationLabels.bet
  if (normalized === recommendationLabels.lean) return recommendationLabels.lean
  if (normalized === recommendationLabels.noBet) return recommendationLabels.noBet
  return ''
}

function riskRank(level) {
  if (level === 'low') return 1
  if (level === 'medium') return 2
  return 3
}

function leaguePriorityRank(match) {
  return numberValue(match.league?.priority ?? match.leaguePriority ?? 50)
}

function numberValue(value) {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}
