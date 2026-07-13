import { buildSimpleBettingDecision } from './bettingDecision.js'
import { buildDecisionDiagnostics, normalizeDecisionStatus } from './decisionClassification.js'
import { getMatchStatusInfo } from './matchStatus.js'

export function buildTodayMatchBuckets(matches = [], options = {}) {
  const rows = Array.isArray(matches) ? matches : []
  const buckets = rows.reduce((result, match) => {
    const status = getMatchStatusInfo(match)
    const analysis = normalizeAnalysis(match.analysis ?? match.match_analysis ?? {})
    const decision = buildSimpleBettingDecision({ ...match, analysis })
    const enriched = {
      ...match,
      analysis,
      match_analysis: analysis,
      bettingDecision: decision,
      betting_decision: decision,
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

    const decisionStatus = normalizeDecisionStatus(decision.decision_status ?? decision.status)

    if (decisionStatus === 'WAIT') {
      result.waitingMatches.push(enriched)
      return result
    }

    if (decisionStatus === 'READY' && decision.final_pick?.type !== 'NO_DECISION') {
      result.strongMatches.push(enriched)
      return result
    }

    result.watchMatches.push(enriched)
    return result
  }, createEmptyBuckets())

  buckets.summary = buildSummary(buckets, options)
  buckets.diagnostics = buildDecisionDiagnostics(buckets.playableMatches)
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
    notReadyReasons: buildNotReadyReasons([...buckets.watchMatches, ...buckets.waitingMatches]),
  }
}

function buildNotReadyReasons(matches = []) {
  const reasons = { market: 0, score: 0, risk: 0, analysis: 0, data: 0 }
  for (const match of matches) {
    const codes = match.bettingDecision?.decision_reason_codes ?? []
    if (codes.some((code) => String(code).includes('MARKET') || String(code).includes('AH_MISSING') || String(code).includes('OU_MISSING'))) reasons.market += 1
    if (codes.some((code) => String(code).includes('SCORE_BELOW'))) reasons.score += 1
    if (codes.some((code) => String(code).includes('RISK_HIGH'))) reasons.risk += 1
    if (codes.some((code) => String(code).includes('ANALYSIS'))) reasons.analysis += 1
    if (codes.some((code) => String(code).includes('DATA'))) reasons.data += 1
  }
  return reasons
}

function normalizeAnalysis(analysis = {}) {
  return Array.isArray(analysis) ? analysis[0] ?? {} : analysis ?? {}
}
