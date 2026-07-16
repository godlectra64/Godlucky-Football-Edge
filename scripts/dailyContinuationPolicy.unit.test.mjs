import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import {
  STUCK_CONTINUATION_THRESHOLD,
  buildDailyContinuationRetryPlan,
  classifyDailyStepContinuation,
  getStepFailureAttemptCount,
  hasContinuationProgress,
  validateContinuationTransition,
} from '../supabase/functions/_shared/dailyContinuationPolicy.js'
import { advanceContinuation, buildBatchSignature, getDailySyncCacheDecision, shouldProcessBatch } from '../supabase/functions/_shared/pipelinePolicy.js'
import { advanceDailyFixtureCursor } from '../supabase/functions/_shared/dailyFixturesPolicy.js'

const now = '2026-07-16T08:00:00.000Z'
const previousCursor = {
  providerPage: 1,
  fixtureOffset: 4,
  oddsOffset: 0,
  processedFixtureCount: 4,
  lastProcessedFixtureId: 1004,
  completedBatchSignatures: ['batch-1'],
  coreAuxiliaryComplete: false,
}
const advancedCursor = { ...previousCursor, fixtureOffset: 11, processedFixtureCount: 11, lastProcessedFixtureId: 1011 }

const planned = classifyDailyStepContinuation({
  status: 'partial_success',
  partial: true,
  failed: 0,
  failures: [],
  rateLimited: false,
  continuationState: advancedCursor,
  details: { continuationSignals: { hasMore: true, resultFailureCount: 0 } },
}, {
  previousContinuation: previousCursor,
  nextContinuation: advancedCursor,
  previousFailureAttemptCount: 2,
})
assert.equal(planned.kind, 'planned_continuation')
assert.equal(planned.reason, 'CURSOR_ADVANCED')
assert.equal(planned.consumesFailureBudget, false)
assert.equal(planned.failureAttemptCount, 2)

const plannedRetry = buildDailyContinuationRetryPlan(planned, { claimedAttemptCount: 6, maxAttempts: 20, now })
assert.equal(plannedRetry.retry, true)
assert.equal(plannedRetry.exhausted, false)
assert.equal(plannedRetry.persistedAttemptCount, 5, 'planned continuation must roll back the transient claim increment')
assert.equal(plannedRetry.nextRetryAt, '2026-07-16T08:00:15.000Z')

const deadline = classifyDailyStepContinuation({
  status: 'pending_retry',
  partial: true,
  failed: 0,
  rateLimited: false,
  continuationState: previousCursor,
  details: { reason: 'SOFT_DEADLINE_REACHED' },
}, {
  previousContinuation: previousCursor,
  nextContinuation: previousCursor,
  previousFailureAttemptCount: 2,
  executionBudgetDeferred: true,
})
assert.equal(deadline.kind, 'planned_continuation')
assert.equal(deadline.reason, 'EXECUTION_BUDGET_DEFERRED')
assert.equal(deadline.failureAttemptCount, 2)

assert.equal(hasContinuationProgress(previousCursor, advancedCursor), true)
assert.equal(validateContinuationTransition(advancedCursor, previousCursor).valid, false)
assert.equal(advanceDailyFixtureCursor({ totalFixtures: 162, fixtureOffset: 11, advancedBy: 7, batchComplete: true }).providerPage, 1)
assert.equal(advanceDailyFixtureCursor({ totalFixtures: 162, fixtureOffset: 11, advancedBy: 7, batchComplete: true }).fixtureOffset, 18)

let stuck = classifyDailyStepContinuation({ status: 'partial_success', partial: true, failed: 0, continuationState: previousCursor }, {
  previousContinuation: previousCursor,
  nextContinuation: previousCursor,
})
assert.equal(stuck.kind, 'planned_continuation')
for (let count = 1; count < STUCK_CONTINUATION_THRESHOLD; count += 1) {
  stuck = classifyDailyStepContinuation({ status: 'partial_success', partial: true, failed: 0, continuationState: previousCursor }, {
    previousContinuation: previousCursor,
    nextContinuation: previousCursor,
    previousFailureAttemptCount: stuck.failureAttemptCount,
    previousStuckContinuationCount: stuck.stuckContinuationCount,
  })
}
assert.equal(stuck.kind, 'real_failure')
assert.equal(stuck.reason, 'STUCK_CONTINUATION')
assert.equal(stuck.failureAttemptCount, 1)

