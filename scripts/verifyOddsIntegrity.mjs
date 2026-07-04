import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
let failed = false

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables for odds verification.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

console.log(`[verify:odds] project_ref=${getProjectRef(supabaseUrl)}`)

await checkOddsRows()
const before = await getMarketDataMismatchSummary()
console.log(`[verify:odds] mismatch_before=${JSON.stringify(before)}`)
await normalizeHasMarketDataFlags(before)
const after = await getMarketDataMismatchSummary()
console.log(`[verify:odds] mismatch_after=${JSON.stringify(after)}`)

report('odds rows exists but has_market_data=false', after.oddsRowsExistButHasMarketDataFalse)
report('has_market_data=true but no odds rows', after.hasMarketDataTrueButNoOddsRows)

if (failed) process.exit(1)
console.log('Odds integrity checks passed')

async function checkOddsRows() {
  const checks = [
    ['invalid odds marketFocus', () => supabase.from('football_match_odds').select('id', { count: 'exact', head: true }).not('market_focus', 'in', '("AH","OU","MATCH_WINNER","BTTS","NONE")')],
    ['null odds price', () => supabase.from('football_match_odds').select('id', { count: 'exact', head: true }).is('price', null)],
    ['invalid odds price', () => supabase.from('football_match_odds').select('id', { count: 'exact', head: true }).not('price', 'is', null).lte('price', 0)],
  ]

  for (const [label, query] of checks) {
    const { count, error } = await query()
    report(label, error ? 1 : count ?? 0, error?.message)
  }

  await checkDuplicateLatestOdds()
}

async function checkDuplicateLatestOdds() {
  const { data, error } = await supabase
    .from('football_match_odds')
    .select('match_id, api_bookmaker_id, market_focus, market_name, selection, line, is_latest')
    .eq('is_latest', true)
    .limit(10000)
  if (error) return report('duplicate latest odds', 1, error.message)

  const seen = new Set()
  let duplicates = 0
  for (const row of data ?? []) {
    const key = [row.match_id, row.api_bookmaker_id, row.market_focus, row.market_name, row.selection, row.line].join('|')
    if (seen.has(key)) duplicates += 1
    else seen.add(key)
  }
  report('duplicate latest odds', duplicates)
}

async function getMarketDataMismatchSummary() {
  const [matches, oddsRows] = await Promise.all([
    selectAll('football_matches', 'id, has_market_data'),
    selectAll('football_match_odds', 'match_id'),
  ])

  const oddsMatchIds = new Set(oddsRows.map((row) => row.match_id).filter(Boolean))
  const oddsRowsExistButHasMarketDataFalse = []
  const hasMarketDataTrueButNoOddsRows = []
  for (const match of matches) {
    const hasOdds = oddsMatchIds.has(match.id)
    const hasMarketData = Boolean(match.has_market_data)
    if (hasOdds && !hasMarketData) oddsRowsExistButHasMarketDataFalse.push(match.id)
    if (hasMarketData && !hasOdds) hasMarketDataTrueButNoOddsRows.push(match.id)
  }

  return {
    oddsRowsExistButHasMarketDataFalse: oddsRowsExistButHasMarketDataFalse.length,
    hasMarketDataTrueButNoOddsRows: hasMarketDataTrueButNoOddsRows.length,
    oddsRowsExistButHasMarketDataFalseIds: oddsRowsExistButHasMarketDataFalse,
    hasMarketDataTrueButNoOddsRowsIds: hasMarketDataTrueButNoOddsRows,
  }
}

async function selectAll(table, columns) {
  const rows = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < pageSize) break
  }
  return rows
}

async function normalizeHasMarketDataFlags(summary) {
  await updateInBatches(summary.oddsRowsExistButHasMarketDataFalseIds, { has_market_data: true })
  await updateInBatches(summary.hasMarketDataTrueButNoOddsRowsIds, { has_market_data: false, odds_updated_at: null })
}

async function updateInBatches(ids = [], patch = {}) {
  const uniqueIds = [...new Set(ids.filter(Boolean))]
  for (let index = 0; index < uniqueIds.length; index += 100) {
    const batch = uniqueIds.slice(index, index + 100)
    if (!batch.length) continue
    const { error } = await supabase.from('football_matches').update(patch).in('id', batch)
    if (error) throw error
  }
}

function report(label, count, message = '') {
  console.log(`${label}: ${count}${message ? ` (${message})` : ''}`)
  if (count > 0) failed = true
}

function getProjectRef(value) {
  try {
    return new URL(value).host.split('.')[0]
  } catch {
    return 'unknown'
  }
}
