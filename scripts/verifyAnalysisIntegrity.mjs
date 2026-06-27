import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, or SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

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
    query: () => supabase.from('match_analysis').select('id', { count: 'exact', head: true }).not('recommendation', 'in', '("BET","LEAN","NO BET")'),
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

if (failed) {
  process.exit(1)
}

console.log('match_analysis integrity checks passed')
