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

export const footballMasterModules = [
  { key: 'team_strength_score', rawKey: 'teamStrength', label: 'Team Strength', max: 15 },
  { key: 'form_score', rawKey: 'recentForm', label: 'Recent Form Last 5 Matches', max: 15 },
  { key: 'home_advantage_score', rawKey: 'homeAdvantage', label: 'Home Advantage', max: 10 },
  { key: 'away_weakness_score', rawKey: 'awayWeakness', label: 'Away Weakness', max: 10 },
  { key: 'goal_scoring_score', rawKey: 'goalScoring', legacyKey: 'goal_quality_score', label: 'Goal Scoring Ability', max: 15 },
  { key: 'defensive_stability_score', rawKey: 'defensiveStability', label: 'Defensive Stability', max: 15 },
  { key: 'motivation_score', rawKey: 'motivation', label: 'Motivation & Competition Priority', max: 10 },
  { key: 'market_risk_score', rawKey: 'marketRisk', legacyKey: 'risk_score', label: 'Market Risk Score', max: 10 },
]

export const analysisModuleLabels = Object.fromEntries(footballMasterModules.map((module) => [module.key, module.label]))

export function calculateFootballMasterAnalysis(match) {
  const modules = footballMasterModules.map((module) => ({
    ...module,
    score: calculateModuleScore(match, module),
  }))
  const confidence = Math.round(clamp(modules.reduce((total, module) => total + module.score, 0), 0, 100))
  const marketRisk = modules.find((module) => module.key === 'market_risk_score')?.score ?? 0
  const dataCompleteness = getDataCompleteness(match)
  const riskLevel = getRiskLevelFromScores(marketRisk, dataCompleteness)

  return {
    framework: 'football-master',
    modules,
    confidence,
    riskLevel,
    recommendation: getRecommendationFromConfidence(confidence, riskLevel),
    analysisSummary: buildAnalysisSummary(match, modules, confidence, riskLevel),
    dataCompleteness,
  }
}

export function calculateAnalysisScore(match) {
  return calculateFootballMasterAnalysis(match).confidence
}

export function getRiskLevel(match) {
  const analysis = match.analysis ?? match.match_analysis ?? match
  const master = calculateFootballMasterAnalysis(match)
  const stored = String(analysis.risk_level ?? '').toLowerCase()

  if (analysis.raw?.framework === 'football-master' && ['low', 'medium', 'high'].includes(stored)) return stored
  return master.riskLevel
}

export function getRecommendation(match) {
  return getRecommendationFromConfidence(getConfidence(match), getRiskLevel(match))
}

export function getRecommendationFromConfidence(confidence, riskLevel = riskLabels.medium) {
  if (String(riskLevel).toLowerCase() === riskLabels.high) return recommendationLabels.noBet
  if (confidence >= 75) return recommendationLabels.bet
  if (confidence >= 62) return recommendationLabels.lean
  return recommendationLabels.noBet
}

export function getRiskAdjustedRecommendation(confidence, riskLevel = riskLabels.medium) {
  return getRecommendationFromConfidence(confidence, riskLevel)
}

export function getConfidence(match) {
  const analysis = match.analysis ?? match.match_analysis ?? match
  const storedConfidence = numberValue(analysis.confidence_score)

  if (analysis.raw?.framework === 'football-master' && storedConfidence > 0) {
    return Math.round(clamp(storedConfidence, 0, 100))
  }

  return calculateFootballMasterAnalysis(match).confidence
}

export function getModuleScores(match) {
  return calculateFootballMasterAnalysis(match).modules.map((module) => ({
    key: module.key,
    label: module.label,
    score: module.score,
    max: module.max,
  }))
}

export function getAnalysisSummary(match) {
  const analysis = match.analysis ?? match.match_analysis ?? match
  return analysis.analysis_summary || analysis.raw?.analysis_summary || analysis.thai_reason || calculateFootballMasterAnalysis(match).analysisSummary
}

