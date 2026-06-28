import { describeMarketMovement, getLatestOddsByMarket, hasUsableMarket, movementSupportsDirection } from './oddsUtils.js'

export function analyzeAsianHandicap(match = {}) {
  const analysis = match.analysis ?? match.match_analysis ?? {}
  const rows = getLatestOddsByMarket(match, 'AH')
  const hasMarket = hasUsableMarket(match, 'AH')
  const homeScore = scoreHomeSide(match, analysis)
  const awayScore = scoreAwaySide(match, analysis)
  const gap = homeScore - awayScore
  const isHome = gap >= 0
  const direction = buildAhDirection(isHome ? 'Home' : 'Away', Math.abs(gap))
  const movement = movementSupportsDirection(rows, direction)
  const reasons = buildAhReasons({ match, analysis, hasMarket, gap, isHome, movement })
  const warnings = buildAhWarnings({ analysis, hasMarket, gap, movement })
  const marketBoost = hasMarket ? 8 : -10
  const movementBoost = movement === 'supports' ? 5 : movement === 'against' ? -12 : 0
  const confidenceScore = clamp(Math.round(48 + Math.abs(gap) * 0.55 + marketBoost + movementBoost - warnings.length * 3), 0, 100)

  return {
    marketFocus: 'AH',
    direction,
    confidenceScore,
    reasons,
    warnings,
    marketSignal: describeMarketMovement(rows, direction),
    hasMarket,
    bookmakerCount: new Set(rows.map((row) => row.bookmaker).filter(Boolean)).size,
  }
}

function scoreHomeSide(match, analysis) {
  return average([
    analysis.home_advantage_score,
    analysis.home_away_score,
    analysis.team_strength_score,
    analysis.form_score,
    100 - Number(analysis.away_weakness_score ?? 45),
    formSignal(match.homeForm),
  ], 58)
}

function scoreAwaySide(match, analysis) {
  return average([
    100 - Number(analysis.home_advantage_score ?? 58),
    analysis.team_strength_score ? 100 - Number(analysis.team_strength_score) : null,
    analysis.form_score ? 100 - Number(analysis.form_score) : null,
    analysis.away_weakness_score,
    formSignal(match.awayForm),
  ], 52)
}

function buildAhDirection(side, gap) {
  const line = gap >= 22 ? '-1.0' : gap >= 16 ? '-0.75' : gap >= 10 ? '-0.5' : gap >= 5 ? '-0.25' : '+0.25'
  if (side === 'Away' && line.startsWith('-')) return `Away ${line}`
  if (side === 'Away') return `Away ${line}`
  return `Home ${line}`
}

function buildAhReasons({ analysis, hasMarket, gap, isHome, movement }) {
  const side = isHome ? 'home side' : 'away side'
  const reasons = []
  if (Math.abs(gap) >= 8) reasons.push(`Team strength profile leans to ${side}`)
  if (Number(analysis.form_score ?? 0) >= 62) reasons.push('Recent form supports the selection side')
  if (Number(analysis.home_advantage_score ?? 0) >= 62 && isHome) reasons.push('Home/away profile gives a clear edge')
  if (Number(analysis.away_weakness_score ?? 0) >= 60 && isHome) reasons.push('Away weakness increases cover potential')
  if (hasMarket) reasons.push('AH market data is available from API-FOOTBALL')
  if (movement === 'supports') reasons.push('Market movement supports the direction')
  return ensureMinimumReasons(reasons)
}

function buildAhWarnings({ analysis, hasMarket, gap, movement }) {
  const warnings = []
  if (!hasMarket) warnings.push('ยังไม่มีข้อมูลตลาดราคา')
  if (Math.abs(gap) < 5) warnings.push('Team edge is narrow')
  if (String(analysis.risk_level ?? '').toUpperCase() === 'HIGH') warnings.push('Risk level is high')
  if (movement === 'against') warnings.push('Market movement is against the direction')
  return warnings
}

function formSignal(form) {
  if (!form) return null
  const played = Number(form.played ?? 0)
  if (!played) return null
  const points = Number(form.wins ?? 0) * 3 + Number(form.draws ?? 0)
  return clamp((points / Math.max(played * 3, 1)) * 100, 0, 100)
}

function average(values, fallback) {
  const numbers = values.map(Number).filter(Number.isFinite)
  if (!numbers.length) return fallback
  return numbers.reduce((total, value) => total + value, 0) / numbers.length
}

function ensureMinimumReasons(reasons) {
  return reasons.length ? reasons : ['Team data is limited, so AH confidence stays conservative']
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
}
