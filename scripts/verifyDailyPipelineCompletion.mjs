import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { getBangkokDayRange } from '../src/utils/bangkokDateRange.js'
import { auditPipelineCompletion, requiredDailyPhases } from '../supabase/functions/_shared/pipelinePolicy.js'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase environment variables for pipeline verification.')

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
})
const date = process.env.SELECTION_DATE || process.argv[2] || getBangkokDayRange().dateKey
let failed = false
console.log(`[verify:daily-pipeline-completion] project_ref=${projectRef(supabaseUrl)}`)
console.log(`[verify:daily-pipeline-completion] run_date=${date}`)
console.log('[verify:daily-pipeline-completion] mode=read-only')

const { data: runs, error: runError } = await supabase
  .from('api_football_daily_sync_runs')
  .select('*')
  .eq('run_date', date)
  .order('started_at', { ascending: false })
if (runError) throw runError
report('missing run', runs?.length ? 0 : 1)
report('duplicate run', duplicateCount(runs ?? [], (row) => `${row.run_date}|${row.mode}`))

const run = runs?.[0]
if (run) {
  const { data: steps, error: stepError } = await supabase
    .from('api_football_daily_sync_steps')
    .select('*')
    .eq('run_id', run.id)
    .order('step_order', { ascending: true })
  if (stepError) throw stepError
  const verifierSteps = steps ?? []
  const audit = auditVerifierPipelineCompletion(run, verifierSteps)
  report('partial overdue', run.status === 'partial' && audit.overdueRetry.length ? audit.overdueRetry.length : 0)
  report('stale running', audit.staleRunning.length)
  report('pending_retry missing next_retry_at', audit.pendingRetryMissingNext.length)
  report('overdue retry', audit.overdueRetry.length)
  report('duplicate step order', audit.duplicateStepOrders.length)
  report('duplicate phase', audit.duplicatePhases.length)
  report('success with pending', audit.successWithIncomplete ? audit.incompleteRequired.length : 0)
  report('COMPLETE with incomplete required steps', String(run.current_phase ?? '').toUpperCase() === 'COMPLETE' ? audit.incompleteRequired.length : 0)
  report('invalid progress', audit.invalidProgress ? 1 : 0)
  report('attempt greater than max', audit.attemptsExceeded.length)
  report('required phase missing', requiredDailyPhases.filter((phase) => !verifierSteps.some((step) => step.phase === phase)).length)
  report('completion invariant violation', audit.violations.length)
  const counts = Object.fromEntries(['success', 'pending', 'running', 'partial', 'pending_retry', 'failed'].map((status) => [status, verifierSteps.filter((step) => step.status === status).length]))
  console.log(`run_id=${run.id}`)
  console.log(`status=${run.status} phase=${run.current_phase ?? 'none'}`)
  console.log(`steps=${JSON.stringify(counts)}`)
  console.log(`progress=${audit.progress}`)
  console.log(`required_pending_steps=${JSON.stringify(audit.requiredPendingSteps.map((step) => ({ phase: step.phase, status: step.status, attempt: Number(step.attempt_count ?? 0), failureAttempts: getExplicitFailureAttempts(step), maxAttempts: Number(step.max_attempts ?? 3) })))}`)
  console.log(`retry_step=${audit.retrySteps[0]?.phase ?? 'none'}`)
  console.log(`next_retry_at=${audit.nextRetryAt ?? 'missing'}`)
  console.log(`overdue_duration_ms=${audit.overdueDurationMs}`)
  console.log(`cursor=${JSON.stringify(audit.cursor ?? {})}`)
  const fixtureCursor = getFixtureCursorDiagnostics(audit.cursor)
  console.log(`fixture_cursor_mode=${fixtureCursor.fixtureCursorMode ?? 'legacy'}`)
  console.log(`unique_processed_fixture_count=${fixtureCursor.uniqueProcessedFixtureCount}`)
  console.log(`fixture_candidate_count=${fixtureCursor.fixtureCandidateCount}`)
  console.log(`fixture_remaining_count=${fixtureCursor.fixtureRemainingCount}`)
  console.log(`fixture_stable_empty_passes=${fixtureCursor.fixtureStableEmptyPasses}`)
  console.log(`legacy_fixture_offset_ignored=${fixtureCursor.legacyFixtureOffsetIgnored}`)
  console.log(`legacy_fixture_offset_value=${fixtureCursor.legacyFixtureOffsetValue}`)
  console.log(`invariant_violations=${JSON.stringify(audit.violations)}`)
}

if (failed) process.exitCode = 1
else console.log('Daily pipeline completion checks passed')

function report(label, count) {
  console.log(`${label}: ${count}`)
  if (count > 0) failed = true
}

function duplicateCount(rows, keyFn) {
  const seen = new Set()
  let count = 0
  for (const row of rows) {
    const key = keyFn(row)
    if (seen.has(key)) count += 1
    else seen.add(key)
  }
  return count
}

