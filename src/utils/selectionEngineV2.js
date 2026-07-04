import { getMarketReadinessGroup, marketReadinessGroups, recommendationLabels, riskLabels } from './analysisEngine.js'
import { getMatchStatusInfo, matchStatusGroups } from './matchStatus.js'

export const selectionV2Reasons = {
  marketReadyCandidatesAvailable: 'market_ready_candidates_available',
  allMatchesFinished: 'all_matches_finished',
  tooFewPlayableToday: 'too_few_playable_today',
  noPlayableCandidates: 'no_playable_candidates',
  noMarketReadyCandidates: 'no_market_ready_candidates',
  usingNextWindowCandidates: 'using_next_window_candidates',
  waitingMarketData: 'waiting_market_data',
  readyDisplayOk: 'ready_display_ok',
}

export const selectionPriorityTiers = {
  ready: 'A',
  seen: 'B',
  waiting: 'C',
  finished: 'D',
}

const hourMs = 60 * 60 * 1000

export function buildUsableDailySelection(matches = [], options = {}) {
  const now = normalizeDate(options.now)
  const windowHours = positiveNumber(options.windowHours, 36)
  const maxWindowHours = Math.max(windowHours, positiveNumber(options.maxWindowHours, 48))
  const minPlayable = positiveNumber(options.minPlayable, 5)
  const limit = positiveNumber(options.limit, 10)
  const rows = (Array.isArray(matches) ? matches : []).map((match) => buildSelectionCandidate(match, now))

  const windowStart = now
  const firstWindowEnd = new Date(windowStart.getTime() + windowHours * hourMs)
  const maxWindowEnd = new Date(windowStart.getTime() + maxWindowHours * hourMs)
  const firstWindowRows = rows.filter((row) => isInWindow(row, windowStart, firstWindowEnd))
  const firstWindowPlayable = firstWindowRows.filter((row) => row.playable)
  const useExpandedWindow = firstWindowPlayable.length < minPlayable
  const windowEnd = useExpandedWindow ? maxWindowEnd : firstWindowEnd
  const windowRows = rows.filter((row) => isInWindow(row, windowStart, windowEnd))
  const playableRows = windowRows.filter((row) => row.playable)
  const finishedRows = rows.filter((row) => row.statusGroup === matchStatusGroups.finished)
  const selected = playableRows
    .sort(compareSelectionCandidates)
    .slice(0, limit)
    .map((row, index) => ({
      ...normalizeDisplayMatch(row.match),
      selectionV2: {
        priorityTier: row.priorityTier,
        marketReadiness: row.marketReadiness,
        statusGroup: row.statusGroup,
        leagueMarketCoverageScore: row.leagueMarketCoverageScore,
        recentOddsCoverageRate: row.recentOddsCoverageRate,
        marketAvailabilityTier: row.marketAvailabilityTier,
      },
      displayRank: index + 1,
      display_rank: index + 1,
      finalRank: index + 1,
      final_rank: index + 1,
      rank: index + 1,
      aiPickRank: index + 1,
      ai_pick_rank: index + 1,
      aiPickLabel: `AI PICK #${index + 1}`,
      ai_pick_label: `AI PICK #${index + 1}`,
    }))

  const readySelectedCount = selected.filter((match) => match.selectionV2?.priorityTier === selectionPriorityTiers.ready || match.selectionV2?.priorityTier === selectionPriorityTiers.seen).length
  const waitingSelectedCount = selected.filter((match) => match.selectionV2?.priorityTier === selectionPriorityTiers.waiting).length
  const marketReadyCandidates = playableRows.filter((row) => row.priorityTier === selectionPriorityTiers.ready).length
  const waitingMarketCandidates = playableRows.filter((row) => row.priorityTier === selectionPriorityTiers.waiting).length

  return {
    selected,
    candidates: playableRows,
    finishedExcluded: finishedRows,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    windowHoursUsed: useExpandedWindow ? maxWindowHours : windowHours,
    expandedWindow: useExpandedWindow,
    totalFixturesInWindow: windowRows.length,
    playableCandidates: playableRows.length,
    marketReadyCandidates,
    waitingMarketCandidates,
    finishedExcludedCount: finishedRows.length,
    selectedCount: selected.length,
    readySelectedCount,
    waitingSelectedCount,
    displayedSignalCount: selected.filter((match) => ['STRONG_SIGNAL', 'WATCH'].includes(getSignal(match))).length,
    resultsPageEligibleCount: rows.filter((row) => row.statusGroup === matchStatusGroups.finished).length,
    reason: getSelectionReason({
      selectedCount: selected.length,
      playableCandidates: playableRows.length,
      marketReadyCandidates,
      waitingMarketCandidates,
      finishedExcludedCount: finishedRows.length,
      expandedWindow: useExpandedWindow,
      totalFixturesInWindow: windowRows.length,
    }),
    nextSyncSuggestion: marketReadyCandidates > 0 ? 'refresh_display_order' : 'sync_odds_then_reselect',
  }
}