export function getDataCompleteness(match) {
  const analysis = match.analysis ?? match.match_analysis ?? match
  const checks = [
    Boolean(match.id),
    Boolean(match.kickoffAt ?? match.kickoff_at),
    Boolean(match.league?.name),
    Boolean(match.homeTeam?.name),
    Boolean(match.awayTeam?.name),
    Boolean(analysis),
    Boolean(match.homeForm ?? analysis.raw?.homeForm),
    Boolean(match.awayForm ?? analysis.raw?.awayForm),
    Boolean(match.homeGoals !== undefined || match.raw),
    footballMasterModules.some((module) => readModuleValue(analysis, module) > 0),
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
  const master = calculateFootballMasterAnalysis(match)

  return {
    ...match,
    confidence: master.confidence,
    recommendation: master.recommendation,
    riskLevel: master.riskLevel,
    totalAnalysisScore: master.confidence,
    dataCompleteness: master.dataCompleteness,
    analysisSummary: master.analysisSummary,
  }
}

export function compareForTopMatches(a, b) {
  const confidenceDiff = getConfidence(b) - getConfidence(a)
  const kickoffA = new Date(a.kickoffAt ?? a.kickoff_at ?? 0).getTime()
  const kickoffB = new Date(b.kickoffAt ?? b.kickoff_at ?? 0).getTime()

  return confidenceDiff || kickoffA - kickoffB
}

export function calculateStats(matches) {
  const enriched = matches.map((match) => enrichMatch(match))
  const settled = enriched.filter((match) => ['FT', 'AET', 'PEN', 'FINISHED'].includes(match.status))
  const bet = enriched.filter((match) => match.recommendation === recommendationLabels.bet)
  const lean = enriched.filter((match) => match.recommendation === recommendationLabels.lean)
  const noBet = enriched.filter((match) => match.recommendation === recommendationLabels.noBet)
  const lowRisk = enriched.filter((match) => match.riskLevel === 'low')
  const mediumRisk = enriched.filter((match) => match.riskLevel === 'medium')
  const highRisk = enriched.filter((match) => match.riskLevel === 'high')
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

function calculateModuleScore(match, module) {
  const analysis = match.analysis ?? match.match_analysis ?? match
  const stored = readModuleValue(analysis, module)
  if (stored > 0) return scaleScore(stored, module.max)

  const homeForm = match.homeForm ?? analysis.raw?.homeForm
  const awayForm = match.awayForm ?? analysis.raw?.awayForm
  const leaguePriority = numberValue(match.league?.priority ?? analysis.raw?.leaguePriority ?? 50)

  switch (module.key) {
    case 'team_strength_score':
      return scoreTeamStrength(match, homeForm, awayForm, module.max)
    case 'form_score':
      return scoreRecentForm(homeForm, awayForm, module.max)
    case 'home_advantage_score':
      return scoreHomeAdvantage(homeForm, module.max)
    case 'away_weakness_score':
      return scoreAwayWeakness(awayForm, module.max)
    case 'goal_scoring_score':
      return scoreGoalScoring(homeForm, awayForm, module.max)
    case 'defensive_stability_score':
      return scoreDefensiveStability(homeForm, awayForm, module.max)
    case 'motivation_score':
      return scoreMotivation(leaguePriority, module.max)
    case 'market_risk_score':
      return scoreMarketRisk(match, homeForm, awayForm, module.max)
    default:
      return 0
  }
}

function readModuleValue(analysis, module) {
  return numberValue(
    analysis[module.key] ??
      analysis[module.legacyKey] ??
      analysis.raw?.modules?.[module.rawKey] ??
      analysis.raw?.[module.key] ??
      analysis.raw?.[module.legacyKey],
  )
}

function scaleScore(value, max) {
  const numeric = numberValue(value)
  if (numeric > max) return Math.round(clamp((numeric / 100) * max, 0, max))
  return Math.round(clamp(numeric, 0, max))
}

function scoreTeamStrength(match, homeForm, awayForm, max) {
  const homePoints = formPoints(homeForm)
  const awayPoints = formPoints(awayForm)
  const goalDiffGap = formGoalDiff(homeForm) - formGoalDiff(awayForm)
  const raw = 8 + (homePoints - awayPoints) * 0.4 + goalDiffGap * 0.35 + (match.homeTeam?.name ? 1 : 0)
  return Math.round(clamp(raw, 3, max))
}

function scoreRecentForm(homeForm, awayForm, max) {
  const totalPoints = formPoints(homeForm) + formPoints(awayForm)
  return Math.round(clamp((totalPoints / 30) * max + 2, 0, max))
}

function scoreHomeAdvantage(homeForm, max) {
  const played = numberValue(homeForm?.played) || 5
  const wins = numberValue(homeForm?.wins)
  const goalDiff = formGoalDiff(homeForm)
  return Math.round(clamp(4 + (wins / played) * 4 + goalDiff * 0.35, 0, max))
}

function scoreAwayWeakness(awayForm, max) {
  const played = numberValue(awayForm?.played) || 5
  const losses = numberValue(awayForm?.losses)
  const goalsAgainst = numberValue(awayForm?.goals_against)
  return Math.round(clamp(2 + (losses / played) * 5 + goalsAgainst * 0.35, 0, max))
}

function scoreGoalScoring(homeForm, awayForm, max) {
  const goalsFor = numberValue(homeForm?.goals_for) + numberValue(awayForm?.goals_for)
  return Math.round(clamp((goalsFor / 15) * max + 2, 0, max))
}

function scoreDefensiveStability(homeForm, awayForm, max) {
  const goalsAgainst = numberValue(homeForm?.goals_against) + numberValue(awayForm?.goals_against)
  const cleanSheets = numberValue(homeForm?.clean_sheets) + numberValue(awayForm?.clean_sheets)
  return Math.round(clamp(max - goalsAgainst * 0.8 + cleanSheets * 1.2, 0, max))
}

function scoreMotivation(leaguePriority, max) {
  if (leaguePriority <= 15) return max
  if (leaguePriority <= 30) return 8
  if (leaguePriority <= 50) return 6
  return 5
}

function scoreMarketRisk(match, homeForm, awayForm, max) {
  const completeness = getDataCompletenessWithoutModules(match)
  const formGap = Math.abs(formPoints(homeForm) - formPoints(awayForm))
  return Math.round(clamp(4 + completeness * 0.04 + Math.min(formGap, 8) * 0.25, 0, max))
}

function getRiskLevelFromScores(marketRiskScore, dataCompleteness) {
  if (marketRiskScore >= 8 && dataCompleteness >= 70) return 'low'
  if (marketRiskScore >= 5 && dataCompleteness >= 50) return 'medium'
  return 'high'
}

function buildAnalysisSummary(match, modules, confidence, riskLevel) {
  const bestModule = [...modules].sort((a, b) => (b.score / b.max) - (a.score / a.max))[0]
  const home = match.homeTeam?.name ?? 'ทีมเหย้า'
  const away = match.awayTeam?.name ?? 'ทีมเยือน'

  return `${home} พบ ${away}: Football Master Framework ให้คะแนน ${confidence}/100 จุดเด่นคือ ${bestModule?.label ?? 'ข้อมูลรวม'} และประเมิน risk_level เป็น ${riskLevel}`
}

function getDataCompletenessWithoutModules(match) {
  const analysis = match.analysis ?? match.match_analysis ?? match
  const checks = [
    Boolean(match.id),
    Boolean(match.kickoffAt ?? match.kickoff_at),
    Boolean(match.league?.name),
    Boolean(match.homeTeam?.name),
    Boolean(match.awayTeam?.name),
    Boolean(match.homeForm ?? analysis.raw?.homeForm),
    Boolean(match.awayForm ?? analysis.raw?.awayForm),
  ]

  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}

function formPoints(form) {
  return numberValue(form?.wins) * 3 + numberValue(form?.draws)
}

function formGoalDiff(form) {
  return numberValue(form?.goals_for) - numberValue(form?.goals_against)
}

function numberValue(value) {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}
