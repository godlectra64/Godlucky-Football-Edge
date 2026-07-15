import { findNextRequiredStep, requiredDailyPhases } from './pipelinePolicy.js'

export function buildCachedFinalDailySummary(steps = [], storedSummary = null) {
  const summary = {
    ...buildFinalDailySummary(steps),
    ...objectValue(storedSummary),
  }
  return {
    ...summary,
    rankingReadiness: nonEmptyObject(summary.rankingReadiness) ?? emptyRankingReadinessSummary(),
    fixtureEnrichment: nonEmptyObject(summary.fixtureEnrichment) ?? emptyFixtureEnrichmentSummary(),
    analysisSummary: nonEmptyObject(summary.analysisSummary) ?? emptyAnalysisDailySummary(),
  }
}

export function buildDailyRunSummaryCached(steps = [], storedRunSummary = null, latest = null) {
  const stored = objectValue(storedRunSummary)
  return {
    ...stored,
    completed: steps.filter((step) => ['success', 'skipped'].includes(step.status)).length,
    failed: countDailySteps(steps, 'failed'),
    partial: countDailySteps(steps, 'partial'),
    processed: sumStepField(steps, 'processed'),
    rowsSaved: sumStepField(steps, 'rows_saved'),
    skipped: sumStepField(steps, 'skipped'),
    rateLimited: steps.some((step) => step.rate_limited),
    finalSummary: buildCachedFinalDailySummary(steps, stored.finalSummary),
    latest,
  }
}

export function buildDailySyncStartPayload(mode, state, durationMs, options = {}) {
  const now = options.now ?? Date.now()
  const steps = state?.steps ?? []
  const nextStep = findNextRequiredStep(steps, now)
  const waitingRetry = !nextStep ? findWaitingRetryStep(steps, now) : null
  const finalSummary = options.finalSummary ?? buildCachedFinalDailySummary(steps, state?.run?.summary?.finalSummary)
  return {
    mode,
    runId: state?.run?.id ?? null,
    phase: nextStep?.phase ?? waitingRetry?.phase ?? null,
    status: state?.run?.status ?? 'started',
    processed: 0,
    totalCandidates: steps.length,
    rowsSaved: 0,
    failed: countDailySteps(steps, 'failed'),
    skipped: countDailySteps(steps, 'skipped'),
    rateLimited: false,
    durationMs,
    steps,
    finalSummary,
    rankingReadiness: finalSummary.rankingReadiness,
    ...calculateRunProgress(steps, now),
    retryAfterSeconds: getRetryAfterSeconds(waitingRetry, now),
    nextAction: nextStep ? 'call daily-sync-next' : waitingRetry ? 'Retry after next_retry_at' : 'daily sync already completed',
    nextRequestExample: nextStep || waitingRetry ? { mode: 'daily-sync-next', runId: state?.run?.id } : { mode: 'daily-sync-status', runId: state?.run?.id },
  }
}

export function buildDailySyncStatusPayload(mode, state, durationMs, message = '', options = {}) {
  const now = options.now ?? Date.now()
  const steps = state?.steps ?? []
  const nextStep = findNextRequiredStep(steps, now)
  const waitingRetry = !nextStep ? findWaitingRetryStep(steps, now) : null
  const finalSummary = options.finalSummary ?? buildCachedFinalDailySummary(steps, state?.run?.summary?.finalSummary)
  return {
    mode,
    runId: state?.run?.id ?? null,
    phase: nextStep?.phase ?? waitingRetry?.phase ?? state?.run?.current_phase ?? null,
    status: waitingRetry ? 'pending_retry' : state?.run?.status ?? 'started',
    processed: sumStepField(steps, 'processed'),
    totalCandidates: steps.length,
    rowsSaved: sumStepField(steps, 'rows_saved'),
    failed: countDailySteps(steps, 'failed'),
    skipped: countDailySteps(steps, 'skipped'),
    rateLimited: steps.some((step) => step.rate_limited),
    durationMs,
    steps,
    finalSummary,
    rankingReadiness: finalSummary.rankingReadiness,
    ...calculateRunProgress(steps, now),
    retryAfterSeconds: getRetryAfterSeconds(waitingRetry, now),
    nextAction: nextStep ? 'call daily-sync-next again' : waitingRetry ? 'Retry after next_retry_at' : message || 'daily sync complete',
    nextRequestExample: nextStep || waitingRetry ? { mode: 'daily-sync-next', runId: state?.run?.id } : { mode: 'daily-sync-status', runId: state?.run?.id },
  }
}

