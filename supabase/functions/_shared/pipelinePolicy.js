export const requiredDailyPhases = Object.freeze(['core', 'fixture-enrichment', 'team-enrichment', 'league-enrichment', 'ranking'])

export function createContinuationState(value = {}) {
  return {
    providerPage: positiveInteger(value.providerPage, 1),
    fixtureOffset: nonNegativeInteger(value.fixtureOffset),
    oddsOffset: nonNegativeInteger(value.oddsOffset),
    processedFixtureCount: nonNegativeInteger(value.processedFixtureCount),
    lastProcessedFixtureId: nullableInteger(value.lastProcessedFixtureId),
    batchSignature: textOrNull(value.batchSignature),
    completedBatchSignatures: uniqueStrings(value.completedBatchSignatures).slice(-100),
    coreAuxiliaryComplete: Boolean(value.coreAuxiliaryComplete),
  }
}

export function advanceContinuation(current = {}, update = {}) {
  const previous = createContinuationState(current)
  const batchSignature = textOrNull(update.batchSignature)
  const completedBatchSignatures = batchSignature && update.batchComplete !== false
    ? uniqueStrings([...previous.completedBatchSignatures, batchSignature]).slice(-100)
    : previous.completedBatchSignatures
  return createContinuationState({
    ...previous,
    ...update,
    processedFixtureCount: update.processedFixtureCount ?? previous.processedFixtureCount,
    batchSignature: batchSignature ?? previous.batchSignature,
    completedBatchSignatures,
  })
}

export function shouldProcessBatch(continuation = {}, batchSignature) {
  const signature = textOrNull(batchSignature)
  return !signature || !createContinuationState(continuation).completedBatchSignatures.includes(signature)
}

