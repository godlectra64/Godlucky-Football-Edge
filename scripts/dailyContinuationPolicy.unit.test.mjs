import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import {
  STUCK_CONTINUATION_THRESHOLD,
  advanceCoreAuxiliaryContinuation,
  buildDailyContinuationRetryPlan,
  classifyDailyStepContinuation,
  getCoreAuxiliaryContinuation,
  getStepFailureAttemptCount,
  hasContinuationProgress,
  selectCoreAuxiliaryBatch,
  validateContinuationTransition,
} from '../supabase/functions/_shared/dailyContinuationPolicy.js'
import { advanceContinuation, buildBatchSignature, findNextRequiredStep, getDailySyncCacheDecision, shouldProcessBatch } from '../supabase/functions/_shared/pipelinePolicy.js'
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
assert.equal(deadline.stuckContinuationCount, 1)

let repeatedDeadline = deadline
for (let count = 1; count < STUCK_CONTINUATION_THRESHOLD; count += 1) {
  repeatedDeadline = classifyDailyStepContinuation({
    status: 'partial_success',
    partial: true,
    failed: 0,
    continuationState: previousCursor,
    details: { reason: 'SOFT_DEADLINE_REACHED' },
  }, {
    previousContinuation: previousCursor,
    nextContinuation: previousCursor,
    previousFailureAttemptCount: repeatedDeadline.failureAttemptCount,
    previousStuckContinuationCount: repeatedDeadline.stuckContinuationCount,
  })
}
assert.equal(repeatedDeadline.kind, 'real_failure', 'three identical soft-deadline continuations without cursor progress must fail as stuck')
assert.equal(repeatedDeadline.reason, 'STUCK_CONTINUATION')

assert.equal(hasContinuationProgress(previousCursor, advancedCursor), true)
assert.equal(validateContinuationTransition(advancedCursor, previousCursor).valid, false)
assert.equal(advanceDailyFixtureCursor({ totalFixtures: 162, fixtureOffset: 11, advancedBy: 7, batchComplete: true }).providerPage, 1)
assert.equal(advanceDailyFixtureCursor({ totalFixtures: 162, fixtureOffset: 11, advancedBy: 7, batchComplete: true }).fixtureOffset, 18)

const auxiliaryCandidates = Array.from({ length: 25 }, (_, index) => ({ id: index }))
let coverageCursor = getCoreAuxiliaryContinuation({ coreStage: 'coverage' })
let coverageBatch = selectCoreAuxiliaryBatch(auxiliaryCandidates, coverageCursor.coverageOffset, 10)
assert.deepEqual(coverageBatch.batch.map((row) => row.id), Array.from({ length: 10 }, (_, index) => index))
coverageCursor = advanceCoreAuxiliaryContinuation(coverageCursor, 'coverage', { advancedBy: coverageBatch.batch.length, totalCandidates: coverageBatch.totalCandidates })
assert.equal(coverageCursor.coverageOffset, 10)
const auxiliaryDeadline = classifyDailyStepContinuation({
  status: 'partial_success',
  partial: true,
  failed: 0,
  rateLimited: false,
  continuationState: coverageCursor,
  details: { reason: 'SOFT_DEADLINE_REACHED' },
}, {
  previousContinuation: { ...coverageCursor, coverageOffset: 0 },
  nextContinuation: coverageCursor,
})
assert.equal(auxiliaryDeadline.kind, 'planned_continuation')
assert.equal(auxiliaryDeadline.reason, 'CURSOR_ADVANCED', 'soft deadline with persisted auxiliary progress must remain a planned continuation')
coverageBatch = selectCoreAuxiliaryBatch(auxiliaryCandidates, coverageCursor.coverageOffset, 10)
assert.deepEqual(coverageBatch.batch.map((row) => row.id), Array.from({ length: 10 }, (_, index) => index + 10), 'coverage continuation must not repeat its first batch')
coverageCursor = advanceCoreAuxiliaryContinuation(coverageCursor, 'coverage', { advancedBy: coverageBatch.batch.length, totalCandidates: coverageBatch.totalCandidates })
assert.equal(coverageCursor.coverageOffset, 20)
coverageBatch = selectCoreAuxiliaryBatch(auxiliaryCandidates, coverageCursor.coverageOffset, 10)
coverageCursor = advanceCoreAuxiliaryContinuation(coverageCursor, 'coverage', { advancedBy: coverageBatch.batch.length, totalCandidates: coverageBatch.totalCandidates })
assert.equal(coverageCursor.coverageOffset, 25)
assert.equal(coverageCursor.coverageComplete, true)
assert.equal(coverageCursor.coreStage, 'rounds')
assert.equal(validateContinuationTransition(coverageCursor, { ...coverageCursor, coverageOffset: 20 }).reason, 'CURSOR_REGRESSION:coverageOffset')

const roundsCandidates = Array.from({ length: 12 }, (_, index) => ({ id: index }))
let roundsCursor = coverageCursor
let roundsBatch = selectCoreAuxiliaryBatch(roundsCandidates, roundsCursor.roundsOffset, 10)
roundsCursor = advanceCoreAuxiliaryContinuation(roundsCursor, 'rounds', { advancedBy: roundsBatch.batch.length, totalCandidates: roundsBatch.totalCandidates })
assert.equal(roundsCursor.roundsOffset, 10)
roundsBatch = selectCoreAuxiliaryBatch(roundsCandidates, roundsCursor.roundsOffset, 10)
assert.deepEqual(roundsBatch.batch.map((row) => row.id), [10, 11], 'rounds continuation must resume after its persisted offset')
roundsCursor = advanceCoreAuxiliaryContinuation(roundsCursor, 'rounds', { advancedBy: roundsBatch.batch.length, totalCandidates: roundsBatch.totalCandidates })
assert.equal(roundsCursor.roundsComplete, true)
assert.equal(roundsCursor.coreStage, 'complete')
assert.equal(roundsCursor.coreAuxiliaryComplete, true)
assert.equal(findNextRequiredStep([
  { phase: 'core', step_order: 1, status: 'success' },
  { phase: 'fixture-enrichment', step_order: 2, status: 'pending' },
  { phase: 'team-enrichment', step_order: 3, status: 'pending' },
  { phase: 'league-enrichment', step_order: 4, status: 'pending' },
  { phase: 'ranking', step_order: 5, status: 'pending' },
])?.phase, 'fixture-enrichment', 'completed core auxiliary state must allow the pipeline to advance')

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
assert.equal(validateContinuationTransition(
  { ...previousCursor, completedBatchSignatures: ['batch-old', 'batch-current'] },
  { ...previousCursor, completedBatchSignatures: ['batch-current', 'batch-new'] },
).valid, true, 'bounded completed batch history may roll over when a new signature is appended')
assert.equal(validateContinuationTransition(
  { ...previousCursor, completedBatchSignatures: ['batch-old', 'batch-current'] },
  { ...previousCursor, completedBatchSignatures: ['batch-current'] },
).reason, 'CURSOR_REGRESSION:completedBatchSignatures')
const cacheDecision = getDailySyncCacheDecision({ id: 'canonical-run', status: 'partial', current_phase: 'core' }, [
  { id: 'core', phase: 'core', step_order: 1, status: 'pending_retry', attempt_count: 5, max_attempts: 20, next_retry_at: '2026-07-16T07:59:00.000Z', summary: { details: { continuationPolicy: planned } } },
  ...['fixture-enrichment', 'team-enrichment', 'league-enrichment', 'ranking'].map((phase, index) => ({ id: phase, phase, step_order: index + 2, status: 'pending', attempt_count: 0, max_attempts: 20 })),
], { now })
assert.equal(cacheDecision.shouldResume, true)
assert.equal(cacheDecision.runId, 'canonical-run')

