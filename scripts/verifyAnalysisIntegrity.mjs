import { exec } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { getBangkokDayRange } from '../src/utils/bangkokDateRange.js'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, or SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)
const execAsync = promisify(exec)

const restAccess = await probeRestAccess()
if (!restAccess.available && isRestSchemaMissing(restAccess.error)) {
  console.warn(`REST Supabase schema unavailable for match_analysis (${restAccess.error.message}). Falling back to linked Supabase CLI database.`)
  const cliPassed = await runLinkedCliVerification()
  process.exit(cliPassed ? 0 : 1)
}
const requiredFields = [
  'analysis_summary',
  'confidence_score',
  'recommendation',
  'risk_level',
  'home_advantage_score',
  'away_weakness_score',
  'goal_scoring_score',
  'defensive_stability_score',
  'market_risk_score',
]

const checks = [
  ...requiredFields.map((field) => ({
    label: `null ${field}`,
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).is(field, null),
  })),
  {
    label: 'invalid recommendation',
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).not('recommendation', 'in', '("BET","LEAN","WATCH","NO BET")'),
  },
  {
    label: 'invalid risk_level',
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).not('risk_level', 'in', '("LOW","MEDIUM","HIGH")'),
  },
  {
    label: 'invalid pick_side',
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).not('pick_side', 'in', '("HOME","AWAY","DRAW","NONE")'),
  },
  {
    label: 'missing pick_reason for selected side',
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).in('pick_side', ['HOME', 'AWAY', 'DRAW']).is('pick_reason', null),
  },
  {
    label: 'pick_side NONE with pick_team',
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).eq('pick_side', 'NONE').not('pick_team', 'is', null),
  },
  {
    label: 'invalid value_status',
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).not('value_status', 'in', '("YES","NO","WAITING_DATA","NOT_APPLICABLE")'),
  },
  {
    label: 'value YES with missing market_line',
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).eq('value_status', 'YES').is('market_line', null),
  },
  {
    label: 'value YES with missing fair_line',
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).eq('value_status', 'YES').is('fair_line', null),
  },
  {
    label: 'value YES on NO BET',
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).eq('value_status', 'YES').eq('recommendation', 'NO BET'),
  },
  {
    label: 'value YES with pick_side NONE',
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).eq('value_status', 'YES').eq('pick_side', 'NONE'),
  },
]

const optionalV2Checks = [
  {
    label: 'invalid data_validation_status',
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).not('data_validation_status', 'in', '("VALID","PARTIAL","INVALID")'),
  },
  {
    label: 'invalid confidence_score range',
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).or('confidence_score.lt.0,confidence_score.gt.100'),
  },
  {
    label: 'invalid ranking_score range',
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).or('ranking_score.lt.0,ranking_score.gt.100'),
  },
  {
    label: 'top pick marked INVALID',
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).eq('is_top_pick', true).eq('data_validation_status', 'INVALID'),
  },
  {
    label: 'invalid top pick recommendation',
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).eq('is_top_pick', true).not('recommendation', 'in', '("BET","LEAN","WATCH","NO BET")'),
  },
  {
    label: 'duplicate final pick per day',
    query: async () => {
      const { data, error } = await supabase
        .from('match_analysis')
        .select('id, match_id, is_final_pick')
        .eq('is_final_pick', true)
      if (error) return { error }

      const kickoffByMatchId = await fetchKickoffByMatchId(data ?? [])
      if (kickoffByMatchId.error) return { error: kickoffByMatchId.error }

      const countsByDay = new Map()
      for (const row of data ?? []) {
        const kickoff = kickoffByMatchId.map.get(row.match_id)
        const day = kickoff ? getBangkokDayRange(kickoff).dateKey : 'unknown'
        countsByDay.set(day, (countsByDay.get(day) ?? 0) + 1)
      }

      const count = [...countsByDay.values()].filter((countForDay) => countForDay > 1).length
      return { count }
    },
  },
  {
    label: 'duplicate final_rank per day',
    query: async () => {
      const { data, error } = await supabase
        .from('match_analysis')
        .select('id, match_id, final_rank, is_top_pick')
        .eq('is_top_pick', true)
        .not('final_rank', 'is', null)
      if (error) return { error }

      const kickoffByMatchId = await fetchKickoffByMatchId(data ?? [])
      if (kickoffByMatchId.error) return { error: kickoffByMatchId.error }

      const seen = new Set()
      let duplicates = 0
      for (const row of data ?? []) {
        const kickoff = kickoffByMatchId.map.get(row.match_id)
        const day = kickoff ? getBangkokDayRange(kickoff).dateKey : 'unknown'
        const key = `${day}:${row.final_rank}`
        if (seen.has(key)) duplicates += 1
        seen.add(key)
      }

      return { count: duplicates }
    },
  },
  {
    label: 'decision rank below 1',
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).eq('is_top_pick', true).lt('final_rank', 1),
  },
]

