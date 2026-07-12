import { getMarketReadinessGroup, marketReadinessGroups, recommendationLabels, riskLabels } from './analysisEngine.js'
import { buildFootballIntelligence, getLegacyDailySelectionFields } from './footballIntelligenceEngine.js'
import { buildStrictApiFootballCandidate, buildStrictApiFootballSelection, compareStrictApiFootballCandidates } from './marketDisplay.js'
import { getMatchStatusInfo, matchStatusGroups } from './matchStatus.js'
import { selectDailyTop10 } from './dailySelectionEngine.js'

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

export function buildUsableDailySelection(matches = [], options = {}) {
  const now = normalizeDate(options.now)
  const selectionDate = options.selectionDate ?? getBangkokDateKey(now)
  const limit = positiveNumber(options.limit ?? options.maxCandidates, 60)
  const rows = (Array.isArray(matches) ? matches : []).map((match) => buildSelectionCandidate(match, now))
  const dateRows = rows.filter((row) => getBangkokDateKey(row.match.kickoffAt ?? row.match.kickoff_at) === selectionDate)
  const playableRows = dateRows.filter((row) => row.playable)
  const finishedRows = dateRows.filter((row) => row.statusGroup === matchStatusGroups.finished)
  const dailySelection = selectDailyTop10(playableRows.map((row) => row.match), { now, selectionDate, limit })
  const candidateByKey = new Map(playableRows.map((row) => [getCandidateKey(row.match), row]))
  const selected = dailySelection.selected
    .map((selectionRow) => ({ selectionRow, row: candidateByKey.get(getCandidateKey(selectionRow.match)) }))
    .filter((item) => item.row)
    .map(({ row, selectionRow }, index) => ({
      ...normalizeDisplayMatch(row.match),
      footballIntelligence: row.unified,
      football_intelligence: row.unified,
      bettingDecision: row.bettingDecision,
      betting_decision: row.bettingDecision,
      decision: row.unified.decision,
      unifiedScore: row.unified.unified_score,
      unified_score: row.unified.unified_score,
      confidence: row.unified.confidence,
      riskLevel: row.unified.risk_level,
      risk_level: row.unified.risk_level,
      ...getLegacyDailySelectionFields(row.unified),
      selectionV2: {
        algorithmVersion: dailySelection.algorithmVersion,
        priorityTier: row.priorityTier,
        marketReadiness: row.marketReadiness,
        hardFilter: selectionRow.hardFilter,
        softRanking: selectionRow.softRanking,
        selectionStatus: selectionRow.selectionStatus,
        decisionStatus: selectionRow.decisionStatus,
        decisionRank: selectionRow.decisionRank,
        decisionAudit: selectionRow.decision,
        selectionTier: selectionRow.tier,
        statusGroup: row.statusGroup,
        decision: row.unified.decision,
        status: row.unified.status,
        unifiedScore: row.unified.unified_score,
        leagueMarketCoverageScore: row.leagueMarketCoverageScore,
        recentOddsCoverageRate: row.recentOddsCoverageRate,
        marketAvailabilityTier: row.marketAvailabilityTier,
      },
      displayRank: index + 1,
      display_rank: index + 1,
      finalRank: selectionRow.decisionRank ?? null,
      final_rank: selectionRow.decisionRank ?? null,
      rank: selectionRow.decisionRank ?? null,
      aiPickRank: selectionRow.decisionRank ?? null,
      ai_pick_rank: selectionRow.decisionRank ?? null,
      aiPickLabel: selectionRow.decisionRank ? `AI PICK #${selectionRow.decisionRank}` : statusLabel(selectionRow.decisionStatus),
      ai_pick_label: selectionRow.decisionRank ? `AI PICK #${selectionRow.decisionRank}` : statusLabel(selectionRow.decisionStatus),
    }))

  const readySelectedCount = selected.filter((match) => isReadyDecisionStatus(match.selectionV2?.decisionStatus)).length
  const waitingSelectedCount = selected.filter((match) => match.selectionV2?.decisionStatus === 'WAITING_MARKET').length
  const marketReadyCandidates = playableRows.filter((row) => row.marketReadiness !== marketReadinessGroups.waiting).length
  const waitingMarketCandidates = playableRows.filter((row) => row.unified.status === 'WAITING_MARKET').length

  return {
    selected,
    candidates: playableRows,
    finishedExcluded: finishedRows,
    windowStart: `${selectionDate}T00:00:00+07:00`,
    windowEnd: `${selectionDate}T23:59:59+07:00`,
    windowHoursUsed: 24,
    expandedWindow: false,
    selectionDate,
    totalFixturesInWindow: dateRows.length,
    playableCandidates: playableRows.length,
    eligibleCandidateCount: dailySelection.summary.eligibleCandidateCount,
    hardFilterPassed: dailySelection.summary.hardFilterPassed,
    hardFilterRejected: dailySelection.summary.hardFilterRejected,
    marketReadyCandidates,
    waitingMarketCandidates,
    finishedExcludedCount: finishedRows.length,
    selectedCount: selected.length,
    healthStatus: dailySelection.summary.healthStatus,
    primarySelected: dailySelection.summary.primarySelected,
    secondarySelected: dailySelection.summary.secondarySelected,
    fallbackSelected: dailySelection.summary.fallbackSelected,
    readyCount: dailySelection.summary.readyCount,
    watchCount: dailySelection.summary.watchCount,
    waitingMarketCount: dailySelection.summary.waitingMarketCount,
    rejectedCount: dailySelection.summary.rejectedCount,
    coreCandidates: dailySelection.summary.coreCandidates,
    expandedCandidates: dailySelection.summary.expandedCandidates,
    marketProbedCandidates: dailySelection.summary.marketProbedCandidates,
    expansionSteps: dailySelection.summary.expansionSteps,
    expansionStopReason: dailySelection.summary.expansionStopReason,
    pipelineVersion: dailySelection.pipelineVersion,
    selectionAlgorithmVersion: dailySelection.algorithmVersion,
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
      expandedWindow: false,
      totalFixturesInWindow: dateRows.length,
    }),
    nextSyncSuggestion: marketReadyCandidates > 0 ? 'refresh_display_order' : 'sync_odds_then_reselect',
  }
}

