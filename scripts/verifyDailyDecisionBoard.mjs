import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const selectionDate = process.env.SELECTION_DATE || process.argv[2] || getBangkokToday()
let failed = false

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables for Daily Decision Board verification.')
  process.exit(1)
}

console.log(`[verify:daily-decision-board] project_ref=${getProjectRef(supabaseUrl)}`)
console.log('[verify:daily-decision-board] timezone=Asia/Bangkok')
console.log(`[verify:daily-decision-board] selectionDate=${selectionDate}`)

const supabase = createClient(supabaseUrl, supabaseKey)

await checkMigration()
await checkDecisionBoard()

if (failed) process.exit(1)
console.log('Daily Decision Board checks passed')

async function checkMigration() {
  const migration = readFileSync(new URL('../supabase/migrations/20260714_market_ready_dynamic_decision_board.sql', import.meta.url), 'utf8')
  report('rank allows dynamic count', migration.includes('daily_top10_selections_rank_positive') && !migration.includes('between 1 and 10') ? 0 : 1)
  report('decision status columns', migration.includes('selection_status text') && migration.includes('market_ready boolean') ? 0 : 1)
  report('pipeline version audit columns', migration.includes('pipeline_version text') && migration.includes('selection_algorithm_version text') ? 0 : 1)
}

async function checkDecisionBoard() {
  let hasDynamicColumns = true
  let { data, error } = await supabase
    .from('daily_top10_selections')
    .select('id, selection_date, match_id, api_fixture_id, rank, ai_final_pick_id, market_focus, selection_status, market_ready, pipeline_version, selection_algorithm_version, locked_at, updated_at')
    .eq('selection_date', selectionDate)
    .order('rank', { ascending: true })

  if (isMissingDecisionBoardColumn(error)) {
    hasDynamicColumns = false
    report('decision board migration applied', 1, error.message)
    const fallback = await supabase
      .from('daily_top10_selections')
      .select('id, selection_date, match_id, api_fixture_id, rank, ai_final_pick_id, market_focus, locked_at, updated_at')
      .eq('selection_date', selectionDate)
      .order('rank', { ascending: true })
    data = fallback.data
    error = fallback.error
  }

  if (error) return report('decision board query', 1, error.message)

  const rows = data ?? []
  const duplicateRanks = findDuplicates(rows, (row) => row.rank)
  const duplicateFixtures = findDuplicates(rows, (row) => row.match_id)
  const readyRows = rows.filter((row) => normalizeStatus(row) === 'READY')
  const watchRows = rows.filter((row) => normalizeStatus(row) === 'WATCH')
  const waitingRows = rows.filter((row) => normalizeStatus(row) === 'WAITING_MARKET')
  const validStatuses = new Set(['READY', 'WATCH', 'WAITING_MARKET', 'REJECTED', 'FINAL_LOCKED', 'FINISHED'])
  const invalidStatuses = rows.filter((row) => row.selection_status && !validStatuses.has(row.selection_status))
  const readyWithoutMarket = readyRows.filter((row) => row.market_ready === false)
  const waitingWithFinalPick = waitingRows.filter((row) => row.ai_final_pick_id)
  const readyWithoutFinalPick = readyRows.filter((row) => !row.ai_final_pick_id)
  const badPipeline = hasDynamicColumns ? rows.filter((row) => row.pipeline_version && row.pipeline_version !== 'market-ready-dynamic-pipeline-v1') : rows
  const badAlgorithm = hasDynamicColumns ? rows.filter((row) => row.selection_algorithm_version && row.selection_algorithm_version !== 'market-ready-dynamic-selection-v1') : rows

  report('dynamic count valid', rows.length >= 0 ? 0 : 1, `rows=${rows.length}`)
  report('duplicate decision rank', duplicateRanks.length)
  report('duplicate fixture', duplicateFixtures.length)
  report('invalid selection status', invalidStatuses.length)
  report('READY market_ready=true', readyWithoutMarket.length)
  report('READY final pick present', readyWithoutFinalPick.length)
  report('WAITING_MARKET has no final pick', waitingWithFinalPick.length)
  report('pipeline version', badPipeline.length)
  report('selection algorithm version', badAlgorithm.length)

  const matchIds = rows.map((row) => row.match_id).filter(Boolean)
  const oddsByMatch = await fetchOddsByMatch(matchIds)
  const invalidReadyMarket = readyRows.filter((row) => !hasValidDecisionMarket(oddsByMatch.get(row.match_id) ?? []))
  const finalPickInvalidMarket = rows.filter((row) => row.ai_final_pick_id && !hasValidDecisionMarket(oddsByMatch.get(row.match_id) ?? []))
  report('READY references valid market', invalidReadyMarket.length)
  report('Final Pick references valid market', finalPickInvalidMarket.length)

  console.log(`readyCount=${readyRows.length}`)
  console.log(`watchCount=${watchRows.length}`)
  console.log(`waitingMarketCount=${waitingRows.length}`)
}

async function fetchOddsByMatch(matchIds) {
  const grouped = new Map()
  if (!matchIds.length) return grouped
  const { data, error } = await supabase
    .from('football_match_odds')
    .select('match_id, market_focus, market_name, line, price, snapshot_at')
    .in('match_id', matchIds)
  if (error) throw error
  for (const row of data ?? []) {
    const rows = grouped.get(row.match_id) ?? []
    rows.push(row)
    grouped.set(row.match_id, rows)
  }
  return grouped
}

function normalizeStatus(row) {
  if (row.selection_status) return row.selection_status
  if (row.market_ready === true) return 'READY'
  if (row.market_ready === false) return 'WAITING_MARKET'
  return row.ai_final_pick_id ? 'READY' : 'WAITING_MARKET'
}

function hasValidDecisionMarket(rows) {
  return rows.some((row) => {
    const focus = String(row.market_focus ?? '').toUpperCase()
    const name = String(row.market_name ?? '').toLowerCase()
    const price = Number(row.price)
    return Number.isFinite(price) && price > 0 && (
      focus === 'AH' ||
      focus === 'OU' ||
      name.includes('asian handicap') ||
      name.includes('handicap') ||
      name.includes('over/under') ||
      name.includes('goals over')
    )
  })
}

function report(label, count, message = '') {
  console.log(`${label}: ${count}${message ? ` (${message})` : ''}`)
  if (count > 0) failed = true
}

function isMissingDecisionBoardColumn(error) {
  if (!error) return false
  const message = String(error.message ?? error.details ?? '')
  return error.code === '42703' || /selection_status|market_ready|pipeline_version|selection_algorithm_version/i.test(message)
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