const optionalV4Checks = [
  {
    label: 'invalid calibrated_confidence_score range',
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).or('calibrated_confidence_score.lt.0,calibrated_confidence_score.gt.100'),
  },
  {
    label: 'invalid market_edge_score range',
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).or('market_edge_score.lt.0,market_edge_score.gt.100'),
  },
  {
    label: 'invalid data_depth_score range',
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).or('data_depth_score.lt.0,data_depth_score.gt.100'),
  },
  {
    label: 'duplicate v4 prediction results',
    query: async () => {
      const { data, error } = await supabase
        .from('football_prediction_results')
        .select('match_id, model_version')
        .eq('model_version', 'v4')
      if (error) return { error }

      const seen = new Set()
      let duplicates = 0
      for (const row of data ?? []) {
        const key = `${row.match_id}:${row.model_version}`
        if (seen.has(key)) duplicates += 1
        seen.add(key)
      }
      return { count: duplicates }
    },
  },
]

const optionalProfessionalChecks = [
  {
    label: 'null professional_score when column exists',
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).is('professional_score', null),
  },
  {
    label: 'invalid professional_score range',
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).or('professional_score.lt.0,professional_score.gt.100'),
  },
  {
    label: 'invalid data_quality_score range',
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).or('data_quality_score.lt.0,data_quality_score.gt.100'),
  },
  {
    label: 'invalid market_quality_score range',
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).or('market_quality_score.lt.0,market_quality_score.gt.100'),
  },
  {
    label: 'invalid statistical_edge_score range',
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).or('statistical_edge_score.lt.0,statistical_edge_score.gt.100'),
  },
  {
    label: 'invalid tactical_edge_score range',
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).or('tactical_edge_score.lt.0,tactical_edge_score.gt.100'),
  },
  {
    label: 'invalid motivation_score professional range',
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).or('motivation_score.lt.0,motivation_score.gt.100'),
  },
  {
    label: 'invalid risk_control_score range',
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).or('risk_control_score.lt.0,risk_control_score.gt.100'),
  },
  {
    label: 'invalid value_edge_score range',
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).or('value_edge_score.lt.0,value_edge_score.gt.100'),
  },
  {
    label: 'decision board analysis missing professional score',
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).eq('is_top_pick', true).is('professional_score', null),
  },
  {
    label: 'persisted decision board missing professional score',
    query: checkDailyTop10LockedProfessionalScore,
  },
  {
    label: 'null pipeline_stage when column exists',
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).is('pipeline_stage', null),
  },
  {
    label: 'invalid pipeline json arrays',
    query: checkProfessionalPipelineJsonArrays,
  },
  {
    label: 'friendly/youth low-data BET',
    query: checkFriendlyYouthLowDataBet,
  },
]

const enrichmentTables = [
  'api_football_league_coverage',
  'api_football_fixture_statistics',
  'api_football_fixture_events',
  'api_football_fixture_lineups',
  'api_football_fixture_players',
  'api_football_injuries',
  'api_football_squads',
  'api_football_coaches',
  'api_football_venues',
  'api_football_top_players',
  'api_football_rounds',
  'api_football_enrichment_sync_log',
  'api_football_daily_sync_runs',
  'api_football_daily_sync_steps',
]

