import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { auditPipelineState, getRequiredRunStatus } from '../supabase/functions/_shared/pipelinePolicy.js'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

const expectedProjectRef = 'fzjbnxomflqopwhzxfog'
const apply = process.argv.includes('--apply')
const confirmProject = argumentValue('--confirm-project')
const targetRunId = argumentValue('--run-id')
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const readKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const writeKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const key = apply ? writeKey : readKey || writeKey
if (!supabaseUrl || !key) throw new Error(`Missing Supabase environment variables for pipeline repair ${apply ? 'apply' : 'dry-run'}.`)
if (projectRef(supabaseUrl) !== expectedProjectRef) throw new Error(`Project ref mismatch: expected ${expectedProjectRef}.`)
if (apply && !writeKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required with --apply.')
if (apply && confirmProject !== expectedProjectRef) throw new Error(`Apply requires --confirm-project=${expectedProjectRef}.`)

const supabase = createClient(supabaseUrl, key)
const runs = await selectAllRuns()
const proposals = []

for (const run of runs) {
  const { data: rawSteps, error } = await supabase.from('api_football_daily_sync_steps').select('*').eq('run_id', run.id).order('step_order', { ascending: true })
  if (error) throw error
  const steps = rawSteps ?? []
  const audit = auditPipelineState(run, steps)
  for (const step of audit.staleRunning) {
    const exhausted = Number(step.attempt_count ?? 0) >= Number(step.max_attempts ?? 3)
    proposals.push(proposal(run, step, exhausted ? 'MARK_FAILED_MAX_ATTEMPTS' : 'RECOVER_STALE_TO_PENDING_RETRY', true))
  }
  for (const step of audit.pendingRetryMissingNext) proposals.push(proposal(run, step, 'SCHEDULE_MISSING_RETRY', true))
  for (const step of audit.overdueRetry) proposals.push(proposal(run, step, 'CONTINUE_EXISTING_RUN', false))
}

const filtered = proposals
  .filter((item) => !targetRunId || item.runId === targetRunId)
  .sort((a, b) => `${a.runId}|${a.stepOrder}|${a.action}`.localeCompare(`${b.runId}|${b.stepOrder}|${b.action}`))
const writable = filtered.filter((item) => item.write)
const signature = sha256(filtered)
console.log(`[repair:pipeline-state] project_ref=${expectedProjectRef}`)
console.log(`[repair:pipeline-state] mode=${apply ? 'apply' : 'dry-run'}`)
console.log(`plan_signature=${signature}`)
console.log(`proposals=${filtered.length} writable=${writable.length} continuation_only=${filtered.length - writable.length}`)
console.log(JSON.stringify(filtered, null, 2))
if (!apply) process.exit(0)
if (!writable.length) {
  console.log('[repair:pipeline-state] no state writes required; overdue steps must continue through the canonical run endpoint')
  process.exit(0)
}

const auditInsert = await supabase
  .from('production_repair_audits')
  .insert({
    repair_type: 'PIPELINE_STATE',
    status: 'RUNNING',
    release_commit: getReleaseCommit(),
    plan_signature: signature,
    summary: { proposals: filtered.length, writable: writable.length },
  })
  .select('id')
  .single()
if (auditInsert.error) throw auditInsert.error
const auditId = auditInsert.data.id
console.log(`audit_id=${auditId}`)

try {
  const touchedRuns = new Set()
  for (const item of writable) {
    const now = new Date().toISOString()
    const patch = item.action === 'MARK_FAILED_MAX_ATTEMPTS'
      ? { status: 'failed', finished_at: now, next_retry_at: null, error_message: 'STALE_RUNNING_MAX_ATTEMPTS', repair_audit_id: auditId }
      : { status: 'pending_retry', finished_at: null, next_retry_at: new Date(Date.now() + 5 * 60_000).toISOString(), error_message: item.action, repair_audit_id: auditId }
    const result = await supabase.from('api_football_daily_sync_steps').update(patch).eq('id', item.stepId).eq('status', item.status)
    if (result.error) throw result.error
    touchedRuns.add(item.runId)
  }
  for (const runId of touchedRuns) await updateRunState(runId, auditId)
  const completed = await supabase.from('production_repair_audits').update({ status: 'SUCCESS', completed_at: new Date().toISOString(), summary: { proposals: filtered.length, applied: writable.length } }).eq('id', auditId)
  if (completed.error) throw completed.error
  console.log(`[repair:pipeline-state] applied=${writable.length}`)
} catch (error) {
  await supabase.from('production_repair_audits').update({ status: 'FAILED', completed_at: new Date().toISOString(), summary: { error: safeError(error) } }).eq('id', auditId)
  throw error
}

async function updateRunState(runId, auditId) {
  const { data: steps, error } = await supabase.from('api_football_daily_sync_steps').select('*').eq('run_id', runId)
  if (error) throw error
  const status = getRequiredRunStatus(steps ?? [])
  const patch = { status, repair_audit_id: auditId, finished_at: status === 'failed' || status === 'success' ? new Date().toISOString() : null }
  const result = await supabase.from('api_football_daily_sync_runs').update(patch).eq('id', runId)
  if (result.error) throw result.error
}

async function selectAllRuns() {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('api_football_daily_sync_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + 999)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return rows
}

function proposal(run, step, action, write) {
  const cursor = step.continuation_state ?? {}
  return {
    runId: run.id,
    runDate: run.run_date,
    runStatus: run.status,
    stepId: step.id,
    stepOrder: step.step_order,
    phase: step.phase,
    status: step.status,
    attempt: Number(step.attempt_count ?? 0),
    maxAttempts: Number(step.max_attempts ?? 3),
    nextRetryAt: step.next_retry_at ?? null,
    cursor: {
      providerPage: cursor.providerPage ?? step.provider_page ?? null,
      fixtureOffset: cursor.fixtureOffset ?? step.fixture_offset ?? null,
      oddsOffset: cursor.oddsOffset ?? step.odds_offset ?? null,
      processedFixtureCount: cursor.processedFixtureCount ?? step.processed_fixture_count ?? null,
      lastProcessedFixtureId: cursor.lastProcessedFixtureId ?? step.last_processed_fixture_id ?? null,
      batchSignature: cursor.batchSignature ?? step.batch_signature ?? null,
    },
    action,
    write,
  }
}

function argumentValue(name) {
  const prefix = `${name}=`
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length) ?? ''
}

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function getReleaseCommit() {
  return process.env.RELEASE_COMMIT_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
}

function safeError(error) {
  return String(error?.message ?? error ?? 'repair failed').slice(0, 500)
}

function projectRef(value) {
  try { return new URL(value).host.split('.')[0] } catch { return 'unknown' }
}
