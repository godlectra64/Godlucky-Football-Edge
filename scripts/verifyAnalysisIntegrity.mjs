import { exec } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { writeFile, unlink } from 'node:fs/promises'
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
    label: 'top pick final_rank outside 1-10',
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).eq('is_top_pick', true).or('final_rank.lt.1,final_rank.gt.10'),
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
      count(*) filter (where is_top_pick is true and (final_rank < 1 or final_rank > 10)) as "top pick final_rank outside 1-10"
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