const footballEnrichmentChecks = [
  ...enrichmentTables.map((table) => ({
    label: `enrichment table ${table}`,
    query: () => supabase.from(table).select('id', { count: 'exact', head: true }),
  })),
  {
    label: 'latest enrichment sync errors',
    query: () => supabase.from('api_football_enrichment_sync_log').select('id', { count: 'exact', head: true }).eq('status', 'error').gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
  },
  {
    label: 'decision board fixture enrichment rows',
    query: checkTopFixtureEnrichment,
  },
  {
    label: 'frontend empty enrichment normalization',
    query: checkFrontendEmptyEnrichment,
  },
  {
    label: 'football enrichment betting keyword scan',
    query: checkFootballEnrichmentKeywordScan,
  },
  {
    label: 'daily sync modes present',
    query: checkDailySyncModesPresent,
  },
  {
    label: 'daily sync docs curl example',
    query: checkDailySyncDocs,
  },
  {
    label: 'daily sync retry migration',
    query: checkDailySyncRetryMigration,
  },
  {
    label: 'today data coverage snapshot',
    query: checkTodayDataCoverage,
  },
  {
    label: 'market-ready stale default analysis',
    query: checkMarketReadyDefaultAnalysis,
  },
]

let failed = false

for (const check of checks) {
  const { count, error } = await check.query()
  if (error) {
    failed = true
    console.error(`${check.label}: query failed - ${error.message}`)
    continue
  }

  console.log(`${check.label}: ${count ?? 0}`)
  if ((count ?? 0) > 0) failed = true
}

for (const check of optionalV2Checks) {
  const { count, error } = await check.query()
  if (error) {
    if (isOptionalV2Missing(error)) {
      console.log(`${check.label}: skipped (${error.message})`)
      continue
    }

    failed = true
    console.error(`${check.label}: query failed - ${error.message}`)
    continue
  }

  console.log(`${check.label}: ${count ?? 0}`)
  if ((count ?? 0) > 0) failed = true
}

for (const check of optionalV4Checks) {
  const { count, error } = await check.query()
  if (error) {
    if (isOptionalV2Missing(error)) {
      console.log(`${check.label}: skipped (${error.message})`)
      continue
    }

    failed = true
    console.error(`${check.label}: query failed - ${error.message}`)
    continue
  }

  console.log(`${check.label}: ${count ?? 0}`)
  if ((count ?? 0) > 0) failed = true
}

for (const check of optionalProfessionalChecks) {
  const { count, error, warning } = await check.query()
  if (error) {
    if (isOptionalV2Missing(error) || isBlankOptionalProfessionalError(error)) {
      console.log(`${check.label}: skipped (${error.message})`)
      continue
    }

    failed = true
    console.error(`${check.label}: query failed - ${error.message}`)
    continue
  }

  if (warning) console.warn(`${check.label}: ${warning}`)
  else console.log(`${check.label}: ${count ?? 0}`)
  if ((count ?? 0) > 0) failed = true
}

for (const check of footballEnrichmentChecks) {
  const { count, error, warning } = await check.query()
  if (error) {
    if (isOptionalV2Missing(error)) {
      console.log(`${check.label}: skipped (${error.message})`)
      continue
    }

    failed = true
    console.error(`${check.label}: query failed - ${error.message}`)
    continue
  }

  if (warning) console.warn(`${check.label}: ${warning}`)
  else console.log(`${check.label}: ${count ?? 0}`)
  if ((count ?? 0) > 0 && check.label !== 'decision board fixture enrichment rows' && !check.label.startsWith('enrichment table ')) failed = true
}

if (failed) {
  process.exit(1)
}

console.log('match_analysis integrity checks passed')

async function probeRestAccess() {
  const { error } = await supabase.from('match_analysis').select('id').limit(1)
  return {
    available: !error,
    error,
  }
}

