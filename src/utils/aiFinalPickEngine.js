import { analyzeAsianHandicap } from './ahAnalysisEngine.js'
import { analyzeOverUnder } from './ouAnalysisEngine.js'
import { getPrimaryBookmaker, getPrimaryOddText, normalizeOddsRows } from './oddsUtils.js'

const signals = ['STRONG_SIGNAL', 'WATCH', 'SKIP']
const riskLevels = ['LOW', 'MEDIUM', 'HIGH']

export function generateAiFinalPick(match = {}) {
  const analysis = match.analysis ?? match.match_analysis ?? {}
  const ahAnalysis = match.aiFinalPick?.ahAnalysis ?? match.ai_final_pick?.ah_analysis ?? analyzeAsianHandicap(match)
  const ouAnalysis = match.aiFinalPick?.ouAnalysis ?? match.ai_final_pick?.ou_analysis ?? analyzeOverUnder(match)
  const selected = chooseMarketAnalysis(ahAnalysis, ouAnalysis)
  const oddsRows = normalizeOddsRows(match)
  const hasOdds = oddsRows.length > 0 || Boolean(selected.hasMarket)
  const totalAnalysisScore = scoreValue(analysis.ranking_score ?? analysis.ai_score ?? analysis.confidence_score ?? match.rankingScore ?? match.confidence, 0)
  const selectionScore = scoreValue(selected.confidenceScore, 0)
  const confidenceScore = clamp(Math.round(Math.max(selectionScore, Number(analysis.calibrated_confidence_score ?? analysis.confidence_score ?? selectionScore))), 0, 100)
  const riskLevel = normalizeRiskLevel(analysis.risk_level ?? match.riskLevel ?? getRiskFromWarnings(selected.warnings))
  const keyReasons = uniqueItems([...(selected.reasons ?? []), ...getStoredReasons(match)]).slice(0, 5)
  const warningSigns = uniqueItems([...(selected.warnings ?? []), ...getStoredWarnings(match)]).slice(0, 5)
  const bookmakerCount = Number(selected.bookmakerCount ?? new Set(oddsRows.map((row) => row.bookmaker).filter(Boolean)).size)
  const movementState = String(selected.marketSignal ?? '').toLowerCase().includes('against') ? 'against' : 'ok'
  const marketDataUsed = Boolean(analysis.market_data_used ?? analysis.raw?.market_data_used ?? hasOdds)
  const oddsRowsUsed = Number(analysis.odds_rows_used ?? analysis.raw?.odds_rows_used ?? oddsRows.length)
  const marketEdgeScore = scoreValue(analysis.market_edge_score ?? analysis.raw?.market_edge_score, 0)
  const recommendation = normalizeRecommendation(analysis.recommendation ?? match.recommendation)
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

  const safeMarketFocus = signal === 'SKIP' && !hasOdds ? 'NONE' : selected.marketFocus
  const direction = signal === 'SKIP' && !hasOdds ? 'No market direction' : selected.direction
  return {
    signal,
    marketFocus: safeMarketFocus,
    direction,
    confidenceScore: signal === 'SKIP' && !hasOdds ? Math.min(confidenceScore, 54) : confidenceScore,
    riskLevel,
    keyReasons,
    warningSigns,
    marketSignal: hasOdds ? selected.marketSignal : 'ยังไม่มีข้อมูลตลาดราคา',
    finalSummary: buildFinalSummary(signal, safeMarketFocus, direction, confidenceScore, riskLevel, hasOdds),
    ahAnalysis,
    ouAnalysis,
    primaryBookmaker: getPrimaryBookmaker(match),
    latestOdds: getPrimaryOddText(match, selected.marketFocus),
    hasOdds,
  }
}

export function normalizeStoredAiFinalPick(row, match = {}) {
  if (!row) return generateAiFinalPick(match)
  return {
    signal: normalizeSignal(row.signal),
    marketFocus: row.market_focus ?? row.marketFocus ?? 'NONE',
    direction: row.direction ?? 'No market direction',
    confidenceScore: clamp(Math.round(Number(row.confidence_score ?? row.confidenceScore ?? 0)), 0, 100),
    riskLevel: normalizeRiskLevel(row.risk_level ?? row.riskLevel),
    keyReasons: toArray(row.key_reasons ?? row.keyReasons),
    warningSigns: toArray(row.warning_signs ?? row.warningSigns),
    marketSignal: row.market_signal ?? row.marketSignal ?? 'ยังไม่มีข้อมูลตลาดราคา',
    finalSummary: row.final_summary ?? row.finalSummary ?? '',
    ahAnalysis: row.ah_analysis ?? row.ahAnalysis ?? null,
    ouAnalysis: row.ou_analysis ?? row.ouAnalysis ?? null,
    primaryBookmaker: row.primary_bookmaker ?? row.primaryBookmaker ?? null,
    latestOdds: row.latest_odds ?? row.latestOdds ?? null,
    hasOdds: Boolean(row.latest_odds ?? row.primary_bookmaker),
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

function buildFinalSummary(signal, marketFocus, direction, confidenceScore, riskLevel, hasOdds) {
  if (!hasOdds) return 'ยังไม่มีข้อมูลตลาดราคา AI Final Pick จึงจำกัดสัญญาณสูงสุดไม่ให้เป็น Strong Signal'
  if (signal === 'STRONG_SIGNAL') return `Strong Signal on ${marketFocus} ${direction} with ${confidenceScore}% confidence and ${riskLevel} risk.`
  if (signal === 'WATCH') return `Watch ${marketFocus} ${direction}. Data direction is useful but still needs confirmation.`
  return `Skip ${marketFocus} ${direction}. Risk or data conflict is too high for a final signal.`
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
