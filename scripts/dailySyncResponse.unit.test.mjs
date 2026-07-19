import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  buildCachedFinalDailySummary,
  buildDailyRunSummaryCached,
  buildCurrentDailySyncFailures,
  buildRecoveredDailySyncStepFailurePatch,
  buildDailySyncStatusPayload,
  buildDailySyncStepResponseCached,
  emptyAnalysisDailySummary,
  emptyFixtureEnrichmentSummary,
  emptyRankingReadinessSummary,
} from '../supabase/functions/_shared/dailySyncResponse.js'

const now = Date.parse('2026-07-14T01:00:00.000Z')
const retryAt = '2026-07-14T01:01:30.000Z'
const storedRankingReadiness = {
  totalFixtures: 12,
  ready: 7,
  partial: 2,
  noMarketData: 1,
  pending: 2,
  failed: 0,
  hasMarketDataCount: 11,
  hasFixtureDetailCount: 10,
}
const storedFixtureEnrichment = {
  oddsRowsCount: 34,
  fixturesWithMarketData: 11,
  fixturesWithoutMarketData: 1,
  readyFixtures: 7,
  partialFixtures: 2,
  noMarketDataFixtures: 1,
  pendingFixtures: 2,
}
const storedAnalysisSummary = {
  bet: 4,
  lean: 3,
  noBet: 5,
  marketDataUsed: 10,
  insufficientMarketData: 1,
  defaultAnalysisRemaining: 0,
}

const steps = [
  {
    phase: 'core',
    step_order: 1,
    status: 'success',
    attempt_count: 1,
    max_attempts: 20,
    processed: 12,
    rows_saved: 12,
    skipped: 1,
    duration_ms: 20,
    summary: { details: { fixturesProcessed: 12 }, durationMs: 20 },
  },
  {
    phase: 'fixture-enrichment',
    step_order: 2,
    status: 'pending_retry',
    attempt_count: 1,
    max_attempts: 20,
    next_retry_at: retryAt,
    processed: 3,
    rows_saved: 4,
    skipped: 2,
    duration_ms: 30,
  },
  { phase: 'team-enrichment', step_order: 3, status: 'pending', attempt_count: 0, max_attempts: 3 },
  { phase: 'league-enrichment', step_order: 4, status: 'pending', attempt_count: 0, max_attempts: 3 },
  { phase: 'ranking', step_order: 5, status: 'pending', attempt_count: 0, max_attempts: 3 },
]

const storedFinalSummary = {
  fixtures: 12,
  rankingReadiness: storedRankingReadiness,
  fixtureEnrichment: storedFixtureEnrichment,
  analysisSummary: storedAnalysisSummary,
  cachedMarker: 'stored-run-summary',
}
const state = {
  run: {
    id: 'run-cached-summary',
    status: 'partial',
    current_phase: 'fixture-enrichment',
    summary: { finalSummary: storedFinalSummary },
  },
  steps,
}

const statusResponse = buildDailySyncStatusPayload('daily-sync-status', state, 15, '', { now })
assert.equal(statusResponse.finalSummary.cachedMarker, 'stored-run-summary')
assert.deepEqual(statusResponse.finalSummary.rankingReadiness, storedRankingReadiness)
assert.deepEqual(statusResponse.rankingReadiness, storedRankingReadiness)
assert.equal(statusResponse.status, 'pending_retry')
assert.equal(statusResponse.phase, 'fixture-enrichment')
assert.equal(statusResponse.retryAfterSeconds, 90)
assert.equal(statusResponse.nextAction, 'Retry after next_retry_at')
assert.deepEqual(statusResponse.nextRequestExample, { mode: 'daily-sync-next', runId: 'run-cached-summary' })

const requiredResponseFields = [
  'runId', 'phase', 'status', 'processed', 'totalCandidates', 'rowsSaved', 'failed', 'skipped',
  'rateLimited', 'steps', 'finalSummary', 'rankingReadiness', 'nextAction', 'nextRequestExample',
  'progressPercent', 'completedSteps', 'totalSteps', 'failedSteps', 'pendingSteps', 'runningSteps',
  'nextPhase', 'retryAfterSeconds',
]
for (const field of requiredResponseFields) assert.ok(Object.hasOwn(statusResponse, field), `missing status field ${field}`)