async function runLinkedCliVerification() {
  const sql = `
    with base as (
      select
        ma.*,
        (fm.kickoff_at at time zone 'Asia/Bangkok')::date as match_day
      from public.match_analysis ma
      left join public.football_matches fm on fm.id = ma.match_id
    ),
    duplicate_final_pick_days as (
      select match_day
      from base
      where is_final_pick is true
      group by match_day
      having count(*) > 1
    ),
    duplicate_rank_days as (
      select match_day, final_rank
      from base
      where is_top_pick is true and final_rank is not null
      group by match_day, final_rank
      having count(*) > 1
    ),
    enrichment_tables(name) as (
      values
        ('api_football_league_coverage'),
        ('api_football_fixture_statistics'),
        ('api_football_fixture_events'),
        ('api_football_fixture_lineups'),
        ('api_football_fixture_players'),
        ('api_football_injuries'),
        ('api_football_squads'),
        ('api_football_coaches'),
        ('api_football_venues'),
        ('api_football_top_players'),
        ('api_football_rounds'),
        ('api_football_enrichment_sync_log'),
        ('api_football_daily_sync_runs'),
        ('api_football_daily_sync_steps')
    )
    select
      count(*) filter (where analysis_summary is null) as "null analysis_summary",
      count(*) filter (where confidence_score is null) as "null confidence_score",
      count(*) filter (where recommendation is null) as "null recommendation",
      count(*) filter (where risk_level is null) as "null risk_level",
      count(*) filter (where home_advantage_score is null) as "null home_advantage_score",
      count(*) filter (where away_weakness_score is null) as "null away_weakness_score",
      count(*) filter (where goal_scoring_score is null) as "null goal_scoring_score",
      count(*) filter (where defensive_stability_score is null) as "null defensive_stability_score",
      count(*) filter (where market_risk_score is null) as "null market_risk_score",
      count(*) filter (where recommendation is not null and recommendation not in ('BET', 'LEAN', 'WATCH', 'NO BET')) as "invalid recommendation",
      count(*) filter (where risk_level is not null and risk_level not in ('LOW', 'MEDIUM', 'HIGH')) as "invalid risk_level",
      count(*) filter (where pick_side is not null and pick_side not in ('HOME', 'AWAY', 'DRAW', 'NONE')) as "invalid pick_side",
      count(*) filter (where pick_side in ('HOME', 'AWAY', 'DRAW') and pick_reason is null) as "missing pick_reason for selected side",
      count(*) filter (where pick_side = 'NONE' and pick_team is not null) as "pick_side NONE with pick_team",
      count(*) filter (where value_status is not null and value_status not in ('YES', 'NO', 'WAITING_DATA', 'NOT_APPLICABLE')) as "invalid value_status",
      count(*) filter (where value_status = 'YES' and market_line is null) as "value YES with missing market_line",
      count(*) filter (where value_status = 'YES' and fair_line is null) as "value YES with missing fair_line",
      count(*) filter (where value_status = 'YES' and recommendation = 'NO BET') as "value YES on NO BET",
      count(*) filter (where value_status = 'YES' and pick_side = 'NONE') as "value YES with pick_side NONE",
      count(*) filter (where data_validation_status is not null and data_validation_status not in ('VALID', 'PARTIAL', 'INVALID')) as "invalid data_validation_status",
      count(*) filter (where confidence_score < 0 or confidence_score > 100) as "invalid confidence_score range",
      count(*) filter (where ranking_score is not null and (ranking_score < 0 or ranking_score > 100)) as "invalid ranking_score range",
      count(*) filter (where is_top_pick is true and data_validation_status = 'INVALID') as "top pick marked INVALID",
      count(*) filter (where is_top_pick is true and recommendation not in ('BET', 'LEAN', 'WATCH', 'NO BET')) as "invalid top pick recommendation",
      (select count(*) from duplicate_final_pick_days) as "duplicate final pick per day",
      (select count(*) from duplicate_rank_days) as "duplicate final_rank per day",
      count(*) filter (where is_top_pick is true and final_rank < 1) as "decision rank below 1",
      (select count(*) from enrichment_tables where to_regclass('public.' || name) is null) as "missing enrichment tables"
    from base;
  `

  const sqlPath = path.join(tmpdir(), `verify-analysis-${randomUUID()}.sql`)
  try {
    await writeFile(sqlPath, sql)
    const { stdout } = await execAsync(`npx supabase db query --linked --output json --file "${sqlPath}"`, {
      maxBuffer: 1024 * 1024 * 4,
    })
    const payload = parseSupabaseCliJson(stdout)
    const row = payload.rows?.[0] ?? {}
    let failedCliCheck = false

    for (const [label, rawCount] of Object.entries(row)) {
      const count = Number(rawCount ?? 0)
      console.log(`${label}: ${count}`)
      if (count > 0) failedCliCheck = true
    }

    for (const check of [checkFrontendEmptyEnrichment, checkFootballEnrichmentKeywordScan, checkDailySyncModesPresent, checkDailySyncDocs, checkDailySyncRetryMigration, checkMarketReadyDefaultAnalysis]) {
      const { count, warning } = await check()
      const label = check.name.replace(/^check/, '')
      if (warning) console.warn(`${label}: ${warning}`)
      else console.log(`${label}: ${count ?? 0}`)
      if ((count ?? 0) > 0) failedCliCheck = true
    }

    if (!failedCliCheck) console.log('match_analysis integrity checks passed')
    return !failedCliCheck
  } catch (error) {
    console.error(`linked Supabase CLI verification failed - ${error.message}`)
    return false
  } finally {
    await unlink(sqlPath).catch(() => {})
  }
}

