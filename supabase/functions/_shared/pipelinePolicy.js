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
