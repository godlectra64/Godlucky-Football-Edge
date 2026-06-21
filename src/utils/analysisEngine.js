export const recommendationLabels = {
  strong: 'น่าสนใจมาก',
  watch: 'น่าติดตาม',
  skip: 'ข้าม',
}

export const riskLabels = {
  low: 'ต่ำ',
  medium: 'กลาง',
  high: 'สูง',
}

export const analysisModuleLabels = {
  team_strength_score: 'ความแข็งแรงทีม',
  form_score: 'ฟอร์มล่าสุด',
  goal_quality_score: 'คุณภาพเกมรุก',
  tactical_score: 'ภาพรวมแท็กติก',
  home_away_score: 'เหย้า / เยือน',
  motivation_score: 'แรงจูงใจ',
  market_context_score: 'บริบทตลาด',
  risk_score: 'การควบคุมความเสี่ยง',
}

const scoreKeys = [
  'team_strength_score',
  'form_score',
  'goal_quality_score',
  'tactical_score',
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
  const risk = analysis.risk_level
  if (['low', 'medium', 'high'].includes(risk)) return risk

  const score = numberValue(analysis.risk_score)
  if (score >= 72) return 'low'
  if (score >= 48) return 'medium'
  return 'high'
}

export function getRecommendation(match) {
  const analysis = match.analysis ?? match.match_analysis ?? match
  if (Object.values(recommendationLabels).includes(analysis.recommendation)) {
    return analysis.recommendation
  }

  const confidence = getConfidence(match)
  const riskLevel = getRiskLevel(match)

  if (confidence >= 78 && riskLevel !== 'high') return recommendationLabels.strong
  if (confidence >= 62) return recommendationLabels.watch
  return recommendationLabels.skip
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

export function getTopMatches(matches, limit = 10) {
  return [...matches]
    .map((match) => enrichMatch(match))
    .filter((match) => match.recommendation !== recommendationLabels.skip)
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
  }
}

export function compareForTopMatches(a, b) {
  const leaguePriorityA = numberValue(a.league?.priority ?? a.leaguePriority ?? 50)
  const leaguePriorityB = numberValue(b.league?.priority ?? b.leaguePriority ?? 50)
  const riskA = riskRank(getRiskLevel(a))
  const riskB = riskRank(getRiskLevel(b))
  const kickoffA = new Date(a.kickoffAt ?? a.kickoff_at ?? 0).getTime()
  const kickoffB = new Date(b.kickoffAt ?? b.kickoff_at ?? 0).getTime()

  return (
    leaguePriorityA - leaguePriorityB ||
    riskA - riskB ||
    getConfidence(b) - getConfidence(a) ||
    kickoffA - kickoffB
  )
}

export function calculateStats(matches) {
  const enriched = matches.map((match) => enrichMatch(match))
  const settled = enriched.filter((match) => ['FT', 'AET', 'PEN'].includes(match.status))
  const strong = enriched.filter((match) => match.recommendation === recommendationLabels.strong)
  const watch = enriched.filter((match) => match.recommendation === recommendationLabels.watch)
  const skipped = enriched.filter((match) => match.recommendation === recommendationLabels.skip)
  const lowRisk = enriched.filter((match) => getRiskLevel(match) === 'low')
  const mediumRisk = enriched.filter((match) => getRiskLevel(match) === 'medium')
  const highRisk = enriched.filter((match) => getRiskLevel(match) === 'high')
  const averageConfidence = enriched.length
    ? Math.round(enriched.reduce((total, match) => total + match.confidence, 0) / enriched.length)
    : 0

  return {
    total: enriched.length,
    settled: settled.length,
    strongCount: strong.length,
    watchCount: watch.length,
    skippedCount: skipped.length,
    lowRiskCount: lowRisk.length,
    mediumRiskCount: mediumRisk.length,
    highRiskCount: highRisk.length,
    averageConfidence,
    updatedCount: enriched.filter((match) => match.analysis?.updated_at).length,
  }
}

function riskRank(level) {
  if (level === 'low') return 1
  if (level === 'medium') return 2
  return 3
}

function numberValue(value) {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}
