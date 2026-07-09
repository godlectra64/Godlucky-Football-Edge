import { analyzeAsianHandicap } from './ahAnalysisEngine.js'
import { getLeagueQualityScore } from './leagueQualityScoring.js'
import { getMatchStatusInfo } from './matchStatus.js'
import { analyzeOverUnder } from './ouAnalysisEngine.js'
import { getLatestOddsByMarket, normalizeOddsRows } from './oddsUtils.js'

export const unifiedDecisionValues = ['BET', 'LEAN', 'WATCH', 'NO_BET']
export const unifiedStatusValues = ['READY', 'WAITING_MARKET', 'WATCH', 'NO_DATA', 'FINISHED']

const scoreWeights = {
  leagueQuality: 10,
  teamStrength: 15,
  recentForm: 15,
  attack: 10,
  defence: 10,
  homeAway: 10,
  motivation: 8,
  statisticalEdge: 7,
  marketQuality: 5,
  valueEdge: 5,
  riskControl: 5,
}

export function buildFootballIntelligence(match = {}) {
  const analysis = getAnalysis(match)
  const statusInfo = getMatchStatusInfo(match)
  const oddsRows = normalizeOddsRows(match)
  const ahRows = getLatestOddsByMarket(match, 'AH')
  const ouRows = getLatestOddsByMarket(match, 'OU')
  const hasMarket = oddsRows.length > 0
  const hasAhMarket = ahRows.length > 0
  const hasOuMarket = ouRows.length > 0
  const hardFilter = getHardFilterReason(match, statusInfo)
  const scoreBreakdown = buildScoreBreakdown(match, analysis, { hasMarket, hasAhMarket, hasOuMarket })
  const unifiedScore = calculateUnifiedScore(scoreBreakdown)
  const winnerPrediction = buildWinnerPrediction(match, analysis, { hasMarket, unifiedScore, hardFilter })
  const ahPick = buildAhPick(match, ahRows)
  const ouPick = buildOuPick(match, ouRows)
  const riskLevel = getRiskLevel(analysis, scoreBreakdown.riskControl)
  const confidence = getUnifiedConfidence({ match, analysis, unifiedScore, winnerPrediction, ahPick, ouPick, hasMarket })
  const finalPick = buildFinalPick({ ahPick, ouPick, winnerPrediction, unifiedScore, confidence, riskLevel, hasMarket, scoreBreakdown })
  const status = getUnifiedStatus({ hardFilter, statusInfo, hasMarket, finalPick, unifiedScore })
  const decision = getUnifiedDecision({ status, hasMarket, finalPick, unifiedScore, confidence, riskLevel })
  const reasons = buildReasons({ winnerPrediction, ahPick, ouPick, finalPick, scoreBreakdown, decision, status })
  const warnings = buildWarnings({ hardFilter, hasMarket, hasAhMarket, hasOuMarket, riskLevel, scoreBreakdown })

  return {
    match_id: match.match_id ?? match.matchId ?? match.id ?? null,
    unified_score: unifiedScore,
    decision,
    status,
    confidence,
    winner_prediction: winnerPrediction,
    ah_pick: ahPick,
    ou_pick: ouPick,
    final_pick: finalPick,
    risk_level: riskLevel,
    reasons,
    warnings,
    score_breakdown: scoreBreakdown,
    data_state: buildDataState(match, analysis, hardFilter),
    market_state: buildMarketState({ oddsRows, ahRows, ouRows, scoreBreakdown }),
  }
}

export function mapUnifiedToBettingDecision(unified = {}) {
  return {
    match_view: unified.winner_prediction,
    winner_prediction: unified.winner_prediction,
    ah_pick: unified.ah_pick,
    ou_pick: unified.ou_pick,
    final_pick: unified.final_pick,
    confidence: scoreValue(unified.confidence),
    status: unified.status,
    decision: unified.decision,
    unified_score: scoreValue(unified.unified_score),
    risk_level: unified.risk_level,
    reasons: unified.reasons ?? [],
    warnings: unified.warnings ?? [],
    score_breakdown: unified.score_breakdown ?? {},
    data_state: unified.data_state ?? {},
    market_state: unified.market_state ?? {},
    unified: true,
  }
}

export function getLegacyAnalysisFields(unified = {}) {
  const recommendation = unified.decision === 'NO_BET' ? 'NO BET' : unified.decision
  return {
    confidence_score: scoreValue(unified.confidence),
    recommendation,
    risk_level: unified.risk_level ?? 'MEDIUM',
    ranking_score: scoreValue(unified.unified_score),
    professional_score: scoreValue(unified.unified_score),
  }
}

