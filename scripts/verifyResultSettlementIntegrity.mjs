import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { settleAiPickResult } from '../src/utils/resultSettlement.js'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

const projectRef = 'fzjbnxomflqopwhzxfog'
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const authKey = serviceRoleKey || anonKey
const warnings = []
const failures = []

function warn(label, detail) {
  warnings.push({ label, detail })
  console.warn(`[warn] ${label}: ${detail}`)
}

function fail(label, detail) {
  failures.push({ label, detail })
  console.error(`[fail] ${label}: ${detail}`)
}

function ok(label, detail) {
  console.log(`[ok] ${label}: ${detail}`)
}

if (supabaseUrl && !supabaseUrl.includes(projectRef)) {
  fail('Supabase project ref', `expected ${projectRef}`)
} else if (supabaseUrl) {
  ok('Supabase project ref', projectRef)
} else {
  warn('Supabase env', 'missing URL; database checks skipped')
}

if (!serviceRoleKey) warn('Supabase service role', 'SUPABASE_SERVICE_ROLE_KEY missing; using anon key if available')

const supabase = supabaseUrl && authKey ? createClient(supabaseUrl, authKey) : null

if (supabase) {
  await checkCounts()
  await repairFinishedResultRows()
  await checkAnomalies()
}

checkUiFiles()

if (warnings.length) console.log(`warnings: ${warnings.length}`)
if (failures.length) {
  console.error(`verify:results failed (${failures.length})`)
  process.exit(1)
}
console.log('verify:results passed')

async function checkCounts() {
  for (const table of ['football_matches', 'football_ai_final_picks', 'football_ai_pick_results', 'daily_top10_selections']) {
    const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true })
    if (error) {
      if (table === 'football_ai_pick_results') warn(`${table} count`, error.message)
      else fail(`${table} count`, error.message)
    } else {
      ok(`${table} count`, String(count ?? 0))
    }
  }
}

async function checkAnomalies() {
  const finishedMissingScore = await supabase
    .from('football_matches')
    .select('id', { count: 'exact', head: true })
    .in('status_short', ['FT', 'AET', 'PEN'])
    .or('home_score.is.null,away_score.is.null')
  reportQuery('finished matches missing score', finishedMissingScore, 'fail')

  const pendingSettled = await supabase
    .from('football_ai_pick_results')
    .select('id, match:football_matches(status_short, home_score, away_score)', { count: 'exact' })
    .eq('settlement_status', 'PENDING')
    .limit(100)
  if (pendingSettled.error) warn('pending result anomaly', pendingSettled.error.message)
  else {
    const bad = (pendingSettled.data ?? []).filter((row) => {
      const match = Array.isArray(row.match) ? row.match[0] : row.match
      return ['FT', 'AET', 'PEN'].includes(match?.status_short) && match.home_score !== null && match.away_score !== null
    })
    if (bad.length) fail('pending after finished score', `${bad.length} rows need settle-ai-pick-results`)
    else ok('pending after finished score', '0')
  }

  const resultMissingScore = await supabase
    .from('football_ai_pick_results')
    .select('id, home_score, away_score, match:football_matches(home_score, away_score)', { count: 'exact' })
    .or('home_score.is.null,away_score.is.null')
    .limit(100)
  if (resultMissingScore.error) warn('result score fallback anomaly', resultMissingScore.error.message)
  else {
    const bad = (resultMissingScore.data ?? []).filter((row) => {
      const match = Array.isArray(row.match) ? row.match[0] : row.match
      return match?.home_score !== null && match?.home_score !== undefined && match?.away_score !== null && match?.away_score !== undefined
    })
    if (bad.length) warn('result rows missing score but match has score', `${bad.length} rows can be refreshed`)
    else ok('result score fallback anomaly', '0')
  }

  const missingJoin = await supabase
    .from('football_ai_pick_results')
    .select('id, match_id, match:football_matches(id)', { count: 'exact' })
    .limit(100)
  if (missingJoin.error) warn('match join anomaly', missingJoin.error.message)
  else {
    const bad = (missingJoin.data ?? []).filter((row) => row.match_id && !row.match)
    if (bad.length) fail('result rows missing match join', `${bad.length}`)
    else ok('result rows missing match join', '0')
  }

  const duplicateFinalPickResults = await findDuplicateAiFinalPickResults()
  if (duplicateFinalPickResults.error) warn('duplicate ai_final_pick results', duplicateFinalPickResults.error.message)
  else if (duplicateFinalPickResults.count) fail('duplicate ai_final_pick results', String(duplicateFinalPickResults.count))
  else ok('duplicate ai_final_pick results', '0')

  const staleScheduled = await supabase
    .from('football_matches')
    .select('id', { count: 'exact', head: true })
    .in('status_short', ['NS', 'TBD'])
    .lt('kickoff_at', new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString())
    .or(`api_fixture_last_checked_at.is.null,api_fixture_last_checked_at.lt.${new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()}`)
  reportQuery('stale scheduled matches', staleScheduled, 'warn')
}