export function buildDailySyncStepResponseCached(mode, result, providerResult, durationMs, options = {}) {
  const now = options.now ?? Date.now()
  const summary = result?.summary ?? emptyDailyStepSummary(result?.step?.phase ?? null, 'success')
  const nextStep = result?.nextStep
  const steps = result?.steps ?? []
  const waitingRetry = !nextStep ? findWaitingRetryStep(steps, now) : null
  const finalSummary = options.finalSummary ?? buildCachedFinalDailySummary(steps, result?.run?.summary?.finalSummary)
  const rankingReadiness = summary.rankingReadiness
    ?? summary.details?.rankingReadiness
    ?? finalSummary.rankingReadiness
    ?? emptyRankingReadinessSummary()
  return {
    providerResult,
    runId: result?.run?.id ?? null,
    phase: summary.mode ?? result?.step?.phase ?? null,
    status: summary.status === 'pending_retry' || waitingRetry ? 'pending_retry' : result?.run?.status ?? summary.status,
    totalCandidates: summary.totalCandidates,
    totalFetched: summary.totalCandidates,
    processed: summary.processed,
    rowsSaved: summary.rowsSaved,
    failed: summary.failed,
    skipped: summary.skipped,
    skippedByLimit: 0,
    failures: summary.failed ? [{ message: summary.message ?? `${summary.mode} failed` }] : [],
    rankedSelectionRows: summary.mode === 'ranking' ? summary.processed : 0,
    topSelections: [],
    endpointCoverage: {},
    enrichedMatches: [],
    processedMatches: [],
    skippedEndpoints: [],
    rankingReadiness,
    rateLimited: summary.rateLimited,
    durationMs,
    steps,
    limits: result?.run?.summary?.phaseLimits ?? {},
    ...calculateRunProgress(steps, now),
    nextPhase: nextStep?.phase ?? waitingRetry?.phase ?? null,
    retryAfterSeconds: getRetryAfterSeconds(waitingRetry, now),
    finalSummary,
    nextAction: nextStep ? (mode === 'daily-sync-auto' ? 'Call this same endpoint again later' : 'call daily-sync-next again') : waitingRetry ? 'Retry after next_retry_at' : 'No action required',
    nextRequestExample: nextStep || waitingRetry ? { mode: mode === 'daily-sync-auto' ? 'daily-sync-auto' : 'daily-sync-next', runId: result?.run?.id, autoAdvance: true, maxStepsPerRequest: 2 } : { mode: 'daily-sync-status', runId: result?.run?.id },
  }
}

export function findWaitingRetryStep(steps = [], now = Date.now()) {
  const nowMs = new Date(now).getTime()
  const firstIncomplete = [...steps]
    .sort((a, b) => Number(a.step_order ?? 0) - Number(b.step_order ?? 0))
    .find((step) => step.status !== 'success')
  if (!firstIncomplete || !['pending_retry', 'failed', 'partial'].includes(String(firstIncomplete.status ?? ''))) return null
  if (Number(firstIncomplete.attempt_count ?? 0) >= Number(firstIncomplete.max_attempts ?? 3)) return null
  const nextRetryMs = firstIncomplete.next_retry_at ? new Date(firstIncomplete.next_retry_at).getTime() : 0
  return nextRetryMs > nowMs ? firstIncomplete : null
}

export function calculateRunProgress(steps = [], now = Date.now()) {
  const totalSteps = Math.max(steps.length || requiredDailyPhases.length, 1)
  const completedSteps = steps.filter((step) => ['success', 'skipped'].includes(step.status)).length
  const failedSteps = steps.filter((step) => step.status === 'failed').length
  const pendingSteps = steps.filter((step) => ['pending', 'pending_retry'].includes(step.status)).length
  const runningSteps = steps.filter((step) => ['running', 'partial'].includes(step.status)).length
  const weighted = steps.reduce((total, step) => {
    if (['success', 'skipped'].includes(step.status)) return total + 1
    if (['running', 'partial', 'pending_retry'].includes(step.status)) return total + 0.5
    return total
  }, 0)
  const next = findNextRequiredStep(steps, now) ?? findWaitingRetryStep(steps, now)
  return {
    progressPercent: Math.max(0, Math.min(100, Math.round((weighted / totalSteps) * 100))),
    completedSteps,
    totalSteps,
    failedSteps,
    pendingSteps,
    runningSteps,
    nextPhase: next?.phase ?? null,
  }
}