const workflow = await readFile(new URL('../.github/workflows/daily-football-sync.yml', import.meta.url), 'utf8')
const workflowCrons = [...workflow.matchAll(/cron:\s*['"]([^'"]+)['"]/g)].map((match) => match[1])
assert.deepEqual(workflowCrons, ['*/15 * * * *'], 'workflow must have exactly one 15-minute cron')
for (const oldCron of ['10 0 * * *', '10 11 * * *', '40 16 * * *']) {
  assert.equal(workflowCrons.includes(oldCron), false, `workflow must remove obsolete cron ${oldCron}`)
}
assert.match(workflow, /workflow_dispatch:/, 'manual workflow dispatch must remain available')
assert.match(workflow, /concurrency:\s*[\s\S]*?group:\s*daily-football-sync[\s\S]*?cancel-in-progress:\s*false/, 'overlapping workflows must serialize without cancelling the active canonical run')
assert.match(workflow, /SUPABASE_URL:\s*\$\{\{\s*secrets\.SUPABASE_URL\s*\}\}/, 'REST preflight must use the SUPABASE_URL GitHub secret')
assert.match(workflow, /SUPABASE_SERVICE_ROLE_KEY:\s*\$\{\{\s*secrets\.SUPABASE_SERVICE_ROLE_KEY\s*\}\}/, 'REST preflight must use the SUPABASE_SERVICE_ROLE_KEY GitHub secret')
assert.doesNotMatch(workflow, /SUPABASE_READ_KEY|SUPABASE_ANON_KEY|VITE_SUPABASE_ANON_KEY/, 'REST preflight must not fall back to an anon or mixed-purpose read key')
const inlineScript = extractWorkflowNodeScript(workflow)
const syntaxCheck = spawnSync(process.execPath, ['--check', '-'], { input: inlineScript, encoding: 'utf8' })
assert.equal(syntaxCheck.status, 0, `workflow inline script must parse on Node 22+: ${syntaxCheck.stderr}`)
const workflowPolicy = compileWorkflowPolicy(inlineScript)
assert.equal(workflowPolicy.bangkokDateKey(new Date('2026-07-18T16:59:59.999Z')), '2026-07-18', 'UTC instant immediately before Bangkok midnight must remain on the prior canonical date')
assert.equal(workflowPolicy.bangkokDateKey(new Date('2026-07-18T17:00:00.000Z')), '2026-07-19', 'UTC instant at Bangkok midnight must advance the canonical date')
const processedIdPreviousCursor = workflowPolicy.getContinuationCursor({
  continuation_state: {
    fixtureCursorMode: 'processed-fixture-ids-v1',
    processedFixtureIds: [101],
    uniqueProcessedFixtureCount: 1,
    fixtureCandidateCount: 3,
    fixtureRemainingCount: 2,
    fixtureStableEmptyPasses: 0,
    fixtureOffset: 722,
  },
})
const processedIdCurrentCursor = workflowPolicy.getContinuationCursor({
  continuation_state: {
    fixtureCursorMode: 'processed-fixture-ids-v1',
    processedFixtureIds: [101, 102],
    uniqueProcessedFixtureCount: 2,
    fixtureCandidateCount: 3,
    fixtureRemainingCount: 1,
    fixtureStableEmptyPasses: 0,
    fixtureOffset: 722,
  },
})
assert.equal(workflowPolicy.inspectContinuationTransition(processedIdPreviousCursor, processedIdCurrentCursor).progress, true, 'workflow progress detector must accept unique processed fixture progress without fixtureOffset movement')
const stableEmptyCursor = workflowPolicy.getContinuationCursor({
  continuation_state: {
    ...processedIdCurrentCursor,
    fixtureRemainingCount: 0,
    fixtureStableEmptyPasses: 1,
  },
})
assert.equal(workflowPolicy.inspectContinuationTransition(processedIdCurrentCursor, stableEmptyCursor).progress, true, 'workflow progress detector must accept remaining-count and stable-empty progress')
const positionalOnlyCursor = workflowPolicy.getContinuationCursor({
  continuation_state: {
    ...processedIdPreviousCursor,
    fixtureOffset: 723,
    processedFixtureCount: 723,
  },
})
assert.equal(workflowPolicy.inspectContinuationTransition(processedIdPreviousCursor, positionalOnlyCursor).progress, false, 'processed-ID workflow progress must not rely on legacy positional or cumulative counters')
assert.equal(workflowPolicy.inspectContinuationTransition(null, workflowPolicy.getContinuationCursor({
  continuation_state: {
    fixtureCursorMode: 'processed-fixture-ids-v1',
    fixtureOffset: 722,
    processedFixtureCount: 722,
  },
})).progress, false, 'initial v1 progress must not be inferred from unproven legacy counters')
const plannedResult = workflowResult('planned_continuation', 'CURSOR_ADVANCED', '2026-07-16T08:02:00.000Z')
const longWindow = workflowPolicy.getRetryWindowDecision(plannedResult, Date.parse(now), 60)
assert.equal(longWindow.action, 'schedule_next_workflow', 'planned retry windows longer than 60 seconds must exit successfully')
assert.equal(workflowPolicy.classifyWorkflowContinuation(plannedResult).kind, 'planned_continuation')

for (const reason of ['API_FOOTBALL_ERROR', 'DATABASE_ERROR']) {
  const advisoryPolicyOnlyResult = workflowResult('real_failure', reason, '2026-07-16T08:02:00.000Z')
  assert.equal(workflowPolicy.getRetryWindowDecision(advisoryPolicyOnlyResult, Date.parse(now), 60).action, 'schedule_next_workflow', `${reason} policy text alone must remain advisory`)
  const failureResult = workflowResult('real_failure', reason, '2026-07-16T08:02:00.000Z')
  failureResult.steps[0].summary.details.errorCode = reason
  assert.equal(workflowPolicy.getRetryWindowDecision(failureResult, Date.parse(now), 60).action, 'failure')
}
const missingRetry = workflowResult('planned_continuation', 'CURSOR_ADVANCED', null)
assert.equal(workflowPolicy.getRetryWindowDecision(missingRetry, Date.parse(now), 60).action, 'failure')

