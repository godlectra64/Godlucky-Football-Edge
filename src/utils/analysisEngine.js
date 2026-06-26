import {
  calculateDataIntelligence,
  calculateDataIntelligenceModifier,
  getDataIntelligenceRankingAdjustment,
  normalizeDataIntelligence,
} from './dataIntelligence.js'

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
  { key: 'team_strength_score', breakdownKey: 'team_strength', label: 'Team Strength', weight: 0.18, max: 100 },
  { key: 'form_score', breakdownKey: 'recent_form', label: 'Recent Form', weight: 0.17, max: 100 },
  { key: 'goal_scoring_score', legacyKey: 'goal_quality_score', breakdownKey: 'attack_quality', label: 'Attack Quality', weight: 0.15, max: 100 },
  { key: 'defensive_stability_score', breakdownKey: 'defensive_stability', label: 'Defensive Stability', weight: 0.15, max: 100 },
  { key: 'home_advantage_score', legacyKey: 'home_away_score', breakdownKey: 'home_away_advantage', label: 'Home/Away Advantage', weight: 0.12, max: 100 },
  { key: 'motivation_score', breakdownKey: 'motivation_context', label: 'Motivation & Context', weight: 0.1, max: 100 },
  { key: 'market_risk_score', legacyKey: 'risk_score', breakdownKey: 'market_odds_risk', label: 'Market & Odds Risk', weight: 0.13, max: 100 },
]

export const analysisModuleLabels = Object.fromEntries(footballMasterModules.map((module) => [module.key, module.label]))

export function calculateFootballMasterAnalysis(match) {
  const analysis = match.analysis ?? match.match_analysis ?? match
  const storedBreakdown = analysis.raw?.analysis_breakdown
  const moduleBreakdown = storedBreakdown ? getStoredModuleBreakdown(storedBreakdown) : buildModuleBreakdown(match)
  const modules = footballMasterModules.map((module) => ({
    ...module,
    score: moduleBreakdown[module.breakdownKey].score,
    reason: moduleBreakdown[module.breakdownKey].reason,
  }))
  const baseConfidence = Math.round(clamp(modules.reduce((total, module) => total + module.score * module.weight, 0), 0, 100))
  const dataCompleteness = getDataCompleteness(match)
  const footballIntelligence = storedBreakdown?.football_intelligence ?? calculateFootballIntelligence(match, {
    moduleBreakdown,
    dataCompleteness,
  })
  const footballModifier = getStoredOrCalculatedModifier(storedBreakdown, footballIntelligence, baseConfidence)
  const calculatedDataIntelligence = calculateDataIntelligence(match, {
    baseConfidence,
    footballModifier,
  })
  const dataIntelligence = normalizeDataIntelligence(storedBreakdown?.data_intelligence ?? calculatedDataIntelligence, match, {
    baseConfidence,
    footballModifier,
  })
  const dataIntelligenceModifier = storedBreakdown?.data_intelligence?.modifier ?? calculateDataIntelligenceModifier(dataIntelligence, baseConfidence, footballModifier)
  const intelligenceModifier = getCombinedIntelligenceModifier(baseConfidence, footballModifier, dataIntelligenceModifier)
  const confidence = Math.round(clamp(baseConfidence + intelligenceModifier, 0, 100))
  const storedV3Risk = storedBreakdown?.football_intelligence ? storedBreakdown?.overall_risk : null
  const overallRisk = calculateOverallRisk(moduleBreakdown, confidence, dataCompleteness, footballIntelligence)
  const riskLevel = normalizeRiskLevel(storedV3Risk?.level ?? overallRisk.level)
  const recommendation = getRecommendationFromConfidence(confidence, riskLevel)
  const normalizedIntelligence = normalizeFootballIntelligence(footballIntelligence, footballModifier)
  const normalizedDataIntelligence = {
    ...dataIntelligence,
    modifier: Math.round(clamp(dataIntelligenceModifier, -10, 10)),
  }
  const analysisBreakdown = {
    ...moduleBreakdown,
    football_intelligence: normalizedIntelligence,
    data_intelligence: normalizedDataIntelligence,
    overall_risk: {
      level: riskLevel,
      reason: storedV3Risk?.reason ?? overallRisk.reason,
    },
  }

  return {
    framework: 'football-intelligence-v3',
    modules,
    baseConfidence,
    confidence,
    intelligenceModifier,
    footballModifier,
    dataIntelligenceModifier: normalizedDataIntelligence.modifier,
    riskLevel,
    recommendation,
    analysisSummary: buildAnalysisSummary(match, modules, baseConfidence, confidence, riskLevel, recommendation, analysisBreakdown),
    analysisBreakdown,
    footballIntelligence: normalizedIntelligence,
    dataIntelligence: normalizedDataIntelligence,
    dataCompleteness,
  }
}

export function calculateAnalysisScore(match) {
  return calculateFootballMasterAnalysis(match).confidence
}

export function getRiskLevel(match) {
  const analysis = match.analysis ?? match.match_analysis ?? match
  const stored = String(analysis.risk_level ?? analysis.raw?.analysis_breakdown?.overall_risk?.level ?? '').toLowerCase()

  if (['football-master-v2', 'football-intelligence-v3'].includes(analysis.raw?.framework) && ['low', 'medium', 'high'].includes(stored)) return stored
  return calculateFootballMasterAnalysis(match).riskLevel
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

  if (['football-master-v2', 'football-intelligence-v3'].includes(analysis.raw?.framework) && storedConfidence > 0) {
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
    reason: module.reason,
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
    Boolean(match.league?.name ?? match.competition?.name),
    Boolean(match.homeTeam?.name),
    Boolean(match.awayTeam?.name),
    Boolean(match.homeForm ?? analysis.raw?.homeForm),
    Boolean(match.awayForm ?? analysis.raw?.awayForm),
    hasRecentForm(match.homeForm ?? analysis.raw?.homeForm),
    hasRecentForm(match.awayForm ?? analysis.raw?.awayForm),
    Boolean((match.standings ?? analysis.raw?.standings ?? []).length),
  ]

  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}

export function getTopMatches(matches, limit = 10) {
  return rankTopMatches(matches, limit)
}

export function enrichMatch(match) {
  const master = calculateFootballMasterAnalysis(match)
  const ranking = buildRankingProfile(match, master)

  return {
    ...match,
    confidence: master.confidence,
    baseConfidence: master.baseConfidence,
    intelligenceModifier: master.intelligenceModifier,
    recommendation: master.recommendation,
    riskLevel: master.riskLevel,
    totalAnalysisScore: master.confidence,
    dataCompleteness: master.dataCompleteness,
    analysisSummary: master.analysisSummary,
    analysisBreakdown: master.analysisBreakdown,
    rankingScore: ranking.rankingScore,
    ranking_score: ranking.rankingScore,
    rankReason: ranking.rankReason,
    rank_reason: ranking.rankReason,
    rankBadges: ranking.rankBadges,
    rank_badges: ranking.rankBadges,
  }
}

