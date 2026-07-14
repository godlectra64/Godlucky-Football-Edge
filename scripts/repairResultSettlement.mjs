import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { settleAiPickResult } from '../src/utils/resultSettlement.js'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

const expectedProjectRef = 'fzjbnxomflqopwhzxfog'
const apply = process.argv.includes('--apply')
const confirmProject = argumentValue('--confirm-project')
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const readKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const writeKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const key = apply ? writeKey : readKey || writeKey
if (!supabaseUrl || !key) throw new Error(`Missing Supabase environment variables for result repair ${apply ? 'apply' : 'dry-run'}.`)
if (projectRef(supabaseUrl) !== expectedProjectRef) throw new Error(`Project ref mismatch: expected ${expectedProjectRef}.`)
if (apply && !writeKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required with --apply.')
if (apply && confirmProject !== expectedProjectRef) throw new Error(`Apply requires --confirm-project=${expectedProjectRef}.`)

const supabase = createClient(supabaseUrl, key)
const pendingResults = await selectAllPendingResults()

const proposals = []
for (const row of pendingResults) {
  const match = Array.isArray(row.match) ? row.match[0] : row.match
  const homeScore = firstNumber(match?.home_score, match?.home_goals)
  const awayScore = firstNumber(match?.away_score, match?.away_goals)
  if (homeScore === null || awayScore === null) continue
  const outcome = settleAiPickResult({ statusShort: match?.status_short, homeScore, awayScore, marketFocus: row.market_focus, direction: row.direction })
  if (outcome.settlement_status !== 'PENDING') proposals.push({ id: row.id, homeScore, awayScore, outcome })
}

async function selectAllPendingResults() {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('football_ai_pick_results')
      .select('id, match_id, market_focus, direction, settlement_status, match:football_matches(status_short, home_score, away_score, home_goals, away_goals)')
      .eq('settlement_status', 'PENDING')
      .order('id', { ascending: true })
      .range(from, from + 999)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return rows
}
const signature = createHash('sha256').update(JSON.stringify(proposals)).digest('hex')
console.log(`[repair:results] project_ref=${expectedProjectRef}`)
console.log(`[repair:results] mode=${apply ? 'apply' : 'dry-run'}`)
console.log(`plan_signature=${signature}`)
console.log(`proposals=${proposals.length}`)
if (!apply || !proposals.length) process.exit(0)

const auditInsert = await supabase
  .from('production_repair_audits')
  .insert({ repair_type: 'RESULT_SETTLEMENT', status: 'RUNNING', release_commit: getReleaseCommit(), plan_signature: signature, summary: { proposals: proposals.length } })
  .select('id')
  .single()
if (auditInsert.error) throw auditInsert.error
const auditId = auditInsert.data.id
console.log(`audit_id=${auditId}`)

try {
  for (const proposal of proposals) {
    const { error: patchError } = await supabase.from('football_ai_pick_results').update({
      home_score: proposal.homeScore,
      away_score: proposal.awayScore,
      settlement_status: proposal.outcome.settlement_status,
      simulation_outcome: proposal.outcome.simulation_outcome,
      settlement_reason: proposal.outcome.settlement_reason,
      settled_at: new Date().toISOString(),
      repair_audit_id: auditId,
    }).eq('id', proposal.id).eq('settlement_status', 'PENDING')
    if (patchError) throw patchError
  }
  const completed = await supabase.from('production_repair_audits').update({ status: 'SUCCESS', completed_at: new Date().toISOString(), summary: { applied: proposals.length } }).eq('id', auditId)
  if (completed.error) throw completed.error
  console.log(`[repair:results] applied=${proposals.length}`)
} catch (repairError) {
  await supabase.from('production_repair_audits').update({ status: 'FAILED', completed_at: new Date().toISOString(), summary: { error: safeError(repairError) } }).eq('id', auditId)
  throw repairError
}

function firstNumber(...values) {
  for (const value of values) if (value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}

function argumentValue(name) {
  const prefix = `${name}=`
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length) ?? ''
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