const defaults = buildCachedFinalDailySummary([], null)
assert.deepEqual(defaults.rankingReadiness, emptyRankingReadinessSummary())
assert.deepEqual(defaults.fixtureEnrichment, emptyFixtureEnrichmentSummary())
assert.deepEqual(defaults.analysisSummary, emptyAnalysisDailySummary())

const runSummary = buildDailyRunSummaryCached(steps, state.run.summary, { status: 'pending_retry' })
assert.equal(runSummary.completed, 1)
assert.equal(runSummary.processed, 15)
assert.equal(runSummary.rowsSaved, 16)
assert.equal(runSummary.skipped, 3)
assert.equal(runSummary.partial, 0)
assert.equal(runSummary.rateLimited, false)
assert.equal(runSummary.finalSummary.cachedMarker, 'stored-run-summary')

const stepResult = {
  run: state.run,
  step: steps[1],
  nextStep: null,
  steps,
  summary: {
    mode: 'fixture-enrichment',
    status: 'pending_retry',
    processed: 3,
    totalCandidates: 12,
    rowsSaved: 4,
    failed: 0,
    skipped: 2,
    rateLimited: false,
    durationMs: 30,
    details: { rankingReadiness: { source: 'details' } },
  },
}
const detailsFallback = buildDailySyncStepResponseCached('daily-sync-next', stepResult, { provider: 'cached' }, 40, { now })
assert.deepEqual(detailsFallback.rankingReadiness, { source: 'details' })
assert.equal(detailsFallback.finalSummary.cachedMarker, 'stored-run-summary')
assert.equal(detailsFallback.retryAfterSeconds, 90)

const directFallback = buildDailySyncStepResponseCached('daily-sync-next', {
  ...stepResult,
  summary: { ...stepResult.summary, rankingReadiness: { source: 'summary' } },
}, {}, 40, { now })
assert.deepEqual(directFallback.rankingReadiness, { source: 'summary' })

const cachedFallback = buildDailySyncStepResponseCached('daily-sync-next', {
  ...stepResult,
  summary: { ...stepResult.summary, details: {} },
}, {}, 40, { now })
assert.deepEqual(cachedFallback.rankingReadiness, storedRankingReadiness)

const recoveredCore = {
  ...structuredClone(steps[0]),
  failed: 0,
  error_message: 'FAILED_COUNT_REPORTED',
  summary: {
    status: 'success',
    failed: 1,
    message: 'FAILED_COUNT_REPORTED',
    failures: [{ message: 'FAILED_COUNT_REPORTED' }],
    errors: [{ message: 'old provider failure' }],
    details: {
      failures: [{ message: 'old provider failure' }],
      errors: [{ message: 'old database failure' }],
      roundFailures: [{ leagueId: 39, season: 2025 }],
      errorCode: 'OLD_ATTEMPT_ERROR',
    },
  },
}
const plannedFixture = {
  ...structuredClone(steps[1]),
  failed: 0,
  error_message: null,
  summary: {
    status: 'partial_success',
    failed: 0,
    details: {
      reason: 'SOFT_DEADLINE_REACHED',
      continuationPolicy: { kind: 'planned_continuation', reason: 'EXECUTION_BUDGET_DEFERRED', failureAttemptCount: 3 },
    },
  },
}
const recoveredPatch = buildRecoveredDailySyncStepFailurePatch(recoveredCore)
assert.equal(recoveredPatch.error_message, null)
assert.equal(recoveredPatch.summary.failed, 0)
assert.equal(recoveredPatch.summary.message, undefined)
assert.equal(recoveredPatch.summary.failures, undefined)
assert.equal(recoveredPatch.summary.errors, undefined)
assert.equal(recoveredPatch.summary.details.failures, undefined)
assert.equal(recoveredPatch.summary.details.errors, undefined)
assert.equal(recoveredPatch.summary.details.roundFailures, undefined)
assert.equal(recoveredPatch.summary.details.errorCode, undefined)