export function compareForTopMatches(a, b) {
  const scoreA = a.rankingScore ?? a.ranking_score ?? calculateRankingScore(a)
  const scoreB = b.rankingScore ?? b.ranking_score ?? calculateRankingScore(b)
  const rankingDiff = scoreB - scoreA
  const confidenceDiff = getConfidence(b) - getConfidence(a)
  const kickoffA = new Date(a.kickoffAt ?? a.kickoff_at ?? 0).getTime()
  const kickoffB = new Date(b.kickoffAt ?? b.kickoff_at ?? 0).getTime()

  return rankingDiff || confidenceDiff || kickoffA - kickoffB
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

export function rankTopMatches(matchesWithAnalysis, limit = 10) {
  return [...(matchesWithAnalysis ?? [])]
    .map((match) => enrichMatch(match))
    .sort(compareForTopMatches)
    .slice(0, Math.max(0, limit))
    .map((match, index) => ({
      ...match,
      rank: index + 1,
    }))
}

export function calculateRankingScore(match) {
  return buildRankingProfile(match).rankingScore
}

export function getRiskPenalty(riskLevel = riskLabels.medium) {
  const normalized = normalizeRiskLevel(riskLevel)
  if (normalized === riskLabels.high) return 16
  if (normalized === riskLabels.medium) return 4
  return 0
}

export function getRecommendationBonus(recommendation = recommendationLabels.noBet) {
  if (recommendation === recommendationLabels.bet) return 7
  if (recommendation === recommendationLabels.lean) return 3
  return 0
}

export function getDataCompletenessScore(match) {
  const stored = numberValue(match?.dataCompleteness ?? match?.data_completeness ?? match?.analysis?.raw?.data_completeness)
  return Math.round(clamp(stored || getDataCompleteness(match ?? {}), 0, 100))
}

export function getModuleConsistencyScore(analysisBreakdown = {}) {
  const scores = getBreakdownScores(analysisBreakdown)
  if (!scores.length) return 58

  const spread = Math.max(...scores) - Math.min(...scores)
  const average = scores.reduce((total, score) => total + score, 0) / scores.length
  const weakCount = scores.filter((score) => score < 45).length

  return Math.round(clamp(100 - spread * 1.35 - weakCount * 7 + (average >= 68 ? 4 : 0), 30, 100))
}

export function generateRankReason(match) {
  return buildRankingProfile(match).rankReason
}

export function generateRankBadges(match) {
  return buildRankingProfile(match).rankBadges
}

function buildRankingProfile(match, precomputedMaster = null) {
  const master = precomputedMaster ?? calculateFootballMasterAnalysis(match ?? {})
  const breakdown = master.analysisBreakdown ?? match?.analysis?.raw?.analysis_breakdown ?? {}
  const intelligence = breakdown.football_intelligence ?? {}
  const dataIntelligence = breakdown.data_intelligence ?? {}
  const confidence = numberValue(match?.confidence ?? match?.confidence_score ?? master.confidence)
  const riskLevel = normalizeRiskLevel(match?.riskLevel ?? match?.risk_level ?? master.riskLevel)
  const recommendation = getRecommendationFromConfidence(confidence, riskLevel)
  const dataCompleteness = getDataCompletenessScore({ ...(match ?? {}), dataCompleteness: master.dataCompleteness })
  const consistencyScore = getModuleConsistencyScore(breakdown)
  const marketScore = numberValue(breakdown.market_odds_risk?.score ?? match?.analysis?.market_risk_score ?? 60)
  const recommendationBonus = getRecommendationBonus(recommendation)
  const riskPenalty = getRiskPenalty(riskLevel)
  const dataAdjustment = clamp((dataCompleteness - 55) * 0.1, -5, 5)
  const consistencyAdjustment = clamp((consistencyScore - 70) * 0.1, -6, 4)
  const marketAdjustment = clamp((marketScore - 60) * 0.08, -5, 4)
  const intelligenceAdjustment = getIntelligenceRankingAdjustment(intelligence)
  const dataIntelligenceAdjustment = getDataIntelligenceRankingAdjustment(dataIntelligence)
  const importanceAdjustment = getMatchImportanceRankingAdjustment(intelligence.match_importance)
  const rankingScore = Math.round(clamp(
    confidence +
      recommendationBonus -
      riskPenalty +
      dataAdjustment +
      consistencyAdjustment +
      marketAdjustment +
      intelligenceAdjustment +
      dataIntelligenceAdjustment +
      importanceAdjustment,
    0,
    100,
  ))
  const rankBadges = generateRankBadgesFromProfile({
    rankingScore,
    recommendation,
    riskLevel,
    dataCompleteness,
    consistencyScore,
    marketScore,
    intelligence,
    dataIntelligence,
  })
  const rankReason = generateRankReasonFromProfile({
    rankingScore,
    confidence,
    recommendation,
    riskLevel,
    dataCompleteness,
    consistencyScore,
    marketScore,
    intelligence,
    dataIntelligence,
    rankBadges,
  })

  return {
    rankingScore,
    rankReason,
    rankBadges,
    rankingInputs: {
      confidence,
      recommendationBonus,
      riskPenalty,
      dataCompleteness,
      consistencyScore,
      marketScore,
      intelligenceAdjustment,
      dataIntelligenceAdjustment,
      importanceAdjustment,
    },
  }
}

function getIntelligenceRankingAdjustment(intelligence = {}) {
  const momentum = intelligence.momentum?.momentum
  const dataConfidence = intelligence.ai_explanation?.data_confidence
  const leagueType = intelligence.league_context?.type
  const h2hConfidence = intelligence.h2h?.confidence
  const squadConfidence = intelligence.squad_context?.confidence
  const signals = intelligence.signals ?? intelligence.ai_explanation?.signals ?? []
  let adjustment = 0

  if (momentum === 'positive') adjustment += 2
  if (momentum === 'negative') adjustment -= 2
  if (dataConfidence === 'high') adjustment += 2
  else if (dataConfidence === 'medium') adjustment += 1
  else if (dataConfidence === 'low') adjustment -= 1
  if (leagueType === 'league') adjustment += 1
  if (leagueType === 'friendly') adjustment -= 3
  if (['medium', 'high'].includes(h2hConfidence)) adjustment += 1
  if (squadConfidence === 'low') adjustment -= 1
  if (signals.includes('clean_sheet_support')) adjustment += 1
  if (signals.includes('conceding_trend_risky')) adjustment -= 1

  return clamp(adjustment, -6, 6)
}

function getMatchImportanceRankingAdjustment(matchImportance = {}) {
  const importance = matchImportance.importance
  const riskModifier = numberValue(matchImportance.risk_modifier)

  if (importance === 'high') return clamp(2 - riskModifier, -2, 2)
  if (importance === 'low') return -2
  if (importance === 'medium') return 1
  return 0
}

function generateRankBadgesFromProfile(profile) {
  const badges = []

  if (profile.recommendation === recommendationLabels.bet) badges.push('คู่เด่น')
  if (profile.riskLevel === riskLabels.low) badges.push('ความเสี่ยงต่ำ')
  if (profile.intelligence?.momentum?.momentum === 'positive') badges.push('โมเมนตัมดี')
  if (profile.dataCompleteness < 65 || profile.intelligence?.ai_explanation?.data_confidence === 'low') badges.push('ข้อมูลจำกัด')
  if (profile.riskLevel === riskLabels.high || profile.marketScore < 52) badges.push('ตลาดเสี่ยง')
  if (profile.recommendation === recommendationLabels.lean || (profile.rankingScore >= 62 && profile.riskLevel !== riskLabels.high)) badges.push('เหมาะติดตาม')
  if (profile.consistencyScore >= 78) badges.push('สัญญาณสอดคล้อง')

  if (profile.dataIntelligence?.data_confidence?.level === 'high') badges.push('Data intel')

  return [...new Set(badges)].slice(0, 4)
}

function generateRankReasonFromProfile(profile) {
  const supportParts = []
  const cautionParts = []

  if (profile.confidence >= 75) supportParts.push('คะแนนความมั่นใจสูง')
  else if (profile.confidence >= 62) supportParts.push('คะแนนความมั่นใจอยู่ในโซนติดตาม')
  else supportParts.push('คะแนนยังไม่ถึงโซนเล่นจริง')

  if (profile.intelligence?.momentum?.momentum === 'positive') supportParts.push('โมเมนตัมสนับสนุน')
  if (profile.consistencyScore >= 78) supportParts.push('โมดูลหลักไปทางเดียวกัน')
  if (profile.dataCompleteness >= 75) supportParts.push('ข้อมูลค่อนข้างครบ')
  if (profile.riskLevel === riskLabels.low) supportParts.push('ความเสี่ยงต่ำ')

  if (profile.riskLevel === riskLabels.medium) cautionParts.push('ยังมีความเสี่ยงระดับกลาง')
  if (profile.riskLevel === riskLabels.high) cautionParts.push('ถูกลดอันดับเพราะความเสี่ยงสูง')
  if (profile.dataCompleteness < 65) cautionParts.push('ข้อมูลยังจำกัด')
  if (profile.marketScore < 55) cautionParts.push('ตลาดยังเสี่ยง')
  if (profile.consistencyScore < 58) cautionParts.push('คะแนนโมดูลขัดแย้งกัน')

  if (profile.dataIntelligence?.recent_form?.trend === 'positive') supportParts.push('ฟอร์มล่าสุดหนุน')
  if (profile.dataIntelligence?.data_confidence?.level === 'high') supportParts.push('data intelligence ครบ')
  if (profile.dataIntelligence?.data_confidence?.level === 'low') cautionParts.push('data intelligence ยังจำกัด')

  const support = supportParts.slice(0, 2).join(' และ ')
  const caution = cautionParts.length ? ` แต่${cautionParts.slice(0, 2).join(' และ')}` : ''

  if (profile.recommendation === recommendationLabels.bet) {
    return `ติดอันดับเพราะ${support}${caution} จึงเหมาะเป็นคู่ BET`
  }
  if (profile.recommendation === recommendationLabels.lean) {
    return `ติดอันดับเพราะ${support}${caution} จึงเหมาะติดตามต่อ`
  }
  return `ติดอันดับเพราะ${support}${caution} แต่ยังควรข้ามก่อน`
}

function getBreakdownScores(analysisBreakdown) {
  return footballMasterModules
    .map((module) => numberValue(analysisBreakdown?.[module.breakdownKey]?.score))
    .filter((score) => score > 0)
}

export function calculateFootballIntelligence(match, context = {}) {
  const h2h = calculateH2HIntelligence(match, context)
  const leagueContext = calculateLeagueContext(match)
  const restDays = calculateRestDays(match, getContextValue(match, context, 'recentMatches'))
  const scheduleDifficulty = calculateScheduleDifficulty(match, getContextValue(match, context, 'recentOpponents'))
  const squadContext = calculateSquadContext(match, getContextValue(match, context, 'squadData'))
  const momentum = calculateMomentum(match, getContextValue(match, context, 'formData'))
  const matchImportance = calculateMatchImportance(match)
  const intelligence = {
    h2h,
    league_context: leagueContext,
    rest_days: restDays,
    schedule_difficulty: scheduleDifficulty,
    squad_context: squadContext,
    momentum,
    match_importance: matchImportance,
  }
  const modifier = calculateIntelligenceModifier(intelligence, context.baseConfidence)
  const signals = collectIntelligenceSignals(intelligence)

  return {
    ...intelligence,
    ai_explanation: {
      summary: buildFootballIntelligenceExplanation(intelligence, modifier),
      signals,
      data_confidence: getIntelligenceDataConfidence(intelligence),
    },
    modifier,
    signals,
  }
}

export function calculateH2HIntelligence(match, context = {}) {
  const h2hMatches = getH2HMatches(match, context)
  if (!h2hMatches.length) {
    return {
      score: 58,
      confidence: 'low',
      reason: 'ยังไม่มีข้อมูล H2H เพียงพอ',
      signals: ['missing_h2h'],
    }
  }

  const latest10 = h2hMatches.slice(0, 10)
  const latest5 = latest10.slice(0, 5)
  const homeId = getTeamId(match.homeTeam)
  const awayId = getTeamId(match.awayTeam)
  const samples = summarizeH2H(latest10, homeId, awayId)
  const homeAwaySamples = latest10.filter((item) => getTeamId(item.homeTeam) === homeId && getTeamId(item.awayTeam) === awayId)
  const goalsAverage = samples.played ? (samples.goals / samples.played).toFixed(2) : null
  const score = clamp(56 + (samples.homeWins - samples.awayWins) * 3 + Math.min(latest5.length, 5), 45, 76)
  const confidence = latest10.length >= 8 ? 'high' : latest10.length >= 4 ? 'medium' : 'low'
  const signals = [
    `h2h_${latest5.length}_of_5_available`,
    `h2h_${latest10.length}_of_10_available`,
    homeAwaySamples.length ? `home_away_history_${homeAwaySamples.length}` : 'home_away_history_limited',
  ]
  if (goalsAverage) signals.push(`h2h_goals_avg_${goalsAverage}`)

  return {
    score: Math.round(score),
    confidence,
    reason: `H2H มีข้อมูลจริง ${latest10.length} นัดล่าสุด เจ้าบ้านชนะ ${samples.homeWins} เสมอ ${samples.draws} ทีมเยือนชนะ ${samples.awayWins}${goalsAverage ? ` ค่าเฉลี่ยประตู ${goalsAverage}` : ''}`,
    signals,
  }
}

export function calculateLeagueContext(match) {
  const name = getCompetitionText(match)
  const type = classifyCompetition(name)
  const byType = {
    league: { score: 62, risk_modifier: -1, reason: 'รายการลีกมีบริบทต่อเนื่องและประเมินเสถียรกว่า' },
    cup: { score: 58, risk_modifier: 2, reason: 'รายการถ้วยมีแรงจูงใจสูง แต่ความผันผวนมากขึ้น' },
    friendly: { score: 52, risk_modifier: 3, reason: 'เกมกระชับมิตรมีความเสี่ยงจากการทดลองทีมและแรงจูงใจต่ำกว่า' },
    international: { score: 57, risk_modifier: 1, reason: 'เกมทีมชาติมีบริบทเฉพาะและข้อมูลสโมสรใช้ได้จำกัด' },
    youth: { score: 53, risk_modifier: 2, reason: 'รายการเยาวชนมีความนิ่งของข้อมูลต่ำกว่ารายการหลัก' },
    women: { score: 54, risk_modifier: 2, reason: 'รายการหญิงอาจมี coverage ข้อมูลน้อยกว่ารายการหลัก' },
    unknown: { score: 58, risk_modifier: 0, reason: 'ยังจำแนกประเภทการแข่งขันไม่ได้ชัด จึงให้ค่ากลาง' },
  }

  return {
    type,
    ...byType[type],
  }
}

export function calculateRestDays(match, recentMatches) {
  const homeRecent = getTeamRecentMatches(recentMatches, 'home')
  const awayRecent = getTeamRecentMatches(recentMatches, 'away')
  const homeRestDays = getRestDays(match, homeRecent)
  const awayRestDays = getRestDays(match, awayRecent)

  if (homeRestDays === null && awayRestDays === null) {
    return {
      home_rest_days: null,
      away_rest_days: null,
      score: 58,
      advantage: 'none',
      reason: 'ยังไม่มีข้อมูลวันพักทีมล่าสุด',
    }
  }

  const homeScore = scoreRestDays(homeRestDays)
  const awayScore = scoreRestDays(awayRestDays)
  const diff = (homeRestDays ?? 0) - (awayRestDays ?? 0)
  const advantage = Math.abs(diff) >= 2 ? (diff > 0 ? 'home' : 'away') : 'none'
  const score = Math.round(clamp(58 + homeScore - awayScore, 45, 72))

  return {
    home_rest_days: homeRestDays,
    away_rest_days: awayRestDays,
    score,
    advantage,
    reason: `วันพักล่าสุด เจ้าบ้าน ${formatRestDays(homeRestDays)} ทีมเยือน ${formatRestDays(awayRestDays)} ภาพรวมได้เปรียบ: ${advantage}`,
  }
}

export function calculateScheduleDifficulty(match, recentOpponents) {
  const opponents = flattenRecentOpponents(recentOpponents)
  const rated = opponents.map(getOpponentDifficulty).filter((value) => value !== null)

  if (!rated.length) {
    return {
      score: 58,
      difficulty: 'unknown',
      reason: 'ยังไม่มีข้อมูลคุณภาพคู่แข่ง 3-5 นัดล่าสุดเพียงพอ',
      confidence: 'low',
    }
  }

  const average = rated.reduce((total, value) => total + value, 0) / rated.length
  const difficulty = average >= 68 ? 'hard' : average <= 42 ? 'easy' : 'medium'
  const score = difficulty === 'hard' ? 54 : difficulty === 'easy' ? 62 : 58
  const confidence = rated.length >= 6 ? 'high' : rated.length >= 3 ? 'medium' : 'low'

  return {
    score,
    difficulty,
    reason: `ประเมินความยากคู่แข่งล่าสุดจากข้อมูลจริง ${rated.length} รายการ ระดับ ${difficulty}`,
    confidence,
  }
}

export function calculateSquadContext(match, squadData) {
  const data = squadData ?? match.raw?.squadData ?? match.analysis?.raw?.squadData
  if (!data || (Array.isArray(data) && !data.length)) {
    return {
      score: 58,
      confidence: 'low',
      reason: 'ยังไม่มีข้อมูลตัวผู้เล่น/อาการบาดเจ็บเพียงพอ',
      signals: ['missing_squad_data'],
    }
  }

  const injuries = countItems(data.injuries ?? data.injury)
  const suspensions = countItems(data.suspensions ?? data.suspension)
  const missingKeyPlayers = countItems(data.missing_key_players ?? data.missingKeyPlayers)
  const rotationRisk = Boolean(data.rotation || data.rotation_risk)
  const penalty = injuries * 1.5 + suspensions * 2 + missingKeyPlayers * 3 + (rotationRisk ? 3 : 0)
  const signals = []
  if (injuries) signals.push(`injuries_${injuries}`)
  if (suspensions) signals.push(`suspensions_${suspensions}`)
  if (missingKeyPlayers) signals.push(`missing_key_players_${missingKeyPlayers}`)
  if (rotationRisk) signals.push('rotation_risk')

  return {
    score: Math.round(clamp(62 - penalty, 35, 68)),
    confidence: signals.length ? 'medium' : 'low',
    reason: signals.length ? 'มีข้อมูล squad จริงบางส่วนและนำมาหักความเสี่ยงตามผลกระทบ' : 'มีข้อมูล squad แต่ยังไม่พบสัญญาณผู้เล่นสำคัญชัดเจน',
    signals,
  }
}

export function calculateMomentum(match, formData) {
  const homeForm = formData?.home ?? match.homeForm ?? match.analysis?.raw?.homeForm
  const awayForm = formData?.away ?? match.awayForm ?? match.analysis?.raw?.awayForm
  const played = numberValue(homeForm?.played) + numberValue(awayForm?.played)

  if (!played) {
    return {
      score: 56,
      momentum: 'unknown',
      signals: ['missing_detailed_form'],
      reason: 'ยังไม่มีข้อมูลโมเมนตัมละเอียด จึงไม่เดาเพิ่มจากข้อมูลที่ไม่มี',
    }
  }

  const pointsRate = ((formPoints(homeForm) + formPoints(awayForm)) / Math.max(played * 3, 1)) * 100
  const goalsPerMatch = (numberValue(homeForm?.goals_for) + numberValue(awayForm?.goals_for)) / Math.max(played, 1)
  const concededPerMatch = (numberValue(homeForm?.goals_against) + numberValue(awayForm?.goals_against)) / Math.max(played, 1)
  const cleanSheets = numberValue(homeForm?.clean_sheets) + numberValue(awayForm?.clean_sheets)
  const signals = []
  if (goalsPerMatch >= 1.5) signals.push('scoring_trend_positive')
  if (concededPerMatch >= 1.7) signals.push('conceding_trend_risky')
  if (cleanSheets >= 3) signals.push('clean_sheet_support')
  const score = Math.round(clamp(44 + pointsRate * 0.35 + goalsPerMatch * 6 - concededPerMatch * 4 + cleanSheets * 1.5, 35, 78))
  const momentum = score >= 63 ? 'positive' : score <= 49 ? 'negative' : 'neutral'

  return {
    score,
    momentum,
    signals: signals.length ? signals : ['form_proxy_used'],
    reason: 'ใช้ข้อมูล goals/form จาก v2 เป็น proxy โดยไม่เดาสถิติที่ยังไม่มี',
  }
}

export function calculateMatchImportance(match) {
  const text = `${getCompetitionText(match)} ${match.round ?? ''} ${match.raw?.stage ?? ''} ${match.raw?.group ?? ''}`.toLowerCase()
  const leagueContext = calculateLeagueContext(match)
  const knockout = ['final', 'semi', 'quarter', 'last 16', 'last_16', 'playoff', 'knockout'].some((item) => text.includes(item))

  if (leagueContext.type === 'friendly') {
    return {
      score: 50,
      importance: 'low',
      risk_modifier: 2,
      reason: 'Friendly มีความสำคัญเชิงผลการแข่งขันต่ำกว่า',
    }
  }
  if (knockout) {
    return {
      score: 64,
      importance: 'high',
      risk_modifier: 2,
      reason: 'รอบน็อกเอาต์/รอบลึกมีความสำคัญสูง แต่ variance สูงขึ้น',
    }
  }
  if (leagueContext.type === 'league') {
    return {
      score: 59,
      importance: 'medium',
      risk_modifier: -1,
      reason: 'เกมลีกปกติมีแรงจูงใจและรูปแบบค่อนข้างเสถียร',
    }
  }

  return {
    score: 58,
    importance: leagueContext.type === 'unknown' ? 'unknown' : 'medium',
    risk_modifier: leagueContext.risk_modifier > 0 ? 1 : 0,
    reason: 'ยังไม่มี league table context เพียงพอ จึงไม่สรุป must-win เอง',
  }
}

function buildModuleBreakdown(match) {
  const analysis = match.analysis ?? match.match_analysis ?? match
  const homeForm = match.homeForm ?? analysis.raw?.homeForm
  const awayForm = match.awayForm ?? analysis.raw?.awayForm
  const standings = match.standings ?? analysis.raw?.standings ?? []
  const leaguePriority = numberValue(match.league?.priority ?? analysis.raw?.leaguePriority ?? 50)
  const homeStanding = findStanding(standings, match.homeTeam?.api_team_id ?? match.homeTeam?.id)
  const awayStanding = findStanding(standings, match.awayTeam?.api_team_id ?? match.awayTeam?.id)

  return {
    team_strength: scoreTeamStrength(match, homeForm, awayForm, homeStanding, awayStanding),
    recent_form: scoreRecentForm(homeForm, awayForm),
    attack_quality: scoreAttackQuality(homeForm, awayForm, homeStanding, awayStanding),
    defensive_stability: scoreDefensiveStability(homeForm, awayForm),
    home_away_advantage: scoreHomeAwayAdvantage(match, homeForm),
    motivation_context: scoreMotivationContext(match, leaguePriority),
    market_odds_risk: scoreMarketOddsRisk(match, homeForm, awayForm),
  }
}

function getStoredModuleBreakdown(breakdown) {
  return Object.fromEntries(
    footballMasterModules.map((module) => {
      const item = breakdown[module.breakdownKey] ?? {}
      return [module.breakdownKey, { score: Math.round(clamp(numberValue(item.score), 0, 100)), reason: String(item.reason ?? '') }]
    }),
  )
}

function scoreTeamStrength(match, homeForm, awayForm, homeStanding, awayStanding) {
  if (homeStanding && awayStanding) {
    const standingGap = numberValue(awayStanding.position) - numberValue(homeStanding.position)
    const pointsGap = numberValue(homeStanding.points) - numberValue(awayStanding.points)
    const goalDiffGap = numberValue(homeStanding.goalDifference) - numberValue(awayStanding.goalDifference)
    const score = clamp(58 + standingGap * 2 + pointsGap * 0.7 + goalDiffGap * 0.8, 28, 90)
    return moduleResult(score, standingGap >= 0 ? 'อันดับและแต้มโดยรวมหนุนฝั่งเจ้าบ้านมากกว่า' : 'อันดับตารางไม่ได้หนุนฝั่งเจ้าบ้านชัดเจน')
  }

  const formGap = formPoints(homeForm) - formPoints(awayForm)
  const goalDiffGap = formGoalDiff(homeForm) - formGoalDiff(awayForm)
  const nameSignal = (match.homeTeam?.name ? 3 : 0) + (match.awayTeam?.name ? 2 : 0)
  const score = clamp(55 + formGap * 1.4 + goalDiffGap * 1.8 + nameSignal, 35, 78)
  return moduleResult(score, 'ไม่มีตารางคะแนนครบ จึงใช้ฟอร์มและข้อมูลทีมที่มีเป็น proxy')
}

function scoreRecentForm(homeForm, awayForm) {
  const played = numberValue(homeForm?.played) + numberValue(awayForm?.played)
  if (!played) return moduleResult(56, 'ข้อมูลฟอร์มล่าสุดจำกัด จึงประเมินแบบกลาง')

  const pointsRate = ((formPoints(homeForm) + formPoints(awayForm)) / Math.max(played * 3, 1)) * 100
  const goalBalance = clamp((formGoalDiff(homeForm) + formGoalDiff(awayForm)) * 2.5, -18, 18)
  const score = clamp(42 + pointsRate * 0.38 + goalBalance, 25, 86)
  return moduleResult(score, played >= 8 ? 'ฟอร์ม 5 นัดล่าสุดมีข้อมูลรองรับเพียงพอ' : 'มีข้อมูลฟอร์มบางส่วน แต่ยังไม่เต็มหน้าต่าง 5 นัด')
}

function scoreAttackQuality(homeForm, awayForm, homeStanding, awayStanding) {
  const goalsFor = numberValue(homeForm?.goals_for) + numberValue(awayForm?.goals_for)
  const played = numberValue(homeForm?.played) + numberValue(awayForm?.played)
  const standingBoost = homeStanding || awayStanding ? clamp((numberValue(homeStanding?.goalsFor) + numberValue(awayStanding?.goalsFor)) * 0.25, 0, 12) : 0

  if (!played && !standingBoost) return moduleResult(57, 'ยังไม่มี xG หรือสถิติเกมรุกละเอียด จึงใช้ค่ากลางแบบระมัดระวัง')

  const goalsPerMatch = goalsFor / Math.max(played, 1)
  const score = clamp(48 + goalsPerMatch * 18 + standingBoost, 30, 88)
  return moduleResult(score, goalsPerMatch >= 1.4 ? 'เกมรุกมีแนวโน้มสร้างประตูได้ดีจากข้อมูลล่าสุด' : 'เกมรุกยังไม่ได้เด่นชัดจากข้อมูลประตูที่มี')
}

function scoreDefensiveStability(homeForm, awayForm) {
  const goalsAgainst = numberValue(homeForm?.goals_against) + numberValue(awayForm?.goals_against)
  const cleanSheets = numberValue(homeForm?.clean_sheets) + numberValue(awayForm?.clean_sheets)
  const played = numberValue(homeForm?.played) + numberValue(awayForm?.played)
  if (!played) return moduleResult(58, 'ข้อมูลเกมรับจำกัด จึงประเมินระดับกลาง')

  const concededPerMatch = goalsAgainst / Math.max(played, 1)
  const score = clamp(74 - concededPerMatch * 22 + cleanSheets * 4, 25, 90)
  return moduleResult(score, concededPerMatch <= 1 ? 'เกมรับค่อนข้างมั่นคงจากอัตราเสียประตู' : 'เกมรับยังมีความเสี่ยงจากอัตราเสียประตู')
}

function scoreHomeAwayAdvantage(match, homeForm) {
  const venueText = String(match.venue ?? match.raw?.venue ?? '').toLowerCase()
  const neutral = venueText.includes('neutral')
  if (neutral) return moduleResult(52, 'สนามเป็นกลางหรือมีสัญญาณว่าเจ้าบ้านไม่ได้เปรียบเต็มที่')

  const played = numberValue(homeForm?.played)
  const homeWinRate = played ? numberValue(homeForm?.wins) / played : 0.4
  const score = clamp(57 + homeWinRate * 22 + Math.max(formGoalDiff(homeForm), 0) * 1.3, 48, 78)
  return moduleResult(score, played ? 'เจ้าบ้านมีแรงหนุนจากสภาพการแข่งขันและฟอร์มฝั่งเหย้า' : 'ไม่มีข้อมูลสนามละเอียด จึงให้น้ำหนักเจ้าบ้านแบบจำกัด')
}

function scoreMotivationContext(match, leaguePriority) {
  const raw = match.raw ?? {}
  const stage = String(raw.stage ?? raw.group ?? match.round ?? '').toLowerCase()
  const knockoutBoost = ['final', 'semi', 'quarter', 'last_16', 'playoff'].some((item) => stage.includes(item)) ? 8 : 0
  const priorityScore = leaguePriority <= 15 ? 65 : leaguePriority <= 30 ? 61 : leaguePriority <= 50 ? 58 : 55
  const score = clamp(priorityScore + knockoutBoost, 52, 78)
  return moduleResult(score, knockoutBoost ? 'รายการหรือรอบการแข่งขันเพิ่มแรงจูงใจเชิงบริบท' : 'ข้อมูลแรงจูงใจยังจำกัด จึงใช้คะแนนกลางตามความสำคัญรายการ')
}

function scoreMarketOddsRisk(match, homeForm, awayForm) {
  const raw = match.raw ?? {}
  const hasOdds = Boolean(raw.odds || raw.market || raw.bookmakers)
  if (!hasOdds) return moduleResult(60, 'ยังไม่มีข้อมูลราคาเพียงพอ จึงประเมินแบบกลางและไม่ยกระดับเป็น high risk อัตโนมัติ')

  const formGap = Math.abs(formPoints(homeForm) - formPoints(awayForm))
  const score = clamp(58 + Math.min(formGap, 8) * 2.2, 42, 82)
  return moduleResult(score, 'มีข้อมูลตลาดบางส่วนและใช้ร่วมกับความต่างของฟอร์มเพื่อประเมินความเสี่ยง')
}

function calculateOverallRisk(breakdown, confidence, dataCompleteness, intelligence) {
  const scores = footballMasterModules.map((module) => breakdown[module.breakdownKey].score)
  const spread = Math.max(...scores) - Math.min(...scores)
  const weakCore = ['team_strength', 'recent_form', 'attack_quality', 'defensive_stability'].filter((key) => breakdown[key].score < 45).length
  const marketRiskWeak = breakdown.market_odds_risk.score < 45
  const leagueType = intelligence?.league_context?.type
  const dataConfidence = intelligence?.ai_explanation?.data_confidence ?? getIntelligenceDataConfidence(intelligence)
  const totalRiskModifier = numberValue(intelligence?.league_context?.risk_modifier) + numberValue(intelligence?.match_importance?.risk_modifier)
  const lowConfidenceSignals = [intelligence?.h2h, intelligence?.schedule_difficulty, intelligence?.squad_context].filter((item) => item?.confidence === 'low').length

  if (
    confidence < 48 ||
    weakCore >= 2 ||
    spread >= 42 ||
    marketRiskWeak ||
    (leagueType === 'friendly' && dataConfidence === 'low') ||
    (totalRiskModifier >= 4 && confidence < 68)
  ) {
    return { level: riskLabels.high, reason: 'คะแนนสำคัญอ่อน/ขัดแย้ง หรือบริบทการแข่งขันมี variance สูง จึงจัดเป็นความเสี่ยงสูง' }
  }
  if (confidence >= 72 && dataCompleteness >= 70 && spread <= 28 && totalRiskModifier <= 1 && lowConfidenceSignals <= 1) {
    return { level: riskLabels.low, reason: 'หลายโมดูลให้ภาพสอดคล้องกัน ข้อมูลรองรับค่อนข้างครบ และ risk modifier ต่ำ' }
  }
  return { level: riskLabels.medium, reason: 'ข้อมูลยังไม่ครบทุกมิติ แต่ไม่มีสัญญาณอันตรายชัด จึงคงความเสี่ยงระดับกลาง' }
}

function buildAnalysisSummary(match, modules, baseConfidence, confidence, riskLevel, recommendation, breakdown) {
  const home = match.homeTeam?.name ?? 'ทีมเหย้า'
  const away = match.awayTeam?.name ?? 'ทีมเยือน'
  const bestModule = [...modules].sort((a, b) => b.score - a.score)[0]
  const weakestModule = [...modules].sort((a, b) => a.score - b.score)[0]
  const intelligence = breakdown.football_intelligence
  const contextText = buildContextSummary(intelligence)
  const riskReason = breakdown.overall_risk.reason
  const modifierText = `base ${baseConfidence}/100, v3 ${formatSigned(intelligence.modifier)}, final ${confidence}/100`

  if (recommendation === recommendationLabels.bet) {
    return `${home} พบ ${away}: ระบบให้เป็น BET เพราะคะแนนสุดท้าย ${confidence}/100 (${modifierText}) และความเสี่ยงอยู่ระดับ ${riskLevel}. จุดหนุนหลักคือ ${bestModule.label} (${bestModule.score}/100) ร่วมกับ ${contextText}. ${riskReason}`
  }
  if (recommendation === recommendationLabels.lean) {
    return `${home} พบ ${away}: ระบบให้เป็น LEAN เพราะภาพรวมยังสนับสนุนบางด้าน โดยเฉพาะ ${bestModule.label} (${bestModule.score}/100) และ ${contextText} แต่ ${weakestModule.label} ยังถ่วงอยู่ (${weakestModule.score}/100) จึงยังไม่ถึงระดับ BET. ${riskReason}`
  }
  return `${home} พบ ${away}: คู่นี้เป็น NO BET เพราะคะแนนสุดท้าย ${confidence}/100 (${modifierText}) ยังไม่พอ หรือความเสี่ยงอยู่ระดับ ${riskLevel}. แม้มีจุดเด่นที่ ${bestModule.label} (${bestModule.score}/100) แต่ ${contextText} และ ${weakestModule.label} (${weakestModule.score}/100) ยังจำกัดความมั่นใจ. ${riskReason}`
}

function normalizeFootballIntelligence(intelligence, fallbackModifier) {
  const normalized = intelligence ?? calculateFootballIntelligence({})
  return {
    h2h: normalized.h2h ?? calculateH2HIntelligence({}),
    league_context: normalized.league_context ?? calculateLeagueContext({}),
    rest_days: normalized.rest_days ?? calculateRestDays({}, null),
    schedule_difficulty: normalized.schedule_difficulty ?? calculateScheduleDifficulty({}, null),
    squad_context: normalized.squad_context ?? calculateSquadContext({}, null),
    momentum: normalized.momentum ?? calculateMomentum({}, null),
    match_importance: normalized.match_importance ?? calculateMatchImportance({}),
    ai_explanation: normalized.ai_explanation ?? {
      summary: 'Football intelligence v3 ใช้ข้อมูลที่มีแบบระมัดระวัง',
      signals: normalized.signals ?? [],
      data_confidence: getIntelligenceDataConfidence(normalized),
    },
    modifier: Math.round(clamp(numberValue(normalized.modifier ?? fallbackModifier), -6, 6)),
    signals: normalized.signals ?? normalized.ai_explanation?.signals ?? collectIntelligenceSignals(normalized),
  }
}

function calculateIntelligenceModifier(intelligence, baseConfidence = 0) {
  const scores = [
    intelligence.h2h.score,
    intelligence.league_context.score,
    intelligence.rest_days.score,
    intelligence.schedule_difficulty.score,
    intelligence.squad_context.score,
    intelligence.momentum.score,
    intelligence.match_importance.score,
  ]
  const averageScore = scores.reduce((total, score) => total + numberValue(score), 0) / scores.length
  const riskModifier = numberValue(intelligence.league_context.risk_modifier) + numberValue(intelligence.match_importance.risk_modifier)
  const lowConfidencePenalty = [intelligence.h2h, intelligence.schedule_difficulty, intelligence.squad_context].filter((item) => item.confidence === 'low').length * 0.4
  const rawModifier = (averageScore - 58) * 0.22 - riskModifier * 0.8 - lowConfidencePenalty
  const highConfidenceSupport = [intelligence.h2h, intelligence.schedule_difficulty, intelligence.squad_context].filter((item) => ['medium', 'high'].includes(item.confidence)).length
  const positiveCap = baseConfidence && baseConfidence < 73 ? 2 : highConfidenceSupport >= 2 ? 6 : 4

  return Math.round(clamp(rawModifier, -6, positiveCap))
}

function getStoredOrCalculatedModifier(storedBreakdown, footballIntelligence, baseConfidence) {
  const stored = storedBreakdown?.football_intelligence?.modifier
  if (stored !== undefined && stored !== null) return Math.round(clamp(numberValue(stored), -6, 6))
  return calculateIntelligenceModifier(footballIntelligence, baseConfidence)
}

function getCombinedIntelligenceModifier(baseConfidence, footballModifier, dataIntelligenceModifier) {
  const total = numberValue(footballModifier) + numberValue(dataIntelligenceModifier)
  const positiveCap = baseConfidence && baseConfidence < 75 ? Math.max(0, 74 - baseConfidence) : 10
  return Math.round(clamp(total, -10, positiveCap))
}

function buildFootballIntelligenceExplanation(intelligence, modifier) {
  const league = intelligence.league_context.type
  const momentum = intelligence.momentum.momentum
  const h2hConfidence = intelligence.h2h.confidence
  const squadConfidence = intelligence.squad_context.confidence

  return `v3 ประเมินบริบทเป็น ${league}, momentum ${momentum}, H2H confidence ${h2hConfidence}, squad confidence ${squadConfidence}; modifier ${formatSigned(modifier)}`
}

function buildContextSummary(intelligence) {
  const parts = []
  parts.push(`บริบทการแข่งขันเป็น ${intelligence.league_context.type}`)
  parts.push(`โมเมนตัม ${intelligence.momentum.momentum}`)
  if (intelligence.h2h.confidence === 'low') parts.push('ข้อมูล H2H ยังจำกัด')
  if (intelligence.squad_context.confidence === 'low') parts.push('ข้อมูลตัวผู้เล่นยังจำกัด')
  if (intelligence.match_importance.risk_modifier > 0) parts.push('รายการมีความผันผวนเพิ่มขึ้น')
  return parts.join(', ')
}

function collectIntelligenceSignals(intelligence) {
  return [
    ...(intelligence?.h2h?.signals ?? []),
    ...(intelligence?.squad_context?.signals ?? []),
    ...(intelligence?.momentum?.signals ?? []),
    `league_${intelligence?.league_context?.type ?? 'unknown'}`,
    `importance_${intelligence?.match_importance?.importance ?? 'unknown'}`,
    `schedule_${intelligence?.schedule_difficulty?.difficulty ?? 'unknown'}`,
    `rest_advantage_${intelligence?.rest_days?.advantage ?? 'none'}`,
  ]
}

function getIntelligenceDataConfidence(intelligence) {
  if (!intelligence) return 'low'
  const confidenceValues = [intelligence.h2h, intelligence.schedule_difficulty, intelligence.squad_context]
    .map((item) => item?.confidence)
    .filter(Boolean)
  const highOrMedium = confidenceValues.filter((value) => ['medium', 'high'].includes(value)).length
  if (highOrMedium >= 3) return 'high'
  if (highOrMedium >= 2) return 'medium'
  return 'low'
}

function getContextValue(match, context, key) {
  return context[key] ?? match.raw?.[key] ?? match.analysis?.raw?.[key] ?? match.analysis?.raw?.analysis_breakdown?.football_intelligence?.[key]
}

function getH2HMatches(match, context) {
  const candidates = [
    context.h2hMatches,
    context.h2h?.matches,
    context.h2h,
    match.raw?.h2h?.matches,
    match.raw?.head_to_head,
    match.analysis?.raw?.h2h?.matches,
  ]
  return candidates.find((candidate) => Array.isArray(candidate) && candidate.length) ?? []
}

function summarizeH2H(matches, homeId, awayId) {
  return matches.reduce(
    (total, item) => {
      const homeGoals = item.score?.fullTime?.home ?? item.home_goals ?? item.homeGoals
      const awayGoals = item.score?.fullTime?.away ?? item.away_goals ?? item.awayGoals
      if (homeGoals === null || homeGoals === undefined || awayGoals === null || awayGoals === undefined) return total
      const itemHomeId = getTeamId(item.homeTeam)
      const itemAwayId = getTeamId(item.awayTeam)
      const homeSideGoals = itemHomeId === homeId ? homeGoals : itemAwayId === homeId ? awayGoals : null
      const awaySideGoals = itemAwayId === awayId ? awayGoals : itemHomeId === awayId ? homeGoals : null
      if (homeSideGoals === null || awaySideGoals === null) return total
      total.played += 1
      total.goals += numberValue(homeGoals) + numberValue(awayGoals)
      if (homeSideGoals > awaySideGoals) total.homeWins += 1
      else if (homeSideGoals < awaySideGoals) total.awayWins += 1
      else total.draws += 1
      return total
    },
    { played: 0, goals: 0, homeWins: 0, awayWins: 0, draws: 0 },
  )
}

function classifyCompetition(name) {
  const text = String(name ?? '').toLowerCase()
  if (!text) return 'unknown'
  if (['women', 'womens', 'feminine'].some((item) => text.includes(item))) return 'women'
  if (['u17', 'u18', 'u19', 'u20', 'u21', 'u23', 'youth'].some((item) => text.includes(item))) return 'youth'
  if (['friendly', 'friendlies'].some((item) => text.includes(item))) return 'friendly'
  if (['world cup', 'euro', 'nations league', 'afcon', 'copa america', 'international'].some((item) => text.includes(item))) return 'international'
  if (['cup', 'trophy', 'knockout', 'playoff', 'play-off'].some((item) => text.includes(item))) return 'cup'
  if (['league', 'division', 'serie', 'liga', 'bundesliga', 'premier', 'championship'].some((item) => text.includes(item))) return 'league'
  return 'unknown'
}

function getCompetitionText(match) {
  return [
    match.league?.name,
    match.competition?.name,
    match.raw?.competition?.name,
    match.raw?.league?.name,
    match.name,
  ]
    .filter(Boolean)
    .join(' ')
}

function getTeamRecentMatches(recentMatches, side) {
  if (!recentMatches) return []
  if (Array.isArray(recentMatches)) return recentMatches
  return recentMatches[side] ?? recentMatches[`${side}Matches`] ?? []
}

function getRestDays(match, recentMatches) {
  if (!Array.isArray(recentMatches) || !recentMatches.length) return null
  const matchTime = new Date(match.kickoffAt ?? match.kickoff_at ?? match.utcDate ?? match.raw?.utcDate ?? Date.now()).getTime()
  const previous = recentMatches
    .map((item) => new Date(item.utcDate ?? item.kickoff_at ?? item.kickoffAt ?? item.date ?? 0).getTime())
    .filter((time) => Number.isFinite(time) && time > 0 && time < matchTime)
    .sort((a, b) => b - a)[0]
  if (!previous) return null
  return Math.max(0, Math.floor((matchTime - previous) / 86400000))
}

function scoreRestDays(days) {
  if (days === null) return 0
  if (days <= 2) return -5
  if (days <= 5) return 0
  if (days <= 9) return 4
  if (days > 14) return -2
  return 1
}

function formatRestDays(days) {
  return days === null ? 'ไม่ทราบ' : `${days} วัน`
}

function flattenRecentOpponents(recentOpponents) {
  if (!recentOpponents) return []
  if (Array.isArray(recentOpponents)) return recentOpponents
  return [...(recentOpponents.home ?? []), ...(recentOpponents.away ?? [])]
}

function getOpponentDifficulty(item) {
  const opponent = item.opponent ?? item.awayTeam ?? item.homeTeam ?? item.team
  const position = numberValue(opponent?.position ?? item.position)
  const points = numberValue(opponent?.points ?? item.points)
  const rating = numberValue(opponent?.rating ?? item.rating ?? item.strength)
  if (rating) return clamp(rating, 0, 100)
  if (position) return clamp(82 - position * 3, 20, 85)
  if (points) return clamp(points, 20, 85)
  return null
}

function countItems(value) {
  if (Array.isArray(value)) return value.length
  if (typeof value === 'number') return value
  if (value && typeof value === 'object') return Object.keys(value).length
  return value ? 1 : 0
}

function moduleResult(score, reason) {
  return { score: Math.round(clamp(score, 0, 100)), reason }
}

function findStanding(standings, teamId) {
  const totalTable = standings.find((standing) => standing.type === 'TOTAL')?.table ?? standings[0]?.table ?? []
  return totalTable.find((row) => Number(row.team?.id) === Number(teamId))
}

function getTeamId(team) {
  return Number(team?.api_team_id ?? team?.id ?? team?.apiTeamId ?? 0)
}

function hasRecentForm(form) {
  return numberValue(form?.played) > 0
}

function formPoints(form) {
  return numberValue(form?.wins) * 3 + numberValue(form?.draws)
}

function formGoalDiff(form) {
  return numberValue(form?.goals_for) - numberValue(form?.goals_against)
}

function normalizeRiskLevel(value) {
  const normalized = String(value ?? '').toLowerCase()
  return ['low', 'medium', 'high'].includes(normalized) ? normalized : riskLabels.medium
}

function numberValue(value) {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

function formatSigned(value) {
  return `${value >= 0 ? '+' : ''}${value}`
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
}
