import { describeMarketMovement, getLatestOddsByMarket, hasUsableMarket, movementSupportsDirection } from './oddsUtils.js'

export function analyzeOverUnder(match = {}) {
  const analysis = match.analysis ?? match.match_analysis ?? {}
  const rows = getLatestOddsByMarket(match, 'OU')
  const hasMarket = hasUsableMarket(match, 'OU')
  const attacking = Number(analysis.goal_scoring_score ?? analysis.goal_quality_score ?? 58)
  const defending = Number(analysis.defensive_stability_score ?? 58)
  const homeGoals = formGoals(match.homeForm)
  const awayGoals = formGoals(match.awayForm)
  const tempo = average([attacking, 100 - defending, homeGoals.totalScore, awayGoals.totalScore], 58)
  const direction = buildOuDirection(tempo, rows)
  const movement = movementSupportsDirection(rows, direction)
  const reasons = buildOuReasons({ attacking, defending, homeGoals, awayGoals, tempo, hasMarket, movement, direction })
  const warnings = buildOuWarnings({ analysis, hasMarket, tempo, movement })
  const marketBoost = hasMarket ? 8 : -10
  const movementBoost = movement === 'supports' ? 5 : movement === 'against' ? -12 : 0
  const confidenceScore = clamp(Math.round(46 + Math.abs(tempo - 52) * 0.58 + marketBoost + movementBoost - warnings.length * 3), 0, 100)

  return {
    marketFocus: 'OU',
    direction,
    confidenceScore,
    reasons,
    warnings,
    marketSignal: describeMarketMovement(rows, direction),
    hasMarket,
    bookmakerCount: new Set(rows.map((row) => row.bookmaker).filter(Boolean)).size,
  }
}

function buildOuDirection(tempo, rows) {
  const latestLine = rows.find((row) => row.line)?.line
  const line = latestLine ?? (tempo >= 72 ? '2.75' : tempo >= 60 ? '2.5' : tempo <= 38 ? '3.25' : '3.0')
  return tempo >= 52 ? `Over ${line}` : `Under ${line}`
}

function buildOuReasons({ attacking, defending, homeGoals, awayGoals, tempo, hasMarket, movement, direction }) {
  const reasons = []
  if (attacking >= 62) reasons.push('Attacking profile is above baseline')
  if (defending <= 52) reasons.push('Defensive stability leaves room for goals')
  if (homeGoals.totalPerMatch + awayGoals.totalPerMatch >= 5) reasons.push('Recent total goals trend is active')
  if (tempo >= 62 && direction.startsWith('Over')) reasons.push('Fixture tempo supports an Over direction')
  if (tempo <= 44 && direction.startsWith('Under')) reasons.push('Fixture tempo supports an Under direction')
  if (hasMarket) reasons.push('OU market data is available from API-FOOTBALL')
  if (movement === 'supports') reasons.push('Market movement supports the direction')
  return reasons.length ? reasons : ['Goal profile is limited, so OU confidence stays conservative']
}

function buildOuWarnings({ analysis, hasMarket, tempo, movement }) {
  const warnings = []
  if (!hasMarket) warnings.push('No OU market data yet')
  if (tempo > 47 && tempo < 57) warnings.push('Goal tempo is close to neutral')
  if (String(analysis.risk_level ?? '').toUpperCase() === 'HIGH') warnings.push('Risk level is high')
  if (movement === 'against') warnings.push('Market movement is against the direction')
  return warnings
}

function formGoals(form) {
  const played = Number(form?.played ?? 0)
  if (!played) return { forPerMatch: 0, againstPerMatch: 0, totalPerMatch: 0, totalScore: null }
  const forPerMatch = Number(form.goals_for ?? 0) / played
  const againstPerMatch = Number(form.goals_against ?? 0) / played
  const totalPerMatch = forPerMatch + againstPerMatch
  return {
    forPerMatch,
    againstPerMatch,
    totalPerMatch,
    totalScore: clamp(totalPerMatch * 24, 0, 100),
  }
}

function average(values, fallback) {
  const numbers = values.map(Number).filter(Number.isFinite)
  if (!numbers.length) return fallback
  return numbers.reduce((total, value) => total + value, 0) / numbers.length
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
}