export function buildSelectionCandidate(match = {}, now = new Date()) {
  const status = getMatchStatusInfo(match)
  const marketReadiness = status.isPlayable ? getMarketReadinessGroup(match) : null
  const priorityTier = getPriorityTier(match, status.group, marketReadiness)
  const leagueCoverage = getLeagueCoverage(match)
  return {
    match,
    kickoffTime: getKickoffTime(match),
    statusGroup: status.group,
    playable: status.isPlayable,
    marketReadiness,
    priorityTier,
    priorityValue: priorityValue(priorityTier),
    signalPriority: signalPriority(match),
    marketEdgeScore: numberValue(match.marketEdgeScore ?? match.market_edge_score ?? match.analysis?.market_edge_score),
    confidenceScore: numberValue(match.confidence ?? match.confidence_score ?? match.calibratedConfidence ?? match.calibrated_confidence_score ?? match.analysis?.calibrated_confidence_score ?? match.analysis?.confidence_score),
    rankingScore: numberValue(match.rankingScore ?? match.ranking_score ?? match.analysis?.ranking_score),
    riskValue: riskValue(match.riskLevel ?? match.risk_level ?? match.analysis?.risk_level),
    leagueMarketCoverageScore: leagueCoverage.score,
    recentOddsCoverageRate: leagueCoverage.rate,
    marketAvailabilityTier: leagueCoverage.tier,
    isPast: getKickoffTime(match) < now.getTime(),
  }
}

function normalizeDisplayMatch(match = {}) {
  const analysis = Array.isArray(match.analysis) ? match.analysis[0] : match.analysis
  return {
    ...match,
    kickoffAt: match.kickoffAt ?? match.kickoff_at,
    status: match.statusShort ?? match.status_short ?? match.match_status ?? match.status,
    statusShort: match.statusShort ?? match.status_short ?? match.match_status ?? match.status,
    status_short: match.status_short ?? match.statusShort ?? match.match_status ?? match.status,
    homeGoals: match.homeGoals ?? match.home_goals ?? match.home_score,
    awayGoals: match.awayGoals ?? match.away_goals ?? match.away_score,
    homeScore: match.homeScore ?? match.home_score ?? match.home_goals,
    awayScore: match.awayScore ?? match.away_score ?? match.away_goals,
    analysis,
    recommendation: match.recommendation ?? analysis?.recommendation,
    riskLevel: match.riskLevel ?? match.risk_level ?? analysis?.risk_level,
    rankingScore: match.rankingScore ?? match.ranking_score ?? analysis?.ranking_score,
    confidence: match.confidence ?? match.confidence_score ?? analysis?.calibrated_confidence_score ?? analysis?.confidence_score,
  }
}

export function compareSelectionCandidates(a, b) {
  const priorityDiff = a.priorityValue - b.priorityValue
  const coverageDiff = b.leagueMarketCoverageScore - a.leagueMarketCoverageScore
  const signalDiff = a.signalPriority - b.signalPriority
  const marketEdgeDiff = b.marketEdgeScore - a.marketEdgeScore
  const rankingDiff = b.rankingScore - a.rankingScore
  const confidenceDiff = b.confidenceScore - a.confidenceScore
  const riskDiff = a.riskValue - b.riskValue
  const kickoffDiff = a.kickoffTime - b.kickoffTime
  return priorityDiff || coverageDiff || signalDiff || marketEdgeDiff || rankingDiff || confidenceDiff || riskDiff || kickoffDiff
}

function getPriorityTier(match, statusGroup, marketReadiness) {
  if (statusGroup === matchStatusGroups.finished) return selectionPriorityTiers.finished
  if (statusGroup !== matchStatusGroups.upcoming && statusGroup !== matchStatusGroups.live) return 'Z'
  if (isPriorityA(match, marketReadiness)) return selectionPriorityTiers.ready
  if (marketReadiness === marketReadinessGroups.ready || marketReadiness === marketReadinessGroups.seen) return selectionPriorityTiers.seen
  return selectionPriorityTiers.waiting
}

