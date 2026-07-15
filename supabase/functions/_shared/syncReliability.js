export const DEFAULT_SYNC_EXECUTION_BUDGET_MS = 40_000
export const MAX_SYNC_EXECUTION_BUDGET_MS = 45_000
export const MIN_SYNC_EXECUTION_BUDGET_MS = 15_000
export const DEFAULT_DEADLINE_RESERVE_MS = 5_000
export const MIN_PHASE_START_REMAINING_MS = 15_000
export const MAX_DAILY_SYNC_STEPS_PER_REQUEST = 2
export const UPSTREAM_BODY_PREVIEW_LIMIT = 512

const sensitiveKeyPattern = /authorization|apikey|api[_-]?key|sb_secret|secret|token|service[_-]?role|password|credential/i

export class UpstreamResponseError extends Error {
  constructor({ errorCode, errorStage, provider, status = null, contentType = null, bodyPreview = null, cause = null }) {
    const normalizedStatus = finiteNumberOrNull(status)
    const message = buildUpstreamErrorMessage(errorCode, provider, normalizedStatus)
    super(message, cause ? { cause } : undefined)
    this.name = 'UpstreamResponseError'
    this.errorCode = errorCode
    this.errorStage = errorStage
    this.provider = provider
    this.status = normalizedStatus
    this.contentType = sanitizeText(contentType, { maxLength: 160 }) || null
    this.bodyPreview = sanitizeText(bodyPreview, { maxLength: UPSTREAM_BODY_PREVIEW_LIMIT }) || null
    this.errorDetails = {
      status: this.status,
      contentType: this.contentType,
      bodyPreview: this.bodyPreview,
    }
  }
}

export function createExecutionBudget(startedAtMs = Date.now(), requestedBudgetMs) {
  const numeric = Number(requestedBudgetMs)
  const budgetMs = Number.isFinite(numeric) && numeric > 0
    ? clamp(Math.floor(numeric), MIN_SYNC_EXECUTION_BUDGET_MS, MAX_SYNC_EXECUTION_BUDGET_MS)
    : DEFAULT_SYNC_EXECUTION_BUDGET_MS
  return {
    startedAtMs,
    budgetMs,
    softDeadlineAt: startedAtMs + budgetMs,
    reserveMs: DEFAULT_DEADLINE_RESERVE_MS,
  }
}

export function getRemainingExecutionMs(budget, now = Date.now()) {
  return Math.max(0, Number(budget?.softDeadlineAt ?? 0) - Number(now))
}

export function shouldDeferExecution(budget, now = Date.now(), minimumRemainingMs = DEFAULT_DEADLINE_RESERVE_MS) {
  return getRemainingExecutionMs(budget, now) <= Math.max(0, Number(minimumRemainingMs) || 0)
}

export function buildDeadlinePendingSummary({ stepOrder = 0, phase = 'daily-sync', durationMs = 0, continuation = {}, reason = 'SOFT_DEADLINE_REACHED' } = {}) {
  return {
    step: Number(stepOrder) || 0,
    mode: String(phase || 'daily-sync'),
    status: 'pending_retry',
    processed: 0,
    totalCandidates: 0,
    rowsSaved: 0,
    failed: 0,
    skipped: 0,
    rateLimited: false,
    durationMs: Math.max(0, Number(durationMs) || 0),
    message: reason,
    partial: true,
    continuationState: sanitizeContinuation(continuation),
    details: { reason },
  }
}