const recoveredResponse = buildDailySyncStepResponseCached('daily-sync-auto', {
  ...stepResult,
  step: plannedFixture,
  steps: [recoveredCore, plannedFixture, ...steps.slice(2)],
  summary: { ...stepResult.summary, status: 'pending_retry', failed: 0 },
}, {}, 40, { now })
assert.deepEqual(recoveredResponse.failures, [], 'a recovered success step must not repopulate top-level failures')
assert.equal(recoveredResponse.steps[0].error_message, null)
assert.equal(recoveredResponse.steps[0].summary.failures, undefined)
assert.equal(recoveredResponse.steps[1].summary.details.reason, 'SOFT_DEADLINE_REACHED', 'planned continuation details must survive stale-failure cleanup')
assert.equal(recoveredResponse.steps[1].summary.details.continuationPolicy.failureAttemptCount, 3, 'historical advisory counters remain diagnostic-only')

assert.deepEqual(buildCurrentDailySyncFailures({ mode: 'core', status: 'success', failed: 0 }, recoveredCore), [])
assert.equal(buildCurrentDailySyncFailures({ mode: 'core', status: 'partial_success', failed: 1 }, plannedFixture).length, 1, 'current result.failed > 0 must remain fatal')
assert.equal(buildCurrentDailySyncFailures({ mode: 'core', status: 'partial_success', failed: 0 }, { ...plannedFixture, failed: 1 }).length, 1, 'current step.failed > 0 must remain fatal')
assert.equal(buildCurrentDailySyncFailures({ mode: 'core', status: 'partial_success', failed: 0 }, { ...plannedFixture, status: 'failed' }).length, 1, 'current failed step status must remain fatal')
assert.equal(buildCurrentDailySyncFailures({ mode: 'core', status: 'partial_success', failed: 0, details: { errorCode: 'DATABASE_WRITE_FAILED' } }, plannedFixture).length, 1, 'current canonical error must remain fatal')
assert.equal(buildCurrentDailySyncFailures({ mode: 'core', status: 'partial_success', failed: 0, failures: [{ message: 'current upstream HTTP 500' }] }, plannedFixture).length, 1, 'current summary failure diagnostics must remain fatal')

const indexSource = await readFile(new URL('../supabase/functions/sync-football-data/index.ts', import.meta.url), 'utf8')
const sharedSource = await readFile(new URL('../supabase/functions/_shared/dailySyncResponse.js', import.meta.url), 'utf8')
for (const functionName of [
  'buildDailySyncStartResponse',
  'buildDailySyncStatusResponse',
  'buildDailySyncStepResponse',
  'runDailySyncStep',
  'markDailySyncRunFinished',
]) {
  const source = functionSource(indexSource, functionName)
  assert.doesNotMatch(source, /buildFinalDailySummaryWithDb|getDailySyncReadinessDebugSummary/, functionName)
}
assert.doesNotMatch(sharedSource, /getDailySyncReadinessDebugSummary|buildFinalDailySummaryWithDb|supabase\s*\.\s*from/)
assert.doesNotMatch(indexSource, /const\s+dbFinalSummary\b/)
assert.doesNotMatch(indexSource, /const\s+finalSummary\s*=\s*[^\n]*\|\|[^\n]*\?/)
assert.match(functionSource(indexSource, 'buildDailySyncStatusResponse'), /buildCachedFinalDailySummaryWithTiming/)
assert.match(functionSource(indexSource, 'buildDailySyncStepResponse'), /buildDailySyncStepResponseCached/)
assert.match(functionSource(indexSource, 'recoverStaleDailySyncSteps'), /clearRecoveredDailySyncStepFailures\(runId\)/, 'resume recovery must clear stale failure state')
assert.match(functionSource(indexSource, 'clearRecoveredDailySyncStepFailures'), /buildRecoveredDailySyncStepFailurePatch\(step\)/)
assert.match(functionSource(indexSource, 'clearRecoveredDailySyncStepFailures'), /\.update\(patch\)/)
assert.match(functionSource(indexSource, 'runDailySyncStep'), /error_message:\s*retry\.continuationPolicy\.kind === 'real_failure'[^\n]*:\s*null/, 'a recovered success or planned retry must clear the current step error')

console.log('Daily sync cached response unit tests passed.')

function functionSource(source, name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source)
  assert.ok(match, `function ${name} not found`)
  const openingBrace = source.indexOf('{', match.index)
  let depth = 0
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) return source.slice(match.index, index + 1)
  }
  throw new Error(`function ${name} is incomplete`)
}