export function getLegacyAiFinalPickFields(unified = {}) {
  const finalPick = unified.final_pick ?? {}
  return {
    signal: unified.decision === 'BET' ? 'STRONG_SIGNAL' : unified.decision === 'LEAN' || unified.decision === 'WATCH' ? 'WATCH' : 'SKIP',
    confidence_score: scoreValue(unified.confidence),
    pick_side: finalPick.side ?? 'NONE',
    pick_team: finalPick.team_name ?? null,
  }
}

export function getLegacyDailySelectionFields(unified = {}) {
  return {
    signal: unified.decision === 'BET' ? 'STRONG_SIGNAL' : unified.decision === 'LEAN' || unified.decision === 'WATCH' ? 'WATCH' : 'SKIP',
    confidence_score: scoreValue(unified.confidence),
    risk_level: unified.risk_level ?? 'MEDIUM',
  }
}

function buildScoreBreakdown(match, analysis, market) {
  const oddsRows = normalizeOddsRows(match)
  const leagueQuality = scoreValue(analysis.league_quality_score ?? match.leagueQualityScore ?? match.league_quality_score ?? getLeagueQualityScore(match) ?? 56)
  const teamStrength = averageScore([analysis.team_strength_score, analysis.match_quality_score, analysis.raw?.team_strength_score], 56)
  const recentForm = averageScore([analysis.form_score, formSignal(match.homeForm ?? analysis.raw?.homeForm), formSignal(match.awayForm ?? analysis.raw?.awayForm)], 56)
  const attack = averageScore([analysis.goal_scoring_score, analysis.tactical_score, analysis.tactical_matchup_score], 56)
  const defence = averageScore([analysis.defensive_stability_score, 100 - numberValue(analysis.away_weakness_score, 45)], 56)
  const homeAway = averageScore([analysis.home_away_score, analysis.home_advantage_score, 100 - numberValue(analysis.away_weakness_score, 45)], 56)
  const motivation = averageScore([analysis.motivation_score], 55)
  const statisticalEdge = averageScore([analysis.statistical_edge_score, analysis.edge_score, analysis.ai_score, analysis.ranking_score], 56)
  const storedMarketQuality = averageScore([analysis.market_quality_score, analysis.market_context_score, analysis.market_reading_score, analysis.odds_confidence_score], 0)
  const marketQuality = market.hasMarket
    ? clampScore(Math.max(storedMarketQuality || 0, 48) + (market.hasAhMarket ? 14 : -4) + (market.hasOuMarket ? 12 : -4) + Math.min(10, oddsRows.length * 1.5))
    : 25
  const storedValue = averageScore([analysis.value_edge_score, analysis.market_edge_score], 0)
  const valueEdge = market.hasMarket ? clampScore(storedValue || 55) : 45
  const riskControl = getRiskControlScore(analysis)

  return {
    leagueQuality,
    teamStrength,
    recentForm,
    attack,
    defence,
    homeAway,
    motivation,
    statisticalEdge,
    marketQuality,
    valueEdge,
    riskControl,
  }
}

function calculateUnifiedScore(breakdown) {
  const totalWeight = Object.values(scoreWeights).reduce((total, value) => total + value, 0)
  const weighted = Object.entries(scoreWeights).reduce((total, [key, weight]) => total + scoreValue(breakdown[key], 55) * weight, 0)
  return scoreValue(weighted / totalWeight)
}

