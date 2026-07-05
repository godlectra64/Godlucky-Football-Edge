import { analyzeAsianHandicap } from './ahAnalysisEngine.js'
import { buildSimpleBettingDecision, getDecisionConfidence } from './bettingDecision.js'
import { analyzeOverUnder } from './ouAnalysisEngine.js'
import { derivePickTeamFromApiFootballOdds } from './marketDisplay.js'
import { getPrimaryBookmaker, getPrimaryOddText, normalizeOddsRows } from './oddsUtils.js'

const signals = ['STRONG_SIGNAL', 'WATCH', 'SKIP']
const riskLevels = ['LOW', 'MEDIUM', 'HIGH']

export function generateAiFinalPick(match = {}) {
  const analysis = match.analysis ?? match.match_analysis ?? {}
  const ahAnalysis = match.aiFinalPick?.ahAnalysis ?? match.ai_final_pick?.ah_analysis ?? analyzeAsianHandicap(match)
  const ouAnalysis = match.aiFinalPick?.ouAnalysis ?? match.ai_final_pick?.ou_analysis ?? analyzeOverUnder(match)
  const selected = chooseMarketAnalysis(ahAnalysis, ouAnalysis)
  const oddsRows = normalizeOddsRows(match).filter((row) => row?.id || row?.matchId || row?.match_id)
  const hasOdds = oddsRows.length > 0
  const totalAnalysisScore = scoreValue(analysis.ranking_score ?? analysis.ai_score ?? analysis.confidence_score ?? match.rankingScore ?? match.confidence, 0)
  const selectionScore = scoreValue(selected.confidenceScore, 0)
  const confidenceScore = clamp(Math.round(Math.max(selectionScore, Number(analysis.calibrated_confidence_score ?? analysis.confidence_score ?? selectionScore))), 0, 100)
  const riskLevel = normalizeRiskLevel(analysis.risk_level ?? match.riskLevel ?? getRiskFromWarnings(selected.warnings))
  const keyReasons = uniqueItems([...(selected.reasons ?? []), ...getStoredReasons(match)]).slice(0, 5)
  const warningSigns = uniqueItems([...(selected.warnings ?? []), ...getStoredWarnings(match)]).slice(0, 5)
  const bookmakerCount = Number(selected.bookmakerCount ?? new Set(oddsRows.map((row) => row.bookmaker).filter(Boolean)).size)
  const movementState = String(selected.marketSignal ?? '').toLowerCase().includes('against') ? 'against' : 'ok'
  const marketDataUsed = Boolean(analysis.market_data_used ?? analysis.raw?.market_data_used ?? hasOdds)
  const oddsRowsUsed = oddsRows.length
  const apiPick = derivePickTeamFromApiFootballOdds(match, oddsRows)
  const marketEdgeScore = scoreValue(analysis.market_edge_score ?? analysis.raw?.market_edge_score, 0)
  const recommendation = normalizeRecommendation(analysis.recommendation ?? match.recommendation)
  const bettingDecision = buildSimpleBettingDecision({ ...match, aiFinalPick: { ...(match.aiFinalPick ?? {}), ahAnalysis, ouAnalysis } })
  const decisionConfidence = getDecisionConfidence(bettingDecision)
  const signal = resolveSignal({
    recommendation,
    totalAnalysisScore,
    selectionScore,
    confidenceScore,
    riskLevel,
    hasOdds,
    bookmakerCount,
    movementState,
    marketDataUsed,
    oddsRowsUsed,
    marketEdgeScore,
    keyReasons,
    warningSigns,
  })

  return {
    ...bettingDecision,
    bettingDecision,
    signal,
    marketFocus: bettingDecision.final_pick === 'NO BET' ? 'NONE' : bettingDecision.final_pick,
    direction: bettingDecision.final_pick === 'AH' ? bettingDecision.ah_pick : bettingDecision.final_pick === 'OU' ? bettingDecision.ou_pick : 'NO BET',
    confidenceScore: bettingDecision.final_recommendation === 'NO BET' ? Math.min(decisionConfidence, 59) : decisionConfidence,
    riskLevel,
    keyReasons,
    warningSigns,
    marketSignal: hasOdds ? selected.marketSignal : 'ยังไม่มีข้อมูลตลาดราคา',
    finalSummary: bettingDecision.final_reason,
    ahAnalysis,
    ouAnalysis,
    primaryBookmaker: getPrimaryBookmaker(match),
    latestOdds: getPrimaryOddText(match, selected.marketFocus),
    hasOdds,
    pickTeam: apiPick.pickTeam,
    pickTeamId: apiPick.pickTeamId,
    pickSide: apiPick.pickSide,
    pickSource: apiPick.pickSource,
    pickMarket: apiPick.pickMarket,
    pickMarketId: apiPick.pickMarketId,
    pickSelection: apiPick.pickSelection,
    pickPrice: apiPick.pickPrice,
    pickConfidence: bettingDecision.final_recommendation === 'NO BET' ? null : decisionConfidence,
    pickReason: apiPick.reason,
  }
}

