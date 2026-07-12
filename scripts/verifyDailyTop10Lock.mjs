import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const bangkokDate = getBangkokToday()
let failed = false

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables for Daily Top10 verification.')
  process.exit(1)
}

console.log(`[verify:daily-top10] project_ref=${getProjectRef(supabaseUrl)}`)
console.log('[verify:daily-top10] timezone=Asia/Bangkok')
console.log(`[verify:daily-top10] today=${bangkokDate}`)

const supabase = createClient(supabaseUrl, supabaseKey)

await checkTableExists()
await checkExpectedConstraintDefinitions()
await checkDailyInvariants()
await checkTodayCoverage()

if (failed) process.exit(1)
console.log('Daily Top10 lock checks passed')

async function checkTableExists() {
  const { error, count } = await supabase.from('daily_top10_selections').select('id', { count: 'exact', head: true })
  report('daily_top10_selections table', error ? 1 : 0, error?.message || `rows ${count ?? 0}`)
}

async function checkExpectedConstraintDefinitions() {
  const migration = readFileSync(new URL('../supabase/migrations/20260706_add_daily_top10_lock.sql', import.meta.url), 'utf8')
  const candidateMigration = readFileSync(new URL('../supabase/migrations/20260712_add_daily_market_candidates.sql', import.meta.url), 'utf8')
  const repairMigration = readFileSync(new URL('../supabase/migrations/20260713_add_atomic_market_first_top10_repair.sql', import.meta.url), 'utf8')
  report('schema unique rank per selection_date', migration.includes('constraint daily_top10_selections_unique_rank unique (selection_date, rank)') ? 0 : 1)
  report('schema unique match per selection_date', migration.includes('constraint daily_top10_selections_unique_match unique (selection_date, match_id)') ? 0 : 1)
  report('schema daily market candidates table', candidateMigration.includes('create table if not exists public.daily_market_candidates') ? 0 : 1)
  report('schema unique candidate rank per selection_date', candidateMigration.includes('constraint daily_market_candidates_unique_rank unique (selection_date, candidate_rank)') ? 0 : 1)
  report('schema unique candidate match per selection_date', candidateMigration.includes('constraint daily_market_candidates_unique_match unique (selection_date, match_id)') ? 0 : 1)
  report('schema candidate readiness valid', candidateMigration.includes("market_readiness_status in ('READY', 'PARTIAL', 'WAITING_MARKET', 'NO_MARKET_DATA')") ? 0 : 1)
  report('schema atomic stale market lock repair RPC', repairMigration.includes('repair_stale_market_first_top10') ? 0 : 1)
  report('schema stale market lock repair service-role only', repairMigration.includes("grant execute on function public.repair_stale_market_first_top10(date, uuid[], jsonb, jsonb) to service_role") ? 0 : 1)
}

async function checkDailyInvariants() {
  const { data, error } = await supabase
    .from('daily_top10_selections')
    .select('id, selection_date, match_id, ai_final_pick_id, rank, signal, market_focus, risk_level')
    .order('selection_date', { ascending: false })
    .limit(500)
  if (error) return report('daily_top10 query', 1, error.message)

  const rows = data ?? []
  const byDate = groupBy(rows, (row) => row.selection_date)
  const tooMany = [...byDate.entries()].filter(([, items]) => items.length > 10)
  const duplicateRanks = findDuplicateByDate(rows, (row) => row.rank)
  const duplicateMatches = findDuplicateByDate(rows, (row) => row.match_id)
  const badRank = rows.filter((row) => Number(row.rank) < 1 || Number(row.rank) > 10)
  const missingMatch = rows.filter((row) => !row.match_id)
  const badSignal = rows.filter((row) => row.signal && !['STRONG_SIGNAL', 'WATCH', 'SKIP'].includes(row.signal))
  const badMarket = rows.filter((row) => row.market_focus && !['AH', 'OU', 'MATCH_WINNER', 'BTTS', 'NONE'].includes(row.market_focus))
  const badRisk = rows.filter((row) => row.risk_level && !['LOW', 'MEDIUM', 'HIGH'].includes(row.risk_level))

  report('max 10 rows per day', tooMany.length)
  report('duplicate rank per day', duplicateRanks.length)
  report('duplicate match per day', duplicateMatches.length)
  report('rank outside 1-10', badRank.length)
  report('locked rows missing match_id', missingMatch.length)
  report('invalid signal', badSignal.length)
  report('invalid market_focus', badMarket.length)
  report('invalid risk_level', badRisk.length)

  const pickIds = [...new Set(rows.map((row) => row.ai_final_pick_id).filter(Boolean))]
  if (!pickIds.length) return report('ai_final_pick references', 0, 'no ai_final_pick_id rows yet')
  const { data: picks, error: pickError } = await supabase.from('football_ai_final_picks').select('id').in('id', pickIds)
  if (pickError) return report('ai_final_pick references', 1, pickError.message)
  const found = new Set((picks ?? []).map((row) => row.id))
  report('ai_final_pick references', pickIds.filter((id) => !found.has(id)).length)
}

async function checkTodayCoverage() {
  const { data, error } = await supabase
    .from('daily_top10_selections')
    .select('id, ai_final_pick_id')
    .eq('selection_date', bangkokDate)
  if (error) return report('today locked query', 1, error.message)

  const rows = data ?? []
  report('today locked count over 10', rows.length > 10 ? rows.length - 10 : 0, `locked ${rows.length}`)
  const withPick = rows.filter((row) => row.ai_final_pick_id).length
  report('today aiFinalPick coverage', withPick < rows.length ? rows.length - withPick : 0, `with pick ${withPick}/${rows.length}`)
}

function report(label, count, message = '') {
  console.log(`${label}: ${count}${message ? ` (${message})` : ''}`)
  if (count > 0) failed = true
}

function groupBy(rows, keyFn) {
  const map = new Map()
  for (const row of rows) {
    const key = keyFn(row)
    const items = map.get(key) ?? []
    items.push(row)
    map.set(key, items)
  }
  return map
}

function findDuplicateByDate(rows, keyFn) {
  const seen = new Set()
  const duplicates = []
  for (const row of rows) {
    const key = `${row.selection_date}:${keyFn(row)}`
    if (seen.has(key)) duplicates.push(row)
    else seen.add(key)
  }
  return duplicates
}

function getBangkokToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function getProjectRef(value) {
  try {
    return new URL(value).host.split('.')[0]
  } catch {
    return 'unknown'
  }
}
