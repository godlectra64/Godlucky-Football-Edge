import {
  getConfidence,
  getMarketReadinessGroup,
  getRecommendation,
  isWaitingForMarketData,
  marketReadinessGroups,
  recommendationLabels,
} from './analysisEngine.js'
import { getMatchStatusInfo } from './matchStatus.js'

export function buildTodayMatchBuckets(matches = [], options = {}) {
  const rows = Array.isArray(matches) ? matches : []
  const buckets = rows.reduce((result, match) => {
    const status = getMatchStatusInfo(match)
    const analysis = normalizeAnalysis(match.analysis ?? match.match_analysis ?? {})
    const enriched = {
      ...match,
      analysis,
      match_analysis: analysis,
      matchStatusGroup: status.group,
      isFinished: status.isFinished,
      isPlayable: status.isPlayable,
    }

    result.allMatches.push(enriched)

    if (status.isFinished) {
      result.finishedMatches.push(enriched)
      return result
    }

    if (!status.isPlayable) {
      result.notPlayableMatches.push(enriched)
      result.hiddenMatches.push(enriched)
      return result
    }

    result.playableMatches.push(enriched)

    if (isWaitingForMarketData(enriched)) {
      result.waitingMatches.push(enriched)
      return result
    }

    if (isStrongTodayPick(enriched)) {
      result.strongMatches.push(enriched)
      return result
    }

    result.watchMatches.push(enriched)
    return result
  }, createEmptyBuckets())

  buckets.summary = buildSummary(buckets, options)
  return buckets
}

export function buildTodayStatusBuckets(matches = [], options = {}) {
  return buildTodayMatchBuckets(matches, options)
}

function createEmptyBuckets() {
  return {
    allMatches: [],
    playableMatches: [],
    strongMatches: [],
    watchMatches: [],
    waitingMatches: [],
    finishedMatches: [],
    hiddenMatches: [],
    notPlayableMatches: [],
    summary: {},
  }
}

function buildSummary(buckets, options = {}) {
  const totalVisible = buckets.strongMatches.length + buckets.watchMatches.length + buckets.waitingMatches.length
  const sourceLockedCount = Number(options.lockedCount ?? 0)
  return {
    totalMatches: buckets.allMatches.length,
    playableCount: buckets.playableMatches.length,
    selectedCount: Number(options.selectedCount ?? buckets.playableMatches.length),
    strongCount: buckets.strongMatches.length,
    watchCount: buckets.watchMatches.length,
    waitingCount: buckets.waitingMatches.length,
    finishedCount: Number(options.finishedCount ?? buckets.finishedMatches.length),
    hiddenCount: buckets.hiddenMatches.length,
    visibleCount: totalVisible,
    lockedCount: sourceLockedCount,
    locked: Boolean(options.locked ?? sourceLockedCount > 0),
    windowHours: Number(options.windowHours ?? 36),
    hasDisplayMatches: totalVisible > 0,
    hasStrongPick: buckets.strongMatches.length > 0,
    hasWaitingOnly: totalVisible > 0 && buckets.strongMatches.length === 0 && buckets.watchMatches.length === 0,
    hasFinishedOnly: totalVisible === 0 && (buckets.finishedMatches.length > 0 || Number(options.finishedCount ?? 0) > 0),
  }
}

function isStrongTodayPick(match = {}) {
  if (getMarketReadinessGroup(match) !== marketReadinessGroups.ready) return false

  const analysis = normalizeAnalysis(match.analysis ?? match.match_analysis ?? {})
  const pick = match.aiFinalPick ?? match.ai_final_pick ?? {}
  const lock = match.dailyTop10Lock ?? match.daily_top10_lock ?? {}
  const signal = String(pick.signal ?? lock.signal ?? '').toUpperCase()
  const recommendation = String(match.recommendation ?? analysis.recommendation ?? getRecommendation(match)).toUpperCase().replace('_', ' ')
  const confidence = Number(match.confidence ?? analysis.calibrated_confidence_score ?? getConfidence(match) ?? 0)
  const risk = String(match.riskLevel ?? match.risk_level ?? analysis.risk_level ?? '').toUpperCase()
  const analysisStatus = String(analysis.analysis_status ?? analysis.raw?.analysis_status ?? pick.analysisStatus ?? pick.analysis_status ?? '').toUpperCase()

  if (risk === 'HIGH') return false
  if (signal === 'STRONG_SIGNAL') return true
  if (recommendation === recommendationLabels.bet) return true
  return analysisStatus === 'MARKET_DATA_READY_RECALCULATED' && confidence >= 72
}

function normalizeAnalysis(analysis = {}) {
  return Array.isArray(analysis) ? analysis[0] ?? {} : analysis ?? {}
}