export function normalizeStoredAiFinalPick(row, match = {}) {
  if (!row) return generateAiFinalPick(match)
  const bettingDecision = buildSimpleBettingDecision({
    ...match,
    bettingDecision: row.betting_decision ?? row.bettingDecision ?? row,
  })
  return {
    ...bettingDecision,
    bettingDecision,
    signal: normalizeSignal(row.signal),
    marketFocus: bettingDecision.final_pick === 'NO BET' ? 'NONE' : bettingDecision.final_pick,
    direction: bettingDecision.final_pick === 'AH' ? bettingDecision.ah_pick : bettingDecision.final_pick === 'OU' ? bettingDecision.ou_pick : 'NO BET',
    confidenceScore: getDecisionConfidence(bettingDecision),
    riskLevel: normalizeRiskLevel(row.risk_level ?? row.riskLevel),
    keyReasons: toArray(row.key_reasons ?? row.keyReasons),
    warningSigns: toArray(row.warning_signs ?? row.warningSigns),
    marketSignal: row.market_signal ?? row.marketSignal ?? 'ยังไม่มีข้อมูลตลาดราคา',
    finalSummary: bettingDecision.final_reason,
    ahAnalysis: row.ah_analysis ?? row.ahAnalysis ?? null,
    ouAnalysis: row.ou_analysis ?? row.ouAnalysis ?? null,
    primaryBookmaker: row.primary_bookmaker ?? row.primaryBookmaker ?? null,
    latestOdds: row.latest_odds ?? row.latestOdds ?? null,
    hasOdds: Boolean(row.latest_odds ?? row.primary_bookmaker),
    pickTeam: row.pick_team ?? row.pickTeam ?? null,
    pickTeamId: row.pick_team_id ?? row.pickTeamId ?? null,
    pickSide: row.pick_side ?? row.pickSide ?? 'NONE',
    pickSource: row.pick_source ?? row.pickSource ?? 'NONE',
    pickMarket: row.pick_market ?? row.pickMarket ?? row.market_focus ?? row.marketFocus ?? null,
    pickMarketId: row.pick_market_id ?? row.pickMarketId ?? null,
    pickSelection: row.pick_selection ?? row.pickSelection ?? null,
    pickPrice: row.pick_price ?? row.pickPrice ?? null,
    pickConfidence: row.pick_confidence ?? row.pickConfidence ?? row.confidence_score ?? null,
  }
}

function chooseMarketAnalysis(ahAnalysis, ouAnalysis) {
  const ah = ahAnalysis ?? { marketFocus: 'AH', confidenceScore: 0, warnings: ['No AH analysis'] }
  const ou = ouAnalysis ?? { marketFocus: 'OU', confidenceScore: 0, warnings: ['No OU analysis'] }
  const ahScore = Number(ah.confidenceScore ?? 0)
  const ouScore = Number(ou.confidenceScore ?? 0)
  if (ahScore > ouScore + 5) return ah
  if (ouScore > ahScore + 5) return ou
  return riskWeight(ah.warnings) <= riskWeight(ou.warnings) ? ah : ou
}

function resolveSignal({ recommendation, totalAnalysisScore, selectionScore, confidenceScore, riskLevel, hasOdds, bookmakerCount, movementState, marketDataUsed, oddsRowsUsed, marketEdgeScore, keyReasons, warningSigns }) {
  if (
    totalAnalysisScore < 60 ||
    confidenceScore < 55 ||
    riskLevel === 'HIGH' ||
    !hasOdds ||
    movementState === 'against' ||
    warningSigns.length > 3
  ) {
    return 'SKIP'
  }
  if (
    recommendation === 'BET' &&
    totalAnalysisScore >= 78 &&
    confidenceScore >= 78 &&
    riskLevel !== 'HIGH' &&
    hasOdds &&
    marketDataUsed &&
    oddsRowsUsed > 0 &&
    marketEdgeScore >= 70
  ) {
    return 'STRONG_SIGNAL'
  }
  if (
    totalAnalysisScore >= 75 &&
    selectionScore >= 70 &&
    confidenceScore >= 70 &&
    riskLevel !== 'HIGH' &&
    hasOdds &&
    bookmakerCount >= 1 &&
    movementState !== 'against' &&
    keyReasons.length >= 3
  ) {
    return 'STRONG_SIGNAL'
  }
  return 'WATCH'
}

function getRiskFromWarnings(warnings = []) {
  if (warnings.length >= 3) return 'HIGH'
  if (warnings.length >= 1) return 'MEDIUM'
  return 'LOW'
}

function riskWeight(warnings = []) {
  return warnings.length
}

function getStoredReasons(match) {
  const raw = match.analysis?.raw ?? match.raw ?? {}
  return toArray(raw.keyReasons ?? raw.reasons ?? raw.analysis_reasons)
}

function getStoredWarnings(match) {
  const raw = match.analysis?.raw ?? match.raw ?? {}
  return toArray(raw.warningSigns ?? raw.warnings ?? raw.risk_factors)
}

function toArray(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (!value) return []
  if (typeof value === 'string') return [value]
  return []
}

function uniqueItems(items) {
  return [...new Set(items.map((item) => String(item).trim()).filter(Boolean))]
}

function normalizeSignal(value) {
  const text = String(value ?? '').toUpperCase()
  return signals.includes(text) ? text : 'SKIP'
}

function normalizeRecommendation(value) {
  const text = String(value ?? '').toUpperCase().replace('_', ' ')
  return ['BET', 'LEAN', 'WATCH', 'NO BET'].includes(text) ? text : 'NO BET'
}

function normalizeRiskLevel(value) {
  const text = String(value ?? '').toUpperCase()
  return riskLevels.includes(text) ? text : 'MEDIUM'
}

function scoreValue(value, fallback) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? clamp(numeric, 0, 100) : fallback
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
}