const restPreflightSource = functionSource(inlineScript, 'getRestRows')
assert.match(restPreflightSource, /apikey:\s*restServiceRoleKey/, 'REST apikey must use the service-role key')
assert.match(restPreflightSource, /Authorization:\s*`Bearer \$\{restServiceRoleKey\}`/, 'REST Authorization must use the service-role key')
assert.match(restPreflightSource, /['"]Content-Type['"]:\s*['"]application\/json['"]/, 'REST requests must identify JSON content')
assert.doesNotMatch(restPreflightSource, /adminSecret|RESULT_ADMIN_SECRET|sb_secret/, 'REST preflight must not use an Edge or result admin secret')
const edgeInvocationSource = functionSource(inlineScript, 'postSync')
assert.match(edgeInvocationSource, /sb_secret:\s*adminSecret/, 'Edge invocation must keep its existing admin secret')
assert.doesNotMatch(edgeInvocationSource, /serviceRoleKey/, 'Edge invocation must not use the REST service-role key')

const missingServiceRole = runScheduledWorkflowSequence(inlineScript, [], {
  serviceRoleKey: null,
  resultAdminSecret: 'result-admin-must-not-be-used',
})
assert.equal(missingServiceRole.status, 1, 'missing SUPABASE_SERVICE_ROLE_KEY must fail')
assert.match(missingServiceRole.stderr, /SUPABASE_SERVICE_ROLE_KEY/)
assert.equal(workflowFetches(missingServiceRole).length, 0, 'missing service-role key must fail before fetch')
assert.doesNotMatch(`${missingServiceRole.stdout}\n${missingServiceRole.stderr}`, /result-admin-must-not-be-used/, 'RESULT_ADMIN_SECRET must not be read or logged by the preflight')

const wrongProjectUrl = runScheduledWorkflowSequence(inlineScript, [], {
  supabaseUrl: 'https://wrong-project.supabase.co',
})
assert.equal(wrongProjectUrl.status, 1, 'preflight must reject a SUPABASE_URL for the wrong project')
assert.match(wrongProjectUrl.stderr, /fzjbnxomflqopwhzxfog/)
assert.equal(workflowFetches(wrongProjectUrl).length, 0, 'wrong-project URL must fail before fetch')

const canonicalRunRow = {
  id: 'canonical-run',
  run_date: workflowPolicy.bangkokDateKey(new Date()),
  mode: 'daily-full-sync-safe',
  status: 'partial',
  current_phase: 'core',
  started_at: now,
}
const bootstrapResult = workflowResult('planned_continuation', 'CURSOR_ADVANCED', new Date(Date.now() - 1_000).toISOString())
const scheduledMissingRun = runScheduledWorkflowSequence(inlineScript, [
  { body: [], status: 200 },
  { body: bootstrapResult, status: 200 },
  { body: [canonicalRunRow], status: 200 },
])
assert.equal(scheduledMissingRun.status, 0, `scheduled preflight without a canonical run must bootstrap today's run: ${scheduledMissingRun.stderr}`)
assert.match(scheduledMissingRun.stdout, /daily bootstrap required runDate=/)
assert.match(scheduledMissingRun.stdout, /daily bootstrap invoked runDate=.* runId=canonical-run/)
assert.match(scheduledMissingRun.stdout, /canonical run created runDate=.* runId=canonical-run/)
assert.doesNotMatch(scheduledMissingRun.stdout, /no continuation due reason=canonical_run_missing/)
const scheduledMissingRunEdgeRequests = workflowFetches(scheduledMissingRun).filter((request) => request.url.includes('/functions/v1/'))
assert.equal(scheduledMissingRunEdgeRequests.length, 1, 'missing canonical run must invoke the daily bootstrap exactly once')
assert.equal(scheduledMissingRunEdgeRequests[0].body.mode, 'daily-sync-auto')
assert.equal(scheduledMissingRunEdgeRequests[0].body.runId, undefined, 'daily bootstrap must not resume an older run id')
assert.equal(scheduledMissingRunEdgeRequests[0].body.autoAdvance, undefined, 'daily bootstrap must reuse the unchanged manual payload')
assert.equal(scheduledMissingRunEdgeRequests[0].body.maxStepsPerRequest, undefined, 'daily bootstrap must reuse the unchanged manual payload')
const scheduledMissingRunRestRequest = workflowFetches(scheduledMissingRun).find((request) => request.url.includes('/rest/v1/'))
assert.ok(scheduledMissingRunRestRequest, 'scheduled preflight must query Supabase REST')
assert.match(scheduledMissingRunRestRequest.url, /^https:\/\/fzjbnxomflqopwhzxfog\.supabase\.co\/rest\/v1\//)
assert.equal(new URL(scheduledMissingRunRestRequest.url).searchParams.get('run_date'), `eq.${workflowPolicy.bangkokDateKey(new Date())}`, 'scheduled preflight must query only the current Bangkok date')
assert.equal(new URL(scheduledMissingRunRestRequest.url).searchParams.get('mode'), 'eq.daily-full-sync-safe')
assert.equal(scheduledMissingRunRestRequest.auth.apikeyUsesServiceRole, true)
assert.equal(scheduledMissingRunRestRequest.auth.bearerUsesServiceRole, true)
assert.equal(scheduledMissingRunRestRequest.auth.contentType, 'application/json')
assert.equal(scheduledMissingRunRestRequest.auth.apikeyUsesResultAdmin, false)
assert.equal(scheduledMissingRunRestRequest.auth.apikeyUsesEdgeAdmin, false)

const todayAlreadyComplete = runScheduledWorkflowSequence(inlineScript, [
  { body: [canonicalRunRow], status: 200 },
  { body: completedWorkflowResult().steps, status: 200 },
])
assert.equal(todayAlreadyComplete.status, 0, `an existing canonical run must not bootstrap again: ${todayAlreadyComplete.stderr}`)
assert.match(todayAlreadyComplete.stdout, /no continuation due reason=canonical_run_complete/)
assert.doesNotMatch(todayAlreadyComplete.stdout, /daily bootstrap required/)
assert.equal(workflowFetches(todayAlreadyComplete).filter((request) => request.url.includes('/functions/v1/')).length, 0)

const yesterdayRunId = 'yesterday-canonical-run'
const yesterdayCanonicalRun = {
  ...canonicalRunRow,
  id: yesterdayRunId,
  run_date: workflowPolicy.bangkokDateKey(new Date(Date.now() - 86_400_000)),
}
const currentBangkokDate = workflowPolicy.bangkokDateKey(new Date())
const yesterdayOnlyPreflightRows = [yesterdayCanonicalRun].filter((run) => run.run_date === currentBangkokDate)
assert.deepEqual(yesterdayOnlyPreflightRows, [], 'a prior Bangkok date must be excluded from today-only preflight results')
const scheduledYesterdayOnly = runScheduledWorkflowSequence(inlineScript, [
  { body: yesterdayOnlyPreflightRows, status: 200 },
  { body: bootstrapResult, status: 200 },
  { body: [canonicalRunRow], status: 200 },
])
assert.equal(scheduledYesterdayOnly.status, 0, `yesterday-only state must bootstrap today: ${scheduledYesterdayOnly.stderr}`)
assert.match(scheduledYesterdayOnly.stdout, /daily bootstrap required/)
const yesterdayOnlyEdgeRequests = workflowFetches(scheduledYesterdayOnly).filter((request) => request.url.includes('/functions/v1/'))
assert.equal(yesterdayOnlyEdgeRequests.length, 1)
assert.equal(yesterdayOnlyEdgeRequests[0].body.runId, undefined, 'a run from yesterday must never be resumed when the current Bangkok date has no canonical run')

const duplicateBootstrapVerification = runScheduledWorkflowSequence(inlineScript, [
  { body: [], status: 200 },
  { body: bootstrapResult, status: 200 },
  { body: [canonicalRunRow, { ...canonicalRunRow, id: 'duplicate-run' }], status: 200 },
])
assert.equal(duplicateBootstrapVerification.status, 1, 'bootstrap must fail if post-invoke verification observes duplicate canonical runs')
assert.match(duplicateBootstrapVerification.stderr, /expected exactly one canonical run/)
assert.equal(workflowFetches(duplicateBootstrapVerification).filter((request) => request.url.includes('/functions/v1/')).length, 1, 'duplicate verification must not trigger another bootstrap invocation')

const redactionServiceRole = 'service-role-redaction-sentinel'
const failedPreflight = runScheduledWorkflowSequence(inlineScript, [{
  body: { message: `Invalid API key ${redactionServiceRole}` },
  status: 401,
}], { serviceRoleKey: redactionServiceRole })
assert.equal(failedPreflight.status, 1, 'REST authentication failure must fail the workflow')
assert.match(failedPreflight.stderr, /canonical run preflight failed with HTTP 401/)
assert.doesNotMatch(`${failedPreflight.stdout}\n${failedPreflight.stderr}`, new RegExp(redactionServiceRole), 'service-role secret value must never be printed')
assert.match(failedPreflight.stderr, /\[masked\]/, 'reflected service-role secret must be redacted')

const scheduledFutureResult = workflowResult('planned_continuation', 'CURSOR_ADVANCED', new Date(Date.now() + 120_000).toISOString())
const scheduledNotDue = runScheduledWorkflowSequence(inlineScript, [
  { body: [canonicalRunRow], status: 200 },
  { body: scheduledFutureResult.steps, status: 200 },
])
assert.equal(scheduledNotDue.status, 0, `not-due scheduled continuation must exit 0: ${scheduledNotDue.stderr}`)
assert.match(scheduledNotDue.stdout, /no continuation due reason=retry_not_due/)
assert.equal(workflowFetches(scheduledNotDue).filter((request) => request.url.includes('/functions/v1/')).length, 0, 'not-due continuation must not invoke the Edge Function')

const activeClaimSteps = structuredClone(scheduledFutureResult.steps)
activeClaimSteps[0].status = 'running'
activeClaimSteps[0].next_retry_at = null
const overlappingScheduledRun = runScheduledWorkflowSequence(inlineScript, [
  { body: [canonicalRunRow], status: 200 },
  { body: activeClaimSteps, status: 200 },
])
assert.equal(overlappingScheduledRun.status, 0, `queued overlap observing an active claim must exit 0: ${overlappingScheduledRun.stderr}`)
assert.match(overlappingScheduledRun.stdout, /active claim runDate=.* runId=canonical-run phase=core/)
assert.doesNotMatch(overlappingScheduledRun.stdout, /daily bootstrap required|continuation due/)
assert.equal(workflowFetches(overlappingScheduledRun).filter((request) => request.url.includes('/functions/v1/')).length, 0, 'overlapping workflow must not duplicate an active Edge invocation')
assert.equal(
  scheduledMissingRunEdgeRequests.length + workflowFetches(overlappingScheduledRun).filter((request) => request.url.includes('/functions/v1/')).length,
  1,
  'serialized colliding scheduled preflights must produce only one daily bootstrap invocation',
)

const dueRetryAt = new Date(Date.now() - 1_000).toISOString()
const scheduledDueSteps = workflowResult('planned_continuation', 'CURSOR_ADVANCED', dueRetryAt).steps
const scheduledDueResult = workflowResult('planned_continuation', 'CURSOR_ADVANCED', new Date(Date.now() + 120_000).toISOString())
const scheduledDue = runScheduledWorkflowSequence(inlineScript, [
  { body: [canonicalRunRow], status: 200 },
  { body: scheduledDueSteps, status: 200 },
  { body: scheduledDueResult, status: 200 },
])
assert.equal(scheduledDue.status, 0, `due scheduled continuation must exit 0 after deferring planned work: ${scheduledDue.stderr}`)
const scheduledDueEdgeRequests = workflowFetches(scheduledDue).filter((request) => request.url.includes('/functions/v1/'))
assert.equal(scheduledDueEdgeRequests.length, 1, 'due continuation must invoke the Edge Function exactly once before the next retry window')
assert.equal(scheduledDueEdgeRequests[0].body.mode, 'daily-sync-auto')
assert.equal(scheduledDueEdgeRequests[0].body.runId, canonicalRunRow.id, 'due continuation must resume the canonical run id')
assert.equal(scheduledDueEdgeRequests[0].body.autoAdvance, true)
assert.equal(scheduledDueEdgeRequests[0].edgeSecretUsesAdmin, true, 'Edge invocation must continue using EDGE_ADMIN_SECRET')
assert.match(scheduledDue.stdout, /continuation due runId=canonical-run/)
assert.match(scheduledDue.stdout, /continuation scheduled runId=canonical-run/)

const scheduledRun = runWorkflowScenario(inlineScript, workflowResult('planned_continuation', 'CURSOR_ADVANCED', new Date(Date.now() + 120_000).toISOString()))
assert.equal(scheduledRun.status, 0, `planned continuation must exit workflow successfully: ${scheduledRun.stderr}`)
assert.match(scheduledRun.stdout, /continuation scheduled runId=canonical-run/)
const productionFutureRetry = new Date(Date.now() + 120_000).toISOString()
const latestProductionPayload = productionWorkflowResult({ nextRetryAt: productionFutureRetry })
assert.equal(latestProductionPayload.steps[0].summary.details.continuationPolicy, undefined, 'Production-shaped fixture must exercise the missing-metadata path')
const latestProductionRun = runWorkflowScenario(inlineScript, latestProductionPayload)
assert.equal(latestProductionRun.status, 0, `latest Production payload must pass assertPipelineState: ${latestProductionRun.stderr}`)
assert.match(latestProductionRun.stdout, /continuation scheduled runId=9cf685ac-7b4a-4110-8a8e-eae61392cf72/)

const incidentRunId = '5aca7d15-987f-4028-8083-3cf54bc7dbbe'
const incidentPreviousPayload = productionWorkflowResult({
  runId: incidentRunId,
  fixtureOffset: 256,
  processedFixtureCount: 256,
  nextRetryAt: new Date(Date.now() - 1_000).toISOString(),
})
const incidentCurrentPayload = withSyntheticFailedCountPolicy(productionWorkflowResult({
  runId: incidentRunId,
  fixtureOffset: 260,
  processedFixtureCount: 260,
  nextRetryAt: productionFutureRetry,
  failures: [{ message: 'FAILED_COUNT_REPORTED' }],
}))
assert.equal(incidentCurrentPayload.failed, 0)
assert.deepEqual(incidentCurrentPayload.failedEndpoints, [])
assert.equal(incidentCurrentPayload.rateLimited, false)
assert.equal(incidentCurrentPayload.failureAttempts, 0)
assert.equal(incidentCurrentPayload.steps[0].summary.details.continuationPolicy.reason, 'FAILED_COUNT_REPORTED')
assert.equal(workflowPolicy.classifyWorkflowContinuation(incidentCurrentPayload).kind, 'planned_continuation', 'Production FAILED_COUNT_REPORTED diagnostic must classify as planned_continuation when current failed counters are zero')
const incidentProgressRun = runWorkflowSequence(inlineScript, [
  { body: incidentPreviousPayload, status: 200 },
  { body: incidentCurrentPayload, status: 200 },
])
assert.equal(incidentProgressRun.status, 0, `Production cursor progress 256 -> 260 with a synthetic diagnostic must exit 0: ${incidentProgressRun.stderr}`)
assert.doesNotMatch(incidentProgressRun.stderr, /Daily pipeline real failure/)
assert.match(incidentProgressRun.stdout, new RegExp(`continuation scheduled runId=${incidentRunId}`))

const productionAuxiliaryPrevious = withCoreContinuation(productionWorkflowResult({
  runId: incidentRunId,
  fixtureOffset: 260,
  processedFixtureCount: 262,
  nextRetryAt: new Date(Date.now() - 1_000).toISOString(),
}), {
  batchSignature: 'fnv1a-f394c4f4-15',
  completedBatchSignatures: ['fnv1a-prior-batch-12'],
  coreStage: 'coverage',
  coverageOffset: 0,
  coverageTotalCandidates: 25,
})
const productionAuxiliaryCurrent = withCoreContinuation(productionWorkflowResult({
  runId: incidentRunId,
  fixtureOffset: 266,
  processedFixtureCount: 262,
  nextRetryAt: productionFutureRetry,
}), {
  batchSignature: 'fnv1a-f394c4f4-15',
  completedBatchSignatures: ['fnv1a-prior-batch-12'],
  coreStage: 'coverage',
  coverageOffset: 11,
  coverageTotalCandidates: 25,
})
productionAuxiliaryCurrent.processed = 11
productionAuxiliaryCurrent.rowsSaved = 11
productionAuxiliaryCurrent.steps[0].processed = 11
productionAuxiliaryCurrent.steps[0].rows_saved = 11
productionAuxiliaryCurrent.steps[0].summary.processed = 11
productionAuxiliaryCurrent.steps[0].summary.rowsSaved = 11
productionAuxiliaryCurrent.steps[0].summary.details.reason = 'SOFT_DEADLINE_REACHED'
productionAuxiliaryCurrent.steps[0].summary.details.coverageProcessed = 11
const productionAuxiliaryTransition = workflowPolicy.inspectContinuationTransition(
  workflowPolicy.getContinuationCursor(productionAuxiliaryPrevious.steps[0]),
  workflowPolicy.getContinuationCursor(productionAuxiliaryCurrent.steps[0]),
)
assert.equal(productionAuxiliaryTransition.progress, true, 'persisted auxiliary offset must be canonical workflow progress')
const productionAuxiliaryRun = runWorkflowSequence(inlineScript, [
  { body: productionAuxiliaryPrevious, status: 200 },
  { body: productionAuxiliaryCurrent, status: 200 },
])
assert.equal(productionAuxiliaryRun.status, 0, `exact Production fixtureOffset 260 -> 266 / processedFixtureCount 262 -> 262 payload with coverage progress must exit 0: ${productionAuxiliaryRun.stderr}`)
assert.doesNotMatch(productionAuxiliaryRun.stderr, /STUCK_CONTINUATION/)
assert.match(productionAuxiliaryRun.stdout, /coreStage=coverage coverageOffset=11/)

const duplicateFixturePrevious = withCoreContinuation(productionWorkflowResult({
  runId: incidentRunId,
  fixtureOffset: 260,
  processedFixtureCount: 262,
  nextRetryAt: new Date(Date.now() - 1_000).toISOString(),
}), { batchSignature: 'fnv1a-f394c4f4-15', completedBatchSignatures: ['fnv1a-f394c4f4-15'] })
const duplicateFixtureCurrent = withCoreContinuation(productionWorkflowResult({
  runId: incidentRunId,
  fixtureOffset: 266,
  processedFixtureCount: 262,
  nextRetryAt: productionFutureRetry,
}), { batchSignature: 'fnv1a-f394c4f4-15', completedBatchSignatures: ['fnv1a-f394c4f4-15'] })
assert.equal(workflowPolicy.inspectContinuationTransition(
  workflowPolicy.getContinuationCursor(duplicateFixturePrevious.steps[0]),
  workflowPolicy.getContinuationCursor(duplicateFixtureCurrent.steps[0]),
).progress, true, 'duplicate fixture skip may advance fixtureOffset without incrementing processedFixtureCount')
const duplicateFixtureRun = runWorkflowSequence(inlineScript, [
  { body: duplicateFixturePrevious, status: 200 },
  { body: duplicateFixtureCurrent, status: 200 },
])
assert.equal(duplicateFixtureRun.status, 0, `duplicate fixture skip must be accepted as progress: ${duplicateFixtureRun.stderr}`)

const failureAttemptsPreviousPayload = productionWorkflowResult({
  runId: incidentRunId,
  fixtureOffset: 260,
  processedFixtureCount: 260,
  nextRetryAt: new Date(Date.now() - 1_000).toISOString(),
})
const failureAttemptsCurrentPayload = failureAttemptsProductionWorkflowResult({
  runId: incidentRunId,
  fixtureOffset: 262,
  processedFixtureCount: 262,
  nextRetryAt: productionFutureRetry,
})
const failureAttemptsEvidence = workflowPolicy.getCanonicalCurrentFailureEvidence(failureAttemptsCurrentPayload, failureAttemptsCurrentPayload.steps[0])
assert.equal(failureAttemptsCurrentPayload.processed, 10)
assert.equal(failureAttemptsCurrentPayload.rowsSaved, 2)
assert.equal(failureAttemptsCurrentPayload.steps[0].status, 'pending_retry')
assert.equal(failureAttemptsCurrentPayload.steps[0].summary.status, 'partial_success')
assert.equal(failureAttemptsCurrentPayload.steps[0].summary.failed, 0)
assert.equal(failureAttemptsCurrentPayload.steps[0].summary.details.reason, 'SOFT_DEADLINE_REACHED')
assert.equal(failureAttemptsCurrentPayload.steps[0].summary.details.remainingMs, 4208)
assert.equal(failureAttemptsCurrentPayload.steps[0].summary.details.continuationPolicy.reason, 'FAILURE_ATTEMPTS_REPORTED')
assert.equal(failureAttemptsCurrentPayload.steps[0].summary.details.continuationPolicy.failureAttempts, 4, 'fixture must reproduce the misleading nested policy counter')
assert.equal(failureAttemptsEvidence.failureAttempts, 0, 'nested continuationPolicy counters are not canonical current-step evidence')
assert.equal(failureAttemptsEvidence.failedCount, 0)
assert.equal(failureAttemptsEvidence.stepFailedCount, 0)
assert.equal(failureAttemptsEvidence.exhausted, false)
assert.deepEqual(failureAttemptsEvidence.failedEndpoints, [])
assert.deepEqual(failureAttemptsEvidence.explicitErrors, [])
assert.deepEqual(failureAttemptsEvidence.reasons, [])
assert.equal(failureAttemptsEvidence.hasRealFailure, false)
assert.equal(workflowPolicy.classifyWorkflowContinuation(failureAttemptsCurrentPayload).kind, 'planned_continuation')
const failureAttemptsProgressRun = runWorkflowSequence(inlineScript, [
  { body: failureAttemptsPreviousPayload, status: 200 },
  { body: failureAttemptsCurrentPayload, status: 200 },
])
assert.equal(failureAttemptsProgressRun.status, 0, `Production cursor progress 260 -> 262 with an unconfirmed FAILURE_ATTEMPTS_REPORTED policy must exit 0: ${failureAttemptsProgressRun.stderr}`)
assert.doesNotMatch(failureAttemptsProgressRun.stderr, /Daily pipeline real failure/)
assert.match(failureAttemptsProgressRun.stdout, /Ignoring unconfirmed advisory policy reason FAILURE_ATTEMPTS_REPORTED/)

const currentFailureAttemptsPayload = failureAttemptsProductionWorkflowResult({ runId: incidentRunId, fixtureOffset: 262, processedFixtureCount: 262, nextRetryAt: productionFutureRetry })
currentFailureAttemptsPayload.steps[0].failureAttempts = 1
const currentFailureAttemptsRun = runWorkflowScenario(inlineScript, currentFailureAttemptsPayload)
assert.equal(currentFailureAttemptsRun.status, 1, 'FAILURE_ATTEMPTS_REPORTED plus current canonical step.failureAttempts=1 must exit 1')

const currentStepFailedPayload = failureAttemptsProductionWorkflowResult({ runId: incidentRunId, fixtureOffset: 262, processedFixtureCount: 262, nextRetryAt: productionFutureRetry })
currentStepFailedPayload.steps[0].failed = 1
const currentStepFailedRun = runWorkflowScenario(inlineScript, currentStepFailedPayload)
assert.equal(currentStepFailedRun.status, 1, 'FAILURE_ATTEMPTS_REPORTED plus current step.failed=1 must exit 1')

const currentStepFailedStatusPayload = failureAttemptsProductionWorkflowResult({ runId: incidentRunId, fixtureOffset: 262, processedFixtureCount: 262, nextRetryAt: productionFutureRetry })
currentStepFailedStatusPayload.steps[0].status = 'failed'
const currentStepFailedStatusRun = runWorkflowScenario(inlineScript, currentStepFailedStatusPayload)
assert.equal(currentStepFailedStatusRun.status, 1, 'FAILURE_ATTEMPTS_REPORTED plus current step status=failed must exit 1')

const currentStepExhaustedPayload = failureAttemptsProductionWorkflowResult({ runId: incidentRunId, fixtureOffset: 262, processedFixtureCount: 262, nextRetryAt: productionFutureRetry })
currentStepExhaustedPayload.steps[0].exhausted = true
const currentStepExhaustedRun = runWorkflowScenario(inlineScript, currentStepExhaustedPayload)
assert.equal(currentStepExhaustedRun.status, 1, 'FAILURE_ATTEMPTS_REPORTED plus exhausted current step must exit 1')

const failureAttemptsDatabasePayload = failureAttemptsProductionWorkflowResult({ runId: incidentRunId, fixtureOffset: 262, processedFixtureCount: 262, nextRetryAt: productionFutureRetry })
failureAttemptsDatabasePayload.errorMessage = 'database write failed for the current core invocation'
const failureAttemptsDatabaseRun = runWorkflowScenario(inlineScript, failureAttemptsDatabasePayload)
assert.equal(failureAttemptsDatabaseRun.status, 1, 'FAILURE_ATTEMPTS_REPORTED plus a current database error must exit 1')

const softDeadlineFailedPayload = failureAttemptsProductionWorkflowResult({ runId: incidentRunId, fixtureOffset: 262, processedFixtureCount: 262, nextRetryAt: productionFutureRetry })
softDeadlineFailedPayload.failed = 1
const softDeadlineFailedRun = runWorkflowScenario(inlineScript, softDeadlineFailedPayload)
assert.equal(softDeadlineFailedRun.status, 1, 'SOFT_DEADLINE_REACHED with current failed=1 must exit 1')

const failureAttemptsCursorRegressionRun = runWorkflowSequence(inlineScript, [
  { body: failureAttemptsProductionWorkflowResult({ runId: incidentRunId, fixtureOffset: 262, processedFixtureCount: 262, nextRetryAt: new Date(Date.now() - 1_000).toISOString() }), status: 200 },
  { body: failureAttemptsProductionWorkflowResult({ runId: incidentRunId, fixtureOffset: 260, processedFixtureCount: 260, nextRetryAt: productionFutureRetry }), status: 200 },
])
assert.equal(failureAttemptsCursorRegressionRun.status, 1, 'FAILURE_ATTEMPTS_REPORTED cursor regression 262 -> 260 must exit 1')
assert.match(failureAttemptsCursorRegressionRun.stderr, /CURSOR_REGRESSION/)

const failureAttemptsNoProgressRun = runWorkflowScenario(inlineScript, failureAttemptsProductionWorkflowResult({
  runId: incidentRunId,
  fixtureOffset: 262,
  processedFixtureCount: 262,
  nextRetryAt: new Date(Date.now() - 1_000).toISOString(),
}))
assert.equal(failureAttemptsNoProgressRun.status, 1, 'FAILURE_ATTEMPTS_REPORTED repeated no-progress must exit 1 at the third repeat')
assert.match(failureAttemptsNoProgressRun.stderr, /STUCK_CONTINUATION/)

const staleFailureAttemptsPayload = failureAttemptsProductionWorkflowResult({ runId: incidentRunId, fixtureOffset: 262, processedFixtureCount: 262, nextRetryAt: productionFutureRetry })
staleFailureAttemptsPayload.failureAttempts = 6
staleFailureAttemptsPayload.finalSummary = { failureAttempts: 9, failed: 3 }
staleFailureAttemptsPayload.priorRunSummary = { failureAttempts: 8 }
staleFailureAttemptsPayload.priorInvocationAggregate = { failureAttempts: 7 }
const staleFailureAttemptsRun = runWorkflowScenario(inlineScript, staleFailureAttemptsPayload)
assert.equal(staleFailureAttemptsRun.status, 0, `stale failureAttempts aggregates and nested policy counters must not reject current step.failureAttempts=0: ${staleFailureAttemptsRun.stderr}`)

const staleHistoricalAggregatePayload = withSyntheticFailedCountPolicy(productionWorkflowResult({
  runId: incidentRunId,
  fixtureOffset: 260,
  processedFixtureCount: 260,
  nextRetryAt: productionFutureRetry,
  failures: [{ message: 'FAILED_COUNT_REPORTED' }],
}))
staleHistoricalAggregatePayload.finalSummary = { failed: 7 }
staleHistoricalAggregatePayload.priorRunSummary = { failed: 5 }
staleHistoricalAggregatePayload.priorInvocationAggregate = { failed: 3 }
const staleHistoricalAggregateRun = runWorkflowScenario(inlineScript, staleHistoricalAggregatePayload)
assert.equal(staleHistoricalAggregateRun.status, 0, `stale historical failed aggregates must not reject the current safe continuation: ${staleHistoricalAggregateRun.stderr}`)

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

const repeatedNoProgressRun = runWorkflowScenario(inlineScript, withSyntheticFailedCountPolicy(productionWorkflowResult({
  runId: incidentRunId,
  fixtureOffset: 260,
  processedFixtureCount: 260,
  nextRetryAt: new Date(Date.now() - 1_000).toISOString(),
  failures: [{ message: 'FAILED_COUNT_REPORTED' }],
})))
assert.equal(repeatedNoProgressRun.status, 1, 'repeated no-progress continuation must exit workflow with code 1 at the threshold')
assert.match(repeatedNoProgressRun.stderr, /STUCK_CONTINUATION/)

const legacyIncidentPrevious = productionWorkflowResult({
  runId: incidentRunId,
  fixtureOffset: 260,
  processedFixtureCount: 262,
  nextRetryAt: new Date(Date.now() - 1_000).toISOString(),
})
const legacyIncidentCurrent = productionWorkflowResult({
  runId: incidentRunId,
  fixtureOffset: 266,
  processedFixtureCount: 262,
  nextRetryAt: new Date(Date.now() - 1_000).toISOString(),
})
legacyIncidentCurrent.processed = 11
legacyIncidentCurrent.rowsSaved = 11
legacyIncidentCurrent.steps[0].summary.processed = 11
legacyIncidentCurrent.steps[0].summary.rowsSaved = 11
legacyIncidentCurrent.steps[0].summary.details.reason = 'SOFT_DEADLINE_REACHED'
legacyIncidentCurrent.steps[0].summary.details.coverageProcessed = 11
const legacyIncidentRun = runWorkflowSequence(inlineScript, [
  { body: legacyIncidentPrevious, status: 200 },
  ...Array.from({ length: 4 }, () => ({ body: legacyIncidentCurrent, status: 200 })),
])
assert.equal(legacyIncidentRun.status, 1, 'legacy Production payload without an auxiliary cursor must reach the exact repeated no-progress exit branch')
assert.match(legacyIncidentRun.stderr, /Daily football sync workflow failed:.*STUCK_CONTINUATION/s, 'STUCK_CONTINUATION exit 1 must never be silent')

const invocationBudgetResponses = Array.from({ length: 12 }, (_, index) => ({
  body: productionWorkflowResult({
    runId: incidentRunId,
    fixtureOffset: 260 + index,
    processedFixtureCount: 262,
    nextRetryAt: new Date(Date.now() - 1_000).toISOString(),
  }),
  status: 200,
}))
const invocationBudgetRun = runWorkflowSequence(inlineScript, invocationBudgetResponses)
assert.equal(invocationBudgetRun.status, 0, `workflow invocation budget exhaustion with valid continuation must exit 0: ${invocationBudgetRun.stderr}`)
assert.match(invocationBudgetRun.stdout, /invocation=12\/12/, 'workflow must log the scheduled continuation at its invocation limit')

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
const syntheticFailureResult = withSyntheticFailedCountPolicy(productionWorkflowResult({
  runId: incidentRunId,
  fixtureOffset: 260,
  processedFixtureCount: 260,
  nextRetryAt: productionFutureRetry,
  failures: [{ message: 'FAILED_COUNT_REPORTED' }],
}))
syntheticFailureResult.failed = 1
const syntheticFailureRun = runWorkflowScenario(inlineScript, syntheticFailureResult)
assert.equal(syntheticFailureRun.status, 1, 'FAILED_COUNT_REPORTED with result.failed=1 must exit workflow with code 1')
const failedAggregateRun = runWorkflowScenario(inlineScript, {
  ...workflowResult('planned_continuation', 'CURSOR_ADVANCED', new Date(Date.now() + 120_000).toISOString()),
  failed: 3,
})
assert.equal(failedAggregateRun.status, 1, 'a current result.failed aggregate must not be hidden by planned continuation metadata')

const incidentDatabaseFailure = withSyntheticFailedCountPolicy(productionWorkflowResult({
  runId: incidentRunId,
  fixtureOffset: 260,
  processedFixtureCount: 260,
  nextRetryAt: productionFutureRetry,
  failures: [{ message: 'FAILED_COUNT_REPORTED' }],
}))
incidentDatabaseFailure.errorMessage = 'database query failed for current core invocation'
const incidentDatabaseFailureRun = runWorkflowScenario(inlineScript, incidentDatabaseFailure)
assert.equal(incidentDatabaseFailureRun.status, 1, 'database error plus FAILED_COUNT_REPORTED must exit workflow with code 1')

const incidentExhaustedStep = withSyntheticFailedCountPolicy(productionWorkflowResult({
  runId: incidentRunId,
  fixtureOffset: 260,
  processedFixtureCount: 260,
  nextRetryAt: productionFutureRetry,
  failures: [{ message: 'FAILED_COUNT_REPORTED' }],
}))
incidentExhaustedStep.steps[0].exhausted = true
const incidentExhaustedStepRun = runWorkflowScenario(inlineScript, incidentExhaustedStep)
assert.equal(incidentExhaustedStepRun.status, 1, 'exhausted current step plus FAILED_COUNT_REPORTED must exit workflow with code 1')

const incidentStepFailedCount = withSyntheticFailedCountPolicy(productionWorkflowResult({
  runId: incidentRunId,
  fixtureOffset: 260,
  processedFixtureCount: 260,
  nextRetryAt: productionFutureRetry,
  failures: [{ message: 'FAILED_COUNT_REPORTED' }],
}))
incidentStepFailedCount.steps[0].summary.failed = 1
const incidentStepFailedCountRun = runWorkflowScenario(inlineScript, incidentStepFailedCount)
assert.equal(incidentStepFailedCountRun.status, 1, 'current step failed count plus FAILED_COUNT_REPORTED must exit workflow with code 1')

const incidentFailureAttempt = withSyntheticFailedCountPolicy(productionWorkflowResult({
  runId: incidentRunId,
  fixtureOffset: 260,
  processedFixtureCount: 260,
  nextRetryAt: productionFutureRetry,
  failures: [{ message: 'FAILED_COUNT_REPORTED' }],
}))
incidentFailureAttempt.steps[0].failureAttempts = 1
const incidentFailureAttemptRun = runWorkflowScenario(inlineScript, incidentFailureAttempt)
assert.equal(incidentFailureAttemptRun.status, 1, 'current phase failureAttempts plus FAILED_COUNT_REPORTED must exit workflow with code 1')

const incidentCursorRegressionRun = runWorkflowSequence(inlineScript, [
  { body: productionWorkflowResult({ runId: incidentRunId, fixtureOffset: 260, processedFixtureCount: 260, nextRetryAt: new Date(Date.now() - 1_000).toISOString() }), status: 200 },
  { body: withSyntheticFailedCountPolicy(productionWorkflowResult({ runId: incidentRunId, fixtureOffset: 256, processedFixtureCount: 256, nextRetryAt: productionFutureRetry, failures: [{ message: 'FAILED_COUNT_REPORTED' }] })), status: 200 },
])
assert.equal(incidentCursorRegressionRun.status, 1, 'Production cursor regression 260 -> 256 must exit workflow with code 1')
assert.match(incidentCursorRegressionRun.stderr, /unsafe planned continuation/)
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
  const advisoryReasonOnlyRun = runWorkflowScenario(inlineScript, workflowResult('real_failure', reason, new Date(Date.now() + 120_000).toISOString()))
  assert.equal(advisoryReasonOnlyRun.status, 0, `${reason} policy text alone must not bypass canonical cursor validation`)
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
const completedSyntheticDiagnostic = completedWorkflowResult()
completedSyntheticDiagnostic.failures = [{ message: 'FAILED_COUNT_REPORTED' }]
const completedSyntheticDiagnosticRun = runWorkflowSequence(inlineScript, [
  { body: completedSyntheticDiagnostic, status: 200 },
  { body: { ok: true, failed: 0, failures: [] }, status: 200 },
])
assert.equal(completedSyntheticDiagnosticRun.status, 0, 'FAILED_COUNT_REPORTED alone must remain non-fatal for a completed daily response')
assert.match(inlineScript, /invocation <= 12/)
assert.match(inlineScript, /STUCK_CONTINUATION/)
assert.match(inlineScript, /continuation scheduled runId=/)
assert.match(inlineScript, /uniqueProcessedFixtureCount/)
assert.match(inlineScript, /processedFixtureIds/)
assert.match(inlineScript, /fixtureStableEmptyPasses/)
assert.match(inlineScript, /async function main\(\)/)
assert.doesNotMatch(inlineScript, /retryAfterSeconds > 60\) throw new Error/)

const edgeSource = await readFile(new URL('../supabase/functions/sync-football-data/index.ts', import.meta.url), 'utf8')
assert.match(edgeSource, /attempt_count: retry\.persistedAttemptCount/)
assert.match(edgeSource, /continuationPolicy: retry\.continuationPolicy/)
assert.match(edgeSource, /getStepFailureAttemptCount\(step\)/)
assert.match(edgeSource, /selectCoreAuxiliaryBatch\(candidates, context\.continuationState\?\.coverageOffset, context\.limit\)/)
assert.match(edgeSource, /selectCoreAuxiliaryBatch\(candidates, context\.continuationState\?\.roundsOffset, context\.limit\)/)
assert.match(edgeSource, /advanceCoreAuxiliaryContinuation\(context\.continuationState, 'coverage'/)
assert.match(edgeSource, /advanceCoreAuxiliaryContinuation\(context\.continuationState, 'rounds'/)
assert.match(edgeSource, /await persistStepContinuation\(context, next\)/)

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
  failures = [],
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
    partial: true,
    failed: 0,
    failures,
    failedEndpoints: [],
    rateLimited: false,
    failureAttempts: 0,
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

function failureAttemptsProductionWorkflowResult(options = {}) {
  const payload = productionWorkflowResult(options)
  payload.processed = 10
  payload.rowsSaved = 2
  const currentStep = payload.steps[0]
  currentStep.failed = 0
  currentStep.failureAttempts = 0
  currentStep.summary.details.reason = 'SOFT_DEADLINE_REACHED'
  currentStep.summary.details.remainingMs = 4208
  return withAdvisoryRealFailurePolicy(payload, 'FAILURE_ATTEMPTS_REPORTED', {
    failureAttemptCount: 4,
    failureAttempts: 4,
    exhausted: false,
  })
}

function withSyntheticFailedCountPolicy(payload) {
  return withAdvisoryRealFailurePolicy(payload, 'FAILED_COUNT_REPORTED', {
    failureAttemptCount: 0,
    exhausted: false,
  })
}

function withAdvisoryRealFailurePolicy(payload, reason, metadata = {}) {
  const currentStep = payload.steps[0]
  currentStep.error_message = reason
  currentStep.summary.details.continuationPolicy = {
    ...metadata,
    kind: 'real_failure',
    reason,
  }
  return payload
}

function withCoreContinuation(payload, continuation) {
  const currentStep = payload.steps[0]
  currentStep.continuation_state = {
    ...currentStep.continuation_state,
    ...continuation,
  }
  Object.assign(payload, continuation)
  return payload
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

function runScheduledWorkflowSequence(inlineScript, responses, options = {}) {
  const serialized = JSON.stringify(responses)
  const config = JSON.stringify({
    supabaseUrl: 'https://fzjbnxomflqopwhzxfog.supabase.co',
    serviceRoleKey: 'test-service-role-key',
    edgeAdminSecret: 'test-edge-admin-secret',
    resultAdminSecret: 'test-result-admin-secret',
    ...options,
  })
  const prelude = `process.env.SYNC_ENDPOINT = 'https://example.invalid/functions/v1/sync-football-data'; const mockConfig = ${config}; if (mockConfig.supabaseUrl == null) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = mockConfig.supabaseUrl; if (mockConfig.serviceRoleKey == null) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = mockConfig.serviceRoleKey; process.env.EDGE_ADMIN_SECRET = mockConfig.edgeAdminSecret; process.env.RESULT_ADMIN_SECRET = mockConfig.resultAdminSecret; process.env.GITHUB_EVENT_NAME = 'schedule'; const mockResponses = ${serialized}; let mockIndex = 0; globalThis.fetch = async (input, init = {}) => { const item = mockResponses[Math.min(mockIndex, mockResponses.length - 1)]; mockIndex += 1; const headers = new Headers(init.headers); const body = init.body ? JSON.parse(init.body) : null; const edgeSecretUsesAdmin = body?.sb_secret === process.env.EDGE_ADMIN_SECRET; if (body?.sb_secret) body.sb_secret = '[masked]'; const auth = { apikeyUsesServiceRole: headers.get('apikey') === process.env.SUPABASE_SERVICE_ROLE_KEY, bearerUsesServiceRole: headers.get('authorization') === 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY, contentType: headers.get('content-type'), apikeyUsesResultAdmin: headers.get('apikey') === process.env.RESULT_ADMIN_SECRET, apikeyUsesEdgeAdmin: headers.get('apikey') === process.env.EDGE_ADMIN_SECRET }; console.log('TEST_FETCH ' + JSON.stringify({ url: String(input), method: init.method ?? 'GET', body, auth, edgeSecretUsesAdmin })); return new Response(JSON.stringify(item.body), { status: item.status, headers: { 'content-type': 'application/json' } }); };\n`
  return spawnSync(process.execPath, [], { input: `${prelude}${inlineScript}`, encoding: 'utf8', timeout: 5_000 })
}

function workflowFetches(result) {
  return result.stdout.split(/\r?\n/)
    .filter((line) => line.startsWith('TEST_FETCH '))
    .map((line) => JSON.parse(line.slice('TEST_FETCH '.length)))
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
    'bangkokDateKey',
    'hasItems',
    'asArray',
    'failureDiagnosticMessage',
    'isDerivedCounterAdvisoryDiagnostic',
    'getFailureDiagnostics',
    'getCanonicalNonAdvisoryFailureDiagnostics',
    'hasExplicitRealError',
    'maximumCanonicalCounter',
    'getRequiredSteps',
    'isComplete',
    'getBlockingStep',
    'getStepContinuationPolicy',
    'getCanonicalCurrentFailureEvidence',
    'getContinuationCursor',
    'validateContinuationCursor',
    'inspectContinuationTransition',
    'classifyWorkflowContinuation',
    'getRetryWindowDecision',
  ]
  const declarations = names.map((name) => functionSource(source, name)).join('\n')
  return new Function(`const requiredPhases = ['core', 'fixture-enrichment', 'team-enrichment', 'league-enrichment', 'ranking']; ${declarations}; return { bangkokDateKey, getCanonicalCurrentFailureEvidence, getContinuationCursor, inspectContinuationTransition, classifyWorkflowContinuation, getRetryWindowDecision }`)()
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