function isPriorityA(match, marketReadiness) {
  const analysis = match.analysis ?? match.match_analysis ?? {}
  const hasOdds = getOddsRowCount(match) > 0
  const analysisStatus = String(analysis.analysis_status ?? match.analysisStatus ?? match.analysis_status ?? '').toUpperCase()
  const marketDataUsed = Boolean(analysis.market_data_used ?? match.marketDataUsed ?? match.market_data_used)
  const marketEdgeScore = numberValue(match.marketEdgeScore ?? match.market_edge_score ?? analysis.market_edge_score)
  const risk = normalizeRisk(match.riskLevel ?? match.risk_level ?? analysis.risk_level)
  const recommendation = normalizeRecommendation(match.recommendation ?? analysis.recommendation)
  const signal = getSignal(match)
  return hasOdds &&
    marketDataUsed &&
    analysisStatus === 'MARKET_DATA_READY_RECALCULATED' &&
    marketEdgeScore > 0 &&
    risk !== riskLabels.high &&
    (signal === 'STRONG_SIGNAL' || recommendation === recommendationLabels.bet) &&
    marketReadiness !== marketReadinessGroups.waiting
}

function getSelectionReason(summary) {
  if (summary.playableCandidates === 0 && summary.finishedExcludedCount > 0) return selectionV2Reasons.allMatchesFinished
  if (summary.playableCandidates === 0) return selectionV2Reasons.noPlayableCandidates
  if (summary.expandedWindow && summary.playableCandidates > 0) return selectionV2Reasons.usingNextWindowCandidates
  if (summary.marketReadyCandidates > 0) return selectionV2Reasons.marketReadyCandidatesAvailable
  if (summary.waitingMarketCandidates > 0) return selectionV2Reasons.waitingMarketData
  return selectionV2Reasons.noMarketReadyCandidates
}

function isInWindow(row, start, end) {
  return row.kickoffTime >= start.getTime() && row.kickoffTime < end.getTime()
}

function priorityValue(tier) {
  if (tier === selectionPriorityTiers.ready) return 1
  if (tier === selectionPriorityTiers.seen) return 2
  if (tier === selectionPriorityTiers.waiting) return 3
  if (tier === selectionPriorityTiers.finished) return 4
  return 5
}

function getLeagueCoverage(match) {
  const rawRate = numberValue(
    match.recentOddsCoverageRate ??
      match.recent_odds_coverage_rate ??
      match.league?.recent_odds_coverage_rate ??
      match.league?.recentOddsCoverageRate,
  )
  const hasOdds = getOddsRowCount(match) > 0
  const rate = rawRate > 0 ? Math.min(rawRate > 1 ? rawRate / 100 : rawRate, 1) : hasOdds ? 0.7 : 0
  const tier = rate >= 0.7 ? 'HIGH' : rate >= 0.35 ? 'MEDIUM' : rate > 0 ? 'LOW' : 'NONE'
  const score = Math.round((rate || (hasOdds ? 0.55 : 0.05)) * 100)
  return { rate, tier, score }
}

function getOddsRowCount(match) {
  const rows = match.odds ?? match.matchOdds ?? match.match_odds ?? match.enrichment?.odds ?? []
  const analysis = match.analysis ?? match.match_analysis ?? {}
  const pick = match.aiFinalPick ?? match.ai_final_pick ?? {}
  return Array.isArray(rows) ? rows.length : numberValue(analysis.odds_rows_used ?? pick.oddsRowsUsed ?? pick.odds_rows_used)
}

function getSignal(match) {
  return String(match.aiFinalPick?.signal ?? match.ai_final_pick?.signal ?? match.dailyTop10Lock?.signal ?? match.signal ?? '').toUpperCase()
}

function signalPriority(match) {
  const signal = getSignal(match)
  const recommendation = normalizeRecommendation(match.recommendation ?? match.analysis?.recommendation)
  if (signal === 'STRONG_SIGNAL' && recommendation === recommendationLabels.bet) return 1
  if (signal === 'STRONG_SIGNAL') return 2
  if (signal === 'WATCH' || recommendation === recommendationLabels.lean || recommendation === recommendationLabels.watch) return 3
  return 4
}

function riskValue(value) {
  const risk = normalizeRisk(value)
  if (risk === riskLabels.low) return 0
  if (risk === riskLabels.medium) return 1
  return 2
}

function normalizeRisk(value) {
  const normalized = String(value ?? '').toUpperCase()
  if (normalized === riskLabels.low) return riskLabels.low
  if (normalized === riskLabels.high) return riskLabels.high
  return riskLabels.medium
}

function normalizeRecommendation(value) {
  const normalized = String(value ?? '').toUpperCase().replace('_', ' ')
  if (normalized === recommendationLabels.bet) return recommendationLabels.bet
  if (normalized === recommendationLabels.lean) return recommendationLabels.lean
  if (normalized === recommendationLabels.watch) return recommendationLabels.watch
  return recommendationLabels.noBet
}

function getKickoffTime(match) {
  const time = new Date(match.kickoffAt ?? match.kickoff_at ?? 0).getTime()
  return Number.isFinite(time) ? time : 0
}

function positiveNumber(value, fallback) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

function numberValue(value) {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now())
  return Number.isNaN(date.getTime()) ? new Date() : date
}
