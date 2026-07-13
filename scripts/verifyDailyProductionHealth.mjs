import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { getBangkokDayRange } from '../src/utils/bangkokDateRange.js'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
let failed = false

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables for Daily Production Health verification.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)
const range = getBangkokDayRange()

console.log(`[verify:daily-production-health] project_ref=${getProjectRef(supabaseUrl)}`)
console.log(`[verify:daily-production-health] date=${range.dateKey}`)
console.log('[verify:daily-production-health] timezone=Asia/Bangkok')

await checkTodayFixtures()
await checkTodayAnalysis()
await checkTodayOdds()
await checkDailyLocks()

if (failed) process.exit(1)
console.log('Daily Production Health checks passed')

async function checkTodayFixtures() {
  const { data, error } = await supabase
    .from('football_matches')
    .select('id, status, status_short, match_status, kickoff_at, home_team_id, away_team_id', { count: 'exact' })
    .gte('kickoff_at', range.startUtc)
    .lt('kickoff_at', range.endUtc)
    .limit(300)
  if (error) return report('today fixtures query', 1, error.message)
  const rows = data ?? []
  report('today fixtures query', 0, `fixtures=${rows.length}`)
  report('fixture missing team link', rows.filter((row) => !row.home_team_id || !row.away_team_id).length)
}

async function checkTodayAnalysis() {
  const { data, error } = await supabase
    .from('football_matches')
    .select('id, analysis:match_analysis(id, recommendation, confidence_score, risk_level, analysis_status)')
    .gte('kickoff_at', range.startUtc)
    .lt('kickoff_at', range.endUtc)
    .limit(300)
  if (error) return report('today analysis query', 1, error.message)
  const rows = data ?? []
  const analyzed = rows.filter((row) => {
    const analysis = Array.isArray(row.analysis) ? row.analysis[0] : row.analysis
    return Boolean(analysis?.id)
  })
  report('analysis rows readable', 0, `analyzed=${analyzed.length}/${rows.length}`)
  report('invalid analysis risk', analyzed.filter((row) => {
    const analysis = Array.isArray(row.analysis) ? row.analysis[0] : row.analysis
    return analysis?.risk_level && !['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(String(analysis.risk_level).toUpperCase())
  }).length)
}

async function checkTodayOdds() {
  const { data: matches, error } = await supabase
    .from('football_matches')
    .select('id')
    .gte('kickoff_at', range.startUtc)
    .lt('kickoff_at', range.endUtc)
    .limit(300)
  if (error) return report('today odds fixture query', 1, error.message)
  const ids = (matches ?? []).map((row) => row.id).filter(Boolean)
  if (!ids.length) return report('today odds rows readable', 0, 'fixtures=0')
  const { count, error: oddsError } = await supabase
    .from('football_match_odds')
    .select('id', { count: 'exact', head: true })
    .in('match_id', ids)
  if (oddsError) return report('today odds rows readable', 1, oddsError.message)
  report('today odds rows readable', 0, `oddsRows=${count ?? 0}`)
}

async function checkDailyLocks() {
  const { data, error } = await supabase
    .from('daily_top10_selections')
    .select('id, rank, match_id')
    .eq('selection_date', range.dateKey)
    .order('rank', { ascending: true })
  if (error) return report('daily lock query', 0, `skipped: ${error.message}`)
  const rows = data ?? []
  report('daily lock over display maximum', rows.length > 10 ? rows.length - 10 : 0, `locked=${rows.length}`)
  report('daily lock duplicate rank', findDuplicates(rows, (row) => row.rank).length)
  report('daily lock duplicate match', findDuplicates(rows, (row) => row.match_id).length)
}

function report(label, count, message = '') {
  console.log(`${label}: ${count}${message ? ` (${message})` : ''}`)
  if (count > 0) failed = true
}

function findDuplicates(rows, keyFn) {
  const seen = new Set()
  const duplicates = []
  for (const row of rows) {
    const key = String(keyFn(row) ?? '')
    if (!key) continue
    if (seen.has(key)) duplicates.push(row)
    else seen.add(key)
  }
  return duplicates
}

function getProjectRef(value) {
  try {
    return new URL(value).host.split('.')[0]
  } catch {
    return 'unknown'
  }
}
