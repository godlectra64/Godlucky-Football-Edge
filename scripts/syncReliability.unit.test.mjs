import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  MAX_DAILY_SYNC_STEPS_PER_REQUEST,
  UPSTREAM_BODY_PREVIEW_LIMIT,
  buildDeadlinePendingSummary,
  buildPhaseLog,
  buildSyncFailureLog,
  createExecutionBudget,
  finishLogBestEffort,
  parseUpstreamJsonResponse,
  sanitizeDiagnosticValue,
  shouldDeferExecution,
} from '../supabase/functions/_shared/syncReliability.js'
import {
  advanceContinuation,
  buildBatchSignature,
  createContinuationState,
  shouldProcessBatch,
} from '../supabase/functions/_shared/pipelinePolicy.js'
import { buildDailySyncStepResponseCached } from '../supabase/functions/_shared/dailySyncResponse.js'

const secret = 'sb_secret_PRODUCTION_DO_NOT_LOG'
const html = `<!doctype html><html><body><h1>522 Connection timed out</h1>${'cloudflare '.repeat(200)}${secret}</body></html>`
let htmlError
try {
  await parseUpstreamJsonResponse(new Response(html, {
    status: 522,
    headers: { 'content-type': 'text/html; charset=UTF-8' },
  }), { provider: 'supabase', errorStage: 'supabase-request' })
} catch (error) {
  htmlError = error
}
assert.ok(htmlError, 'HTML 522 must throw a classified error')
assert.equal(htmlError.errorCode, 'SUPABASE_UPSTREAM_TIMEOUT')
assert.equal(htmlError.errorStage, 'supabase-request')
assert.equal(htmlError.status, 522)
assert.equal(htmlError.contentType, 'text/html; charset=UTF-8')
assert.ok(htmlError.bodyPreview.length <= UPSTREAM_BODY_PREVIEW_LIMIT + 14, 'HTML preview must be truncated')
assert.doesNotMatch(htmlError.message, /<html|cloudflare cloudflare/i, 'short error message must not contain the HTML page')

const errorResponse = {
  errorCode: 'SUPABASE_UPSTREAM_TIMEOUT',
  errorStage: 'fixture-enrichment',
  provider: 'supabase',
  errorMessage: `upstream failed token=${secret}`,
  errorDetails: { status: 522, bodyPreview: html, authorization: `Bearer ${secret}` },
  failures: [{ message: `apikey=${secret}`, apiKey: secret }],
}
const cause = new Error(`cause Bearer ${secret}`)
const failure = new Error(`request failed ${secret}`, { cause })
failure.stack = `Error: request failed ${secret}\n at worker (index.ts:1:1)`
const structuredLog = buildSyncFailureLog({ mode: 'daily-sync-auto', errorResponse, error: failure, durationMs: 41_866 }, { secrets: [secret] })
assert.deepEqual(Object.keys(structuredLog), [
  'mode', 'errorCode', 'errorStage', 'provider', 'errorMessage', 'errorDetails', 'failures', 'durationMs', 'stack', 'cause',
])
assert.equal(structuredLog.errorStage, 'fixture-enrichment')
assert.equal(structuredLog.durationMs, 41_866)
assert.doesNotMatch(JSON.stringify(structuredLog), new RegExp(secret), 'structured failure log must redact known secrets')
assert.equal(Object.hasOwn(structuredLog.errorDetails, 'authorization'), false, 'authorization fields must be removed')
assert.equal(Object.hasOwn(structuredLog.failures[0], 'apiKey'), false, 'API key fields must be removed')

const phaseLog = buildPhaseLog({
  runId: 'run-1',
  dateKey: '2026-07-15',
  stepOrder: 2,
  phase: 'fixture-enrichment',
  durationMs: 123,
  continuation: { providerPage: 3, fixtureOffset: 20, oddsOffset: 7, batchSignature: 'batch-safe', authorization: secret },
  error: failure,
}, { secrets: [secret] })
assert.deepEqual(Object.keys(phaseLog), ['runId', 'dateKey', 'stepOrder', 'phase', 'durationMs', 'continuation', 'errorMessage', 'stack', 'cause'])
assert.equal(phaseLog.continuation.providerPage, 3)
assert.equal(phaseLog.continuation.fixtureOffset, 20)
assert.equal(phaseLog.continuation.oddsOffset, 7)
assert.doesNotMatch(JSON.stringify(phaseLog), new RegExp(secret))