async function repairFinishedResultRows() {
  const { data, error } = await supabase
    .from('football_ai_pick_results')
    .select(`
      id,
      market_focus,
      direction,
      home_score,
      away_score,
      settlement_status,
      match:football_matches(status_short, status_long, status, home_score, away_score, home_goals, away_goals)
    `)
    .or('settlement_status.eq.PENDING,home_score.is.null,away_score.is.null')
    .limit(200)

  if (error) return warn('result repair query', error.message)

  let repaired = 0
  for (const row of data ?? []) {
    const match = Array.isArray(row.match) ? row.match[0] : row.match
    const homeScore = firstNumber(match?.home_score, match?.home_goals)
    const awayScore = firstNumber(match?.away_score, match?.away_goals)
    const statusShort = String(match?.status_short ?? match?.status ?? '').toUpperCase()
    if (homeScore === null || awayScore === null) continue

    if (!['FT', 'AET', 'PEN'].includes(statusShort)) {
      const { error: scoreUpdateError } = await supabase
        .from('football_ai_pick_results')
        .update({
          home_score: homeScore,
          away_score: awayScore,
          status_short: statusShort,
          status_long: match?.status_long ?? null,
        })
        .eq('id', row.id)
      if (scoreUpdateError) warn('result score repair update', `${row.id}: ${scoreUpdateError.message}`)
      else repaired += 1
      continue
    }

    const outcome = settleAiPickResult({
      statusShort,
      homeScore,
      awayScore,
      marketFocus: row.market_focus,
      direction: row.direction,
    })
    if (outcome.settlement_status === 'PENDING') continue

    const { error: updateError } = await supabase
      .from('football_ai_pick_results')
      .update({
        home_score: homeScore,
        away_score: awayScore,
        status_short: statusShort,
        status_long: match?.status_long ?? null,
        settlement_status: outcome.settlement_status,
        simulation_outcome: outcome.simulation_outcome,
        settlement_reason: outcome.settlement_reason,
        settled_at: new Date().toISOString(),
      })
      .eq('id', row.id)

    if (updateError) warn('result repair update', `${row.id}: ${updateError.message}`)
    else repaired += 1
  }

  ok('finished result repair', String(repaired))
}

async function findDuplicateAiFinalPickResults() {
  const { data, error } = await supabase
    .from('football_ai_pick_results')
    .select('id, ai_final_pick_id')
    .not('ai_final_pick_id', 'is', null)
    .limit(5000)
  if (error) return { count: 0, error }

  const seen = new Set()
  let duplicates = 0
  for (const row of data ?? []) {
    if (seen.has(row.ai_final_pick_id)) duplicates += 1
    else seen.add(row.ai_final_pick_id)
  }
  return { count: duplicates }
}

function reportQuery(label, result, severity) {
  if (result.error) return warn(label, result.error.message)
  const count = result.count ?? 0
  if (!count) return ok(label, '0')
  return severity === 'fail' ? fail(label, String(count)) : warn(label, String(count))
}

function checkUiFiles() {
  const edgeSource = readText('supabase/functions/sync-football-data/index.ts')
  if (!edgeSource.includes(".upsert(rows, { onConflict: 'ai_final_pick_id' })")) fail('result-refresh conflict target', 'missing ai_final_pick_id upsert')
  else ok('result-refresh conflict target', 'ai_final_pick_id')

  const resultPage = readText('src/pages/ResultTrackerPage.jsx')
  const headingCount = countOccurrences(resultPage, 'ติดตามผลย้อนหลัง')
  if (headingCount !== 1) fail('ResultTracker duplicate heading', `found ${headingCount}`)
  else ok('ResultTracker heading', 'single')

  const uiText = resultPage + readText('src/utils/matchStatus.js')
  for (const text of ['จบแล้ว', 'รอผล', 'ไม่ประเมิน', 'เข้าทาง', 'ไม่เข้าทาง', 'ไม่มีสัญญาณ']) {
    if (!uiText.includes(text)) warn('ResultTracker Thai copy', `missing ${text}`)
  }

  if (/\bSync\b|ซิงก์ข้อมูล/.test(resultPage)) fail('ResultTracker sync control', 'sync copy/control found')
  else ok('ResultTracker sync control', 'not present')

  const sourceFiles = listSourceFiles(['src'])
  const forbidden = ['betting tips', 'betting recommendations', 'stake', 'bankroll', 'profit', 'ROI', 'แทง', 'เดิมพัน']
  for (const file of sourceFiles) {
    const text = readText(file)
    for (const word of forbidden) {
      if (forbiddenWordPattern(word).test(text)) fail('forbidden UI word', `${word} in ${file}`)
    }
  }
}

function listSourceFiles(roots) {
  const files = []
  for (const root of roots) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const full = path.join(root, entry.name)
      if (entry.isDirectory()) files.push(...listSourceFiles([full]))
      else if (/\.(jsx?|tsx?)$/.test(entry.name)) files.push(full)
    }
  }
  return files
}

function readText(file) {
  return fs.readFileSync(file, 'utf8')
}

function countOccurrences(text, needle) {
  return text.split(needle).length - 1
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function forbiddenWordPattern(word) {
  const escaped = escapeRegExp(word)
  return /^[\x00-\x7F]+$/.test(word)
    ? new RegExp(`\\b${escaped}\\b`, 'i')
    : new RegExp(escaped, 'i')
}

function firstNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return numeric
  }
  return null
}