export function buildBatchSignature(values = []) {
  const input = [...new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? '')).filter(Boolean))].join('|')
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}-${input.length}`
}

export async function collectProviderPages(fetchPage, params = {}, options = {}) {
  const maxPages = positiveInteger(options.maxPages, 100)
  const rows = []
  const visited = new Set()
  let page = positiveInteger(options.startPage, 1)
  let totalPages = page
  while (page <= totalPages && page <= maxPages) {
    if (visited.has(page)) throw new Error(`Provider pagination repeated page ${page}`)
    visited.add(page)
    const payload = await fetchPage({ ...params, page })
    rows.push(...(Array.isArray(payload?.response) ? payload.response : []))
    const current = positiveInteger(payload?.paging?.current, page)
    totalPages = positiveInteger(payload?.paging?.total, current)
    if (current >= totalPages) break
    page = current + 1
  }
  if (page < totalPages && visited.size >= maxPages) throw new Error(`Provider pagination exceeded ${maxPages} pages`)
  return { rows, pageCount: visited.size, lastPage: [...visited].at(-1) ?? 1, totalPages }
}

export function canRunRequiredPhase(steps = [], phase) {
  const index = requiredDailyPhases.indexOf(phase)
  if (index < 0) return false
  const byPhase = new Map((steps ?? []).map((step) => [step.phase, step]))
  return requiredDailyPhases.slice(0, index).every((required) => byPhase.get(required)?.status === 'success')
}

export function findNextRequiredStep(steps = [], now = Date.now()) {
  const sorted = [...(steps ?? [])].sort((a, b) => Number(a.step_order ?? 0) - Number(b.step_order ?? 0))
  for (const step of sorted) {
    if (step.status === 'success') continue
    return isStepRunnable(step, now) && canRunRequiredPhase(sorted, step.phase) ? step : null
  }
  return null
}

export function getDailySyncCacheDecision(run = {}, steps = [], options = {}) {
  const nowMs = validTimestamp(options.now, Date.now())
  const sorted = requiredDailyPhases
    .map((phase) => (steps ?? []).find((step) => step.phase === phase) ?? { phase, status: 'missing' })
  const firstIncomplete = sorted.find((step) => step.status !== 'success') ?? null
  const runStatus = String(run.status ?? '').toLowerCase()
  const currentPhase = String(run.current_phase ?? firstIncomplete?.phase ?? '') || null
  const terminalStatus = ['success', 'complete'].includes(runStatus) || currentPhase === 'complete'
  const base = {
    runId: run.id ?? null,
    runStatus: run.status ?? null,
    currentPhase,
    retryStep: firstIncomplete?.phase ?? null,
    nextRetryAt: firstIncomplete?.next_retry_at ?? null,
    canUseCachedSummary: false,
    shouldWait: false,
    shouldResume: false,
    needsSelfHeal: false,
  }

  if (terminalStatus && !firstIncomplete) {
    return {
      ...base,
      cacheDecision: 'hit',
      cacheBypassReason: null,
      canUseCachedSummary: true,
      continuationAction: 'return_terminal_cache',
    }
  }

  if (!firstIncomplete) {
    return {
      ...base,
      cacheDecision: 'bypass',
      cacheBypassReason: 'RUN_NOT_TERMINAL',
      shouldResume: true,
      continuationAction: 'finalize_existing_run',
    }
  }

  if (firstIncomplete.status === 'running') {
    return {
      ...base,
      cacheDecision: 'wait',
      cacheBypassReason: 'CONTINUATION_ALREADY_CLAIMED',
      shouldWait: true,
      continuationAction: 'wait_for_active_claim',
    }
  }

  const attemptCount = Number(firstIncomplete.attempt_count ?? 0)
  const maxAttempts = Number(firstIncomplete.max_attempts ?? 3)
  if (attemptCount >= maxAttempts) {
    return {
      ...base,
      cacheDecision: 'bypass',
      cacheBypassReason: 'RETRY_ATTEMPTS_EXHAUSTED',
      shouldResume: true,
      continuationAction: 'finalize_existing_run',
    }
  }

  const retryStatus = ['partial', 'pending_retry', 'failed'].includes(String(firstIncomplete.status ?? ''))
  const nextRetryMs = firstIncomplete.next_retry_at ? new Date(firstIncomplete.next_retry_at).getTime() : Number.NaN
  if (retryStatus && Number.isFinite(nextRetryMs) && nextRetryMs > nowMs) {
    return {
      ...base,
      cacheDecision: 'wait',
      cacheBypassReason: 'RETRY_NOT_DUE',
      shouldWait: true,
      continuationAction: 'wait_for_retry',
    }
  }

  if (retryStatus && Number.isFinite(nextRetryMs) && nextRetryMs <= nowMs) {
    return {
      ...base,
      cacheDecision: 'bypass',
      cacheBypassReason: 'RETRY_DUE_OR_OVERDUE',
      shouldResume: true,
      continuationAction: 'resume_existing_run',
    }
  }

  if (retryStatus || runStatus === 'partial' || runStatus === 'pending_retry') {
    return {
      ...base,
      cacheDecision: 'bypass',
      cacheBypassReason: 'MISSING_OR_INVALID_RETRY_SCHEDULE',
      shouldResume: true,
      needsSelfHeal: true,
      continuationAction: 'self_heal_and_resume',
    }
  }

  return {
    ...base,
    cacheDecision: 'bypass',
    cacheBypassReason: terminalStatus ? 'TERMINAL_RUN_HAS_REQUIRED_PENDING' : 'REQUIRED_STEP_PENDING',
    shouldResume: true,
    continuationAction: 'resume_existing_run',
  }
}

export function buildDailyStepClaim(step = {}, now = Date.now()) {
  if (!isStepRunnable(step, now)) return null
  const claimedAt = new Date(now).toISOString()
  const attemptCount = Number(step.attempt_count ?? 0) + 1
  return {
    expected: {
      id: step.id,
      status: String(step.status ?? 'pending'),
      attemptCount: Number(step.attempt_count ?? 0),
      nextRetryAt: step.next_retry_at ?? null,
    },
    update: {
      status: 'running',
      started_at: claimedAt,
      finished_at: null,
      error_message: null,
      attempt_count: attemptCount,
      last_attempt_at: claimedAt,
      next_retry_at: null,
    },
  }
}

export async function claimDailyStepOnce(step, compareAndSet, now = Date.now()) {
  const claim = buildDailyStepClaim(step, now)
  if (!claim) return { claimed: false, step: null, claim: null }
  const claimedStep = await compareAndSet(claim)
  return { claimed: Boolean(claimedStep), step: claimedStep ?? null, claim }
}

export function isStepRunnable(step = {}, now = Date.now()) {
  const status = String(step.status ?? 'pending')
  if (status === 'pending') return true
  if (!['pending_retry', 'partial', 'failed'].includes(status)) return false
  if (Number(step.attempt_count ?? 0) >= Number(step.max_attempts ?? 3)) return false
  const nextRetry = step.next_retry_at ? new Date(step.next_retry_at).getTime() : 0
  return !nextRetry || nextRetry <= new Date(now).getTime()
}

export function getRequiredRunStatus(steps = []) {
  const rows = steps ?? []
  if (!rows.length) return 'started'
  const byPhase = new Map(rows.map((step) => [step.phase, step]))
  if (requiredDailyPhases.every((phase) => byPhase.get(phase)?.status === 'success')) return 'success'
  if (rows.some((step) => step.status === 'running')) return 'running'
  if (rows.some((step) => step.status === 'failed' && Number(step.attempt_count ?? 0) >= Number(step.max_attempts ?? 3))) return 'failed'
  return rows.some((step) => ['partial', 'pending_retry', 'failed'].includes(step.status)) ? 'partial' : 'running'
}

export function calculateRequiredProgress(steps = []) {
  const byPhase = new Map((steps ?? []).map((step) => [step.phase, step]))
  const completed = requiredDailyPhases.filter((phase) => byPhase.get(phase)?.status === 'success').length
  return Math.round((completed / requiredDailyPhases.length) * 100)
}

export function auditPipelineState(run = {}, steps = [], options = {}) {
  const now = new Date(options.now ?? Date.now()).getTime()
  const staleAfterMs = Number(options.staleAfterMs ?? 15 * 60_000)
  const duplicateStepOrders = duplicateValues(steps, (step) => step.step_order)
  const duplicatePhases = duplicateValues(steps, (step) => step.phase)
  const staleRunning = steps.filter((step) => {
    if (step.status !== 'running') return false
    const updated = new Date(step.updated_at ?? step.last_attempt_at ?? step.started_at ?? 0).getTime()
    return Number.isFinite(updated) && now - updated > staleAfterMs
  })
  const pendingRetryMissingNext = steps.filter((step) => step.status === 'pending_retry' && !step.next_retry_at)
  const overdueRetry = steps.filter((step) => step.status === 'pending_retry' && step.next_retry_at && new Date(step.next_retry_at).getTime() < now)
  const attemptsExceeded = steps.filter((step) => Number(step.attempt_count ?? 0) > Number(step.max_attempts ?? 3))
  const incompleteRequired = requiredDailyPhases.filter((phase) => !steps.some((step) => step.phase === phase && step.status === 'success'))
  const successWithIncomplete = run.status === 'success' && incompleteRequired.length > 0
  const persistedProgress = run.progress_percent ?? run.summary?.progressPercent
  const progress = persistedProgress == null ? calculateRequiredProgress(steps) : Number(persistedProgress)
  const invalidProgress = Number.isFinite(progress) && (progress < 0 || progress > 100 || (run.status === 'success' && progress !== 100))
  return { duplicateStepOrders, duplicatePhases, staleRunning, pendingRetryMissingNext, overdueRetry, attemptsExceeded, incompleteRequired, successWithIncomplete, invalidProgress, progress }
}

export function auditPipelineCompletion(run = {}, steps = [], options = {}) {
  const now = new Date(options.now ?? Date.now()).getTime()
  const state = auditPipelineState(run, steps, options)
  const byPhase = new Map((steps ?? []).map((step) => [step.phase, step]))
  const requiredPendingSteps = requiredDailyPhases
    .map((phase) => byPhase.get(phase))
    .filter((step) => step && step.status !== 'success')
  const retrySteps = requiredPendingSteps.filter((step) => step.status === 'pending_retry')
  const validRetrySteps = retrySteps.filter((step) => {
    const retryAt = new Date(step.next_retry_at ?? 0).getTime()
    return Number.isFinite(retryAt)
      && retryAt > now
      && Number(step.attempt_count ?? 0) < Number(step.max_attempts ?? 3)
  })
  const status = String(run.status ?? '').toLowerCase()
  const phase = String(run.current_phase ?? '').toLowerCase()
  const violations = []

  if (status === 'partial' && requiredPendingSteps.length && !validRetrySteps.length) {
    violations.push('PARTIAL_WITHOUT_VALID_CONTINUATION')
  }
  if (status === 'partial' && requiredPendingSteps.some((step) => ['pending', 'partial'].includes(step.status)) && !validRetrySteps.length) {
    violations.push('REQUIRED_PENDING_WITHOUT_SCHEDULE')
  }
  if (status === 'failed') violations.push('FAILED_TERMINAL_RUN')
  if (status === 'success' && requiredPendingSteps.length) violations.push('SUCCESS_WITH_INCOMPLETE_REQUIRED_STEPS')
  if (phase === 'complete' && requiredPendingSteps.length) violations.push('COMPLETE_WITH_INCOMPLETE_REQUIRED_STEPS')
  if ((status === 'success' || phase === 'complete') && state.progress < 100) violations.push('TERMINAL_PROGRESS_BELOW_100')

  const retryStep = retrySteps[0] ?? null
  const retryAt = retryStep?.next_retry_at ? new Date(retryStep.next_retry_at).getTime() : null
  return {
    ...state,
    requiredPendingSteps,
    retrySteps,
    validRetrySteps,
    violations: [...new Set(violations)],
    nextRetryAt: retryStep?.next_retry_at ?? null,
    overdueDurationMs: retryAt !== null && Number.isFinite(retryAt) && retryAt < now ? now - retryAt : 0,
    cursor: retryStep?.continuation_state ?? requiredPendingSteps[0]?.continuation_state ?? null,
  }
}

function duplicateValues(rows, getter) {
  const seen = new Set()
  const duplicates = new Set()
  for (const row of rows ?? []) {
    const value = getter(row)
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  return [...duplicates]
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? '').trim()).filter(Boolean))]
}

function nonNegativeInteger(value) {
  const number = Number(value ?? 0)
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0
}

function positiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback
}

function nullableInteger(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.floor(number) : null
}

function textOrNull(value) {
  const text = String(value ?? '').trim()
  return text || null
}

function validTimestamp(value, fallback) {
  const timestamp = new Date(value ?? fallback).getTime()
  return Number.isFinite(timestamp) ? timestamp : new Date(fallback).getTime()
}