function statusLabel(status) {
  if (status === 'READY_PRIMARY') return 'PRIMARY'
  if (status === 'READY_ALTERNATIVE') return 'ALT'
  if (status === 'WATCH') return 'WATCH'
  if (status === 'WAITING_MARKET') return 'รอราคา'
  return 'ไม่เข้าเกณฑ์'
}

function isReadyDecisionStatus(status) {
  return ['READY_PRIMARY', 'READY_ALTERNATIVE', 'READY'].includes(String(status ?? '').toUpperCase())
}

export function buildStrictDailyApiFootballSelection(matches = [], options = {}) {
  return buildStrictApiFootballSelection(matches, options)
}

export function buildSelectionCandidate(match = {}, now = new Date()) {
  const status = getMatchStatusInfo(match)
  const unified = buildFootballIntelligence(match)
  const marketReadiness = status.isPlayable ? getMarketReadinessGroup(match) : null
  const priorityTier = getPriorityTier(match, status.group, marketReadiness)
  const leagueCoverage = getLeagueCoverage(match)
  const strictApiFootball = buildStrictApiFootballCandidate(match)
  return {
    match,
    unified,
    bettingDecision: {
      match_view: unified.winner_prediction,
      winner_prediction: unified.winner_prediction,
      ah_pick: unified.ah_pick,
      ou_pick: unified.ou_pick,
      final_pick: unified.final_pick,
      confidence: unified.confidence,
      status: unified.status,
      decision: unified.decision,
      unified_score: unified.unified_score,
      risk_level: unified.risk_level,
      reasons: unified.reasons,
      warnings: unified.warnings,
      score_breakdown: unified.score_breakdown,
      data_state: unified.data_state,
      market_state: unified.market_state,
      unified: true,
    },
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
    hasApiFootballOdds: strictApiFootball.hasApiFootballOdds,
    hasPrimaryMarket: strictApiFootball.hasPrimaryMarket,
    marketPriority: strictApiFootball.marketPriority,
    decisionPriority: decisionPriority(unified),
    unifiedScore: numberValue(unified.unified_score),
    unifiedConfidence: numberValue(unified.confidence),
    hasPickTeam: Boolean(strictApiFootball.pickTeam),
    strictApiFootball,
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
  const unifiedDiff = a.decisionPriority - b.decisionPriority
  if (unifiedDiff) return unifiedDiff
  const priorityDiff = a.priorityValue - b.priorityValue
  const coverageDiff = b.leagueMarketCoverageScore - a.leagueMarketCoverageScore
  const unifiedScoreDiff = b.unifiedScore - a.unifiedScore
  const unifiedConfidenceDiff = b.unifiedConfidence - a.unifiedConfidence
  const strictDiff = compareStrictApiFootballCandidates(a.strictApiFootball, b.strictApiFootball)
  const signalDiff = a.signalPriority - b.signalPriority
  const marketEdgeDiff = b.marketEdgeScore - a.marketEdgeScore
  const rankingDiff = b.rankingScore - a.rankingScore
  const confidenceDiff = b.confidenceScore - a.confidenceScore
  const riskDiff = a.riskValue - b.riskValue
  const kickoffDiff = a.kickoffTime - b.kickoffTime
  return unifiedScoreDiff || unifiedConfidenceDiff || priorityDiff || coverageDiff || strictDiff || signalDiff || marketEdgeDiff || rankingDiff || confidenceDiff || riskDiff || kickoffDiff
}

export function planDailyTop10Persistence(existingRows = [], selectedRows = []) {
  const rankRows = new Map(existingRows.map((row) => [Number(row.rank), row]))
  const exactRows = new Map(existingRows.map((row) => [row.match_id ?? row.matchId, row]))
  const assignedRowIds = new Set()
  const deletedRowIds = new Set()
  const operations = []
  let duplicateRankResolved = 0

  selectedRows.forEach((row, index) => {
    const rank = index + 1
    const matchId = row.match_id ?? row.matchId ?? row.id
    const exactRow = exactRows.get(matchId)
    if (exactRow?.id && Number(exactRow.rank) !== rank) {
      operations.push({ type: 'delete_conflict', id: exactRow.id, rank: exactRow.rank, matchId })
      assignedRowIds.add(exactRow.id)
      deletedRowIds.add(exactRow.id)
      duplicateRankResolved += 1
    }
  })

  selectedRows.forEach((row, index) => {
    const rank = index + 1
    const matchId = row.match_id ?? row.matchId ?? row.id
    const rawRankRow = rankRows.get(rank)
    const rawExactRow = exactRows.get(matchId)
    const rankRow = rawRankRow?.id && !deletedRowIds.has(rawRankRow.id) ? rawRankRow : null
    const exactRow = rawExactRow?.id && !deletedRowIds.has(rawExactRow.id) ? rawExactRow : null
    let targetRow = rankRow ?? exactRow ?? null

    if (targetRow?.id && assignedRowIds.has(targetRow.id)) targetRow = null

    if (targetRow?.id) {
      assignedRowIds.add(targetRow.id)
      operations.push({ type: 'update', id: targetRow.id, rank, matchId })
    } else {
      operations.push({ type: 'insert', rank, matchId })
    }
  })

  const finalRows = applyDailyTop10Plan(existingRows, operations)
  return {
    operations,
    rowsUpdated: operations.filter((item) => item.type === 'update').length,
    rowsInserted: operations.filter((item) => item.type === 'insert').length,
    rowsSkipped: selectedRows.length ? 0 : existingRows.length,
    duplicateRankResolved,
    finalRows,
    duplicateRanks: findDuplicateKeys(finalRows, (row) => `${row.selection_date}:${row.rank}`),
    duplicateMatches: findDuplicateKeys(finalRows, (row) => `${row.selection_date}:${row.match_id}`),
  }
}

function applyDailyTop10Plan(existingRows, operations) {
  const rows = new Map(existingRows.map((row) => [row.id, { ...row }]))
  let insertIndex = 0
  for (const operation of operations) {
    if (operation.type === 'delete_conflict') {
      rows.delete(operation.id)
    } else if (operation.type === 'update') {
      const existing = rows.get(operation.id)
      if (existing) rows.set(operation.id, { ...existing, rank: operation.rank, match_id: operation.matchId })
    } else if (operation.type === 'insert') {
      insertIndex += 1
      rows.set(`insert-${insertIndex}`, {
        id: `insert-${insertIndex}`,
        selection_date: existingRows[0]?.selection_date ?? '2026-07-04',
        rank: operation.rank,
        match_id: operation.matchId,
      })
    }
  }
  return [...rows.values()]
}

function findDuplicateKeys(rows, getKey) {
  const seen = new Set()
  const duplicates = []
  for (const row of rows) {
    const key = getKey(row)
    if (seen.has(key)) duplicates.push(key)
    else seen.add(key)
  }
  return duplicates
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
  return Array.isArray(rows) ? rows.filter((row) => row?.id || row?.match_id || row?.matchId).length : 0
}

function getCandidateKey(match = {}) {
  return String(match.api_sports_fixture_id ?? match.api_fixture_id ?? match.fixtureId ?? match.fixture_id ?? match.id ?? match.match_id ?? '')
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

function decisionPriority(unified = {}) {
  if (unified.decision === 'BET') return 1
  if (unified.decision === 'LEAN') return 2
  if (unified.decision === 'WATCH' && unified.status !== 'WAITING_MARKET') return 3
  if (unified.status === 'WAITING_MARKET') return 4
  return 5
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

function getBangkokDateKey(value) {
  const date = normalizeDate(value)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}