for (const errorCode of ['API_FOOTBALL_ERROR', 'DATABASE_ERROR']) {
  const failure = classifyDailyStepContinuation({ status: 'error', failed: 1, details: { errorCode }, continuationState: previousCursor }, {
    previousContinuation: previousCursor,
    nextContinuation: previousCursor,
    previousFailureAttemptCount: 2,
  })
  assert.equal(failure.kind, 'real_failure')
  assert.equal(failure.reason, errorCode)
  assert.equal(failure.failureAttemptCount, 3)
  const exhausted = buildDailyContinuationRetryPlan(failure, { claimedAttemptCount: 8, maxAttempts: 3, now })
  assert.equal(exhausted.exhausted, true)
  assert.equal(exhausted.nextRetryAt, null)
}

assert.equal(getStepFailureAttemptCount({
  attempt_count: 5,
  summary: { status: 'partial_success', partial: true, failed: 0 },
}), 0, 'legacy planned attempts must not become real-failure attempts')
assert.equal(getStepFailureAttemptCount({
  status: 'failed',
  attempt_count: 20,
  summary: { status: 'partial_success', partial: true, failed: 0, rateLimited: false },
}), 0, 'legacy planned continuation exhausted under the old policy must remain recoverable')
assert.equal(getStepFailureAttemptCount({
  attempt_count: 5,
  summary: { details: { continuationPolicy: { failureAttemptCount: 2 } } },
}), 2)

const signature = buildBatchSignature([101, 102, 103])
const completedCursor = advanceContinuation(previousCursor, { batchSignature: signature, batchComplete: true })
assert.equal(shouldProcessBatch(completedCursor, signature), false, 'completed fixture batches must remain idempotent')
const cacheDecision = getDailySyncCacheDecision({ id: 'canonical-run', status: 'partial', current_phase: 'core' }, [
  { id: 'core', phase: 'core', step_order: 1, status: 'pending_retry', attempt_count: 5, max_attempts: 20, next_retry_at: '2026-07-16T07:59:00.000Z', summary: { details: { continuationPolicy: planned } } },
  ...['fixture-enrichment', 'team-enrichment', 'league-enrichment', 'ranking'].map((phase, index) => ({ id: phase, phase, step_order: index + 2, status: 'pending', attempt_count: 0, max_attempts: 20 })),
], { now })
assert.equal(cacheDecision.shouldResume, true)
assert.equal(cacheDecision.runId, 'canonical-run')

const workflow = await readFile(new URL('../.github/workflows/daily-football-sync.yml', import.meta.url), 'utf8')
const inlineScript = extractWorkflowNodeScript(workflow)
const syntaxCheck = spawnSync(process.execPath, ['--check', '-'], { input: inlineScript, encoding: 'utf8' })
assert.equal(syntaxCheck.status, 0, `workflow inline script must parse on Node 22+: ${syntaxCheck.stderr}`)
const workflowPolicy = compileWorkflowPolicy(inlineScript)
const plannedResult = workflowResult('planned_continuation', 'CURSOR_ADVANCED', '2026-07-16T08:02:00.000Z')
const longWindow = workflowPolicy.getRetryWindowDecision(plannedResult, Date.parse(now), 60)
assert.equal(longWindow.action, 'schedule_next_workflow', 'planned retry windows longer than 60 seconds must exit successfully')
assert.equal(workflowPolicy.classifyWorkflowContinuation(plannedResult).kind, 'planned_continuation')

for (const reason of ['API_FOOTBALL_ERROR', 'DATABASE_ERROR']) {
  const failureResult = workflowResult('real_failure', reason, '2026-07-16T08:02:00.000Z')
  assert.equal(workflowPolicy.getRetryWindowDecision(failureResult, Date.parse(now), 60).action, 'failure')
}
const missingRetry = workflowResult('planned_continuation', 'CURSOR_ADVANCED', null)
assert.equal(workflowPolicy.getRetryWindowDecision(missingRetry, Date.parse(now), 60).action, 'failure')
const scheduledRun = runWorkflowScenario(inlineScript, workflowResult('planned_continuation', 'CURSOR_ADVANCED', new Date(Date.now() + 120_000).toISOString()))
assert.equal(scheduledRun.status, 0, `planned continuation must exit workflow successfully: ${scheduledRun.stderr}`)
assert.match(scheduledRun.stdout, /continuation scheduled runId=canonical-run/)
const productionFutureRetry = new Date(Date.now() + 120_000).toISOString()
const latestProductionPayload = productionWorkflowResult({ nextRetryAt: productionFutureRetry })
assert.equal(latestProductionPayload.steps[0].summary.details.continuationPolicy, undefined, 'Production-shaped fixture must exercise the missing-metadata path')
const latestProductionRun = runWorkflowScenario(inlineScript, latestProductionPayload)
assert.equal(latestProductionRun.status, 0, `latest Production payload must pass assertPipelineState: ${latestProductionRun.stderr}`)
assert.match(latestProductionRun.stdout, /continuation scheduled runId=9cf685ac-7b4a-4110-8a8e-eae61392cf72/)

