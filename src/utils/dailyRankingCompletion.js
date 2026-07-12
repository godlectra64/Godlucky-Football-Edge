export function buildRankingCompletionState(input = {}) {
  const selectedCount = nonNegativeInteger(input.selectedCount)
  const eligibleCandidateCount = nonNegativeInteger(input.eligibleCandidateCount)
  const expectedSelectedCount = selectedCount
  const writeFailures = nonNegativeInteger(input.writeFailures)
  const invalidScores = nonNegativeInteger(input.invalidScores)
  const duplicateRanks = nonNegativeInteger(input.duplicateRanks)
  const duplicateFixtures = nonNegativeInteger(input.duplicateFixtures)
  const hardFilterViolations = nonNegativeInteger(input.hardFilterViolations)
  const finalPickViolations = nonNegativeInteger(input.finalPickViolations)
  const retryableFailure = Boolean(input.retryableFailure)

  const invariantFailures = [
    selectedCount > eligibleCandidateCount ? 'SELECTED_COUNT_EXCEEDS_ELIGIBLE' : null,
    invalidScores > 0 ? 'INVALID_SCORE' : null,
    duplicateRanks > 0 ? 'DUPLICATE_RANK' : null,
    duplicateFixtures > 0 ? 'DUPLICATE_FIXTURE' : null,
    hardFilterViolations > 0 ? 'HARD_FILTER_VIOLATION' : null,
    finalPickViolations > 0 ? 'FAKE_FINAL_PICK' : null,
  ].filter(Boolean)

  if (writeFailures > 0 || retryableFailure) {
    return {
      rankingStatus: 'pending_retry',
      selectionCompleted: false,
      retryable: true,
      retryReasonCode: writeFailures > 0 ? 'DATABASE_WRITE_FAILED' : 'RETRYABLE_RANKING_FAILURE',
      selectionHealth: 'WRITE_FAILED',
      expectedSelectedCount,
      marketReadinessStatus: getMarketReadinessStatus(input.rankingReadiness, selectedCount),
      bettingReadiness: getBettingReadiness(input.rankingReadiness, selectedCount),
      invariantFailures,
    }
  }

  if (invariantFailures.length > 0) {
    return {
      rankingStatus: 'failed',
      selectionCompleted: false,
      retryable: false,
      retryReasonCode: invariantFailures[0],
      selectionHealth: 'FAILED',
      expectedSelectedCount,
      marketReadinessStatus: getMarketReadinessStatus(input.rankingReadiness, selectedCount),
      bettingReadiness: getBettingReadiness(input.rankingReadiness, selectedCount),
      invariantFailures,
    }
  }

  return {
    rankingStatus: 'success',
    selectionCompleted: true,
    retryable: false,
    retryReasonCode: 'NONE',
    selectionHealth: selectedCount > 0 ? 'DYNAMIC_BOARD_READY' : eligibleCandidateCount > 0 ? 'NO_DECISION_READY' : 'NO_ELIGIBLE_CANDIDATES',
    expectedSelectedCount,
    marketReadinessStatus: getMarketReadinessStatus(input.rankingReadiness, selectedCount),
    bettingReadiness: getBettingReadiness(input.rankingReadiness, selectedCount),
    invariantFailures: [],
  }
}

export function getMarketReadinessStatus(rankingReadiness = {}, selectedCount = 0) {
  const ready = nonNegativeInteger(rankingReadiness.ready)
  const partial = nonNegativeInteger(rankingReadiness.partial)
  const pending = nonNegativeInteger(rankingReadiness.pending)
  const noMarketData = nonNegativeInteger(rankingReadiness.noMarketData)
  const marketData = nonNegativeInteger(rankingReadiness.hasMarketDataCount)
  if (selectedCount > 0 && ready >= selectedCount) return 'market_ready'
  if (ready > 0 || partial > 0 || marketData > 0) return 'market_partial'
  if (pending > 0 || noMarketData > 0 || selectedCount > 0) return 'waiting_market'
  return 'unknown'
}

export function getBettingReadiness(rankingReadiness = {}, selectedCount = 0) {
  return getMarketReadinessStatus(rankingReadiness, selectedCount) === 'market_ready' ? 'READY' : 'NOT_READY'
}

function nonNegativeInteger(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return 0
  return Math.floor(numeric)
}