function parseSupabaseCliJson(output) {
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Supabase CLI did not return JSON output')
  }
  return JSON.parse(output.slice(start, end + 1))
}

function isOptionalV2Missing(error) {
  const message = String(error?.message ?? error?.details ?? '')
  return (
    error?.code === '42703' ||
    error?.code === 'PGRST200' ||
    error?.code === 'PGRST205' ||
    /column .* does not exist/i.test(message) ||
    /Could not find .* column/i.test(message) ||
    /Could not find the table .* in the schema cache/i.test(message) ||
    /relationship .* could not be found/i.test(message)
  )
}

function isRestSchemaMissing(error) {
  if (!error) return false
  const message = String(error.message ?? error.details ?? '')
  return error.code === 'PGRST205' || /Could not find the table .* in the schema cache/i.test(message)
}

function isBlankOptionalProfessionalError(error) {
  return error && String(error.message ?? '') === '' && !error.code
}

async function fetchKickoffByMatchId(rows) {
  const ids = [...new Set((rows ?? []).map((row) => row.match_id).filter(Boolean))]
  const map = new Map()
  if (!ids.length) return { map }

  const { data, error } = await supabase
    .from('football_matches')
    .select('id, kickoff_at')
    .in('id', ids)

  if (error) return { error, map }

  for (const match of data ?? []) {
    map.set(match.id, match.kickoff_at)
  }

  return { map }
}

async function checkTopFixtureEnrichment() {
  const { data: matches, error } = await supabase
    .from('match_analysis')
    .select('match_id, final_rank, is_top_pick, football_matches(api_sports_fixture_id)')
    .eq('is_top_pick', true)
    .not('final_rank', 'is', null)
    .order('final_rank', { ascending: true })
    .limit(10)
  if (error) return { error }

  const fixtureIds = (matches ?? [])
    .map((item) => item.football_matches?.api_sports_fixture_id)
    .filter(Boolean)
  if (!fixtureIds.length) return { count: 0, warning: 'no decision board API-FOOTBALL fixtures available yet' }

  const tables = ['api_football_fixture_statistics', 'api_football_fixture_events', 'api_football_fixture_lineups', 'api_football_fixture_players']
  let enrichedRows = 0
  for (const table of tables) {
    const { count, error: tableError } = await supabase.from(table).select('id', { count: 'exact', head: true }).in('api_fixture_id', fixtureIds)
    if (tableError) {
      if (isOptionalV2Missing(tableError)) return { count: 0, warning: tableError.message }
      return { error: tableError }
    }
    enrichedRows += count ?? 0
  }
  return enrichedRows > 0 ? { count: 0 } : { count: 0, warning: 'decision board exists, but enrichment rows are still empty' }
}

async function checkTodayDataCoverage() {
  const { startUtc, endUtc, dateKey } = getBangkokDayRange()
  const { data: matches, error } = await supabase
    .from('football_matches')
    .select('id, odds_updated_at, enrichment_status, data_readiness_status, has_market_data, has_fixture_detail, analysis:match_analysis(recommendation, confidence_score, ranking_score, analysis_status, market_data_used, raw)')
    .gte('kickoff_at', startUtc)
    .lt('kickoff_at', endUtc)
  if (error) {
    if (isOptionalV2Missing(error)) return checkTodayDataCoverageLegacy(startUtc, endUtc, dateKey)
    return { error }
  }

  const matchIds = (matches ?? []).map((row) => row.id).filter(Boolean)
  const oddsRows = matchIds.length
    ? await supabase.from('football_match_odds').select('id', { count: 'exact', head: true }).in('match_id', matchIds)
    : { count: 0, error: null }
  if (oddsRows.error) {
    if (isOptionalV2Missing(oddsRows.error)) return { count: 0, warning: oddsRows.error.message }
    return { error: oddsRows.error }
  }

  const coverageSummary = buildVerifyCoverageSummary(matches ?? [], oddsRows.count ?? 0)
  const allNoBet = (matches ?? []).length > 0 && Object.keys(coverageSummary.recommendation).every((key) => ['NO BET', 'NO_ANALYSIS'].includes(key))
  const warning = allNoBet && Number(oddsRows.count ?? 0) === 0
    ? `coverage issue on ${dateKey}: ${formatVerifyCoverageSummary(coverageSummary)}; this is a data coverage issue, not a model issue`
    : `coverage ${dateKey}: ${formatVerifyCoverageSummary(coverageSummary)}`
  return { count: 0, warning }
}