const cursorProgressRun = runWorkflowSequence(inlineScript, [
  { body: productionWorkflowResult({ fixtureOffset: 22, processedFixtureCount: 22, lastProcessedFixtureId: 1554300, nextRetryAt: new Date(Date.now() - 1_000).toISOString() }), status: 200 },
  { body: latestProductionPayload, status: 200 },
])
assert.equal(cursorProgressRun.status, 0, `missing-metadata cursor progress 22 -> 27 must exit 0: ${cursorProgressRun.stderr}`)

const cursorRegressionRun = runWorkflowSequence(inlineScript, [
  { body: productionWorkflowResult({ nextRetryAt: new Date(Date.now() - 1_000).toISOString() }), status: 200 },
  { body: productionWorkflowResult({ fixtureOffset: 22, processedFixtureCount: 22, lastProcessedFixtureId: 1554300, nextRetryAt: productionFutureRetry }), status: 200 },
])
assert.equal(cursorRegressionRun.status, 1, 'missing-metadata cursor regression 27 -> 22 must exit workflow with code 1')
assert.match(cursorRegressionRun.stderr, /unsafe planned continuation/)

const repeatedNoProgressRun = runWorkflowScenario(inlineScript, productionWorkflowResult({ nextRetryAt: new Date(Date.now() - 1_000).toISOString() }))
assert.equal(repeatedNoProgressRun.status, 1, 'repeated no-progress continuation must exit workflow with code 1 at the threshold')
assert.match(repeatedNoProgressRun.stderr, /STUCK_CONTINUATION/)

const exhaustedProductionPayload = productionWorkflowResult({ nextRetryAt: productionFutureRetry })
exhaustedProductionPayload.steps[0].exhausted = true
const exhaustedProductionRun = runWorkflowScenario(inlineScript, exhaustedProductionPayload)
assert.equal(exhaustedProductionRun.status, 1, 'exhausted blocking step without continuationPolicy metadata must exit workflow with code 1')

const missingProductionRetryRun = runWorkflowScenario(inlineScript, productionWorkflowResult({ nextRetryAt: null }))
assert.equal(missingProductionRetryRun.status, 1, 'pending_retry without a valid next_retry_at must exit workflow with code 1')

const productionApiFailure = productionWorkflowResult({ nextRetryAt: productionFutureRetry })
productionApiFailure.failures = [{ message: 'api-football error: upstream HTTP 500' }]
const productionApiFailureRun = runWorkflowScenario(inlineScript, productionApiFailure)
assert.equal(productionApiFailureRun.status, 1, 'Production-shaped API failure must exit workflow with code 1')

