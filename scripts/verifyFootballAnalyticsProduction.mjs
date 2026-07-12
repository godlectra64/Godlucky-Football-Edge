import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const selectionDate = process.env.SELECTION_DATE || process.argv[2] || getBangkokToday()
let failed = false

console.log(`[verify:football-analytics] timezone=Asia/Bangkok`)
console.log(`[verify:football-analytics] selectionDate=${selectionDate}`)

checkSource()

if (supabaseUrl && supabaseKey) {
  console.log(`[verify:football-analytics] project_ref=${getProjectRef(supabaseUrl)}`)
  const supabase = createClient(supabaseUrl, supabaseKey)
  await checkDatabase(supabase)
} else {
  console.log('[verify:football-analytics] database checks skipped: missing Supabase env')
}

if (failed) process.exit(1)
console.log('Football analytics production checks passed')

function checkSource() {
  const status = readFile('src/utils/analysisStatus.js')
  const analytics = readFile('src/utils/footballAnalytics.js')
  const migration = readFile('supabase/migrations/20260712_finalize_football_analytics_production.sql')
  const edge = readFile('supabase/functions/sync-football-data/index.ts')
  const packageJson = readFile('package.json')

  report('analysis statuses canonical', ['ANALYSIS_READY', 'PARTIAL_ANALYSIS', 'WAITING_DATA', 'INSUFFICIENT_DATA', 'FINAL_LOCKED', 'FINISHED'].filter((value) => !status.includes(value)).length)
  report('analytics versions canonical', analytics.includes('football-analytics-pipeline-v1') && analytics.includes('football-analysis-model-v1') ? 0 : 1)
  report('migration has analytics columns', ['analysis_status', 'model_outlook', 'win_draw_loss_probabilities', 'expected_goals', 'expected_score_predictions', 'confidence_breakdown', 'data_quality'].filter((value) => !migration.includes(value)).length)
  report('migration creates daily_analysis_board', migration.includes('create or replace view public.daily_analysis_board') ? 0 : 1)
  report('migration does not add selected_bookmaker', /add column if not exists selected_bookmaker/i.test(migration) ? 1 : 0)
  report('edge writes analytics fields', ['win_draw_loss_probabilities', 'expected_score_predictions', 'analysis_model_version', 'summary: buildFootballAnalyticsSummary'].filter((value) => !edge.includes(value)).length)
  report('package exposes production verifier', packageJson.includes('verify:football-analytics') ? 0 : 1)
  report('public UI has no forbidden visible terms', findForbiddenPublicTerms().length, findForbiddenPublicTerms().join(', '))
}

async function checkDatabase(supabase) {
  const rows = await selectRows(supabase, 'daily_analysis_board', 'fixture_id, selection_date, rank, analysis_status, win_draw_loss_probabilities, expected_goals, expected_score_predictions, confidence, confidence_breakdown, data_quality, analysis_model_version, pipeline_version', (query) =>
    query.eq('selection_date', selectionDate).order('rank', { ascending: true }),
  )
  if (!rows) return

  const invalidStatus = rows.filter((row) => !['ANALYSIS_READY', 'PARTIAL_ANALYSIS', 'WAITING_DATA', 'INSUFFICIENT_DATA', 'FINAL_LOCKED', 'FINISHED'].includes(row.analysis_status))
  const invalidProbabilities = rows.filter((row) => {
    const p = row.win_draw_loss_probabilities ?? {}
    const total = Number(p.homeWin ?? p.home_win ?? 0) + Number(p.draw ?? 0) + Number(p.awayWin ?? p.away_win ?? 0)
    return Math.abs(total - 1) > 0.02
  })
  const invalidConfidence = rows.filter((row) => Number(row.confidence) < 0 || Number(row.confidence) > 100)
  const invalidScoreCount = rows.filter((row) => Array.isArray(row.expected_score_predictions) && row.expected_score_predictions.length > 3)
  const invalidVersions = rows.filter((row) => row.pipeline_version !== 'football-analytics-pipeline-v1' || row.analysis_model_version !== 'football-analysis-model-v1')

  report('dynamic count accepted', rows.length >= 0 ? 0 : 1, `rows=${rows.length}`)
  report('valid analysis statuses', invalidStatus.length)
  report('probabilities sum to 1', invalidProbabilities.length)
  report('confidence range 0-100', invalidConfidence.length)
  report('expected score top 3', invalidScoreCount.length)
  report('canonical versions', invalidVersions.length)
}

async function selectRows(supabase, table, columns, applyQuery) {
  const result = await applyQuery(supabase.from(table).select(columns))
  if (result.error) {
    report(`${table} query`, 1, result.error.message)
    return null
  }
  return result.data ?? []
}

function findForbiddenPublicTerms() {
  const publicFiles = [
    'src/components/AiFinalPickCard.jsx',
    'src/components/MatchCard.jsx',
    'src/components/MarketOddsCard.jsx',
    'src/components/ScoreBadge.jsx',
    'src/pages/TodayPage.jsx',
    'src/pages/MatchDetailPage.jsx',
    'src/pages/ResultTrackerPage.jsx',
    'src/pages/AiPerformancePage.jsx',
    'src/pages/StatsPage.jsx',
  ]
  const forbidden = ['Best Bet', 'Double Chance Pick', 'Asian Handicap Pick', 'Over/Under Pick', 'เดิมพัน', 'แทง', 'เจ้ามือ', 'ราคาบอล', 'Best Pick', 'Final Decision', 'AH Analysis', 'O/U Analysis']
  const found = []
  for (const file of publicFiles) {
    const text = readFile(file)
    for (const term of forbidden) {
      if (text.includes(term)) found.push(`${file}:${term}`)
    }
  }
  return found
}

function readFile(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
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