export function buildFinalDailySummary(steps = []) {
  const endpointRows = aggregateEndpointRows(steps)
  const core = findStepSummary(steps, 'core')
  const fixtureEnrichment = findStepSummary(steps, 'fixture-enrichment')
  const ranking = findStepSummary(steps, 'ranking')
  return {
    fixtures: Number(core?.details?.fixturesProcessed ?? 0),
    coverage: endpointRows['/leagues'] ?? 0,
    rounds: endpointRows['/fixtures/rounds'] ?? 0,
    fixtureStatistics: endpointRows['/fixtures/statistics'] ?? 0,
    events: endpointRows['/fixtures/events'] ?? 0,
    lineups: endpointRows['/fixtures/lineups'] ?? 0,
    fixturePlayers: endpointRows['/fixtures/players'] ?? 0,
    injuries: endpointRows['/injuries'] ?? 0,
    squads: endpointRows['/players/squads'] ?? 0,
    coaches: endpointRows['/coachs'] ?? 0,
    venues: endpointRows['/venues'] ?? 0,
    topScorers: endpointRows['/players/topscorers'] ?? 0,
    topAssists: endpointRows['/players/topassists'] ?? 0,
    topYellowCards: endpointRows['/players/topyellowcards'] ?? 0,
    topRedCards: endpointRows['/players/topredcards'] ?? 0,
    topPlayers: (endpointRows['/players/topscorers'] ?? 0) + (endpointRows['/players/topassists'] ?? 0) + (endpointRows['/players/topyellowcards'] ?? 0) + (endpointRows['/players/topredcards'] ?? 0),
    ranking: ranking?.status === 'success' || ranking?.status === 'empty' ? 'success' : ranking?.status ?? 'pending',
    rankingReadiness: ranking?.rankingReadiness ?? ranking?.details?.rankingReadiness ?? null,
    fixtureEnrichment: fixtureEnrichment?.details ?? null,
    totalDurationMs: steps.reduce((total, step) => total + Number(step.duration_ms ?? step.summary?.durationMs ?? 0), 0),
    failedEndpoints: aggregateEndpointNames(steps, 'failed'),
    skippedEndpoints: aggregateEndpointNames(steps, 'skipped'),
    rateLimited: steps.some((step) => step.rate_limited || step.summary?.rateLimited),
  }
}

export function emptyRankingReadinessSummary() {
  return {
    totalFixtures: 0,
    ready: 0,
    partial: 0,
    noMarketData: 0,
    pending: 0,
    failed: 0,
    hasMarketDataCount: 0,
    hasFixtureDetailCount: 0,
  }
}

export function emptyFixtureEnrichmentSummary() {
  return {
    oddsRowsCount: 0,
    fixturesWithMarketData: 0,
    fixturesWithoutMarketData: 0,
    readyFixtures: 0,
    partialFixtures: 0,
    noMarketDataFixtures: 0,
    pendingFixtures: 0,
  }
}

export function emptyAnalysisDailySummary() {
  return {
    bet: 0,
    lean: 0,
    noBet: 0,
    marketDataUsed: 0,
    insufficientMarketData: 0,
    defaultAnalysisRemaining: 0,
  }
}

export function getRetryAfterSeconds(step, now = Date.now()) {
  if (!step?.next_retry_at) return null
  return Math.max(0, Math.ceil((new Date(step.next_retry_at).getTime() - new Date(now).getTime()) / 1000))
}

export function sumStepField(steps = [], field) {
  return steps.reduce((total, step) => total + Number(step?.[field] ?? 0), 0)
}

export function countDailySteps(steps = [], status) {
  return steps.filter((step) => step.status === status).length
}

function emptyDailyStepSummary(mode, status, message = '') {
  return {
    step: 0,
    mode: mode ?? 'daily-sync',
    status,
    processed: 0,
    totalCandidates: 0,
    rowsSaved: 0,
    failed: 0,
    skipped: 0,
    rateLimited: false,
    durationMs: 0,
    message,
  }
}

function aggregateEndpointRows(steps) {
  const rows = {}
  for (const step of steps) {
    const breakdown = step.summary?.endpointBreakdown ?? {}
    for (const [endpoint, item] of Object.entries(breakdown)) {
      rows[endpoint] = (rows[endpoint] ?? 0) + Number(item?.rowsSaved ?? 0)
    }
  }
  return rows
}

function aggregateEndpointNames(steps, field) {
  const names = new Set()
  for (const step of steps) {
    const breakdown = step.summary?.endpointBreakdown ?? {}
    for (const [endpoint, item] of Object.entries(breakdown)) {
      if (Number(item?.[field] ?? 0) > 0) names.add(endpoint)
    }
  }
  return [...names]
}

function findStepSummary(steps, phase) {
  return steps.find((step) => step.phase === phase)?.summary ?? null
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function nonEmptyObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length ? value : null
}