const originalJsonError = { ok: false, errorCode: 'SYNC_FAILED', errorStage: 'ranking', errorMessage: 'ranking failed' }
let finishLogFailure = null
const finishSucceeded = await finishLogBestEffort(
  async () => { throw new Error('sync_logs unavailable') },
  (error) => { finishLogFailure = error },
)
assert.equal(finishSucceeded, false)
assert.equal(finishLogFailure.message, 'sync_logs unavailable')
assert.deepEqual(originalJsonError, { ok: false, errorCode: 'SYNC_FAILED', errorStage: 'ranking', errorMessage: 'ranking failed' }, 'finishLog failure must not replace the original JSON error')

const budget = createExecutionBudget(1_000, 40_000)
assert.equal(budget.softDeadlineAt, 41_000)
assert.equal(shouldDeferExecution(budget, 35_999, 5_000), false)
assert.equal(shouldDeferExecution(budget, 36_000, 5_000), true)
const continuation = createContinuationState({
  providerPage: 4,
  fixtureOffset: 30,
  oddsOffset: 12,
  processedFixtureCount: 42,
  lastProcessedFixtureId: 999,
  batchSignature: 'batch-current',
  completedBatchSignatures: ['batch-complete'],
})
const deadlineSummary = buildDeadlinePendingSummary({ stepOrder: 2, phase: 'fixture-enrichment', durationMs: 35_000, continuation })
assert.equal(deadlineSummary.status, 'pending_retry')
assert.equal(deadlineSummary.partial, true)
assert.equal(deadlineSummary.failed, 0)
assert.deepEqual(deadlineSummary.continuationState, continuation)

const signature = buildBatchSignature([101, 102])
const completed = advanceContinuation(continuation, { batchSignature: signature, batchComplete: true })
assert.equal(shouldProcessBatch(completed, signature), false, 'completed batch signature must not be processed twice')
assert.equal(shouldProcessBatch(completed, buildBatchSignature([103])), true)

const stepResponse = buildDailySyncStepResponseCached('daily-sync-auto', {
  run: { id: 'run-1', status: 'partial', summary: {} },
  step: { phase: 'fixture-enrichment', continuation_state: continuation },
  nextStep: null,
  steps: [{ phase: 'fixture-enrichment', status: 'pending_retry', attempt_count: 1, max_attempts: 20, next_retry_at: '2099-01-01T00:00:00.000Z', continuation_state: continuation }],
  summary: deadlineSummary,
}, { provider: 'api-football' }, 35_000, { now: Date.parse('2026-07-15T00:00:00.000Z') })
assert.equal(stepResponse.status, 'pending_retry')
assert.equal(stepResponse.partial, true)
assert.deepEqual(stepResponse.continuation, continuation)

const sanitized = sanitizeDiagnosticValue({ requestBody: { password: secret }, authorization: `Bearer ${secret}`, safe: `token=${secret}` }, { secrets: [secret] })
assert.doesNotMatch(JSON.stringify(sanitized), new RegExp(secret))
assert.equal(Object.hasOwn(sanitized, 'authorization'), false)

const source = await readFile(new URL('../supabase/functions/sync-football-data/index.ts', import.meta.url), 'utf8')
assert.match(source, /console\.error\('sync-football-data-failed',\s*buildSyncFailureLog/)
assert.match(source, /console\.error\('sync-football-data-finish-log-failed',\s*buildFinishLogFailureLog/)
assert.match(source, /await finishLogBestEffort[\s\S]*return json\(errorResponse, 500\)/)
assert.match(source, /console\.info\('daily-sync-phase-start'/)
assert.match(source, /console\.info\('daily-sync-phase-complete'/)
assert.match(source, /console\.error\('daily-sync-phase-failed'/)
assert.match(source, /new DailySyncPhaseError\(phase, error\)/)
assert.match(source, /MAX_DAILY_SYNC_STEPS_PER_REQUEST/)
assert.equal(MAX_DAILY_SYNC_STEPS_PER_REQUEST, 2)
const autoSource = functionSource(source, 'runDailySyncOrchestratorMode')
assert.doesNotMatch(autoSource, /fetch\s*\(|sync-football-data/, 'daily-sync-auto must not invoke the Edge Function endpoint')
assert.equal(autoSource.match(/runDailySyncOrchestratorMode\s*\(/g)?.length, 1, 'daily-sync-auto must not recurse')

console.log('Sync reliability unit tests passed.')

function functionSource(sourceText, name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(sourceText)
  assert.ok(match, `function ${name} not found`)
  const openingBrace = sourceText.indexOf('{', match.index)
  let depth = 0
  for (let index = openingBrace; index < sourceText.length; index += 1) {
    if (sourceText[index] === '{') depth += 1
    if (sourceText[index] === '}') depth -= 1
    if (depth === 0) return sourceText.slice(match.index, index + 1)
  }
  throw new Error(`function ${name} is incomplete`)
}
