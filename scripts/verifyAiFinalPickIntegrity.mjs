import { exec } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables for AI Final Pick verification.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)
const execAsync = promisify(exec)
let failed = false

await checkAiFinalPickTables()
await checkTop10Coverage()
await checkAiFinalPickIntegrity()
await checkOddsIntegrity()
await checkForbiddenUiWords()

if (failed) process.exit(1)
console.log('AI Final Pick integrity checks passed')

async function checkAiFinalPickTables() {
  const tables = ['football_bookmakers', 'football_match_odds', 'football_ai_final_picks']
  for (const table of tables) {
    const { error } = await supabase.from(table).select('id', { count: 'exact', head: true })
    report(`table ${table}`, error ? 1 : 0, error?.message)
  }
}

async function checkTop10Coverage() {
  const { data, error } = await supabase
    .from('match_analysis')
    .select('match_id, final_rank, is_top_pick')
    .eq('is_top_pick', true)
    .not('final_rank', 'is', null)
    .order('final_rank', { ascending: true })
    .limit(10)
  if (error) {
    if (isRestSchemaMissing(error)) return checkTop10CoverageViaCli()
    return report('top 10 query', 1, error.message)
  }

  const matchIds = (data ?? []).map((row) => row.match_id).filter(Boolean)
  if (!matchIds.length) return report('top 10 aiFinalPick coverage', 0, 'no Top 10 rows yet')

  const { data: picks, error: pickError } = await supabase
    .from('football_ai_final_picks')
    .select('match_id')
    .in('match_id', matchIds)
  if (pickError) return report('top 10 aiFinalPick coverage', 1, pickError.message)

  const found = new Set((picks ?? []).map((row) => row.match_id))
  const missing = matchIds.filter((id) => !found.has(id))
  report('top 10 aiFinalPick coverage', missing.length, missing.length ? `missing ${missing.length}` : '')
}

async function checkTop10CoverageViaCli() {
  const sql = `
    with top10 as (
      select match_id
      from public.match_analysis
      where is_top_pick is true and final_rank is not null
      order by final_rank asc
      limit 10
    )
    select
      count(*) filter (where fp.match_id is null) as missing_count,
      count(*) as top_count
    from top10 t
    left join public.football_ai_final_picks fp on fp.match_id = t.match_id;
  `
  const sqlPath = path.join(tmpdir(), `verify-ai-final-pick-${randomUUID()}.sql`)
  try {
    await import('node:fs/promises').then((fs) => fs.writeFile(sqlPath, sql))
    const { stdout } = await execAsync(`npx supabase db query --linked --output json --file "${sqlPath}"`, { maxBuffer: 1024 * 1024 * 2 })
    const payload = parseSupabaseCliJson(stdout)
    const row = payload.rows?.[0] ?? {}
    const missing = Number(row.missing_count ?? 0)
    const topCount = Number(row.top_count ?? 0)
    report('top 10 aiFinalPick coverage', missing, topCount ? `top ${topCount}` : 'no Top 10 rows yet')
  } catch (error) {
    report('top 10 aiFinalPick coverage', 1, error.message)
  } finally {
    await import('node:fs/promises').then((fs) => fs.unlink(sqlPath).catch(() => {}))
  }
}

async function checkAiFinalPickIntegrity() {
  const checks = [
    ['invalid signal', () => supabase.from('football_ai_final_picks').select('id', { count: 'exact', head: true }).not('signal', 'in', '("STRONG_SIGNAL","WATCH","SKIP")')],
    ['invalid marketFocus', () => supabase.from('football_ai_final_picks').select('id', { count: 'exact', head: true }).not('market_focus', 'in', '("AH","OU","MATCH_WINNER","BTTS","NONE")')],
    ['invalid confidenceScore', () => supabase.from('football_ai_final_picks').select('id', { count: 'exact', head: true }).or('confidence_score.lt.0,confidence_score.gt.100')],
    ['invalid riskLevel', () => supabase.from('football_ai_final_picks').select('id', { count: 'exact', head: true }).not('risk_level', 'in', '("LOW","MEDIUM","HIGH")')],
    ['strong signal without odds', () => supabase.from('football_ai_final_picks').select('id', { count: 'exact', head: true }).eq('signal', 'STRONG_SIGNAL').is('latest_odds', null)],
    ['strong signal with HIGH risk', () => supabase.from('football_ai_final_picks').select('id', { count: 'exact', head: true }).eq('signal', 'STRONG_SIGNAL').eq('risk_level', 'HIGH')],
  ]

  for (const [label, query] of checks) {
    const { count, error } = await query()
    report(label, error ? 1 : count ?? 0, error?.message)
  }
}

async function checkOddsIntegrity() {
  const checks = [
    ['invalid odds marketFocus', () => supabase.from('football_match_odds').select('id', { count: 'exact', head: true }).not('market_focus', 'in', '("AH","OU","MATCH_WINNER","BTTS","NONE")')],
    ['invalid odds price', () => supabase.from('football_match_odds').select('id', { count: 'exact', head: true }).not('price', 'is', null).lte('price', 0)],
  ]

  for (const [label, query] of checks) {
    const { count, error } = await query()
    report(label, error ? 1 : count ?? 0, error?.message)
  }
}

async function checkForbiddenUiWords() {
  const banned = [/betting tips/i, /betting recommendations/i, /\bstake\b/i, /\bbankroll\b/i, /\bprofit\b/i, /\bROI\b/i, /เดิมพัน/i, /แทง/i]
  const files = await listFiles('src')
  const offenders = []
  for (const file of files.filter((item) => /\.(jsx?|tsx?)$/.test(item))) {
    const text = await readFile(file, 'utf8')
    if (banned.some((pattern) => pattern.test(text))) offenders.push(file)
  }
  report('forbidden UI words', offenders.length, offenders.join(', '))
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(fullPath))
    else files.push(fullPath)
  }
  return files
}

function report(label, count, message = '') {
  console.log(`${label}: ${count}${message ? ` (${message})` : ''}`)
  if (count > 0) failed = true
}

function isRestSchemaMissing(error) {
  if (!error) return false
  const message = String(error.message ?? error.details ?? '')
  return error.code === 'PGRST205' || /Could not find the table .* in the schema cache/i.test(message)
}

function parseSupabaseCliJson(output) {
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) throw new Error('Supabase CLI did not return JSON output')
  return JSON.parse(output.slice(start, end + 1))
}
