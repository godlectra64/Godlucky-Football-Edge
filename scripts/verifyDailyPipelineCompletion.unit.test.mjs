import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

const date = '2099-01-02'
const verifierPath = fileURLToPath(new URL('./verifyDailyPipelineCompletion.mjs', import.meta.url))
const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const verifierSource = await readFile(verifierPath, 'utf8')

assert.doesNotMatch(verifierSource, /\bprocess\.exit\s*\(/)
assert.match(verifierSource, /process\.exitCode\s*=\s*1/)
assert.doesNotMatch(verifierSource, /getStepFailureAttemptCount/, 'verifier must not inherit attempt_count fallback semantics from the runtime continuation policy')

const missing = await runVerifier({ runs: [], steps: [] })
assert.equal(missing.timedOut, false, 'missing-run verifier must not leave active handles')
assert.equal(missing.code, 1, `missing-run verifier must exit 1\n${missing.stderr}`)
assert.equal(missing.signal, null)
assert.match(missing.stdout, /missing run: 1/)
assert.doesNotMatch(missing.stdout, /Daily pipeline completion checks passed/)
assert.doesNotMatch(`${missing.stdout}\n${missing.stderr}`, /Assertion failed|UV_HANDLE_CLOSING/)
assert.equal(missing.requests.filter((path) => path.includes('api_football_daily_sync_runs')).length, 1)
assert.equal(missing.requests.some((path) => path.includes('api_football_daily_sync_steps')), false)

const completedRun = {
  id: 'run-complete',
  run_date: date,
  mode: 'daily-sync-auto',
  status: 'success',
  current_phase: 'COMPLETE',
  progress_percent: 100,
  started_at: '2099-01-02T00:00:00.000Z',
}
const completedSteps = ['core', 'fixture-enrichment', 'team-enrichment', 'league-enrichment', 'ranking'].map((phase, index) => ({
  id: `step-${index + 1}`,
  run_id: completedRun.id,
  phase,
  step_order: index + 1,
  status: 'success',
  attempt_count: 1,
  max_attempts: 3,
}))
const completed = await runVerifier({ runs: [completedRun], steps: completedSteps })
assert.equal(completed.timedOut, false, 'completed-run verifier must not leave active handles')
assert.equal(completed.code, 0, `completed-run verifier must exit 0\n${completed.stderr}`)
assert.equal(completed.signal, null)
assert.match(completed.stdout, /missing run: 0/)
assert.match(completed.stdout, /Daily pipeline completion checks passed/)
assert.doesNotMatch(`${completed.stdout}\n${completed.stderr}`, /Assertion failed|UV_HANDLE_CLOSING/)

const plannedAttemptOne = await runVerifier(plannedContinuationFixture({ attemptCount: 1, policyFailureAttemptCount: 1 }))
assert.equal(plannedAttemptOne.code, 0, `planned continuation with attempt_count=1 must remain valid\n${plannedAttemptOne.stdout}\n${plannedAttemptOne.stderr}`)
assert.match(plannedAttemptOne.stdout, /"phase":"core","status":"pending_retry","attempt":1,"failureAttempts":0,"maxAttempts":20/)
assert.match(plannedAttemptOne.stdout, /completion invariant violation: 0/)
assert.doesNotMatch(plannedAttemptOne.stdout, /PARTIAL_WITHOUT_VALID_CONTINUATION|REQUIRED_PENDING_WITHOUT_SCHEDULE/)
assert.match(plannedAttemptOne.stdout, /fixture_cursor_mode=processed-fixture-ids-v1/)
assert.match(plannedAttemptOne.stdout, /unique_processed_fixture_count=2/)
assert.match(plannedAttemptOne.stdout, /fixture_candidate_count=5/)
assert.match(plannedAttemptOne.stdout, /fixture_remaining_count=3/)
assert.match(plannedAttemptOne.stdout, /fixture_stable_empty_passes=1/)
assert.match(plannedAttemptOne.stdout, /legacy_fixture_offset_ignored=true/)
assert.match(plannedAttemptOne.stdout, /legacy_fixture_offset_value=722/)

const plannedAttemptTen = await runVerifier(plannedContinuationFixture({ attemptCount: 10, policyFailureAttemptCount: 10 }))
assert.equal(plannedAttemptTen.code, 0, `planned continuation with attempt_count=10 must not report real failures\n${plannedAttemptTen.stdout}\n${plannedAttemptTen.stderr}`)
assert.match(plannedAttemptTen.stdout, /"phase":"core","status":"pending_retry","attempt":10,"failureAttempts":0,"maxAttempts":20/)

const explicitFailureAttempts = await runVerifier(plannedContinuationFixture({ attemptCount: 10, explicitFailureAttempts: 1 }))
assert.equal(explicitFailureAttempts.code, 0, `explicit failureAttempts below max must preserve a valid scheduled continuation\n${explicitFailureAttempts.stdout}\n${explicitFailureAttempts.stderr}`)
assert.match(explicitFailureAttempts.stdout, /"phase":"core","status":"pending_retry","attempt":10,"failureAttempts":1,"maxAttempts":20/)

const invalidCursorFixture = plannedContinuationFixture({ attemptCount: 1 })
invalidCursorFixture.steps[0].continuation_state.fixtureCursorMode = 'positional-offset-v0'
const invalidCursor = await runVerifier(invalidCursorFixture)
assert.equal(invalidCursor.code, 1, `unknown fixture cursor mode must fail verification\n${invalidCursor.stdout}\n${invalidCursor.stderr}`)
assert.match(invalidCursor.stdout, /INVALID_FIXTURE_CURSOR_MODE/)

const realFailure = await runVerifier(realFailureFixture())
assert.equal(realFailure.code, 1, `real failed step must still fail verification\n${realFailure.stdout}\n${realFailure.stderr}`)
assert.match(realFailure.stdout, /PARTIAL_WITHOUT_VALID_CONTINUATION/)
assert.match(realFailure.stdout, /"phase":"core","status":"failed","attempt":1,"failureAttempts":1,"maxAttempts":20/)

console.log('Daily pipeline completion verifier unit tests passed.')

function plannedContinuationFixture({ attemptCount, policyFailureAttemptCount, explicitFailureAttempts } = {}) {
  const run = {
    id: `run-planned-${attemptCount}`,
    run_date: date,
    mode: 'daily-sync-auto',
    status: 'partial',
    current_phase: 'core',
    progress_percent: 0,
    started_at: '2099-01-02T00:00:00.000Z',
  }
  const policy = {
    kind: 'planned_continuation',
    ...(policyFailureAttemptCount === undefined ? {} : { failureAttemptCount: policyFailureAttemptCount }),
    ...(explicitFailureAttempts === undefined ? {} : { failureAttempts: explicitFailureAttempts }),
  }
  const steps = ['core', 'fixture-enrichment', 'team-enrichment', 'league-enrichment', 'ranking'].map((phase, index) => phase === 'core' ? {
    id: 'step-core',
    run_id: run.id,
    phase,
    step_order: 1,
    status: 'pending_retry',
    attempt_count: attemptCount,
    max_attempts: 20,
    next_retry_at: '2099-01-02T12:00:00.000Z',
    error_message: null,
    failed: 0,
    continuation_state: {
      fixtureCursorMode: 'processed-fixture-ids-v1',
      processedFixtureIds: [101, 102],
      uniqueProcessedFixtureCount: 2,
      fixtureCandidateCount: 5,
      fixtureRemainingCount: 3,
      fixtureStableEmptyPasses: 1,
      legacyFixtureOffsetIgnored: true,
      legacyFixtureOffsetValue: 722,
    },
    summary: {
      status: 'partial_success',
      partial: true,
      failed: 0,
      details: { continuationPolicy: policy },
    },
  } : {
    id: `step-${index + 1}`,
    run_id: run.id,
    phase,
    step_order: index + 1,
    status: 'pending',
    attempt_count: 0,
    max_attempts: 3,
  })
  return { runs: [run], steps }
}

function realFailureFixture() {
  const run = {
    id: 'run-failed',
    run_date: date,
    mode: 'daily-sync-auto',
    status: 'partial',
    current_phase: 'core',
    progress_percent: 0,
    started_at: '2099-01-02T00:00:00.000Z',
  }
  const steps = ['core', 'fixture-enrichment', 'team-enrichment', 'league-enrichment', 'ranking'].map((phase, index) => phase === 'core' ? {
    id: 'step-core-failed',
    run_id: run.id,
    phase,
    step_order: 1,
    status: 'failed',
    attempt_count: 1,
    max_attempts: 20,
    next_retry_at: null,
    error_message: 'database write failed',
    failed: 1,
    summary: {
      status: 'error',
      failed: 1,
      failureAttempts: 1,
      details: { errorCode: 'DATABASE_ERROR', continuationPolicy: { kind: 'real_failure' } },
    },
  } : {
    id: `step-failed-${index + 1}`,
    run_id: run.id,
    phase,
    step_order: index + 1,
    status: 'pending',
    attempt_count: 0,
    max_attempts: 3,
  })
  return { runs: [run], steps }
}

async function runVerifier({ runs, steps }) {
  const requests = []
  const server = createServer((request, response) => {
    const path = request.url ?? ''
    requests.push(path)
    const rows = path.includes('api_football_daily_sync_steps') ? steps : runs
    response.writeHead(200, {
      connection: 'close',
      'content-type': 'application/json',
    })
    response.end(JSON.stringify(rows))
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  let child
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    child = spawn(process.execPath, [verifierPath, date], {
      cwd: projectRoot,
      env: {
        ...process.env,
        VITE_SUPABASE_URL: `http://127.0.0.1:${address.port}`,
        VITE_SUPABASE_ANON_KEY: 'local-verifier-test-key',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    return { ...await collectChild(child), requests }
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill()
      await new Promise((resolve) => child.once('close', resolve))
    }
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

function collectChild(child) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill()
    }, 10_000)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('close', (code, signal) => {
      clearTimeout(timeout)
      resolve({ code, signal, stdout, stderr, timedOut })
    })
  })
}
