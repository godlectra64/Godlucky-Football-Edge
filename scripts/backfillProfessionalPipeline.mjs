import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import {
  buildProfessionalSelectionScore,
  professionalPipelineVersion,
} from '../src/utils/professionalSelectionPipeline.js'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, or SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)
const pageSize = Number(process.env.PROFESSIONAL_BACKFILL_PAGE_SIZE ?? 100)
const maxRows = Number(process.env.PROFESSIONAL_BACKFILL_LIMIT ?? 0)
const dryRun = process.argv.includes('--dry-run') || process.env.PROFESSIONAL_BACKFILL_DRY_RUN === '1'

const analysisSelect = 'id, match_id, team_strength_score, form_score, home_advantage_score, away_weakness_score, goal_scoring_score, defensive_stability_score, motivation_score, market_risk_score, confidence_score, calibrated_confidence_score, recommendation, risk_level, league_quality_score, match_quality_score, tactical_matchup_score, market_reading_score, home_away_score, risk_score, edge_score, ai_score, ranking_score, market_edge_score, odds_confidence_score, odds_movement_score, data_depth_score, value_market, value_side, value_line, market_type, market_line, value_status, professional_score, data_quality_score, market_quality_score, statistical_edge_score, tactical_edge_score, risk_control_score, value_edge_score, pipeline_stage, pipeline_reasons, pipeline_warnings, raw, updated_at'

const matchSelect = 'id, api_sports_fixture_id, api_sports_league_id, api_sports_home_team_id, api_sports_away_team_id, kickoff_at, status, status_short, has_market_data, has_fixture_detail, data_readiness_status, raw, league:football_leagues(id, api_league_id, name, country, priority), homeTeam:football_teams!football_matches_home_team_id_fkey(id, api_team_id, name, country), awayTeam:football_teams!football_matches_away_team_id_fkey(id, api_team_id, name, country)'

let scanned = 0
let updated = 0
let skipped = 0
let failed = 0

await assertProfessionalColumnsAvailable()

while (true) {
  const { data: rows, error } = await supabase
    .from('match_analysis')
    .select(analysisSelect)
    .or([
      'professional_score.is.null',
      'data_quality_score.is.null',
      'market_quality_score.is.null',
      'statistical_edge_score.is.null',
      'tactical_edge_score.is.null',
      'motivation_score.is.null',
      'risk_control_score.is.null',
      'value_edge_score.is.null',
      'pipeline_stage.is.null',
      'pipeline_reasons.is.null',
      'pipeline_warnings.is.null',
    ].join(','))
    .order('updated_at', { ascending: false, nullsFirst: false })
    .range(0, pageSize - 1)

  if (error) {
    console.error(`Failed to fetch match_analysis rows: ${error.message}`)
    process.exit(1)
  }

  const batch = rows ?? []
  if (!batch.length) break
  const limitedBatch = maxRows > 0 ? batch.slice(0, Math.max(0, maxRows - scanned)) : batch
  if (!limitedBatch.length) break

  const matchIds = [...new Set(limitedBatch.map((row) => row.match_id).filter(Boolean))]
  const [matchesById, oddsByMatchId] = await Promise.all([
    fetchMatchesById(matchIds),
    fetchOddsByMatchId(matchIds),
  ])

  let batchUpdated = 0
  for (const row of limitedBatch) {
    scanned += 1
    const match = buildMatchInput(row, matchesById.get(row.match_id), oddsByMatchId.get(row.match_id) ?? [])
    const professional = buildProfessionalSelectionScore(match)
    const payload = buildProfessionalPayload(row, professional)

    if (dryRun) {
      updated += 1
      batchUpdated += 1
      continue
    }

    const { error: updateError } = await supabase
      .from('match_analysis')
      .update(payload)
      .eq('id', row.id)

    if (updateError) {
      failed += 1
      console.error(`Failed to update match_analysis ${row.id}: ${updateError.message}`)
      continue
    }

    updated += 1
    batchUpdated += 1
  }

  if (dryRun) break
  if (batchUpdated === 0 && failed > 0) break
  if (maxRows > 0 && scanned >= maxRows) break
  if (batch.length < pageSize) break
}

const remaining = await countRemainingMissing()
console.log(`professional pipeline backfill complete: scanned=${scanned}, updated=${updated}, skipped=${skipped}, failed=${failed}, remaining=${remaining}, dryRun=${dryRun}`)

if (failed > 0 || remaining > 0) process.exit(1)

async function assertProfessionalColumnsAvailable() {
  const { error } = await supabase
    .from('match_analysis')
    .select('id, professional_score, pipeline_stage, pipeline_reasons, pipeline_warnings')
    .limit(1)
  if (error) {
    console.error(`Professional pipeline columns are not queryable yet: ${error.message || JSON.stringify(error)}`)
    process.exit(1)
  }
}

async function fetchMatchesById(matchIds) {
  if (!matchIds.length) return new Map()
  const { data, error } = await supabase
    .from('football_matches')
    .select(matchSelect)
    .in('id', matchIds)
  if (error) {
    console.error(`Failed to fetch football_matches: ${error.message}`)
    process.exit(1)
  }
  return new Map((data ?? []).map((match) => [match.id, match]))
}

async function fetchOddsByMatchId(matchIds) {
  if (!matchIds.length) return new Map()
  const { data, error } = await supabase
    .from('football_match_odds')
    .select('*')
    .in('match_id', matchIds)
    .order('is_latest', { ascending: false })
    .order('snapshot_at', { ascending: false })
  if (error) {
    console.warn(`Odds fetch skipped: ${error.message}`)
    return new Map()
  }
  return groupBy(data ?? [], (row) => row.match_id)
}