function buildWinnerPrediction(match, analysis, context) {
  if (context.hardFilter) {
    return {
      side: 'NONE',
      team_name: null,
      label: 'ข้อมูลยังไม่พอประเมินฝั่งชนะ',
      confidence: 0,
      reason: 'ข้อมูล fixture ไม่ผ่านเงื่อนไขขั้นต่ำสำหรับการประเมิน',
      source: 'INSUFFICIENT_DATA',
    }
  }

  const homeTeam = match.homeTeam ?? match.home_team ?? {}
  const awayTeam = match.awayTeam ?? match.away_team ?? {}
  const homeName = homeTeam.name ?? match.home_name ?? 'เจ้าบ้าน'
  const awayName = awayTeam.name ?? match.away_name ?? 'ทีมเยือน'
  const homeScore = averageScore([
    analysis.home_advantage_score,
    analysis.home_away_score,
    analysis.team_strength_score,
    analysis.form_score,
    formSignal(match.homeForm ?? analysis.raw?.homeForm),
  ], 56)
  const awayScore = averageScore([
    100 - numberValue(analysis.home_advantage_score, 56),
    analysis.away_weakness_score,
    analysis.form_score ? 100 - numberValue(analysis.form_score, 56) : null,
    formSignal(match.awayForm ?? analysis.raw?.awayForm),
  ], 52)
  const gap = Math.abs(homeScore - awayScore)
  const side = gap < 3 ? 'DRAW' : homeScore >= awayScore ? 'HOME' : 'AWAY'
  const teamName = side === 'HOME' ? homeName : side === 'AWAY' ? awayName : null
  const baseConfidence = 50 + gap * 0.6 + context.unifiedScore * 0.12
  const confidence = scoreValue(context.hasMarket ? Math.min(baseConfidence + 6, 82) : Math.min(baseConfidence, 60))

  if (side === 'DRAW') {
    return {
      side,
      team_name: null,
      label: 'ภาพรวมสูสี',
      confidence,
      reason: 'คะแนนทีมใกล้กัน จึงประเมินเป็นเกมสูสี',
      source: context.hasMarket ? 'MARKET_MODEL' : 'FIXTURE_MODEL',
    }
  }

  return {
    side,
    team_name: teamName,
    label: `${teamName} มีโอกาสเหนือกว่า${confidence >= 58 ? '' : 'เล็กน้อย'}`,
    confidence,
    reason: context.hasMarket
      ? 'ประเมินจากข้อมูลทีมร่วมกับตลาดราคาที่มีอยู่'
      : 'ประเมินจากคุณภาพลีก ข้อมูลทีม และความพร้อมข้อมูลพื้นฐาน',
    source: context.hasMarket ? 'MARKET_MODEL' : 'FIXTURE_MODEL',
  }
}

function buildAhPick(match, rows) {
  if (!rows.length) {
    return {
      side: 'NONE',
      team_name: null,
      label: 'รอเส้น AH',
      reason: 'ยังไม่มีข้อมูล Asian Handicap',
      requires_market: true,
      confidence: 0,
    }
  }

  const analysis = analyzeAsianHandicap(match)
  const side = String(analysis.direction ?? '').toLowerCase().startsWith('away') ? 'AWAY' : 'HOME'
  const row = findMarketRow(rows, side === 'HOME' ? 'home' : 'away') ?? rows[0]
  const line = firstText(row.line, String(row.selection ?? '').match(/[+-]?\d+(?:\.\d+)?/)?.[0], '0')
  const teamName = side === 'HOME' ? match.homeTeam?.name ?? null : match.awayTeam?.name ?? null
  const confidence = scoreValue(analysis.confidenceScore)
  return {
    side,
    team_name: teamName,
    label: `${side} ${formatSignedLine(line)}`,
    reason: confidence >= 60 ? `มีเส้น AH แล้ว ระบบให้น้ำหนักฝั่ง${side === 'HOME' ? 'เจ้าบ้าน' : 'ทีมเยือน'}` : 'มีเส้น AH แล้ว แต่คะแนนยังไม่ผ่านเกณฑ์',
    requires_market: true,
    confidence,
  }
}

function buildOuPick(match, rows) {
  if (!rows.length) {
    return {
      side: 'NONE',
      label: 'รอราคา O/U',
      reason: 'ยังไม่มีข้อมูล Over/Under',
      requires_market: true,
      confidence: 0,
    }
  }

  const analysis = analyzeOverUnder(match)
  const side = String(analysis.direction ?? '').toLowerCase().startsWith('under') ? 'UNDER' : 'OVER'
  const row = findMarketRow(rows, side.toLowerCase()) ?? rows[0]
  const line = firstText(row.line, String(row.selection ?? '').match(/\d+(?:\.\d+)?/)?.[0], '2.5')
  const confidence = scoreValue(analysis.confidenceScore)
  return {
    side,
    label: `${side} ${line}`,
    reason: confidence >= 60 ? `มีราคา O/U แล้ว ระบบให้น้ำหนักฝั่ง ${side}` : 'มีราคา O/U แล้ว แต่คะแนนยังไม่ผ่านเกณฑ์',
    requires_market: true,
    confidence,
  }
}

