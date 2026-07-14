import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { buildOddsNaturalKey, normalizeMarketRow } from '../supabase/functions/_shared/marketContract.js'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase environment variables for odds verification.')

const supabase = createClient(supabaseUrl, supabaseKey)
let failed = false
console.log(`[verify:odds] project_ref=${projectRef(supabaseUrl)}`)
console.log('[verify:odds] mode=read-only')

const oddsRows = await selectOdds()
const oddsMatchIds = new Set(oddsRows.map((row) => row.match_id).filter(Boolean))
const [referencedMatches, flaggedMatches] = await Promise.all([
  selectMatchesByIds([...oddsMatchIds]),
  selectFlaggedMatches(),
])
const matches = [...new Map([...referencedMatches, ...flaggedMatches].map((row) => [row.id, row])).values()]
const normalized = oddsRows.map((row) => ({ row, market: normalizeRepairAwareMarket(row) }))
const currentRows = normalized.filter(({ row }) => row.is_latest !== false && !['INVALID', 'SUPERSEDED'].includes(String(row.integrity_status ?? '').toUpperCase()))
const validCurrentRows = currentRows.filter(({ row, market }) => Boolean(row.match_id) && market.valid)
const activeOddsMatchIds = new Set(validCurrentRows.map(({ row }) => row.match_id))

report('invalid active odds rows', currentRows.filter(({ row, market }) => !row.match_id || !market.valid).length)
report('Correct Score marked actionable', normalized.filter(({ market }) => market.marketType === 'CORRECT_SCORE' && market.actionable).length)
report('Double Chance selection lost', normalized.filter(({ market }) => market.marketType === 'DOUBLE_CHANCE' && !['1X', 'X2', '12'].includes(market.selection)).length)
report('duplicate latest odds', duplicateCount(currentRows, ({ row, market }) => buildOddsNaturalKey({ ...row, normalized_market_type: market.marketType, normalized_selection: market.selection })))
report('odds rows exists but has_market_data=false', matches.filter((row) => activeOddsMatchIds.has(row.id) && !row.has_market_data).length)
report('has_market_data=true but no valid active odds rows', matches.filter((row) => row.has_market_data && !activeOddsMatchIds.has(row.id)).length)

console.log(`oddsRows=${oddsRows.length}`)
console.log(`inactiveInvalidRows=${normalized.filter(({ row, market }) => row.is_latest === false && (!row.match_id || !market.valid)).length}`)
console.log(`bookmakers=${new Set(oddsRows.map((row) => row.bookmaker_name).filter(Boolean)).size}`)
console.log(`providerSourceTimestamp=${oddsRows.filter((row) => row.provider_source_at).length}`)
console.log(`fetchedTimestamp=${oddsRows.filter((row) => row.fetched_at ?? row.snapshot_at).length}`)

if (failed) process.exit(1)
console.log('Odds integrity checks passed')

async function selectAll(table, columns) {
  const rows = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from(table).select(columns).order('id', { ascending: true }).range(from, from + pageSize - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < pageSize) break
  }
  return rows
}

async function selectOdds() {
  const canonicalColumns = 'id, match_id, api_fixture_id, api_bookmaker_id, bookmaker_name, market_focus, normalized_market_type, market_name, selection, normalized_selection, line, price, is_latest, snapshot_at, provider_source_at, fetched_at, normalized_at, integrity_status'
  try {
    return await selectAll('football_match_odds', canonicalColumns)
  } catch (error) {
    if (!isMissingColumn(error)) throw error
    return selectAll('football_match_odds', 'id, match_id, api_fixture_id, api_bookmaker_id, bookmaker_name, market_focus, market_name, selection, line, price, is_latest, snapshot_at')
  }
}

function normalizeRepairAwareMarket(row) {
  const legacy = String(row.market_focus ?? '').toUpperCase()
  return normalizeMarketRow({
    ...row,
    normalized_market_type: row.normalized_market_type || (legacy && legacy !== 'NONE' ? row.market_focus : row.market_name),
    normalized_selection: row.normalized_selection ?? row.selection,
  })
}

async function selectMatchesByIds(ids) {
  const rows = []
  for (let index = 0; index < ids.length; index += 100) {
    const { data, error } = await supabase.from('football_matches').select('id, has_market_data').in('id', ids.slice(index, index + 100))
    if (error) throw error
    rows.push(...(data ?? []))
  }
  return rows
}

async function selectFlaggedMatches() {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('football_matches').select('id, has_market_data').eq('has_market_data', true).order('id', { ascending: true }).range(from, from + 999)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return rows
}

function isMissingColumn(error) {
  return error?.code === '42703' || /column .* does not exist|schema cache/i.test(String(error?.message ?? ''))
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