async function countRemainingMissing() {
  const { count, error } = await supabase
    .from('match_analysis')
    .select('id', { count: 'exact', head: true })
    .or([
      'professional_score.is.null',
      'data_quality_score.is.null',
      'market_quality_score.is.null',
      'statistical_edge_score.is.null',
      'tactical_edge_score.is.null',
      'motivation_score.is.null',
      'risk_control_score.is.null',
      'value_edge_score.is.null',
      'pipeline_stage.is.null',
      'pipeline_reasons.is.null',
      'pipeline_warnings.is.null',
    ].join(','))
  if (error) {
    console.error(`Failed to count remaining missing rows: ${error.message}`)
    process.exit(1)
  }
  return count ?? 0
}

function buildMatchInput(analysisRow, matchRow = {}, oddsRows = []) {
  const rawAnalysis = analysisRow.raw && typeof analysisRow.raw === 'object' ? analysisRow.raw : {}
  const rawMatch = matchRow?.raw && typeof matchRow.raw === 'object' ? matchRow.raw : {}
  const analysis = {
    ...rawAnalysis,
    ...analysisRow,
    raw: rawAnalysis,
  }
  return {
    ...rawMatch,
    id: matchRow?.id ?? analysisRow.match_id,
    match_id: analysisRow.match_id,
    kickoffAt: matchRow?.kickoff_at ?? rawMatch.kickoffAt ?? rawMatch.utcDate,
    kickoff_at: matchRow?.kickoff_at,
    status: matchRow?.status ?? matchRow?.status_short ?? rawMatch.status,
    league: {
      ...(rawMatch.league ?? {}),
      id: rawMatch.league?.id ?? matchRow?.league?.api_league_id ?? matchRow?.api_sports_league_id,
      api_league_id: matchRow?.league?.api_league_id ?? matchRow?.api_sports_league_id,
      name: rawMatch.league?.name ?? rawMatch.competition?.name ?? matchRow?.league?.name,
      country: rawMatch.league?.country ?? rawMatch.competition?.country ?? matchRow?.league?.country,
    },
    competition: {
      ...(rawMatch.competition ?? {}),
      id: rawMatch.competition?.id ?? matchRow?.league?.api_league_id ?? matchRow?.api_sports_league_id,
      api_league_id: matchRow?.league?.api_league_id ?? matchRow?.api_sports_league_id,
      name: rawMatch.competition?.name ?? matchRow?.league?.name,
      country: rawMatch.competition?.country ?? matchRow?.league?.country,
    },
    homeTeam: rawMatch.homeTeam ?? {
      id: matchRow?.homeTeam?.id ?? matchRow?.api_sports_home_team_id,
      api_team_id: matchRow?.homeTeam?.api_team_id ?? matchRow?.api_sports_home_team_id,
      name: matchRow?.homeTeam?.name,
      country: matchRow?.homeTeam?.country,
    },
    awayTeam: rawMatch.awayTeam ?? {
      id: matchRow?.awayTeam?.id ?? matchRow?.api_sports_away_team_id,
      api_team_id: matchRow?.awayTeam?.api_team_id ?? matchRow?.api_sports_away_team_id,
      name: matchRow?.awayTeam?.name,
      country: matchRow?.awayTeam?.country,
    },
    homeForm: rawAnalysis.homeForm ?? rawAnalysis.home_form ?? rawMatch.homeForm,
    awayForm: rawAnalysis.awayForm ?? rawAnalysis.away_form ?? rawMatch.awayForm,
    standings: rawAnalysis.standings ?? rawMatch.standings ?? [],
    h2h: rawAnalysis.h2h ?? rawAnalysis.h2hMatches ?? rawMatch.h2h,
    recentMatches: rawAnalysis.recentMatches ?? rawMatch.recentMatches,
    homeStats: rawAnalysis.homeStats ?? rawMatch.homeStats,
    awayStats: rawAnalysis.awayStats ?? rawMatch.awayStats,
    odds: oddsRows,
    analysis,
    raw: {
      ...rawMatch,
      ...rawAnalysis,
    },
  }
}

function buildProfessionalPayload(row, professional) {
  const raw = row.raw && typeof row.raw === 'object' ? row.raw : {}
  const reasons = Array.isArray(professional.reasons) ? professional.reasons : []
  const warnings = Array.isArray(professional.warnings) ? professional.warnings : []
  const pipelineStage = professional.pipelineStage || (professional.scores?.dataQuality < 35 ? 'NO_DATA' : 'WATCH')
  return {
    professional_score: scoreValue(professional.totalScore),
    data_quality_score: scoreValue(professional.scores.dataQuality),
    market_quality_score: scoreValue(professional.scores.marketQuality),
    statistical_edge_score: scoreValue(professional.scores.statisticalEdge),
    tactical_edge_score: scoreValue(professional.scores.tacticalEdge),
    motivation_score: scoreValue(professional.scores.motivation),
    risk_control_score: scoreValue(professional.scores.riskControl),
    value_edge_score: scoreValue(professional.scores.valueEdge),
    pipeline_stage: pipelineStage,
    pipeline_reasons: reasons,
    pipeline_warnings: warnings,
    raw: {
      ...raw,
      professional_pipeline: {
        ...professional,
        pipelineStage,
        version: professionalPipelineVersion,
      },
      professional_pipeline_backfilled_at: new Date().toISOString(),
    },
  }
}

function scoreValue(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.round(Math.max(0, Math.min(100, numeric)) * 10) / 10 : 0
}

function groupBy(rows, getKey) {
  const map = new Map()
  for (const row of rows) {
    const key = getKey(row)
    if (!key) continue
    const group = map.get(key) ?? []
    group.push(row)
    map.set(key, group)
  }
  return map
}