function buildFinalPick({ ahPick, ouPick, winnerPrediction, unifiedScore, confidence, riskLevel, hasMarket, scoreBreakdown }) {
  if (!hasMarket || (ahPick.side === 'NONE' && ouPick.side === 'NONE')) {
    return {
      type: 'NO_DECISION',
      side: 'NONE',
      team_name: null,
      label: 'ยังไม่มี Best Pick',
      reason: 'รอข้อมูลราคาเพื่อยืนยัน AH/O-U',
    }
  }

  const marketPass = scoreBreakdown.marketQuality >= 45 && scoreBreakdown.valueEdge >= 45
  const riskPass = riskLevel !== 'HIGH' && scoreBreakdown.riskControl >= 45
  const candidates = [
    ahPick.side !== 'NONE' && scoreValue(ahPick.confidence) >= 60 ? { type: 'AH', side: ahPick.side, team_name: ahPick.team_name, label: ahPick.label, confidence: ahPick.confidence, reason: ahPick.reason } : null,
    ouPick.side !== 'NONE' && scoreValue(ouPick.confidence) >= 60 ? { type: 'OU', side: ouPick.side, team_name: null, label: ouPick.label, confidence: ouPick.confidence, reason: ouPick.reason } : null,
  ].filter(Boolean)

  if (!marketPass || !riskPass || unifiedScore < 60 || confidence < 60 || !candidates.length) {
    return {
      type: 'NO_DECISION',
      side: 'NONE',
      team_name: null,
      label: 'ยังไม่ผ่านเกณฑ์',
      reason: 'มีข้อมูลตลาดแล้ว แต่คะแนนรวม ความคุ้มค่า หรือความเสี่ยงยังไม่ผ่าน',
    }
  }

  const best = candidates.sort((a, b) => b.confidence - a.confidence)[0]
  return {
    type: best.type,
    side: best.side,
    team_name: best.team_name,
    label: best.label,
    reason: `เลือก ${best.type} เพราะตลาดนี้ได้คะแนนสูงสุด และมุมมองผู้ชนะคือ ${winnerPrediction.label}`,
  }
}

function getUnifiedStatus({ hardFilter, statusInfo, hasMarket, finalPick, unifiedScore }) {
  if (statusInfo.isFinished) return 'FINISHED'
  if (hardFilter) return 'NO_DATA'
  if (!hasMarket) return unifiedScore >= 45 ? 'WAITING_MARKET' : 'WATCH'
  if (finalPick.type !== 'NO_DECISION') return 'READY'
  return 'WATCH'
}

function getUnifiedDecision({ status, hasMarket, finalPick, unifiedScore, confidence, riskLevel }) {
  if (status === 'FINISHED' || status === 'NO_DATA') return 'NO_BET'
  if (!hasMarket) return unifiedScore >= 45 ? 'WATCH' : 'NO_BET'
  if (finalPick.type !== 'NO_DECISION' && unifiedScore >= 78 && confidence >= 72 && riskLevel !== 'HIGH') return 'BET'
  if (unifiedScore >= 60 && confidence >= 60 && riskLevel !== 'HIGH') return 'LEAN'
  if (unifiedScore >= 50 && riskLevel !== 'HIGH') return 'WATCH'
  return 'NO_BET'
}

function getUnifiedConfidence({ analysis, unifiedScore, winnerPrediction, ahPick, ouPick, hasMarket }) {
  const marketConfidence = Math.max(scoreValue(ahPick.confidence), scoreValue(ouPick.confidence))
  const stored = scoreValue(analysis.calibrated_confidence_score ?? analysis.confidence_score, 0)
  const base = averageScore([stored || null, unifiedScore, winnerPrediction.confidence, marketConfidence || null], hasMarket ? 58 : 54)
  return scoreValue(hasMarket ? base : Math.min(base, 60))
}

function buildReasons({ winnerPrediction, ahPick, ouPick, finalPick, scoreBreakdown, decision, status }) {
  return uniqueItems([
    winnerPrediction.reason,
    ahPick.side !== 'NONE' ? ahPick.reason : null,
    ouPick.side !== 'NONE' ? ouPick.reason : null,
    finalPick.reason,
    `Unified decision: ${decision}`,
    `Status: ${status}`,
    `Risk control ${scoreBreakdown.riskControl}/100`,
  ]).slice(0, 8)
}

function buildWarnings({ hardFilter, hasMarket, hasAhMarket, hasOuMarket, riskLevel, scoreBreakdown }) {
  return uniqueItems([
    hardFilter,
    !hasMarket ? 'ยังไม่มี odds จึงจำกัด confidence และรอ AH/O-U' : null,
    hasMarket && !hasAhMarket ? 'ยังไม่มี AH market' : null,
    hasMarket && !hasOuMarket ? 'ยังไม่มี O/U market' : null,
    riskLevel === 'HIGH' ? 'ความเสี่ยงสูง' : null,
    scoreBreakdown.marketQuality < 45 ? 'market quality ต่ำ' : null,
    scoreBreakdown.valueEdge < 45 ? 'value edge ยังไม่พอ' : null,
  ]).slice(0, 8)
}

