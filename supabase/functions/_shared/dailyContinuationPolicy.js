export const PLANNED_CONTINUATION_RETRY_DELAY_MS = 15_000
export const STUCK_CONTINUATION_THRESHOLD = 3

export function getContinuationPolicyMetadata(step = {}) {
  const summary = objectValue(step?.summary)
  return objectValue(summary?.details?.continuationPolicy ?? summary?.continuationPolicy)
}

export function getStepFailureAttemptCount(step = {}) {
  const explicit = nonNegativeIntegerOrNull(getContinuationPolicyMetadata(step).failureAttemptCount)
  if (explicit !== null) return explicit
  const summary = objectValue(step?.summary)
  if (isLegacyPlannedSummary(summary)) return 0
  if (step?.status === 'failed' || hasRealFailureSignal(summary)) return nonNegativeInteger(step?.attempt_count)
  return 0
}

export function getStepStuckContinuationCount(step = {}) {
  return nonNegativeInteger(getContinuationPolicyMetadata(step).stuckContinuationCount)
}

export function hasContinuationProgress(previous = {}, next = {}) {
  const before = continuationSnapshot(previous)
  const after = continuationSnapshot(next)
  return after.providerPage > before.providerPage
    || after.fixtureOffset > before.fixtureOffset
    || after.oddsOffset > before.oddsOffset
    || after.processedFixtureCount > before.processedFixtureCount
    || (!before.coreAuxiliaryComplete && after.coreAuxiliaryComplete)
    || after.completedBatchSignatures.some((signature) => !before.completedBatchSignatures.includes(signature))
}

export function validateContinuationTransition(previous = {}, next = {}) {
  const before = continuationSnapshot(previous)
  const after = continuationSnapshot(next)
  const regressedField = ['providerPage', 'fixtureOffset', 'oddsOffset', 'processedFixtureCount']
    .find((field) => after[field] < before[field])
  if (regressedField) return { valid: false, reason: `CURSOR_REGRESSION:${regressedField}` }
  if (before.coreAuxiliaryComplete && !after.coreAuxiliaryComplete) return { valid: false, reason: 'CURSOR_REGRESSION:coreAuxiliaryComplete' }
  if (before.completedBatchSignatures.some((signature) => !after.completedBatchSignatures.includes(signature))) {
    return { valid: false, reason: 'CURSOR_REGRESSION:completedBatchSignatures' }
  }
  return { valid: true, reason: null }
}

export function classifyDailyStepContinuation(summary = {}, options = {}) {
  const previousContinuation = options.previousContinuation ?? {}
  const nextContinuation = options.nextContinuation ?? summary?.continuationState ?? previousContinuation
  const previousFailureAttemptCount = nonNegativeInteger(options.previousFailureAttemptCount)
  const previousStuckContinuationCount = nonNegativeInteger(options.previousStuckContinuationCount)
  const transition = validateContinuationTransition(previousContinuation, nextContinuation)
  const cursorProgress = transition.valid && hasContinuationProgress(previousContinuation, nextContinuation)
  const executionBudgetDeferred = options.executionBudgetDeferred === true
    || summary?.details?.reason === 'SOFT_DEADLINE_REACHED'
    || summary?.details?.continuationSignals?.executionBudgetDeferred === true
  const partial = summary?.status === 'partial_success'
    || summary?.status === 'pending_retry'
    || summary?.partial === true

  if (!transition.valid) {
    return realFailurePolicy(transition.reason, previousFailureAttemptCount, previousStuckContinuationCount + 1, cursorProgress)
  }
  if (hasRealFailureSignal(summary)) {
    return realFailurePolicy(realFailureReason(summary), previousFailureAttemptCount, 0, cursorProgress)
  }
  if (!partial) {
    return {
      kind: 'success',
      reason: 'STEP_COMPLETE',
      planned: false,
      consumesFailureBudget: false,
      failureAttemptCount: previousFailureAttemptCount,
      stuckContinuationCount: 0,
      cursorProgress,
    }
  }
  if (cursorProgress || executionBudgetDeferred) {
    return {
      kind: 'planned_continuation',
      reason: cursorProgress ? 'CURSOR_ADVANCED' : 'EXECUTION_BUDGET_DEFERRED',
      planned: true,
      consumesFailureBudget: false,
      failureAttemptCount: previousFailureAttemptCount,
      stuckContinuationCount: 0,
      cursorProgress,
    }
  }

  const stuckContinuationCount = previousStuckContinuationCount + 1
  if (stuckContinuationCount >= STUCK_CONTINUATION_THRESHOLD) {
    return realFailurePolicy('STUCK_CONTINUATION', previousFailureAttemptCount, stuckContinuationCount, false)
  }
  return {
    kind: 'planned_continuation',
    reason: 'PROGRESS_THRESHOLD_PENDING',
    planned: true,
    consumesFailureBudget: false,
    failureAttemptCount: previousFailureAttemptCount,
    stuckContinuationCount,
    cursorProgress: false,
  }
}