const productionDatabaseFailure = productionWorkflowResult({ nextRetryAt: productionFutureRetry })
productionDatabaseFailure.errorMessage = 'database query failed'
const productionDatabaseFailureRun = runWorkflowScenario(inlineScript, productionDatabaseFailure)
assert.equal(productionDatabaseFailureRun.status, 1, 'Production-shaped database failure must exit workflow with code 1')
const syntheticFailureResult = {
  ...workflowResult('planned_continuation', 'CURSOR_ADVANCED', new Date(Date.now() + 120_000).toISOString()),
  failed: 1,
  failures: [{ message: 'FAILED_COUNT_REPORTED' }],
}
const syntheticFailureRun = runWorkflowScenario(inlineScript, syntheticFailureResult)
assert.equal(syntheticFailureRun.status, 0, `planned continuation with FAILED_COUNT_REPORTED must exit 0: ${syntheticFailureRun.stderr}`)
const legacyAggregateRun = runWorkflowScenario(inlineScript, {
  ...workflowResult('planned_continuation', 'CURSOR_ADVANCED', new Date(Date.now() + 120_000).toISOString()),
  failed: 3,
})
assert.equal(legacyAggregateRun.status, 0, `planned continuation with legacy failed aggregate and failureAttempts=0 must exit 0: ${legacyAggregateRun.stderr}`)
const apiFailureRun = runWorkflowScenario(inlineScript, { ...workflowResult('real_failure', 'API_FOOTBALL_ERROR', new Date(Date.now() + 120_000).toISOString()), failed: 1, failures: [{ message: 'api-football failed' }] })
assert.equal(apiFailureRun.status, 1, 'real API failure must exit workflow with code 1')
const unsafePlannedApiRun = runWorkflowScenario(inlineScript, { ...workflowResult('planned_continuation', 'CURSOR_ADVANCED', new Date(Date.now() + 120_000).toISOString()), failed: 1, failures: [{ message: 'api-football error: upstream rejected request' }] })
assert.equal(unsafePlannedApiRun.status, 1, 'real API diagnostics must not be hidden by a planned policy label')
const databaseFailureRun = runWorkflowScenario(inlineScript, { ok: false, errorMessage: 'database unavailable' }, 500)
assert.equal(databaseFailureRun.status, 1, 'database HTTP failure must exit workflow with code 1')
const failedStepResult = workflowResult('real_failure', 'EXHAUSTED_REAL_FAILURES', new Date(Date.now() + 120_000).toISOString())
failedStepResult.steps[0].status = 'failed'
const failedStepRun = runWorkflowScenario(inlineScript, failedStepResult)
assert.equal(failedStepRun.status, 1, 'failed required step must exit workflow with code 1')
for (const reason of ['CURSOR_REGRESSION:fixtureOffset', 'STUCK_CONTINUATION']) {
  const cursorFailureRun = runWorkflowScenario(inlineScript, workflowResult('real_failure', reason, new Date(Date.now() + 120_000).toISOString()))
  assert.equal(cursorFailureRun.status, 1, `${reason} must exit workflow with code 1`)
}
const invalidCanonicalRun = runWorkflowScenario(inlineScript, { ok: true, runId: 'canonical-run', status: 'partial', failed: 0, failures: [], steps: [] })
assert.equal(invalidCanonicalRun.status, 1, 'missing canonical required steps must exit workflow with code 1')
const changedRunId = workflowResult('planned_continuation', 'CURSOR_ADVANCED', new Date(Date.now() + 120_000).toISOString())
changedRunId.runId = 'different-run'
const changedRunIdRun = runWorkflowSequence(inlineScript, [
  { body: workflowResult('planned_continuation', 'CURSOR_ADVANCED', new Date(Date.now() - 1_000).toISOString()), status: 200 },
  { body: changedRunId, status: 200 },
])
assert.equal(changedRunIdRun.status, 1, 'changed canonical runId must exit workflow with code 1')
const otherModeFailureRun = runWorkflowSequence(inlineScript, [
  { body: completedWorkflowResult(), status: 200 },
  { body: { ok: true, failed: 1, failures: [] }, status: 200 },
])
assert.equal(otherModeFailureRun.status, 1, 'non-daily mode failed aggregate must still exit workflow with code 1')
assert.match(inlineScript, /invocation <= 12/)
assert.match(inlineScript, /STUCK_CONTINUATION/)
assert.match(inlineScript, /continuation scheduled runId=/)
assert.match(inlineScript, /async function main\(\)/)
assert.doesNotMatch(inlineScript, /retryAfterSeconds > 60\) throw new Error/)

const edgeSource = await readFile(new URL('../supabase/functions/sync-football-data/index.ts', import.meta.url), 'utf8')
assert.match(edgeSource, /attempt_count: retry\.persistedAttemptCount/)
assert.match(edgeSource, /continuationPolicy: retry\.continuationPolicy/)
assert.match(edgeSource, /getStepFailureAttemptCount\(step\)/)

console.log('daily continuation policy unit tests passed')

function workflowResult(kind, reason, nextRetryAt) {
  const phases = ['core', 'fixture-enrichment', 'team-enrichment', 'league-enrichment', 'ranking']
  return {
    ok: true,
    runId: 'canonical-run',
    status: 'partial',
    failed: 0,
    failures: [],
    steps: phases.map((phase, index) => phase === 'core' ? {
      phase,
      step_order: index + 1,
      status: 'pending_retry',
      max_attempts: 20,
      next_retry_at: nextRetryAt,
      continuation_state: advancedCursor,
      summary: {
        status: 'partial_success',
        partial: true,
        failed: 0,
        details: {
          continuationPolicy: {
            kind,
            reason,
            cursorProgress: kind === 'planned_continuation' && reason === 'CURSOR_ADVANCED',
            failureAttemptCount: kind === 'planned_continuation' ? 0 : 1,
          },
        },
      },
    } : { phase, step_order: index + 1, status: 'pending' }),
  }
}

