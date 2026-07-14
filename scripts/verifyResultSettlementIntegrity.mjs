import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase environment variables for result verification.')

const supabase = createClient(supabaseUrl, supabaseKey)
let failed = false
console.log(`[verify:results] project_ref=${projectRef(supabaseUrl)}`)
console.log('[verify:results] mode=read-only')

const [matches, results] = await Promise.all([
  selectAll('football_matches', 'id, status_short, status, home_score, away_score, home_goals, away_goals'),
  selectAll('football_ai_pick_results', 'id, match_id, ai_final_pick_id, market_focus, settlement_status, simulation_outcome, home_score, away_score'),
])
const matchesById = new Map(matches.map((row) => [row.id, row]))
const finished = (match) => ['FT', 'AET', 'PEN'].includes(String(match?.status_short ?? match?.status ?? '').toUpperCase())
const abandoned = (match) => ['PST', 'CANC', 'ABD', 'AWD', 'WO'].includes(String(match?.status_short ?? match?.status ?? '').toUpperCase())

report('finished match missing score', matches.filter((row) => finished(row) && !hasScore(row)).length)
report('finished result still PENDING', results.filter((row) => finished(matchesById.get(row.match_id)) && hasScore(matchesById.get(row.match_id)) && row.settlement_status === 'PENDING').length)
report('postponed/cancelled counted as loss', results.filter((row) => abandoned(matchesById.get(row.match_id)) && ['LOSS', 'LOST'].includes(String(row.settlement_status ?? row.simulation_outcome).toUpperCase())).length)
report('duplicate settlement', duplicateCount(results.filter((row) => row.ai_final_pick_id), (row) => row.ai_final_pick_id))
report('invalid market settlement', results.filter((row) => !['AH', 'OU', 'MATCH_WINNER', 'DOUBLE_CHANCE', 'NONE'].includes(String(row.market_focus ?? 'NONE').toUpperCase())).length)
report('result missing match', results.filter((row) => row.match_id && !matchesById.has(row.match_id)).length)

if (failed) process.exit(1)
console.log('Result settlement integrity checks passed')

async function selectAll(table, columns) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).order('id', { ascending: true }).range(from, from + 999)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return rows
}

function hasScore(row = {}) {
  return firstNumber(row.home_score, row.home_goals) !== null && firstNumber(row.away_score, row.away_goals) !== null
}

function firstNumber(...values) {
  for (const value of values) if (value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
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

function report(label, count) {
  console.log(`${label}: ${count}`)
  if (count > 0) failed = true
}

function projectRef(value) {
  try { return new URL(value).host.split('.')[0] } catch { return 'unknown' }
}