async function checkTodayDataCoverageLegacy(startUtc, endUtc, dateKey) {
  const { data: matches, error } = await supabase
    .from('football_matches')
    .select('id, odds_updated_at, enrichment_status, data_readiness_status, analysis:match_analysis(recommendation, confidence_score, ranking_score, raw)')
    .gte('kickoff_at', startUtc)
    .lt('kickoff_at', endUtc)
  if (error) {
    if (isOptionalV2Missing(error)) return { count: 0, warning: error.message }
    return { error }
  }
  const matchIds = (matches ?? []).map((row) => row.id).filter(Boolean)
  const oddsRows = matchIds.length
    ? await supabase.from('football_match_odds').select('id', { count: 'exact', head: true }).in('match_id', matchIds)
    : { count: 0, error: null }
  if (oddsRows.error) {
    if (isOptionalV2Missing(oddsRows.error)) return { count: 0, warning: oddsRows.error.message }
    return { error: oddsRows.error }
  }
  return { count: 0, warning: `coverage ${dateKey}: ${formatVerifyCoverageSummary(buildVerifyCoverageSummary(matches ?? [], oddsRows.count ?? 0))}` }
}

function buildVerifyCoverageSummary(matches, oddsRowsCount) {
  const readiness = countBy(matches ?? [], (row) => row.data_readiness_status ?? 'UNKNOWN')
  const recommendation = countBy(matches ?? [], (row) => {
    const analysis = Array.isArray(row.analysis) ? row.analysis[0] : row.analysis
    return analysis?.recommendation ?? 'NO_ANALYSIS'
  })
  const oddsUpdatedNull = (matches ?? []).filter((row) => !row.odds_updated_at).length
  let marketDataUsed = 0
  let insufficientMarketData = 0
  let defaultAnalysisRemaining = 0
  for (const match of matches ?? []) {
    const analysis = Array.isArray(match.analysis) ? match.analysis[0] : match.analysis
    if (analysis?.market_data_used || analysis?.raw?.market_data_used) marketDataUsed += 1
    const readinessStatus = String(match.data_readiness_status ?? '').toUpperCase()
    if (!Boolean(analysis?.market_data_used || analysis?.raw?.market_data_used) && readinessStatus === 'NO_MARKET_DATA') insufficientMarketData += 1
    if (Boolean(match.has_market_data || match.odds_updated_at) && analysisAppearsDefault(analysis)) defaultAnalysisRemaining += 1
  }
  return {
    fixtures: matches.length,
    oddsRows: Number(oddsRowsCount ?? 0),
    oddsUpdatedNull,
    readiness,
    recommendation,
    marketDataUsed,
    insufficientMarketData,
    defaultAnalysisRemaining,
  }
}

function formatVerifyCoverageSummary(summary) {
  return `fixtures=${summary.fixtures}, oddsRows=${summary.oddsRows}, oddsUpdatedAtNull=${summary.oddsUpdatedNull}, readiness=${JSON.stringify(summary.readiness)}, recommendation=${JSON.stringify(summary.recommendation)}, marketDataUsed=${summary.marketDataUsed}, insufficientMarketData=${summary.insufficientMarketData}, defaultAnalysisRemaining=${summary.defaultAnalysisRemaining}`
}