function productionWorkflowResult({
  runId = '9cf685ac-7b4a-4110-8a8e-eae61392cf72',
  fixtureOffset = 27,
  processedFixtureCount = 27,
  lastProcessedFixtureId = 1554415,
  nextRetryAt,
} = {}) {
  const continuationState = {
    providerPage: 1,
    fixtureOffset,
    oddsOffset: 0,
    processedFixtureCount,
    lastProcessedFixtureId,
    batchSignature: null,
    completedBatchSignatures: [],
    coreAuxiliaryComplete: false,
  }
  return {
    ok: true,
    mode: 'daily-sync-auto',
    runId,
    status: 'pending_retry',
    phase: 'core',
    failed: 0,
    failures: [],
    providerPage: 1,
    fixtureOffset,
    processedFixtureCount,
    lastProcessedFixtureId,
    coreAuxiliaryComplete: false,
    steps: ['core', 'fixture-enrichment', 'team-enrichment', 'league-enrichment', 'ranking'].map((phase, index) => phase === 'core' ? {
      phase,
      step_order: index + 1,
      status: 'pending_retry',
      max_attempts: 20,
      next_retry_at: nextRetryAt,
      continuation_state: continuationState,
      summary: {
        status: 'partial_success',
        partial: true,
        failed: 0,
        failures: [],
        rateLimited: false,
        details: {
          hasMore: true,
          coreAuxiliaryComplete: false,
        },
      },
    } : {
      phase,
      step_order: index + 1,
      status: 'pending',
    }),
  }
}

function extractWorkflowNodeScript(source) {
  const startMarker = "node <<'NODE'"
  const start = source.indexOf(startMarker)
  const end = source.indexOf('\n          NODE', start)
  assert.ok(start >= 0 && end > start, 'workflow Node script not found')
  return source.slice(source.indexOf('\n', start) + 1, end).split('\n').map((line) => line.replace(/^ {10}/, '')).join('\n')
}

function runWorkflowScenario(inlineScript, responseBody, status = 200) {
  return runWorkflowSequence(inlineScript, [{ body: responseBody, status }])
}

function runWorkflowSequence(inlineScript, responses) {
  const serialized = JSON.stringify(responses)
  const prelude = `process.env.SYNC_ENDPOINT = 'https://example.invalid/sync'; process.env.EDGE_ADMIN_SECRET = 'test-secret'; const mockResponses = ${serialized}; let mockIndex = 0; globalThis.fetch = async () => { const item = mockResponses[Math.min(mockIndex, mockResponses.length - 1)]; mockIndex += 1; return new Response(JSON.stringify(item.body), { status: item.status, headers: { 'content-type': 'application/json' } }); };\n`
  return spawnSync(process.execPath, [], { input: `${prelude}${inlineScript}`, encoding: 'utf8', timeout: 5_000 })
}

function completedWorkflowResult() {
  return {
    ok: true,
    runId: 'canonical-run',
    status: 'success',
    failed: 0,
    failures: [],
    steps: ['core', 'fixture-enrichment', 'team-enrichment', 'league-enrichment', 'ranking'].map((phase, index) => ({ phase, step_order: index + 1, status: 'success' })),
  }
}

function compileWorkflowPolicy(source) {
  const names = [
    'hasItems',
    'getRequiredSteps',
    'isComplete',
    'getBlockingStep',
    'getStepContinuationPolicy',
    'getContinuationCursor',
    'validateContinuationCursor',
    'hasRealFailureDiagnostics',
    'classifyWorkflowContinuation',
    'getRetryWindowDecision',
  ]
  const declarations = names.map((name) => functionSource(source, name)).join('\n')
  return new Function(`const requiredPhases = ['core', 'fixture-enrichment', 'team-enrichment', 'league-enrichment', 'ranking']; ${declarations}; return { classifyWorkflowContinuation, getRetryWindowDecision }`)()
}

function functionSource(source, name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source)
  assert.ok(match, `workflow function ${name} not found`)
  const open = source.indexOf('{', match.index)
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) return source.slice(match.index, index + 1)
  }
  throw new Error(`workflow function ${name} is not balanced`)
}
