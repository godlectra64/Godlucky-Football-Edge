import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  buildCachedFinalDailySummary,
  buildDailyRunSummaryCached,
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
