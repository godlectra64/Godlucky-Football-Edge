const selectionWeights = {
  dataQualityScore: 15,
  leagueTrustScore: 10,
  oddsClarityScore: 15,
  formQualityScore: 15,
  goalChanceScore: 15,
  motivationScore: 10,
  marketMovementScore: 10,
  riskControlScore: 10,
}

export function calculateSelectionScore(match) {
  const selection = match.selection ?? {}

  return Object.entries(selectionWeights).reduce((total, [key, max]) => {
    const value = Number(selection[key] ?? 0)
    return total + Math.max(0, Math.min(max, value))
  }, 0)
}

export function calculateAnalysisScore(match) {
  const modules = Object.values(match.modules ?? {})

  if (!modules.length) return 0

  const sum = modules.reduce((total, value) => total + Number(value ?? 0), 0)
  const average = sum / modules.length

  return Math.round(Math.max(0, Math.min(100, average * 10)))
}

export function getRiskAdjustedRecommendation(score, riskLevel) {
  let recommendation = score >= 75 ? 'BET' : score >= 60 ? 'LEAN' : 'NO BET'

  if (riskLevel === 'สูง') {
    if (recommendation === 'BET') recommendation = 'LEAN'
    else if (recommendation === 'LEAN') recommendation = 'NO BET'
  }

  return recommendation
}

export function getRecommendation(match) {
  return getRiskAdjustedRecommendation(calculateAnalysisScore(match), match.riskLevel)
}

export function getConfidence(match) {
  const score = calculateAnalysisScore(match)
  const selectionScore = calculateSelectionScore(match)
  const riskPenalty = match.riskLevel === 'สูง' ? 10 : match.riskLevel === 'กลาง' ? 4 : 0
  const confidence = Math.round(score * 0.72 + selectionScore * 0.28 - riskPenalty)

  return Math.max(35, Math.min(96, confidence))
}

export function getTopMatches(matches, limit = 10) {
  return [...matches]
    .map((match) => ({
      ...match,
      selectionScore: calculateSelectionScore(match),
      totalAnalysisScore: calculateAnalysisScore(match),
      recommendation: getRecommendation(match),
      confidence: getConfidence(match),
    }))
    .filter((match) => match.selectionScore >= 60)
    .sort((a, b) => b.selectionScore - a.selectionScore)
    .slice(0, limit)
}

export function calculateStats(matches) {
  const settled = matches.filter((match) => ['Win', 'Lose', 'Push'].includes(match.result))
  const bets = matches.filter((match) => getRecommendation(match) === 'BET')
  const leans = matches.filter((match) => getRecommendation(match) === 'LEAN')
  const ahMatches = matches.filter((match) => match.recommendedMarket === 'AH')
  const ouMatches = matches.filter((match) => match.recommendedMarket === 'OU')
  const counts = {
    win: matches.filter((match) => match.result === 'Win').length,
    lose: matches.filter((match) => match.result === 'Lose').length,
    push: matches.filter((match) => match.result === 'Push').length,
    pending: matches.filter((match) => match.result === 'Pending').length,
  }

  const winrate = (list) => {
    const resolved = list.filter((match) => ['Win', 'Lose'].includes(match.result))
    if (!resolved.length) return 0
    return Math.round((resolved.filter((match) => match.result === 'Win').length / resolved.length) * 100)
  }

  const roiUnits = settled.reduce((total, match) => {
    if (match.result === 'Win') return total + 1
    if (match.result === 'Lose') return total - 1
    return total
  }, 0)

  return {
    total: matches.length,
    betCount: bets.length,
    leanCount: leans.length,
    winrateOverall: winrate(matches),
    winrateBet: winrate(bets),
    winrateLean: winrate(leans),
    ahWinrate: winrate(ahMatches),
    ouWinrate: winrate(ouMatches),
    ...counts,
    roiUnits,
    roiPercent: settled.length ? Math.round((roiUnits / settled.length) * 100) : 0,
  }
}