async function checkMarketReadyDefaultAnalysis() {
  const { startUtc, endUtc } = getBangkokDayRange()
  const { data: matches, error } = await supabase
    .from('football_matches')
    .select('id, has_market_data, odds_updated_at, data_readiness_status, analysis:match_analysis(confidence_score, ranking_score)')
    .gte('kickoff_at', startUtc)
    .lt('kickoff_at', endUtc)

  if (error) {
    if (isOptionalV2Missing(error)) return { count: 0, warning: error.message }
    return { error }
  }

  const matchIds = (matches ?? []).map((row) => row.id).filter(Boolean)
  const { data: oddsRows, error: oddsError } = matchIds.length
    ? await supabase.from('football_match_odds').select('match_id').in('match_id', matchIds)
    : { data: [], error: null }
  if (oddsError) {
    if (isOptionalV2Missing(oddsError)) return { count: 0, warning: oddsError.message }
    return { error: oddsError }
  }

  const oddsMatchIds = new Set((oddsRows ?? []).map((row) => row.match_id).filter(Boolean))
  const stale = (matches ?? []).filter((match) => {
    const analysis = Array.isArray(match.analysis) ? match.analysis[0] : match.analysis
    const hasMarket = Boolean(match.has_market_data || match.odds_updated_at || oddsMatchIds.has(match.id))
    return hasMarket && analysisAppearsDefault(analysis)
  })

  if (!stale.length) return { count: 0 }
  return {
    count: 0,
    warning: `Market data exists but analysis appears stale/default: ${stale.length} matches`,
  }
}

async function checkFriendlyYouthLowDataBet() {
  const { data, error } = await supabase
    .from('match_analysis')
    .select('id, match_id, recommendation, data_quality_score, league_quality_score, raw')
    .eq('recommendation', 'BET')
  if (error) return { error }

  const matchIds = [...new Set((data ?? []).map((row) => row.match_id).filter(Boolean))]
  const { data: matches, error: matchError } = matchIds.length
    ? await supabase
      .from('football_matches')
      .select('id, league:football_leagues(name, country)')
      .in('id', matchIds)
    : { data: [], error: null }
  if (matchError) return { error: matchError }

  const leagueByMatchId = new Map((matches ?? []).map((match) => [match.id, match.league ?? {}]))
  const riskyRows = (data ?? []).filter((row) => {
    const league = leagueByMatchId.get(row.match_id) ?? {}
    const text = [
      league?.name,
      league?.country,
      row.raw?.league?.name,
      row.raw?.competition?.name,
      row.raw?.professional_pipeline?.pipelineStage,
    ].filter(Boolean).join(' ').toLowerCase()
    const lowTrust = /friendly|test|youth|u17|u18|u19|u20|u21|u23|reserve|amateur/.test(text)
    const dataQuality = Number(row.data_quality_score ?? row.raw?.professional_pipeline?.scores?.dataQuality ?? 0)
    const leagueQuality = Number(row.league_quality_score ?? row.raw?.professional_pipeline?.scores?.leagueQuality ?? 0)
    return lowTrust && (dataQuality < 60 || leagueQuality < 55)
  })

  return { count: riskyRows.length }
}

async function checkProfessionalPipelineJsonArrays() {
  const { data, error } = await fetchAllRows((from, to) => supabase
    .from('match_analysis')
    .select('id, pipeline_reasons, pipeline_warnings, raw')
    .range(from, to))
  if (error) return { error }

  const invalid = (data ?? []).filter((row) => {
    const reasons = row.pipeline_reasons ?? row.raw?.professional_pipeline?.reasons ?? []
    const warnings = row.pipeline_warnings ?? row.raw?.professional_pipeline?.warnings ?? []
    return !Array.isArray(reasons) || !Array.isArray(warnings)
  })

  return { count: invalid.length }
}

async function checkDailyTop10LockedProfessionalScore() {
  const { data: locks, error: lockError } = await fetchAllRows((from, to) => supabase
    .from('daily_top10_selections')
    .select('match_id')
    .not('match_id', 'is', null)
    .range(from, to))
  if (lockError) {
    if (isOptionalV2Missing(lockError)) return { count: 0, warning: lockError.message }
    return { error: lockError }
  }

  const matchIds = [...new Set((locks ?? []).map((row) => row.match_id).filter(Boolean))]
  if (!matchIds.length) return { count: 0 }

  const { data: analysisRows, error } = await supabase
    .from('match_analysis')
    .select('match_id, professional_score')
    .in('match_id', matchIds)
  if (error) return { error }

  const byMatchId = new Map((analysisRows ?? []).map((row) => [row.match_id, row]))
  const missing = matchIds.filter((matchId) => !byMatchId.get(matchId)?.professional_score && byMatchId.get(matchId)?.professional_score !== 0)
  return { count: missing.length }
}

