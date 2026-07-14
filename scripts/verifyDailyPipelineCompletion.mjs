import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { getBangkokDayRange } from '../src/utils/bangkokDateRange.js'
import { auditPipelineState, requiredDailyPhases } from '../supabase/functions/_shared/pipelinePolicy.js'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase environment variables for pipeline verification.')

const supabase = createClient(supabaseUrl, supabaseKey)
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
  const audit = auditPipelineState(run, steps ?? [])
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
  report('required phase missing', requiredDailyPhases.filter((phase) => !(steps ?? []).some((step) => step.phase === phase)).length)
  const counts = Object.fromEntries(['success', 'pending', 'running', 'partial', 'pending_retry', 'failed'].map((status) => [status, (steps ?? []).filter((step) => step.status === status).length]))
  console.log(`run_id=${run.id}`)
  console.log(`status=${run.status} phase=${run.current_phase ?? 'none'}`)
  console.log(`steps=${JSON.stringify(counts)}`)
  console.log(`progress=${audit.progress}`)
}

if (failed) process.exit(1)
console.log('Daily pipeline completion checks passed')

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

function projectRef(value) {
  try { return new URL(value).host.split('.')[0] } catch { return 'unknown' }
}