export async function parseUpstreamJsonResponse(response, { provider = 'upstream', errorStage = 'upstream-request' } = {}) {
  const contentType = response.headers.get('content-type') || ''
  const text = await response.text()
  const looksHtml = isHtmlResponse(contentType, text)
  if (looksHtml) {
    throw new UpstreamResponseError({
      errorCode: provider === 'supabase' && isTimeoutStatus(response.status) ? 'SUPABASE_UPSTREAM_TIMEOUT' : 'UPSTREAM_HTML_ERROR',
      errorStage,
      provider,
      status: response.status,
      contentType,
      bodyPreview: truncateBodyPreview(text),
    })
  }

  if (!text.trim()) return { data: {}, text: '' }
  try {
    return { data: JSON.parse(text), text: sanitizeText(text, { maxLength: UPSTREAM_BODY_PREVIEW_LIMIT }) }
  } catch (cause) {
    throw new UpstreamResponseError({
      errorCode: 'UPSTREAM_INVALID_JSON',
      errorStage,
      provider,
      status: response.status,
      contentType,
      bodyPreview: truncateBodyPreview(text),
      cause,
    })
  }
}

export function buildSyncFailureLog({ mode, errorResponse, error, durationMs }, options = {}) {
  const sanitizeOptions = { secrets: options.secrets, maxLength: options.maxLength ?? 1_000 }
  return {
    mode: sanitizeText(mode, sanitizeOptions),
    errorCode: sanitizeText(errorResponse?.errorCode, sanitizeOptions),
    errorStage: sanitizeText(errorResponse?.errorStage, sanitizeOptions),
    provider: sanitizeText(errorResponse?.provider, sanitizeOptions),
    errorMessage: sanitizeText(errorResponse?.errorMessage, sanitizeOptions),
    errorDetails: sanitizeDiagnosticValue(errorResponse?.errorDetails ?? null, sanitizeOptions),
    failures: sanitizeDiagnosticValue(errorResponse?.failures ?? [], sanitizeOptions),
    durationMs: Math.max(0, Number(durationMs) || 0),
    stack: sanitizeText(error?.stack, { ...sanitizeOptions, maxLength: 4_000 }) || null,
    cause: sanitizeDiagnosticValue(normalizeCause(error?.cause), sanitizeOptions),
  }
}

export function buildPhaseLog({ runId, dateKey, stepOrder, phase, durationMs = 0, continuation = {}, error = null }, options = {}) {
  const sanitizeOptions = { secrets: options.secrets, maxLength: options.maxLength ?? 1_000 }
  return {
    runId: sanitizeText(runId, sanitizeOptions) || null,
    dateKey: sanitizeText(dateKey, sanitizeOptions) || null,
    stepOrder: Number(stepOrder) || 0,
    phase: sanitizeText(phase, sanitizeOptions),
    durationMs: Math.max(0, Number(durationMs) || 0),
    continuation: sanitizeContinuation(continuation),
    errorMessage: error ? sanitizeText(error?.message ?? error, sanitizeOptions) : null,
    stack: error ? sanitizeText(error?.stack, { ...sanitizeOptions, maxLength: 4_000 }) || null : null,
    cause: error ? sanitizeDiagnosticValue(normalizeCause(error?.cause), sanitizeOptions) : null,
  }
}

export function buildFinishLogFailureLog({ mode, error, durationMs }, options = {}) {
  const sanitizeOptions = { secrets: options.secrets, maxLength: options.maxLength ?? 1_000 }
  return {
    mode: sanitizeText(mode, sanitizeOptions),
    errorMessage: sanitizeText(error?.message ?? error ?? 'finishLog failed', sanitizeOptions),
    durationMs: Math.max(0, Number(durationMs) || 0),
    stack: sanitizeText(error?.stack, { ...sanitizeOptions, maxLength: 4_000 }) || null,
    cause: sanitizeDiagnosticValue(normalizeCause(error?.cause), sanitizeOptions),
  }
}

export async function finishLogBestEffort(worker, onFailure = () => {}) {
  try {
    await worker()
    return true
  } catch (error) {
    onFailure(error)
    return false
  }
}