async function fetchAllRows(queryPage, pageSize = 1000) {
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await queryPage(from, from + pageSize - 1)
    if (error) return { data: rows, error }
    rows.push(...(data ?? []))
    if (!data || data.length < pageSize) break
  }
  return { data: rows, error: null }
}

function analysisAppearsDefault(analysis) {
  const confidence = Number(analysis?.confidence_score)
  const ranking = Number(analysis?.ranking_score)
  return Number.isFinite(confidence) &&
    Number.isFinite(ranking) &&
    Math.abs(confidence - 59.1) <= 0.2 &&
    Math.abs(ranking - 54.8) <= 0.2
}

function countBy(rows, getKey) {
  return rows.reduce((acc, row) => {
    const key = getKey(row)
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
}

async function checkFrontendEmptyEnrichment() {
  const { normalizeFootballEnrichment } = await import('../src/utils/matchDetail.js')
  const normalized = normalizeFootballEnrichment({ enrichment: {} })
  const ok = Array.isArray(normalized.statistics) && Array.isArray(normalized.coverageItems) && normalized.coverageItems.length >= 7
  return { count: ok ? 0 : 1 }
}

async function checkFootballEnrichmentKeywordScan() {
  const files = [
    'supabase/migrations/20260630_add_api_football_enrichment_tables.sql',
    'supabase/migrations/20260703_add_daily_sync_orchestrator.sql',
    'src/repositories/matchesRepository.js',
  ]
  const banned = /\b(betting tips|betting recommendations|stake|bankroll|profit|ROI)\b|เดิมพัน|แทง/i
  for (const file of files) {
    const text = await readFile(file, 'utf8')
    if (banned.test(text)) return { count: 1, warning: `banned market keyword found in ${file}` }
  }
  const edgeText = await readFile('supabase/functions/sync-football-data/index.ts', 'utf8')
  const enrichmentLines = edgeText
    .split('\n')
    .filter((line) => /api_football_|footballEnrichment|daily-sync|dailySync|top-players|fixture-enrich|coverage|rounds|squads|coaches|venues/.test(line))
    .join('\n')
  return { count: banned.test(enrichmentLines) ? 1 : 0 }
}

async function checkDailySyncModesPresent() {
  const text = await readFile('supabase/functions/sync-football-data/index.ts', 'utf8')
  const required = ['daily-sync-start', 'daily-sync-phase', 'daily-sync-status', 'daily-sync-next', 'daily-full-sync-safe', 'daily-sync-auto']
  const missing = required.filter((mode) => !text.includes(mode))
  return missing.length ? { count: 1, warning: `missing modes: ${missing.join(', ')}` } : { count: 0 }
}

async function checkDailySyncDocs() {
  const text = await readFile('docs/admin-daily-sync-orchestrator.md', 'utf8').catch((error) => `missing:${error.message}`)
  const required = ['WORKER_RESOURCE_LIMIT', 'daily-sync-start', 'daily-sync-next', 'daily-sync-status', 'daily-sync-phase', 'daily-sync-auto', 'curl', '%SERVICE_KEY%', 'maxStepsPerRequest', 'progressPercent', 'pending_retry', 'finalSummary']
  const missing = required.filter((item) => !text.includes(item))
  return missing.length ? { count: 1, warning: `daily sync docs missing: ${missing.join(', ')}` } : { count: 0 }
}

async function checkDailySyncRetryMigration() {
  const text = await readFile('supabase/migrations/20260704_upgrade_daily_sync_orchestrator.sql', 'utf8').catch((error) => `missing:${error.message}`)
  const required = ['attempt_count', 'max_attempts', 'last_attempt_at', 'next_retry_at', 'pending_retry']
  const missing = required.filter((item) => !text.includes(item))
  return missing.length ? { count: 1, warning: `daily sync retry migration missing: ${missing.join(', ')}` } : { count: 0 }
}
