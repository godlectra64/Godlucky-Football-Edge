import { buildSimpleBettingDecision } from './bettingDecision.js'
import { buildFootballIntelligence } from './footballIntelligenceEngine.js'
import { getMatchStatusInfo } from './matchStatus.js'

export function buildTodayMatchBuckets(matches = [], options = {}) {
  const rows = Array.isArray(matches) ? matches : []
  const buckets = rows.reduce((result, match) => {
    const status = getMatchStatusInfo(match)
    const analysis = normalizeAnalysis(match.analysis ?? match.match_analysis ?? {})
    const unified = match.footballIntelligence ?? match.football_intelligence ?? buildFootballIntelligence({ ...match, analysis })
    const decision = match.bettingDecision ?? match.betting_decision ?? buildSimpleBettingDecision({ ...match, analysis, footballIntelligence: unified })
    const enriched = {
      ...match,
      analysis,
      match_analysis: analysis,
      footballIntelligence: unified,
      football_intelligence: unified,
      bettingDecision: decision,
      betting_decision: decision,
      unifiedScore: unified.unified_score,
      unified_score: unified.unified_score,
      decision: unified.decision,
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

    if (unified.status === 'WAITING_MARKET') {
      result.waitingMatches.push(enriched)
      return result
    }

    if (unified.decision === 'BET') {
      result.strongMatches.push(enriched)
      return result
    }

    if (unified.decision === 'LEAN' || unified.decision === 'WATCH') {
      result.watchMatches.push(enriched)
      return result
    }

    result.predictionOnlyMatches.push(enriched)
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
    predictionOnlyMatches: [],
    finishedMatches: [],
    hiddenMatches: [],
    notPlayableMatches: [],
    summary: {},
  }
}

function buildSummary(buckets, options = {}) {
  const totalVisible = buckets.strongMatches.length + buckets.watchMatches.length + buckets.waitingMatches.length + buckets.predictionOnlyMatches.length
  const sourceLockedCount = Number(options.lockedCount ?? 0)
  return {
    totalMatches: buckets.allMatches.length,
    playableCount: buckets.playableMatches.length,
    selectedCount: Number(options.selectedCount ?? buckets.playableMatches.length),
    strongCount: buckets.strongMatches.length,
    watchCount: buckets.watchMatches.length,
    waitingCount: buckets.waitingMatches.length,
    predictionOnlyCount: buckets.predictionOnlyMatches.length,
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

function normalizeAnalysis(analysis = {}) {
  return Array.isArray(analysis) ? analysis[0] ?? {} : analysis ?? {}
}