export function buildDailyContinuationRetryPlan(continuationPolicy, options = {}) {
  const claimedAttemptCount = nonNegativeInteger(options.claimedAttemptCount)
  const maxAttempts = positiveInteger(options.maxAttempts, 3)
  const nowMs = validTimestamp(options.now, Date.now())
  const persistedAttemptCount = Math.max(0, claimedAttemptCount - 1)
  if (continuationPolicy?.kind === 'success') {
    return { retry: false, exhausted: false, nextRetryAt: null, persistedAttemptCount }
  }
  if (continuationPolicy?.kind === 'planned_continuation') {
    return {
      retry: true,
      exhausted: false,
      nextRetryAt: new Date(nowMs + PLANNED_CONTINUATION_RETRY_DELAY_MS).toISOString(),
      persistedAttemptCount,
    }
  }
  const failureAttemptCount = nonNegativeInteger(continuationPolicy?.failureAttemptCount)
  const exhausted = failureAttemptCount >= maxAttempts
  return {
    retry: !exhausted,
    exhausted,
    nextRetryAt: exhausted ? null : new Date(nowMs + realFailureRetryDelayMs(failureAttemptCount)).toISOString(),
    persistedAttemptCount: claimedAttemptCount,
  }
}

function hasRealFailureSignal(summary = {}) {
  return summary?.status === 'error'
    || Number(summary?.failed ?? 0) > 0
    || (Array.isArray(summary?.failures) && summary.failures.length > 0)
    || Number(summary?.details?.continuationSignals?.resultFailureCount ?? 0) > 0
    || summary?.rateLimited === true
    || Boolean(summary?.details?.errorCode)
}

function isLegacyPlannedSummary(summary = {}) {
  return summary?.status !== 'error'
    && (summary?.status === 'partial_success' || summary?.status === 'pending_retry' || summary?.partial === true)
    && Number(summary?.failed ?? 0) === 0
    && (!Array.isArray(summary?.failures) || summary.failures.length === 0)
    && summary?.rateLimited !== true
    && !summary?.details?.errorCode
}

function realFailureReason(summary = {}) {
  if (summary?.details?.errorCode) return String(summary.details.errorCode)
  if (summary?.rateLimited === true) return 'RATE_LIMITED'
  if (Number(summary?.details?.continuationSignals?.resultFailureCount ?? 0) > 0) return 'RESULT_FAILURES_REPORTED'
  if (Number(summary?.failed ?? 0) > 0) return 'FAILED_COUNT_REPORTED'
  if (Array.isArray(summary?.failures) && summary.failures.length > 0) return 'FAILURES_REPORTED'
  return 'STEP_EXECUTION_ERROR'
}

function realFailurePolicy(reason, previousFailureAttemptCount, stuckContinuationCount, cursorProgress) {
  return {
    kind: 'real_failure',
    reason,
    planned: false,
    consumesFailureBudget: true,
    failureAttemptCount: previousFailureAttemptCount + 1,
    stuckContinuationCount,
    cursorProgress,
  }
}

function realFailureRetryDelayMs(failureAttemptCount) {
  if (failureAttemptCount <= 1) return 60_000
  if (failureAttemptCount === 2) return 3 * 60_000
  return 5 * 60_000
}

function continuationSnapshot(value = {}) {
  const row = objectValue(value)
  return {
    providerPage: positiveInteger(row.providerPage, 1),
    fixtureOffset: nonNegativeInteger(row.fixtureOffset),
    oddsOffset: nonNegativeInteger(row.oddsOffset),
    processedFixtureCount: nonNegativeInteger(row.processedFixtureCount),
    completedBatchSignatures: uniqueStrings(row.completedBatchSignatures),
    coreAuxiliaryComplete: Boolean(row.coreAuxiliaryComplete),
  }
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? '').trim()).filter(Boolean))]
}

function nonNegativeInteger(value) {
  const number = Number(value ?? 0)
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0
}

function nonNegativeIntegerOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null
}

function positiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback
}

function validTimestamp(value, fallback) {
  const timestamp = new Date(value ?? fallback).getTime()
  return Number.isFinite(timestamp) ? timestamp : new Date(fallback).getTime()
}
