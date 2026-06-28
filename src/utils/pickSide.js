const validPickSides = ['HOME', 'AWAY', 'DRAW', 'NONE']

export function deriveAiPickSide(match = {}) {
  const analysis = match.analysis ?? match.match_analysis ?? match
  const storedSide = normalizePickSide(analysis.pick_side ?? match.pickSide ?? match.pick_side)
  const storedReason = String(analysis.pick_reason ?? match.pickReason ?? match.pick_reason ?? '').trim()
  const recommendation = normalizeRecommendation(analysis.recommendation ?? match.recommendation)
  const riskLevel = normalizeRiskLevel(analysis.risk_level ?? match.riskLevel ?? match.risk_level)
  const confidence = scoreValue(analysis.confidence_score ?? match.confidence ?? match.confidence_score)
  const homeName = match.homeTeam?.name ?? match.home_team?.name ?? match.homeTeamName ?? ''
  const awayName = match.awayTeam?.name ?? match.away_team?.name ?? match.awayTeamName ?? ''

  if (storedSide !== 'NONE' && storedReason && recommendation !== 'NO BET' && confidence >= 58) {
    return buildPickResult(storedSide, homeName, awayName, storedReason)
  }

  if (recommendation === 'NO BET') {
    return buildPickResult('NONE', homeName, awayName, 'Skip เพราะระบบประเมินว่ายังไม่มีข้อมูลสนับสนุนพอ')
  }
  if (riskLevel === 'HIGH') {
    return buildPickResult('NONE', homeName, awayName, 'ความเสี่ยงสูง จึงไม่แนะนำเลือกฝั่ง')
  }
  if (confidence < 58) {
    return buildPickResult('NONE', homeName, awayName, 'ข้อมูลยังไม่พอให้เลือกฝั่งอย่างมั่นใจ')
  }

  const scores = getPickScores(analysis)
  const marketPenalty = Math.max(0, 55 - scores.marketRisk) * 0.35
  const homeEdge = (scores.homeAdvantage - 50) * 0.55 + (scores.awayWeakness - 50) * 0.45 + (scores.goalScoring - 55) * 0.15 + (scores.defensiveStability - 55) * 0.1 - marketPenalty
  const awayEdge = (50 - scores.homeAdvantage) * 0.7 + (50 - scores.awayWeakness) * 0.55 + (scores.goalScoring - 55) * 0.05 + (scores.defensiveStability - 55) * 0.05 - marketPenalty

  if (homeEdge >= 14 && scores.homeAdvantage >= 62 && scores.awayWeakness >= 60 && scores.marketRisk >= 48) {
    return buildPickResult('HOME', homeName, awayName, 'เจ้าบ้านได้เปรียบชัดจากคะแนนเหย้าและความอ่อนแอของทีมเยือน')
  }

  if (awayEdge >= 16 && scores.homeAdvantage <= 42 && scores.awayWeakness <= 42 && scores.marketRisk >= 52) {
    return buildPickResult('AWAY', homeName, awayName, 'ทีมเยือนมีภาษีดีกว่าจากคะแนนฝั่งเจ้าบ้านที่อ่อนและทีมเยือนไม่เปราะชัด')
  }

  return buildPickResult('NONE', homeName, awayName, 'ข้อมูลยังไม่พอให้เลือกฝั่งอย่างมั่นใจ')
}

export function getAiPickDisplay(match = {}) {
  const pick = deriveAiPickSide(match)

  if (pick.pickSide === 'NONE') {
    return {
      ...pick,
      label: pick.pickReason.includes('Skip') ? 'Skip' : 'ข้อมูลยังไม่พอเลือกฝั่ง',
      canHighlight: false,
    }
  }

  return {
    ...pick,
    label: pick.pickTeam ? `AI เลือก: ${pick.pickTeam}` : 'ข้อมูลยังไม่พอเลือกฝั่ง',
    canHighlight: Boolean(pick.pickTeam),
  }
}

function getPickScores(analysis) {
  const breakdown = analysis.raw?.analysis_breakdown ?? analysis.analysis_breakdown ?? {}
  return {
    homeAdvantage: scoreValue(analysis.home_advantage_score ?? breakdown.home_away_advantage?.score ?? analysis.home_away_score),
    awayWeakness: scoreValue(analysis.away_weakness_score ?? breakdown.away_weakness?.score),
    goalScoring: scoreValue(analysis.goal_scoring_score ?? breakdown.attack_quality?.score ?? analysis.goal_quality_score),
    defensiveStability: scoreValue(analysis.defensive_stability_score ?? breakdown.defensive_stability?.score),
    marketRisk: scoreValue(analysis.market_risk_score ?? breakdown.market_odds_risk?.score ?? analysis.risk_score ?? 52),
  }
}

function buildPickResult(pickSide, homeName, awayName, pickReason) {
  const normalized = normalizePickSide(pickSide)
  const pickTeam = normalized === 'HOME' ? homeName : normalized === 'AWAY' ? awayName : normalized === 'DRAW' ? 'เสมอ' : null

  return {
    pickSide: normalized,
    pick_side: normalized,
    pickTeam,
    pick_team: pickTeam,
    pickReason,
    pick_reason: pickReason,
  }
}

function normalizePickSide(value) {
  const normalized = String(value ?? '').toUpperCase()
  return validPickSides.includes(normalized) ? normalized : 'NONE'
}

function normalizeRecommendation(value) {
  const normalized = String(value ?? '').toUpperCase()
  return ['BET', 'LEAN', 'NO BET'].includes(normalized) ? normalized : 'NO BET'
}

function normalizeRiskLevel(value) {
  const normalized = String(value ?? '').toUpperCase()
  return ['LOW', 'MEDIUM', 'HIGH'].includes(normalized) ? normalized : 'MEDIUM'
}

function scoreValue(value) {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric)) : 0
}