function buildDataState(match, analysis, hardFilter) {
  return {
    has_fixture_id: Boolean(match.id ?? match.match_id ?? match.matchId ?? match.api_fixture_id ?? match.apiFixtureId),
    has_home_team: Boolean(match.homeTeam?.name ?? match.home_team?.name ?? match.home_name),
    has_away_team: Boolean(match.awayTeam?.name ?? match.away_team?.name ?? match.away_name),
    has_kickoff: Boolean(match.kickoffAt ?? match.kickoff_at),
    has_lineups: hasRows(match.lineups ?? match.enrichment?.lineups ?? analysis.raw?.lineups),
    has_injuries: hasRows(match.injuries ?? match.enrichment?.injuries ?? analysis.raw?.injuries),
    has_statistics: hasRows(match.statistics ?? match.enrichment?.statistics ?? analysis.raw?.statistics),
    hard_filter_reason: hardFilter,
  }
}

function buildMarketState({ oddsRows, ahRows, ouRows, scoreBreakdown }) {
  return {
    has_odds: oddsRows.length > 0,
    has_ah: ahRows.length > 0,
    has_ou: ouRows.length > 0,
    odds_count: oddsRows.length,
    market_quality: scoreBreakdown.marketQuality,
    value_edge: scoreBreakdown.valueEdge,
  }
}

function getHardFilterReason(match, statusInfo) {
  if (['PST', 'CANC', 'ABD', 'AWD', 'WO'].includes(statusInfo.short)) return `status_${statusInfo.short}`
  if (!(match.id ?? match.match_id ?? match.matchId ?? match.api_fixture_id ?? match.apiFixtureId)) return 'invalid_fixture_id'
  if (!(match.homeTeam?.name ?? match.home_team?.name ?? match.home_name)) return 'missing_home_team'
  if (!(match.awayTeam?.name ?? match.away_team?.name ?? match.away_name)) return 'missing_away_team'
  if (!(match.kickoffAt ?? match.kickoff_at)) return 'missing_kickoff_at'
  return null
}

function getRiskControlScore(analysis) {
  const stored = analysis.risk_control_score ?? analysis.risk_score ?? analysis.market_risk_score
  if (stored !== undefined && stored !== null) return scoreValue(stored)
  const risk = String(analysis.risk_level ?? '').toUpperCase()
  if (risk === 'LOW') return 78
  if (risk === 'HIGH') return 38
  return 60
}

function getRiskLevel(analysis, riskControl) {
  const stored = String(analysis.risk_level ?? '').toUpperCase()
  if (['LOW', 'MEDIUM', 'HIGH'].includes(stored)) return stored
  if (riskControl >= 70) return 'LOW'
  if (riskControl < 45) return 'HIGH'
  return 'MEDIUM'
}

function getAnalysis(match = {}) {
  const analysis = Array.isArray(match.analysis) ? match.analysis[0] : match.analysis ?? match.match_analysis ?? {}
  return analysis ?? {}
}

function findMarketRow(rows, pattern) {
  const text = String(pattern ?? '').toLowerCase()
  return rows.find((row) => String(row.selection ?? row.raw?.value ?? '').toLowerCase().includes(text)) ?? null
}

function formSignal(form) {
  if (!form) return null
  const played = Number(form.played ?? 0)
  if (!played) return null
  const points = Number(form.wins ?? 0) * 3 + Number(form.draws ?? 0)
  return clampScore((points / Math.max(played * 3, 1)) * 100)
}

function hasRows(value) {
  return Array.isArray(value) && value.length > 0
}

function averageScore(values, fallback) {
  const numbers = values.map((value) => numberValue(value, null)).filter((value) => value !== null)
  if (!numbers.length) return scoreValue(fallback)
  return scoreValue(numbers.reduce((total, value) => total + value, 0) / numbers.length)
}

function formatSignedLine(value) {
  const text = String(value ?? '0').trim()
  if (!text || text === '0') return '0'
  return text.startsWith('-') || text.startsWith('+') ? text : `+${text}`
}

function firstText(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue
    const text = String(value).trim()
    if (text) return text
  }
  return ''
}

function uniqueItems(items) {
  return [...new Set(items.map((item) => String(item ?? '').trim()).filter(Boolean))]
}

function numberValue(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function scoreValue(value, fallback = 0) {
  return Math.round(clampScore(numberValue(value, fallback)))
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
}