export function sanitizeDiagnosticValue(value, options = {}, depth = 0) {
  if (value === null || value === undefined) return value ?? null
  if (typeof value === 'string') return sanitizeText(value, options)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (depth >= 5) return '[truncated]'
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => sanitizeDiagnosticValue(item, options, depth + 1))
  if (value instanceof Error) {
    return {
      name: sanitizeText(value.name, options),
      message: sanitizeText(value.message, options),
      stack: sanitizeText(value.stack, { ...options, maxLength: 4_000 }) || null,
      cause: sanitizeDiagnosticValue(normalizeCause(value.cause), options, depth + 1),
    }
  }
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !sensitiveKeyPattern.test(key))
      .slice(0, 50)
      .map(([key, item]) => [key, sanitizeDiagnosticValue(item, options, depth + 1)]))
  }
  return sanitizeText(value, options)
}

export function sanitizeText(value, { secrets = [], maxLength = 1_000 } = {}) {
  let text = String(value ?? '')
  for (const secret of Array.isArray(secrets) ? secrets.filter(Boolean) : []) {
    text = text.split(String(secret)).join('[masked]')
  }
  text = text
    .replace(/sb_secret_[A-Za-z0-9._-]+/g, 'sb_secret_[masked]')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [masked]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, 'jwt_[masked]')
    .replace(/(api[_-]?key|apikey|secret|token|authorization)(\s*[:=]\s*)([^&\s,;]+)/gi, '$1$2[masked]')
  const limit = Math.max(0, Number(maxLength) || 0)
  return limit && text.length > limit ? `${text.slice(0, limit)}...[truncated]` : text
}

export function sanitizeContinuation(value = {}) {
  const row = value && typeof value === 'object' ? value : {}
  return {
    providerPage: positiveInteger(row.providerPage, 1),
    fixtureOffset: nonNegativeInteger(row.fixtureOffset),
    oddsOffset: nonNegativeInteger(row.oddsOffset),
    processedFixtureCount: nonNegativeInteger(row.processedFixtureCount),
    lastProcessedFixtureId: finiteNumberOrNull(row.lastProcessedFixtureId),
    batchSignature: sanitizeText(row.batchSignature, { maxLength: 160 }) || null,
    completedBatchSignatures: [...new Set((Array.isArray(row.completedBatchSignatures) ? row.completedBatchSignatures : [])
      .map((item) => sanitizeText(item, { maxLength: 160 }))
      .filter(Boolean))].slice(-100),
    coreAuxiliaryComplete: Boolean(row.coreAuxiliaryComplete),
  }
}

export function isHtmlResponse(contentType, body) {
  const normalizedType = String(contentType ?? '').toLowerCase()
  const prefix = String(body ?? '').trimStart().slice(0, 256).toLowerCase()
  return normalizedType.includes('text/html') || prefix.startsWith('<!doctype html') || prefix.startsWith('<html')
}

export function truncateBodyPreview(body) {
  return sanitizeText(String(body ?? '').replace(/\s+/g, ' ').trim(), { maxLength: UPSTREAM_BODY_PREVIEW_LIMIT })
}

function buildUpstreamErrorMessage(errorCode, provider, status) {
  if (errorCode === 'SUPABASE_UPSTREAM_TIMEOUT') return `Supabase upstream timed out${status ? ` (HTTP ${status})` : ''}`
  if (errorCode === 'UPSTREAM_HTML_ERROR') return `${provider} returned HTML instead of JSON${status ? ` (HTTP ${status})` : ''}`
  return `${provider} returned invalid JSON${status ? ` (HTTP ${status})` : ''}`
}

function isTimeoutStatus(status) {
  return [408, 504, 522, 524].includes(Number(status))
}

function normalizeCause(cause) {
  if (!cause) return null
  if (cause instanceof Error) return { name: cause.name, message: cause.message, stack: cause.stack ?? null, cause: normalizeCause(cause.cause) }
  return cause
}

function finiteNumberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function nonNegativeInteger(value) {
  const number = Number(value ?? 0)
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0
}

function positiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}