function getExplicitFailureAttempts(step = {}) {
  const summary = objectValue(step.summary)
  const details = objectValue(summary.details)
  const policy = objectValue(details.continuationPolicy ?? summary.continuationPolicy)
  const candidates = [
    summary.failureAttempts,
    summary.failure_attempts,
    details.failureAttempts,
    details.failure_attempts,
    policy.failureAttempts,
    policy.failure_attempts,
    step.failureAttempts,
    step.failure_attempts,
  ]
  for (const candidate of candidates) {
    const explicit = explicitNonNegativeInteger(candidate)
    if (explicit !== null) return explicit
  }
  return 0
}

function auditVerifierPipelineCompletion(run, steps) {
  const now = Date.now()
  const audit = auditPipelineCompletion(run, steps, { now })
  const attemptsExceeded = steps.filter((step) => getExplicitFailureAttempts(step) > Number(step.max_attempts ?? 3))
  const validRetrySteps = audit.retrySteps.filter((step) => {
    const retryAt = new Date(step.next_retry_at ?? 0).getTime()
    return Number.isFinite(retryAt)
      && retryAt > now
      && getExplicitFailureAttempts(step) < Number(step.max_attempts ?? 3)
  })
  const violations = audit.violations.filter((violation) => ![
    'PARTIAL_WITHOUT_VALID_CONTINUATION',
    'REQUIRED_PENDING_WITHOUT_SCHEDULE',
  ].includes(violation))
  const status = String(run.status ?? '').toLowerCase()
  if (status === 'partial' && audit.requiredPendingSteps.length && !validRetrySteps.length) {
    violations.push('PARTIAL_WITHOUT_VALID_CONTINUATION')
  }
  if (status === 'partial' && audit.requiredPendingSteps.some((step) => ['pending', 'partial'].includes(step.status)) && !validRetrySteps.length) {
    violations.push('REQUIRED_PENDING_WITHOUT_SCHEDULE')
  }
  violations.push(...validateFixtureCursor(audit.cursor))
  return {
    ...audit,
    attemptsExceeded,
    validRetrySteps,
    violations: [...new Set(violations)],
  }
}

function getFixtureCursorDiagnostics(value) {
  const cursor = objectValue(value)
  const processedFixtureIds = Array.isArray(cursor.processedFixtureIds) ? cursor.processedFixtureIds : []
  return {
    fixtureCursorMode: cursor.fixtureCursorMode ?? null,
    processedFixtureIds,
    uniqueProcessedFixtureCount: Number(cursor.uniqueProcessedFixtureCount ?? processedFixtureIds.length),
    fixtureCandidateCount: Number(cursor.fixtureCandidateCount ?? 0),
    fixtureRemainingCount: Number(cursor.fixtureRemainingCount ?? 0),
    fixtureStableEmptyPasses: Number(cursor.fixtureStableEmptyPasses ?? 0),
    legacyFixtureOffsetIgnored: Boolean(cursor.legacyFixtureOffsetIgnored),
    legacyFixtureOffsetValue: Number(cursor.legacyFixtureOffsetValue ?? cursor.fixtureOffset ?? 0),
  }
}

function validateFixtureCursor(value) {
  const cursor = getFixtureCursorDiagnostics(value)
  if (cursor.fixtureCursorMode && cursor.fixtureCursorMode !== 'processed-fixture-ids-v1') return ['INVALID_FIXTURE_CURSOR_MODE']
  if (cursor.fixtureCursorMode !== 'processed-fixture-ids-v1') return []
  const violations = []
  const normalizedIds = cursor.processedFixtureIds
    .map(Number)
    .filter((fixtureId) => Number.isSafeInteger(fixtureId) && fixtureId > 0)
  if (normalizedIds.length !== cursor.processedFixtureIds.length || new Set(normalizedIds).size !== normalizedIds.length) violations.push('INVALID_PROCESSED_FIXTURE_IDS')
  if (cursor.uniqueProcessedFixtureCount !== new Set(normalizedIds).size) violations.push('UNIQUE_PROCESSED_FIXTURE_COUNT_MISMATCH')
  for (const [name, number] of [
    ['fixtureCandidateCount', cursor.fixtureCandidateCount],
    ['fixtureRemainingCount', cursor.fixtureRemainingCount],
    ['fixtureStableEmptyPasses', cursor.fixtureStableEmptyPasses],
    ['legacyFixtureOffsetValue', cursor.legacyFixtureOffsetValue],
  ]) {
    if (!Number.isInteger(number) || number < 0) violations.push(`INVALID_${name.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`)
  }
  if (cursor.fixtureStableEmptyPasses > 2) violations.push('INVALID_FIXTURE_STABLE_EMPTY_PASSES')
  if (cursor.fixtureRemainingCount > cursor.fixtureCandidateCount) violations.push('FIXTURE_REMAINING_EXCEEDS_CANDIDATES')
  return violations
}

function explicitNonNegativeInteger(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 ? number : null
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function projectRef(value) {
  try { return new URL(value).host.split('.')[0] } catch { return 'unknown' }
}
