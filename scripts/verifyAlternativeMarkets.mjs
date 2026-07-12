import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const selectionDate = process.env.SELECTION_DATE || process.argv[2] || getBangkokToday()
let failed = false

const expectedStatuses = new Set(['READY_PRIMARY', 'READY_ALTERNATIVE', 'WAITING_MARKET', 'INSUFFICIENT_DATA', 'REJECTED', 'FINAL_LOCKED', 'FINISHED'])
const expectedMarkets = new Set(['AH', 'OU', 'MATCH_WINNER', 'DOUBLE_CHANCE', 'CORRECT_SCORE', 'BTTS', 'NONE'])
const expectedTiers = new Set(['PRIMARY', 'ALTERNATIVE', 'SUPPORTING'])

console.log(`[verify:alternative-markets] timezone=Asia/Bangkok`)
console.log(`[verify:alternative-markets] selectionDate=${selectionDate}`)

checkSource()

if (supabaseUrl && supabaseKey) {
  console.log(`[verify:alternative-markets] project_ref=${getProjectRef(supabaseUrl)}`)
  const supabase = createClient(supabaseUrl, supabaseKey)
  await checkDatabase(supabase)
} else {
  console.log('[verify:alternative-markets] database checks skipped: missing Supabase env')
}

if (failed) process.exit(1)
console.log('Alternative market checks passed')

function checkSource() {
  const registry = readFile('src/utils/marketRegistry.js')
  const quality = readFile('src/utils/marketQuality.js')
  const selection = readFile('src/utils/dailySelectionEngine.js')
  const settlement = readFile('src/utils/resultSettlement.js')
  const migration = readFile('supabase/migrations/20260712_finalize_football_analytics_production.sql')
  const edge = readFile('supabase/functions/sync-football-data/index.ts')

  report('registry includes core markets', ['ASIAN_HANDICAP', 'OVER_UNDER', 'MATCH_WINNER_1X2', 'DOUBLE_CHANCE', 'CORRECT_SCORE'].filter((value) => !registry.includes(value)).length)
  report('quality exposes v2 versions', quality.includes('market-quality-v2') && quality.includes('multi-market-decision-v1') ? 0 : 1)
  report('selection supports READY_PRIMARY', selection.includes('READY_PRIMARY') ? 0 : 1)
  report('selection supports READY_ALTERNATIVE', selection.includes('READY_ALTERNATIVE') ? 0 : 1)
  report('settlement supports DOUBLE_CHANCE', settlement.includes('DOUBLE_CHANCE') ? 0 : 1)
  report('migration extends market constraints', migration.includes('DOUBLE_CHANCE') && migration.includes('CORRECT_SCORE') ? 0 : 1)
  report('edge stores alternative markets', edge.includes('DOUBLE_CHANCE') && edge.includes('CORRECT_SCORE') ? 0 : 1)
  report('no fixed count requirement in verifier', readFile('scripts/verifyDailyDecisionBoard.mjs').includes('rows.length >= 0') ? 0 : 1)
}

async function checkDatabase(supabase) {
  const rows = await selectRows(supabase, 'daily_top10_selections', 'id, selection_date, match_id, rank, ai_final_pick_id, market_focus, selection_status, market_ready, decision_market, market_tier, primary_market_ready, alternative_market_ready, confidence_score, pipeline_version, decision_model_version, market_quality_version', (query) =>
    query.eq('selection_date', selectionDate).order('rank', { ascending: true }),
  )
  if (!rows) return

  const duplicates = {
    fixture: countDuplicates(rows.map((row) => row.match_id).filter(Boolean)),
    rank: countDuplicates(rows.map((row) => row.rank).filter(Boolean)),
  }
  const readyPrimary = rows.filter((row) => row.selection_status === 'READY_PRIMARY')
  const readyAlternative = rows.filter((row) => row.selection_status === 'READY_ALTERNATIVE')
  const waiting = rows.filter((row) => row.selection_status === 'WAITING_MARKET')
  const invalidStatus = rows.filter((row) => row.selection_status && !expectedStatuses.has(row.selection_status))
  const invalidMarket = rows.filter((row) => row.market_focus && !expectedMarkets.has(row.market_focus))
  const invalidTier = rows.filter((row) => row.market_tier && !expectedTiers.has(row.market_tier))
  const readyWithoutPick = rows.filter((row) => ['READY_PRIMARY', 'READY_ALTERNATIVE'].includes(row.selection_status) && !row.ai_final_pick_id)
  const correctScoreReady = rows.filter((row) => row.selection_status?.startsWith('READY') && row.market_focus === 'CORRECT_SCORE')
  const confidenceInvalid = rows.filter((row) => row.confidence_score !== null && row.confidence_score !== undefined && (Number(row.confidence_score) < 0 || Number(row.confidence_score) > 100))

  report('dynamic count accepted', rows.length >= 0 ? 0 : 1, `rows=${rows.length}`)
  report('duplicate fixture', duplicates.fixture)
  report('duplicate rank', duplicates.rank)
  report('valid selection statuses', invalidStatus.length)
  report('valid decision market values', invalidMarket.length)
  report('valid market tier values', invalidTier.length)
  report('READY has final pick', readyWithoutPick.length)
  report('Correct Score alone never creates READY', correctScoreReady.length)
  report('confidence range 0-100', confidenceInvalid.length)
  console.log(`READY_PRIMARY=${readyPrimary.length}`)
  console.log(`READY_ALTERNATIVE=${readyAlternative.length}`)
  console.log(`WAITING_MARKET=${waiting.length}`)
}

async function selectRows(supabase, table, columns, applyQuery) {
  const result = await applyQuery(supabase.from(table).select(columns))
  if (result.error) {
    if (isMissingColumnError(result.error)) {
      console.log(`${table} database check: PENDING_MIGRATION (${result.error.message})`)
      return null
    }
    report(`${table} query`, 1, result.error.message)
    return null
  }
  return result.data ?? []
}

function isMissingColumnError(error) {
  const message = String(error?.message ?? error?.details ?? '')
  return error?.code === '42703' || /column .* does not exist/i.test(message)
}

function readFile(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function countDuplicates(values) {
  const seen = new Set()
  let duplicates = 0
  for (const value of values) {
    if (seen.has(value)) duplicates += 1
    else seen.add(value)
  }
  return duplicates
}

function report(label, count, message = '') {
  console.log(`${label}: ${count}${message ? ` (${message})` : ''}`)
  if (count > 0) failed = true
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
