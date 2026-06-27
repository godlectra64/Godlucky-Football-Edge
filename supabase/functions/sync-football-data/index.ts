import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const priorityLeagues = new Map<string, number>([
  ['UEFA Champions League', 8],
  ['Champions League', 8],
  ['Premier League', 10],
  ['Primera Division', 12],
  ['La Liga', 12],
  ['Serie A', 14],
  ['Bundesliga', 16],
  ['Ligue 1', 18],
  ['UEFA Europa League', 20],
  ['Europa League', 20],
])

const BASE_URL = sanitizeUrl(Deno.env.get('FOOTBALL_API_BASE_URL') ?? 'https://api.football-data.org/v4')
const TOKEN = sanitizeHeaderValue(Deno.env.get('FOOTBALL_API_KEY') ?? '')
const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const secretKeys = parseSupabaseSecretKeys(Deno.env.get('SUPABASE_SECRET_KEYS'))

const supabase = createClient(supabaseUrl, serviceRoleKey)

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const startedAt = new Date().toISOString()
  let logId: string | null = null

  try {
    assertRuntimeConfig()
    const authError = getServiceAuthError(request)
    if (authError) return authError

    const body = await safeJson(request)
    const { dateFrom, dateTo } = getSyncDateRange(body)
    const syncType = body.mode ?? 'manual-football-data'

    const log = await supabase
      .from('sync_logs')
      .insert({
        sync_type: syncType,
        status: 'running',
        message: `football-data.org sync ${dateFrom} to ${dateTo}`,
        started_at: startedAt,
        raw: { provider: 'football-data.org', dateFrom, dateTo },
      })
      .select('id')
      .single()

    if (log.error) throw log.error
    logId = log.data.id

    if (body.resetToday) {
      await resetMatchesForRange(dateFrom, dateTo)
    }

    const competitions = await fetchCompetitions()
    await upsertCompetitions(competitions)

    const matches = await fetchFixturesByRange(dateFrom, dateTo)
    let processed = 0
    const processedMatchIds: Array<string> = []
    const failures: Array<{ matchId?: number; message: string }> = []

    for (const footballDataMatch of matches) {
      try {
        const synced = await syncMatch(footballDataMatch)
        if (synced?.matchId) processedMatchIds.push(synced.matchId)
        processed += 1
      } catch (error) {
        failures.push({
          matchId: footballDataMatch?.id,
          message: error instanceof Error ? error.message : 'match sync failed',
        })
      }
    }

    const recomputeResult = await recomputeProcessedAnalysisRows(processedMatchIds)
    const recomputedStoredRows = body.recomputeStoredAnalysisRows ? await recomputeStoredAnalysisRows(Number(body.recomputeStoredLimit ?? 50)) : 0
    const normalizedAnalysisRows = await normalizeLegacyAnalysisRows()
    const updatedAnalysisCount = recomputeResult.updated + recomputedStoredRows
    const invalidRowsFixed = normalizedAnalysisRows.fixed
    const allFailures = [...failures, ...recomputeResult.failures]
    const total = matches.length
    const status = allFailures.length ? 'partial_success' : 'success'
    const message = total === 0
      ? 'ไม่พบคู่แข่งขันวันนี้และพรุ่งนี้'
      : allFailures.length
      ? `บันทึกข้อมูล ${processed} คู่ อัปเดตวิเคราะห์ ${updatedAnalysisCount} รายการ แก้ข้อมูลผิด ${invalidRowsFixed} รายการ และมีข้อผิดพลาด ${allFailures.length} รายการ`
      : `บันทึกข้อมูล ${processed} คู่ และอัปเดตวิเคราะห์ ${updatedAnalysisCount} รายการ`

    await finishLog(logId, status, message, {
      provider: 'football-data.org',
      dateFrom,
      dateTo,
      competitions: competitions.length,
      total,
      processed,
      updatedAnalysisCount,
      invalidRowsFixed,
      recomputedStoredRows,
      normalizedAnalysisRows: normalizedAnalysisRows.checked,
      failures: allFailures,
    })

    return json({
      ok: true,
      provider: 'football-data.org',
      dateFrom,
      dateTo,
      processed,
      total,
      updatedAnalysisCount,
      invalidRowsFixed,
      recomputedStoredRows,
      normalizedAnalysisRows: normalizedAnalysisRows.checked,
      failures: allFailures,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'sync failed'
    await finishLog(logId, 'failed', message, { provider: 'football-data.org', error: serializeError(error) })
    return json({ ok: false, provider: 'football-data.org', message }, 500)
  }
})

async function syncMatch(match: any) {
  const league = await upsertLeague(match.competition, match.area)
  const homeTeam = await upsertTeam(match.homeTeam, match.area?.name)
  const awayTeam = await upsertTeam(match.awayTeam, match.area?.name)

  const matchResult = await supabase
    .from('football_matches')
    .upsert(
      {
        api_fixture_id: match.id,
        league_id: league.id,
        home_team_id: homeTeam.id,
        away_team_id: awayTeam.id,
        kickoff_at: match.utcDate,
        status: match.status,
        venue: null,
        round: formatRound(match),
        home_goals: match.score?.fullTime?.home ?? null,
        away_goals: match.score?.fullTime?.away ?? null,
        raw: match,
      },
      { onConflict: 'api_fixture_id' },
    )
    .select('id')
    .single()

  if (matchResult.error) throw matchResult.error

  const [standings, homeLast, awayLast] = await Promise.all([
    fetchStandings(match.competition?.id),
    fetchTeamLastMatches(match.homeTeam?.id, 5),
    fetchTeamLastMatches(match.awayTeam?.id, 5),
  ])

  const homeForm = summarizeRecentForm(homeLast, match.homeTeam?.id)
  const awayForm = summarizeRecentForm(awayLast, match.awayTeam?.id)

  await Promise.all([
    upsertRecentForm(homeTeam.id, homeForm, homeLast),
    upsertRecentForm(awayTeam.id, awayForm, awayLast),
  ])

  const analysis = analyzeMatch({
    match,
    homeForm,
    awayForm,
    standings,
    leaguePriority: league.priority,
    recentMatches: { home: homeLast, away: awayLast },
    recentOpponents: { home: homeLast, away: awayLast },
  })

  await upsertMatchAnalysis(matchResult.data.id, analysis)
  await recordAiPerformance(matchResult.data.id, {
    match,
    league,
    homeTeam,
    awayTeam,
    analysis,
  })

  return { matchId: matchResult.data.id }
}

async function apiGet(path: string, params: Record<string, string | number | undefined> = {}) {
  const url = new URL(`${BASE_URL}${path}`)
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  })

  const response = await fetch(url, {
    headers: {
      'X-Auth-Token': TOKEN ?? '',
      Accept: 'application/json',
    },
  })

  const text = await response.text()
  const data = text ? JSON.parse(text) : {}

  if (!response.ok) {
    const message = data?.message ?? data?.error ?? text ?? `football-data.org ${response.status}`
    throw new Error(`football-data.org ${response.status}: ${message}`)
  }

  return data
}

async function fetchFixturesByRange(dateFrom: string, dateTo: string) {
  const data = await apiGet('/matches', { dateFrom, dateTo })
  return data.matches ?? []
}

async function fetchCompetitions() {
  const data = await apiGet('/competitions')
  return data.competitions ?? []
}

async function fetchStandings(competitionId: number) {
  if (!competitionId) return []

  try {
    const data = await apiGet(`/competitions/${competitionId}/standings`)
    return data.standings ?? []
  } catch (error) {
    console.warn(`standings unavailable for competition ${competitionId}`, error)
    return []
  }
}

async function fetchTeamLastMatches(teamId: number, limit: number) {
  if (!teamId) return []

  try {
    const data = await apiGet(`/teams/${teamId}/matches`, { limit, status: 'FINISHED' })
    return data.matches ?? []
  } catch (error) {
    console.warn(`last matches unavailable for team ${teamId}`, error)
    return []
  }
}

async function upsertCompetitions(competitions: Array<any>) {
  for (const competition of competitions) {
    await upsertLeague(competition, competition.area)
  }
}

async function upsertLeague(competition: any, area?: any) {
  const name = String(competition?.name ?? 'Unknown Competition')
  const result = await supabase
    .from('football_leagues')
    .upsert(
      {
        api_league_id: competition?.id,
        name,
        country: area?.name ?? competition?.area?.name ?? null,
        logo: competition?.emblem ?? null,
        enabled: true,
        priority: priorityLeagues.get(name) ?? priorityLeagues.get(competition?.code) ?? 50,
      },
      { onConflict: 'api_league_id' },
    )
    .select('id, priority')
    .single()

  if (result.error) throw result.error
  return result.data
}

async function upsertTeam(team: any, country?: string | null) {
  const result = await supabase
    .from('football_teams')
    .upsert(
      {
        api_team_id: team?.id,
        name: team?.name ?? team?.shortName ?? 'Unknown Team',
        logo: team?.crest ?? null,
        country: country ?? null,
      },
      { onConflict: 'api_team_id' },
    )
    .select('id')
    .single()

  if (result.error) throw result.error
  return result.data
}

async function upsertRecentForm(teamId: string, form: Record<string, number>, raw: unknown) {
  const result = await supabase.from('team_recent_form').upsert(
    {
      team_id: teamId,
      form_window: 5,
      wins: form.wins,
      draws: form.draws,
      losses: form.losses,
      goals_for: form.goals_for,
      goals_against: form.goals_against,
      clean_sheets: form.clean_sheets,
      failed_to_score: form.failed_to_score,
      raw,
    },
    { onConflict: 'team_id,form_window' },
  )

  if (result.error) throw result.error
}

async function upsertMatchAnalysis(matchId: string, analysis: any) {
  const safeAnalysis = normalizeAnalysisPayload(analysis)
  const nextPayload = {
    match_id: matchId,
    team_strength_score: safeAnalysis.team_strength_score,
    form_score: safeAnalysis.form_score,
    home_advantage_score: safeAnalysis.home_advantage_score,
    away_weakness_score: safeAnalysis.away_weakness_score,
    goal_scoring_score: safeAnalysis.goal_scoring_score,
    defensive_stability_score: safeAnalysis.defensive_stability_score,
    motivation_score: safeAnalysis.motivation_score,
    market_risk_score: safeAnalysis.market_risk_score,
    confidence_score: safeAnalysis.confidence_score,
    recommendation: safeAnalysis.recommendation,
    risk_level: safeAnalysis.risk_level,
    pick_side: safeAnalysis.pick_side,
    pick_team: safeAnalysis.pick_team,
    pick_reason: safeAnalysis.pick_reason,
    analysis_summary: safeAnalysis.analysis_summary,
    thai_reason: safeAnalysis.thai_reason,
    raw: safeAnalysis,
  }

  const nextResult = await supabase.from('match_analysis').upsert(nextPayload, { onConflict: 'match_id' })
  if (!nextResult.error) return

  const legacyResult = await supabase.from('match_analysis').upsert(
    {
      match_id: matchId,
      team_strength_score: safeAnalysis.team_strength_score,
      form_score: safeAnalysis.form_score,
      goal_quality_score: safeAnalysis.goal_scoring_score,
      home_away_score: safeAnalysis.home_advantage_score,
      motivation_score: safeAnalysis.motivation_score,
      market_context_score: safeAnalysis.market_risk_score,
      risk_score: safeAnalysis.market_risk_score,
      confidence_score: safeAnalysis.confidence_score,
      recommendation: safeAnalysis.recommendation,
      risk_level: safeAnalysis.risk_level,
      thai_reason: safeAnalysis.thai_reason,
      raw: safeAnalysis,
    },
    { onConflict: 'match_id' },
  )

  if (legacyResult.error) throw nextResult.error
}

function normalizeAnalysisPayload(analysis: any) {
  const confidence = normalizeScore(analysis?.confidence_score ?? analysis?.final_confidence_score ?? 0)
  const riskLevel = normalizeRiskLevel(analysis?.risk_level)
  const recommendation = getRecommendationFromConfidence(confidence, riskLevel)
  const summary = String(
    analysis?.analysis_summary ||
      analysis?.thai_reason ||
      `แนะนำ ${recommendation} เพราะความมั่นใจ ${confidence}/100 และความเสี่ยงระดับ${riskLevel}. ข้อมูลบางส่วนยังจำกัด ควรตรวจราคาก่อนตัดสินใจ`,
  ).trim()
  const pick = derivePickSideFromAnalysis(analysis ?? {}, {
    recommendation,
    risk_level: riskLevel,
    confidence_score: confidence,
  })

  return {
    ...(analysis ?? {}),
    team_strength_score: normalizeScore(analysis?.team_strength_score ?? analysis?.modules?.teamStrength ?? 56),
    form_score: normalizeScore(analysis?.form_score ?? analysis?.modules?.recentForm ?? 56),
    home_advantage_score: normalizeScore(analysis?.home_advantage_score ?? analysis?.modules?.homeAwayAdvantage ?? 56),
    away_weakness_score: normalizeScore(analysis?.away_weakness_score ?? analysis?.modules?.awayWeakness ?? 55),
    goal_scoring_score: normalizeScore(analysis?.goal_scoring_score ?? analysis?.modules?.attackQuality ?? 56),
    defensive_stability_score: normalizeScore(analysis?.defensive_stability_score ?? analysis?.modules?.defensiveStability ?? 56),
    motivation_score: normalizeScore(analysis?.motivation_score ?? analysis?.modules?.motivationContext ?? 56),
    market_risk_score: normalizeScore(analysis?.market_risk_score ?? analysis?.modules?.marketOddsRisk ?? 52),
    confidence_score: confidence,
    recommendation,
    risk_level: riskLevel,
    pick_side: pick.pick_side,
    pick_team: pick.pick_team,
    pick_reason: pick.pick_reason,
    analysis_summary: summary,
    thai_reason: summary,
  }
}

async function recordAiPerformance(matchId: string, payload: any) {
  const snapshot = buildPredictionSnapshot(matchId, payload)
  let snapshotRows = await findPerformanceSnapshots(matchId)
  const alreadyExists = snapshotRows.some((row: any) => row.analysis_version === snapshot.analysis_version)

  if (!alreadyExists) {
    const insertResult = await supabase
      .from('ai_prediction_snapshots')
      .insert(snapshot)
      .select('id, recommendation, predicted_outcome, analysis_version, raw')
      .single()

    if (insertResult.error) throw insertResult.error
    snapshotRows = [...snapshotRows, insertResult.data]
  }

  await updatePerformanceResults(matchId, snapshotRows, payload.match)
}

async function findPerformanceSnapshots(matchId: string) {
  const result = await supabase
    .from('ai_prediction_snapshots')
    .select('id, recommendation, predicted_outcome, analysis_version, raw')
    .eq('match_id', matchId)

  if (result.error) throw result.error
  return result.data ?? []
}

function buildPredictionSnapshot(matchId: string, { match, league, homeTeam, awayTeam, analysis }: any) {
  const analysisBreakdown = analysis.analysis_breakdown ?? {}
  const analysisVersion = analysis.framework ?? analysis.raw?.framework ?? 'unknown'

  return {
    match_id: matchId,
    fixture_id: String(match.id ?? ''),
    home_team: match.homeTeam?.name ?? homeTeam?.name ?? null,
    away_team: match.awayTeam?.name ?? awayTeam?.name ?? null,
    league: match.competition?.name ?? league?.name ?? null,
    kickoff: match.utcDate ?? null,
    recommendation: analysis.recommendation ?? 'NO BET',
    confidence_score: Number(analysis.confidence_score ?? 0),
    ranking_score: Number(analysis.ranking_score ?? analysis.confidence_score ?? 0),
    risk_level: normalizeRiskLevel(analysis.risk_level),
    analysis_version: analysisVersion,
    predicted_outcome: inferPerformancePredictedOutcome(analysisBreakdown),
    raw: {
      analysis_version: analysisVersion,
      analysis_breakdown: analysisBreakdown,
      confidence_score: analysis.confidence_score,
      recommendation: analysis.recommendation,
      risk_level: analysis.risk_level,
    },
  }
}

async function updatePerformanceResults(matchId: string, snapshots: Array<any>, match: any) {
  const resultTracking = getPerformanceResultTracking(match)

  for (const snapshot of snapshots) {
    const resultPayload = {
      snapshot_id: snapshot.id,
      match_id: matchId,
      status: resultTracking.status,
      home_goals: resultTracking.home_goals,
      away_goals: resultTracking.away_goals,
      result: resultTracking.result,
      finished_at: resultTracking.finished_at,
    }
    const result = await supabase.from('ai_prediction_results').upsert(resultPayload, { onConflict: 'snapshot_id' }).select('id').single()
    if (result.error) throw result.error

    const evaluation = evaluatePerformancePrediction(snapshot, resultTracking)
    const evaluationResult = await supabase.from('ai_prediction_evaluations').upsert(
      {
        snapshot_id: snapshot.id,
        match_id: matchId,
        evaluation_status: evaluation.evaluation_status,
        evaluation_reason: evaluation.evaluation_reason,
        evaluated_at: evaluation.evaluated_at,
        raw: {
          result: resultTracking,
          predicted_outcome: snapshot.predicted_outcome,
          analysis_version: snapshot.analysis_version,
        },
      },
      { onConflict: 'snapshot_id' },
    )
    if (evaluationResult.error) throw evaluationResult.error
  }
}

function getPerformanceResultTracking(match: any) {
  const homeGoals = nullableNumber(match.score?.fullTime?.home ?? match.home_goals)
  const awayGoals = nullableNumber(match.score?.fullTime?.away ?? match.away_goals)
  const finished = ['FINISHED', 'FT', 'AET', 'PEN'].includes(String(match.status ?? '').toUpperCase()) && homeGoals !== null && awayGoals !== null

  return {
    status: finished ? 'finished' : 'pending',
    home_goals: homeGoals,
    away_goals: awayGoals,
    result: finished ? getPerformanceResult(homeGoals, awayGoals) : null,
    finished_at: finished ? new Date().toISOString() : null,
  }
}

function evaluatePerformancePrediction(snapshot: any, resultTracking: any) {
  if (resultTracking.status !== 'finished' || !resultTracking.result) {
    return { evaluation_status: 'pending', evaluation_reason: 'Result is not finished yet', evaluated_at: null }
  }

  const recommendation = String(snapshot.recommendation ?? '').toUpperCase()
  if (!['BET', 'LEAN'].includes(recommendation)) {
    return { evaluation_status: 'no_evaluation', evaluation_reason: 'NO BET is tracked but not evaluated as a prediction', evaluated_at: new Date().toISOString() }
  }

  const predicted = snapshot.predicted_outcome ?? inferPerformancePredictedOutcome(snapshot.raw?.analysis_breakdown)
  if (!['home', 'draw', 'away'].includes(predicted)) {
    return { evaluation_status: 'no_evaluation', evaluation_reason: 'No explicit predicted outcome was available', evaluated_at: new Date().toISOString() }
  }

  return {
    evaluation_status: predicted === resultTracking.result ? 'correct' : 'incorrect',
    evaluation_reason: predicted === resultTracking.result ? 'Predicted outcome matched final result' : 'Predicted outcome did not match final result',
    evaluated_at: new Date().toISOString(),
  }
}

function inferPerformancePredictedOutcome(analysisBreakdown: any = {}) {
  const data = analysisBreakdown?.data_intelligence ?? {}
  const leagueEdge = data.league_position?.edge
  const venueEdge = data.home_away_form?.advantage
  const h2hScore = Number(data.head_to_head?.score ?? 0)
  const moduleHomeAdvantage = Number(analysisBreakdown?.home_away_advantage?.score ?? 0)

  if (leagueEdge === 'home' || venueEdge === 'home') return 'home'
  if (leagueEdge === 'away' || venueEdge === 'away') return 'away'
  if (h2hScore >= 64 || moduleHomeAdvantage >= 65) return 'home'
  if (h2hScore > 0 && h2hScore <= 50) return 'away'
  return 'unknown'
}

function getPerformanceResult(homeGoals: number, awayGoals: number) {
  if (homeGoals > awayGoals) return 'home'
  if (homeGoals < awayGoals) return 'away'
  return 'draw'
}

function nullableNumber(value: any) {
  if (value === null || value === undefined) return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

async function recomputeStoredAnalysisRows(limit: number) {
  const result = await supabase
    .from('football_matches')
    .select(`
      id,
      raw,
      league:football_leagues(id, api_league_id, name, priority),
      homeTeam:football_teams!football_matches_home_team_id_fkey(id, api_team_id, name),
      awayTeam:football_teams!football_matches_away_team_id_fkey(id, api_team_id, name),
      analysis:match_analysis(raw)
    `)
    .order('kickoff_at', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 100)))

  if (result.error) throw result.error

  let recomputed = 0

  for (const row of result.data ?? []) {
    const storedAnalysis = Array.isArray(row.analysis) ? row.analysis[0] : row.analysis
    const rawAnalysis = storedAnalysis?.raw ?? {}
    const rawMatch = row.raw ?? rawAnalysis.raw_match ?? {}
    const match = {
      ...rawMatch,
      id: rawMatch.id ?? row.raw?.id,
      utcDate: rawMatch.utcDate ?? row.raw?.utcDate,
      competition: rawMatch.competition ?? { id: row.league?.api_league_id, name: row.league?.name },
      homeTeam: rawMatch.homeTeam ?? { id: row.homeTeam?.api_team_id, name: row.homeTeam?.name },
      awayTeam: rawMatch.awayTeam ?? { id: row.awayTeam?.api_team_id, name: row.awayTeam?.name },
    }
    const homeForm = rawAnalysis.homeForm ?? { played: 0, wins: 0, draws: 0, losses: 0, goals_for: 0, goals_against: 0, clean_sheets: 0, failed_to_score: 0 }
    const awayForm = rawAnalysis.awayForm ?? { played: 0, wins: 0, draws: 0, losses: 0, goals_for: 0, goals_against: 0, clean_sheets: 0, failed_to_score: 0 }
    const standings = rawAnalysis.standings ?? []
    const analysis = analyzeMatch({
      match,
      homeForm,
      awayForm,
      standings,
      leaguePriority: Number(row.league?.priority ?? 50),
      recentMatches: rawAnalysis.recent_matches ?? null,
      recentOpponents: rawAnalysis.recent_matches ?? null,
    })

    await upsertMatchAnalysis(row.id, analysis)
    await recordAiPerformance(row.id, {
      match,
      league: row.league,
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      analysis,
    })
    recomputed += 1
  }

  return recomputed
}

async function recomputeProcessedAnalysisRows(matchIds: Array<string>) {
  const failures: Array<{ matchId?: number; message: string }> = []
  const uniqueIds = [...new Set(matchIds.filter(Boolean))]
  if (!uniqueIds.length) return { updated: 0, failures }

  const result = await supabase
    .from('football_matches')
    .select(`
      id,
      raw,
      league:football_leagues(id, api_league_id, name, priority),
      homeTeam:football_teams!football_matches_home_team_id_fkey(id, api_team_id, name),
      awayTeam:football_teams!football_matches_away_team_id_fkey(id, api_team_id, name),
      analysis:match_analysis(raw)
    `)
    .in('id', uniqueIds)

  if (result.error) throw result.error

  let updated = 0

  for (const row of result.data ?? []) {
    try {
      const storedAnalysis = Array.isArray(row.analysis) ? row.analysis[0] : row.analysis
      const rawAnalysis = storedAnalysis?.raw ?? {}
      const rawMatch = row.raw ?? rawAnalysis.raw_match ?? {}
      const match = {
        ...rawMatch,
        id: rawMatch.id ?? row.raw?.id,
        utcDate: rawMatch.utcDate ?? row.raw?.utcDate,
        competition: rawMatch.competition ?? { id: row.league?.api_league_id, name: row.league?.name },
        homeTeam: rawMatch.homeTeam ?? { id: row.homeTeam?.api_team_id, name: row.homeTeam?.name },
        awayTeam: rawMatch.awayTeam ?? { id: row.awayTeam?.api_team_id, name: row.awayTeam?.name },
      }
      const homeForm = rawAnalysis.homeForm ?? emptyForm()
      const awayForm = rawAnalysis.awayForm ?? emptyForm()
      const analysis = analyzeMatch({
        match,
        homeForm,
        awayForm,
        standings: rawAnalysis.standings ?? [],
        leaguePriority: Number(row.league?.priority ?? 50),
        recentMatches: rawAnalysis.recent_matches ?? null,
        recentOpponents: rawAnalysis.recent_matches ?? null,
      })

      await upsertMatchAnalysis(row.id, analysis)
      await recordAiPerformance(row.id, {
        match,
        league: row.league,
        homeTeam: row.homeTeam,
        awayTeam: row.awayTeam,
        analysis,
      })
      updated += 1
    } catch (error) {
      failures.push({
        matchId: Number(row.raw?.id ?? 0) || undefined,
        message: error instanceof Error ? error.message : 'analysis recompute failed',
      })
    }
  }

  return { updated, failures }
}

async function normalizeLegacyAnalysisRows() {
  const result = await supabase
    .from('match_analysis')
    .select('id, team_strength_score, form_score, home_advantage_score, away_weakness_score, goal_scoring_score, defensive_stability_score, motivation_score, market_risk_score, confidence_score, recommendation, risk_level, pick_side, pick_team, pick_reason, analysis_summary, thai_reason, raw')
    .limit(1000)

  if (result.error) throw result.error

  let fixed = 0

  for (const row of result.data ?? []) {
    const confidence = Math.round(clamp(Number(row.confidence_score ?? row.raw?.confidence_score ?? 0), 0, 100))
    const riskLevel = normalizeRiskLevel(row.risk_level ?? row.raw?.risk_level)
    const recommendation = getRecommendationFromConfidence(confidence, riskLevel)
    const analysisSummary = row.analysis_summary || row.raw?.analysis_summary || row.thai_reason || `แนะนำ ${recommendation} เพราะความมั่นใจ ${confidence}/100 และความเสี่ยงระดับ${riskLevel}. ข้อมูลบางส่วนยังจำกัด ควรตรวจราคาก่อนตัดสินใจ`
    const pick = derivePickSideFromAnalysis(row.raw?.raw_match ?? row.raw ?? {}, {
      home_advantage_score: row.home_advantage_score ?? row.raw?.home_advantage_score,
      away_weakness_score: row.away_weakness_score ?? row.raw?.away_weakness_score,
      goal_scoring_score: row.goal_scoring_score ?? row.raw?.goal_scoring_score,
      defensive_stability_score: row.defensive_stability_score ?? row.raw?.defensive_stability_score,
      market_risk_score: row.market_risk_score ?? row.raw?.market_risk_score,
      confidence_score: confidence,
      recommendation,
      risk_level: riskLevel,
    })
    const nextPayload = {
      team_strength_score: normalizeScore(row.team_strength_score ?? row.raw?.team_strength_score ?? row.raw?.modules?.teamStrength ?? 56),
      form_score: normalizeScore(row.form_score ?? row.raw?.form_score ?? row.raw?.modules?.recentForm ?? 56),
      home_advantage_score: normalizeScore(row.home_advantage_score ?? row.raw?.home_advantage_score ?? row.raw?.modules?.homeAwayAdvantage ?? 56),
      away_weakness_score: normalizeScore(row.away_weakness_score ?? row.raw?.away_weakness_score ?? row.raw?.modules?.awayWeakness ?? 55),
      goal_scoring_score: normalizeScore(row.goal_scoring_score ?? row.raw?.goal_scoring_score ?? row.raw?.modules?.attackQuality ?? 56),
      defensive_stability_score: normalizeScore(row.defensive_stability_score ?? row.raw?.defensive_stability_score ?? row.raw?.modules?.defensiveStability ?? 56),
      motivation_score: normalizeScore(row.motivation_score ?? row.raw?.motivation_score ?? row.raw?.modules?.motivationContext ?? 56),
      market_risk_score: normalizeScore(row.market_risk_score ?? row.raw?.market_risk_score ?? row.raw?.modules?.marketOddsRisk ?? 52),
      confidence_score: confidence,
      analysis_summary: analysisSummary,
      recommendation,
      risk_level: riskLevel,
      pick_side: pick.pick_side,
      pick_team: pick.pick_team,
      pick_reason: pick.pick_reason,
    }

    if (
      row.analysis_summary &&
      row.recommendation === recommendation &&
      row.risk_level === riskLevel &&
      row.pick_side === pick.pick_side &&
      (row.pick_team ?? null) === (pick.pick_team ?? null) &&
      row.pick_reason === pick.pick_reason &&
      ['team_strength_score', 'form_score', 'home_advantage_score', 'away_weakness_score', 'goal_scoring_score', 'defensive_stability_score', 'motivation_score', 'market_risk_score', 'confidence_score'].every((key) => row[key] !== null && row[key] !== undefined)
    ) {
      continue
    }

    const updateResult = await supabase
      .from('match_analysis')
      .update(nextPayload)
      .eq('id', row.id)

    if (updateResult.error) throw updateResult.error
    fixed += 1
  }

  return { checked: result.data?.length ?? 0, fixed }
}

function analyzeMatch({ match, homeForm, awayForm, standings, leaguePriority, recentMatches, recentOpponents }: any) {
  const homeStanding = findStanding(standings, match.homeTeam?.id)
  const awayStanding = findStanding(standings, match.awayTeam?.id)
  const dataCompleteness = getDataCompletenessFromSource(match, homeForm, awayForm, standings)
  const analysisBreakdown = buildModuleBreakdown(match, homeForm, awayForm, homeStanding, awayStanding, leaguePriority)
  const baseConfidence = Math.round(
    analysisBreakdown.team_strength.score * 0.1 +
      analysisBreakdown.recent_form.score * 0.1 +
      analysisBreakdown.home_away_advantage.score * 0.14 +
      analysisBreakdown.away_weakness.score * 0.14 +
      analysisBreakdown.attack_quality.score * 0.16 +
      analysisBreakdown.defensive_stability.score * 0.16 +
      analysisBreakdown.market_odds_risk.score * 0.14 +
      analysisBreakdown.motivation_context.score * 0.06,
  )
  const footballIntelligence = calculateFootballIntelligence(match, {
    homeForm,
    awayForm,
    recentMatches,
    recentOpponents,
    baseConfidence,
  })
  const footballModifier = footballIntelligence.modifier
  const dataIntelligence = calculateDataIntelligence(match, {
    homeForm,
    awayForm,
    recentOpponents,
    baseConfidence,
    footballModifier,
  })
  const dataIntelligenceModifier = dataIntelligence.modifier
  const intelligenceModifier = getCombinedIntelligenceModifier(baseConfidence, footballModifier, dataIntelligenceModifier)
  const rawConfidence = Math.round(clamp(baseConfidence + intelligenceModifier, 0, 100))
  const confidence = applyMarketDataConfidenceGuard(rawConfidence, baseConfidence, analysisBreakdown)
  analysisBreakdown.football_intelligence = footballIntelligence
  analysisBreakdown.data_intelligence = dataIntelligence
  const overallRisk = calculateOverallRisk(analysisBreakdown, confidence, dataCompleteness, footballIntelligence)
  analysisBreakdown.overall_risk = overallRisk
  const riskLevel = overallRisk.level
  const roundedModules = {
    teamStrength: analysisBreakdown.team_strength.score,
    recentForm: analysisBreakdown.recent_form.score,
    attackQuality: analysisBreakdown.attack_quality.score,
    defensiveStability: analysisBreakdown.defensive_stability.score,
    homeAwayAdvantage: analysisBreakdown.home_away_advantage.score,
    awayWeakness: analysisBreakdown.away_weakness.score,
    motivationContext: analysisBreakdown.motivation_context.score,
    marketOddsRisk: analysisBreakdown.market_odds_risk.score,
  }
  const recommendation = getRecommendationFromConfidence(confidence, riskLevel)
  logFootballIntelligenceV3({
    match,
    baseConfidence,
    footballModifier,
    dataIntelligenceModifier,
    intelligenceModifier,
    confidence,
    riskLevel,
    recommendation,
    modules: roundedModules,
    intelligenceSignals: footballIntelligence.signals,
  })
  const analysisSummary = buildAnalysisSummary(match, confidence, riskLevel, recommendation, analysisBreakdown)
  const pick = derivePickSideFromAnalysis(match, {
    home_advantage_score: analysisBreakdown.home_away_advantage.score,
    away_weakness_score: analysisBreakdown.away_weakness.score,
    goal_scoring_score: analysisBreakdown.attack_quality.score,
    defensive_stability_score: analysisBreakdown.defensive_stability.score,
    market_risk_score: analysisBreakdown.market_odds_risk.score,
    confidence_score: confidence,
    recommendation,
    risk_level: riskLevel,
  })

  return {
    provider: 'football-data.org',
    framework: 'football-intelligence-v3',
    team_strength_score: analysisBreakdown.team_strength.score,
    form_score: analysisBreakdown.recent_form.score,
    home_advantage_score: analysisBreakdown.home_away_advantage.score,
    away_weakness_score: analysisBreakdown.away_weakness.score,
    goal_scoring_score: analysisBreakdown.attack_quality.score,
    defensive_stability_score: analysisBreakdown.defensive_stability.score,
    motivation_score: analysisBreakdown.motivation_context.score,
    market_risk_score: analysisBreakdown.market_odds_risk.score,
    confidence_score: confidence,
    base_confidence_score: baseConfidence,
    intelligence_modifier: intelligenceModifier,
    football_intelligence_modifier: footballModifier,
    data_intelligence_modifier: dataIntelligenceModifier,
    final_confidence_score: confidence,
    recommendation,
    risk_level: riskLevel,
    pick_side: pick.pick_side,
    pick_team: pick.pick_team,
    pick_reason: pick.pick_reason,
    analysis_summary: analysisSummary,
    thai_reason: analysisSummary,
    modules: roundedModules,
    analysis_breakdown: analysisBreakdown,
    data_completeness: dataCompleteness,
    homeForm,
    awayForm,
    standings,
    recent_matches: recentMatches,
    raw_match: match,
  }
}

function buildModuleBreakdown(match: any, homeForm: any, awayForm: any, homeStanding: any, awayStanding: any, leaguePriority: number) {
  return {
    team_strength: scoreTeamStrength(match, homeForm, awayForm, homeStanding, awayStanding),
    recent_form: scoreRecentForm(homeForm, awayForm),
    attack_quality: scoreAttackQuality(homeForm, awayForm, homeStanding, awayStanding),
    defensive_stability: scoreDefensiveStability(homeForm, awayForm),
    home_away_advantage: scoreHomeAwayAdvantage(match, homeForm),
    away_weakness: scoreAwayWeakness(awayForm, awayStanding),
    motivation_context: scoreMotivationContext(match, leaguePriority),
    market_odds_risk: scoreMarketOddsRisk(match, homeForm, awayForm),
  }
}

function scoreTeamStrength(match: any, homeForm: any, awayForm: any, homeStanding: any, awayStanding: any) {
  if (homeStanding && awayStanding) {
    const standingGap = Number(awayStanding.position ?? 12) - Number(homeStanding.position ?? 12)
    const pointsGap = Number(homeStanding.points ?? 0) - Number(awayStanding.points ?? 0)
    const goalDiffGap = Number(homeStanding.goalDifference ?? 0) - Number(awayStanding.goalDifference ?? 0)
    const score = clamp(58 + standingGap * 2 + pointsGap * 0.7 + goalDiffGap * 0.8, 28, 90)
    return moduleResult(score, standingGap >= 0 ? 'อันดับและแต้มโดยรวมหนุนฝั่งเจ้าบ้านมากกว่า' : 'อันดับตารางไม่ได้หนุนฝั่งเจ้าบ้านชัดเจน')
  }

  const formGap = formPoints(homeForm) - formPoints(awayForm)
  const goalDiffGap = formGoalDiff(homeForm) - formGoalDiff(awayForm)
  const nameSignal = (match.homeTeam?.name ? 3 : 0) + (match.awayTeam?.name ? 2 : 0)
  const score = clamp(55 + formGap * 1.4 + goalDiffGap * 1.8 + nameSignal, 35, 78)
  return moduleResult(score, 'ไม่มีตารางคะแนนครบ จึงใช้ฟอร์มและข้อมูลทีมที่มีเป็น proxy')
}

function scoreRecentForm(homeForm: any, awayForm: any) {
  const played = Number(homeForm?.played ?? 0) + Number(awayForm?.played ?? 0)
  if (!played) return moduleResult(56, 'ข้อมูลฟอร์มล่าสุดจำกัด จึงประเมินแบบกลางจากบริบทคู่แข่ง')

  const pointsRate = ((formPoints(homeForm) + formPoints(awayForm)) / Math.max(played * 3, 1)) * 100
  const goalBalance = clamp((formGoalDiff(homeForm) + formGoalDiff(awayForm)) * 2.5, -18, 18)
  const score = clamp(42 + pointsRate * 0.38 + goalBalance, 25, 86)
  return moduleResult(score, played >= 8 ? 'ฟอร์ม 5 นัดล่าสุดมีข้อมูลรองรับเพียงพอ' : 'มีข้อมูลฟอร์มบางส่วน แต่ยังไม่เต็มหน้าต่าง 5 นัด')
}

function scoreAttackQuality(homeForm: any, awayForm: any, homeStanding: any, awayStanding: any) {
  const goalsFor = Number(homeForm?.goals_for ?? 0) + Number(awayForm?.goals_for ?? 0)
  const played = Number(homeForm?.played ?? 0) + Number(awayForm?.played ?? 0)
  const standingBoost = homeStanding || awayStanding ? clamp((Number(homeStanding?.goalsFor ?? 0) + Number(awayStanding?.goalsFor ?? 0)) * 0.25, 0, 12) : 0

  if (!played && !standingBoost) return moduleResult(57, 'ยังไม่มี xG หรือสถิติเกมรุกละเอียด จึงใช้ค่ากลางแบบระมัดระวัง')

  const goalsPerMatch = goalsFor / Math.max(played, 1)
  const score = clamp(48 + goalsPerMatch * 18 + standingBoost, 30, 88)
  return moduleResult(score, goalsPerMatch >= 1.4 ? 'เกมรุกมีแนวโน้มสร้างประตูได้ดีจากข้อมูลล่าสุด' : 'เกมรุกยังไม่ได้เด่นชัดจากข้อมูลประตูที่มี')
}

function scoreDefensiveStability(homeForm: any, awayForm: any) {
  const goalsAgainst = Number(homeForm?.goals_against ?? 0) + Number(awayForm?.goals_against ?? 0)
  const cleanSheets = Number(homeForm?.clean_sheets ?? 0) + Number(awayForm?.clean_sheets ?? 0)
  const played = Number(homeForm?.played ?? 0) + Number(awayForm?.played ?? 0)
  if (!played) return moduleResult(58, 'ข้อมูลเกมรับจำกัด จึงยังประเมินความมั่นคงในระดับกลาง')

  const concededPerMatch = goalsAgainst / Math.max(played, 1)
  const score = clamp(74 - concededPerMatch * 22 + cleanSheets * 4, 25, 90)
  return moduleResult(score, concededPerMatch <= 1 ? 'เกมรับค่อนข้างมั่นคงจากอัตราเสียประตู' : 'เกมรับยังมีความเสี่ยงจากอัตราเสียประตู')
}

function scoreHomeAwayAdvantage(match: any, homeForm: any) {
  const venueText = String(match.venue ?? match.raw?.venue ?? '').toLowerCase()
  if (venueText.includes('neutral')) return moduleResult(52, 'สนามเป็นกลางหรือมีสัญญาณว่าเจ้าบ้านไม่ได้เปรียบเต็มที่')

  const played = Number(homeForm?.played ?? 0)
  const homeWinRate = played ? Number(homeForm?.wins ?? 0) / played : 0.4
  const score = clamp(57 + homeWinRate * 22 + Math.max(formGoalDiff(homeForm), 0) * 1.3, 48, 78)
  return moduleResult(score, played ? 'เจ้าบ้านมีแรงหนุนจากสภาพการแข่งขันและฟอร์มฝั่งเหย้า' : 'ไม่มีข้อมูลสนามละเอียด จึงให้น้ำหนักเจ้าบ้านแบบจำกัด')
}

function scoreAwayWeakness(awayForm: any, awayStanding: any) {
  const played = Number(awayForm?.played ?? 0)
  const standingPosition = Number(awayStanding?.position ?? 0)

  if (!played && !standingPosition) {
    return moduleResult(55, 'ข้อมูลจุดอ่อนทีมเยือนยังจำกัด จึงประเมินแบบระมัดระวัง')
  }

  const lossRate = played ? Number(awayForm?.losses ?? 0) / played : 0.25
  const concededPerMatch = played ? Number(awayForm?.goals_against ?? 0) / played : 1.2
  const failedRate = played ? Number(awayForm?.failed_to_score ?? 0) / played : 0.2
  const tableWeakness = standingPosition ? clamp((standingPosition - 6) * 2.2, -8, 18) : 0
  const score = clamp(45 + lossRate * 24 + concededPerMatch * 12 + failedRate * 12 + tableWeakness, 28, 88)

  return moduleResult(
    score,
    score >= 68
      ? 'ทีมเยือนมีสัญญาณเปราะจากฟอร์มแพ้/เสียประตูและอันดับตาราง'
      : 'ทีมเยือนยังไม่เห็นจุดอ่อนชัดพอ จึงให้คะแนนแบบกลางค่อนไปทางระวัง',
  )
}

function scoreMotivationContext(match: any, leaguePriority: number) {
  const stage = String(match.stage ?? match.group ?? match.round ?? '').toLowerCase()
  const knockoutBoost = ['final', 'semi', 'quarter', 'last_16', 'playoff'].some((item) => stage.includes(item)) ? 8 : 0
  const priorityScore = leaguePriority <= 15 ? 65 : leaguePriority <= 30 ? 61 : leaguePriority <= 50 ? 58 : 55
  const score = clamp(priorityScore + knockoutBoost, 52, 78)
  return moduleResult(score, knockoutBoost ? 'รายการหรือรอบการแข่งขันเพิ่มแรงจูงใจเชิงบริบท' : 'ข้อมูลแรงจูงใจยังจำกัด จึงใช้คะแนนกลางตามความสำคัญรายการ')
}

function scoreMarketOddsRisk(match: any, homeForm: any, awayForm: any) {
  const hasOdds = hasMarketData(match)
  if (!hasOdds) {
    return {
      ...moduleResult(52, 'ข้อมูลราคาตลาดยังจำกัด จึงให้คะแนน conservative และไม่ใช้เป็นเหตุผลหนุน BET เต็มตัว'),
      has_market_data: false,
    }
  }

  const formGap = Math.abs(formPoints(homeForm) - formPoints(awayForm))
  const score = clamp(58 + Math.min(formGap, 8) * 2.2, 42, 82)
  return { ...moduleResult(score, 'มีข้อมูลตลาดบางส่วนและใช้ร่วมกับความต่างของฟอร์มเพื่อประเมินความเสี่ยง'), has_market_data: true }
}

function calculateOverallRiskV2Legacy(breakdown: any, confidence: number, dataCompleteness: number) {
  const scores = [
    breakdown.team_strength.score,
    breakdown.recent_form.score,
    breakdown.attack_quality.score,
    breakdown.defensive_stability.score,
    breakdown.home_away_advantage.score,
    breakdown.motivation_context.score,
    breakdown.market_odds_risk.score,
  ]
  const spread = Math.max(...scores) - Math.min(...scores)
  const weakCore = ['team_strength', 'recent_form', 'attack_quality', 'defensive_stability'].filter((key) => breakdown[key].score < 45).length

  if (confidence < 48 || weakCore >= 2 || spread >= 42) {
    return { level: 'HIGH', reason: 'คะแนนสำคัญหลายด้านอ่อนหรือขัดแย้งกันมาก จึงจัดเป็นความเสี่ยงสูง' }
  }
  if (confidence >= 72 && dataCompleteness >= 70 && spread <= 28) {
    return { level: 'LOW', reason: 'หลายโมดูลให้ภาพสอดคล้องกันและข้อมูลรองรับค่อนข้างครบ' }
  }
  return { level: 'MEDIUM', reason: 'มีข้อมูลสนับสนุนบางส่วน แต่ยังไม่ครบทุกมิติหรือคะแนนยังไม่สอดคล้องเต็มที่' }
}

function moduleResult(score: number, reason: string) {
  return { score: Math.round(clamp(score, 0, 100)), reason }
}

function getDataCompletenessFromSource(match: any, homeForm: any, awayForm: any, standings: Array<any>) {
  const checks = [
    Boolean(match.id),
    Boolean(match.utcDate),
    Boolean(match.competition?.name),
    Boolean(match.homeTeam?.name),
    Boolean(match.awayTeam?.name),
    Number(homeForm?.played ?? 0) > 0,
    Number(awayForm?.played ?? 0) > 0,
    Boolean(standings?.length),
    Boolean(match.score),
    Boolean(match.status),
  ]

  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}

function formPoints(form: any) {
  return Number(form?.wins ?? 0) * 3 + Number(form?.draws ?? 0)
}

function formGoalDiff(form: any) {
  return Number(form?.goals_for ?? 0) - Number(form?.goals_against ?? 0)
}

function getRecommendationFromConfidence(confidence: number, riskLevel = 'medium') {
  if (normalizeRiskLevel(riskLevel) === 'HIGH') return 'NO BET'
  if (confidence >= 72) return 'BET'
  if (confidence >= 58) return 'LEAN'
  return 'NO BET'
}

function applyMarketDataConfidenceGuard(confidence: number, baseConfidence: number, breakdown: any) {
  if (breakdown?.market_odds_risk?.has_market_data !== false || confidence < 72) return confidence

  const coreScores = [
    breakdown.home_away_advantage?.score,
    breakdown.away_weakness?.score,
    breakdown.attack_quality?.score,
    breakdown.defensive_stability?.score,
  ].map((score) => Number(score ?? 0))
  const coreAverage = coreScores.reduce((total, score) => total + score, 0) / Math.max(coreScores.length, 1)
  const footballCaseIsVeryStrong = baseConfidence >= 78 && coreAverage >= 74

  return footballCaseIsVeryStrong ? confidence : Math.min(confidence, 71)
}

function hasMarketData(match: any) {
  return Boolean(
    match?.odds ||
      match?.market ||
      match?.bookmakers ||
      match?.raw?.odds ||
      match?.raw?.market ||
      match?.raw?.bookmakers,
  )
}

function derivePickSideFromAnalysis(match: any, analysis: any) {
  const storedSide = normalizePickSide(analysis?.pick_side)
  const storedReason = String(analysis?.pick_reason ?? '').trim()
  const recommendation = String(analysis?.recommendation ?? 'NO BET').toUpperCase()
  const riskLevel = normalizeRiskLevel(analysis?.risk_level)
  const confidence = normalizeScore(analysis?.confidence_score ?? 0)
  const homeName = match?.homeTeam?.name ?? match?.home_team?.name ?? match?.raw_match?.homeTeam?.name ?? null
  const awayName = match?.awayTeam?.name ?? match?.away_team?.name ?? match?.raw_match?.awayTeam?.name ?? null

  if (storedSide !== 'NONE' && storedReason && recommendation !== 'NO BET' && confidence >= 58) {
    return buildPickResult(storedSide, homeName, awayName, storedReason)
  }

  if (recommendation === 'NO BET') {
    return buildPickResult('NONE', homeName, awayName, 'ไม่แนะนำเดิมพัน เพราะระบบประเมินว่ายังไม่มีความคุ้มค่าพอ')
  }
  if (riskLevel === 'HIGH') {
    return buildPickResult('NONE', homeName, awayName, 'ความเสี่ยงสูง จึงไม่แนะนำเลือกฝั่ง')
  }
  if (confidence < 58) {
    return buildPickResult('NONE', homeName, awayName, 'ข้อมูลยังไม่พอให้เลือกฝั่งอย่างมั่นใจ')
  }

  const homeAdvantage = normalizeScore(analysis?.home_advantage_score ?? analysis?.modules?.homeAwayAdvantage ?? 56)
  const awayWeakness = normalizeScore(analysis?.away_weakness_score ?? analysis?.modules?.awayWeakness ?? 55)
  const goalScoring = normalizeScore(analysis?.goal_scoring_score ?? analysis?.modules?.attackQuality ?? 56)
  const defensiveStability = normalizeScore(analysis?.defensive_stability_score ?? analysis?.modules?.defensiveStability ?? 56)
  const marketRisk = normalizeScore(analysis?.market_risk_score ?? analysis?.modules?.marketOddsRisk ?? 52)
  const marketPenalty = Math.max(0, 55 - marketRisk) * 0.35
  const homeEdge = (homeAdvantage - 50) * 0.55 + (awayWeakness - 50) * 0.45 + (goalScoring - 55) * 0.15 + (defensiveStability - 55) * 0.1 - marketPenalty
  const awayEdge = (50 - homeAdvantage) * 0.7 + (50 - awayWeakness) * 0.55 + (goalScoring - 55) * 0.05 + (defensiveStability - 55) * 0.05 - marketPenalty

  if (homeEdge >= 14 && homeAdvantage >= 62 && awayWeakness >= 60 && marketRisk >= 48) {
    return buildPickResult('HOME', homeName, awayName, 'เจ้าบ้านได้เปรียบชัดจากคะแนนเหย้าและความอ่อนแอของทีมเยือน')
  }
  if (awayEdge >= 16 && homeAdvantage <= 42 && awayWeakness <= 42 && marketRisk >= 52) {
    return buildPickResult('AWAY', homeName, awayName, 'ทีมเยือนมีภาษีดีกว่าจากคะแนนฝั่งเจ้าบ้านที่อ่อนและทีมเยือนไม่เปราะชัด')
  }

  return buildPickResult('NONE', homeName, awayName, 'ข้อมูลยังไม่พอให้เลือกฝั่งอย่างมั่นใจ')
}

function buildPickResult(pickSide: string, homeName: string | null, awayName: string | null, pickReason: string) {
  const normalized = normalizePickSide(pickSide)
  const pickTeam = normalized === 'HOME' ? homeName : normalized === 'AWAY' ? awayName : normalized === 'DRAW' ? 'เสมอ' : null

  return {
    pick_side: normalized,
    pick_team: pickTeam,
    pick_reason: pickReason,
  }
}

function normalizePickSide(value: unknown) {
  const normalized = String(value ?? '').toUpperCase()
  return ['HOME', 'AWAY', 'DRAW', 'NONE'].includes(normalized) ? normalized : 'NONE'
}

function normalizeRiskLevel(value: unknown) {
  const normalized = String(value ?? '').toLowerCase()
  if (normalized === 'low') return 'LOW'
  if (normalized === 'medium') return 'MEDIUM'
  if (normalized === 'high') return 'HIGH'
  return 'MEDIUM'
}

function normalizeScore(value: unknown) {
  return Math.round(clamp(Number(value ?? 0), 0, 100))
}

function emptyForm() {
  return { played: 0, wins: 0, draws: 0, losses: 0, goals_for: 0, goals_against: 0, clean_sheets: 0, failed_to_score: 0 }
}

function logAnalysisV2Breakdown({ match, confidence, riskLevel, recommendation, modules }: any) {
  console.info('football-analysis-v2-breakdown', {
    providerMatchId: match.id,
    homeTeam: match.homeTeam?.name ?? null,
    awayTeam: match.awayTeam?.name ?? null,
    moduleScores: modules,
    confidence,
    riskLevel,
    recommendation,
  })
}

function buildAnalysisSummaryV2Legacy(match: any, confidence: number, riskLevel: string, recommendation: string, breakdown: any) {
  const summaryHome = match.homeTeam?.name ?? 'ทีมเหย้า'
  const summaryAway = match.awayTeam?.name ?? 'ทีมเยือน'
  const summaryModules = [
    { label: 'Team Strength', score: breakdown.team_strength.score },
    { label: 'Recent Form', score: breakdown.recent_form.score },
    { label: 'Attack Quality', score: breakdown.attack_quality.score },
    { label: 'Defensive Stability', score: breakdown.defensive_stability.score },
    { label: 'Home/Away Advantage', score: breakdown.home_away_advantage.score },
    { label: 'Motivation & Context', score: breakdown.motivation_context.score },
    { label: 'Market & Odds Risk', score: breakdown.market_odds_risk.score },
  ]
  const bestModule = [...summaryModules].sort((a, b) => b.score - a.score)[0]
  const weakestModule = [...summaryModules].sort((a, b) => a.score - b.score)[0]
  const riskReason = breakdown.overall_risk.reason

  if (recommendation === 'BET') {
    return `${summaryHome} พบ ${summaryAway}: คะแนนรวม ${confidence}/100 เข้าระดับ BET เพราะ ${bestModule.label} เด่น (${bestModule.score}/100) และ risk_level เป็น ${riskLevel}. ${riskReason}`
  }
  if (recommendation === 'LEAN') {
    return `${summaryHome} พบ ${summaryAway}: คะแนนรวม ${confidence}/100 เหมาะเป็น LEAN มากกว่า BET จุดหนุนหลักคือ ${bestModule.label} (${bestModule.score}/100) แต่ ${weakestModule.label} ยังถ่วงอยู่ (${weakestModule.score}/100). ${riskReason}`
  }
  return `${summaryHome} พบ ${summaryAway}: คะแนนรวม ${confidence}/100 ยังเป็น NO BET แม้มีจุดเด่นที่ ${bestModule.label} (${bestModule.score}/100) แต่ ${weakestModule.label} ยังไม่สนับสนุนพอ (${weakestModule.score}/100). ${riskReason}`

  const modules: Record<string, number> = {}
  const home = match.homeTeam?.name ?? 'ทีมเหย้า'
  const away = match.awayTeam?.name ?? 'ทีมเยือน'
  const topModule = Object.entries(modules).sort(([, a], [, b]) => b - a)[0]?.[0] ?? 'teamStrength'
  const moduleText: Record<string, string> = {
    teamStrength: 'ความแข็งแรงทีม',
    recentForm: 'ฟอร์ม 5 นัดหลัง',
    homeAdvantage: 'ความได้เปรียบในบ้าน',
    awayWeakness: 'จุดอ่อนทีมเยือน',
    goalScoring: 'ศักยภาพการทำประตู',
    defensiveStability: 'ความมั่นคงเกมรับ',
    motivation: 'แรงจูงใจและความสำคัญรายการ',
    marketRisk: 'ความเสี่ยงตลาด',
  }

  return `${home} พบ ${away}: Football Master Framework ให้คะแนน ${confidence}/100 คำแนะนำ ${getRecommendationFromConfidence(confidence, riskLevel)} จุดเด่นคือ${moduleText[topModule]} และ risk_level เป็น ${riskLevel}`
}

function calculateDataIntelligence(match: any, context: any = {}) {
  const leaguePosition = calculateLeaguePositionData(match)
  const recentForm = calculateRecentFormData(context.homeForm, context.awayForm)
  const homeAwayForm = calculateHomeAwayFormData(match)
  const headToHead = calculateHeadToHeadData(match, context)
  const strengthOfSchedule = calculateStrengthOfScheduleData(context.recentOpponents)
  const goalStatistics = calculateGoalStatisticsData(context.homeForm, context.awayForm)
  const sections: any = {
    league_position: leaguePosition,
    recent_form: recentForm,
    home_away_form: homeAwayForm,
    head_to_head: headToHead,
    strength_of_schedule: strengthOfSchedule,
    goal_statistics: goalStatistics,
  }
  const dataConfidence = calculateDataConfidenceScore(sections)
  const modifier = calculateDataIntelligenceModifier({ ...sections, data_confidence: dataConfidence }, context.baseConfidence, context.footballModifier)

  return { ...sections, data_confidence: dataConfidence, consistency: calculateDataConsistency(sections), modifier }
}

function calculateLeaguePositionData(match: any) {
  const standings = match.standings ?? []
  const homeStanding = findStanding(standings, getTeamId(match.homeTeam))
  const awayStanding = findStanding(standings, getTeamId(match.awayTeam))
  if (!homeStanding || !awayStanding) return { score: 58, confidence: 'low', home_rank: null, away_rank: null, point_gap: null, goal_difference_gap: null, edge: 'unknown', reason: 'ยังไม่มีข้อมูลอันดับลีกเพียงพอ' }

  const homeRank = Number(homeStanding.position ?? 0)
  const awayRank = Number(awayStanding.position ?? 0)
  const pointGap = Number(homeStanding.points ?? 0) - Number(awayStanding.points ?? 0)
  const goalDiffGap = Number(homeStanding.goalDifference ?? 0) - Number(awayStanding.goalDifference ?? 0)
  const score = Math.round(clamp(58 + (awayRank - homeRank) * 1.8 + pointGap * 0.45 + goalDiffGap * 0.35, 35, 85))
  return { score, confidence: 'high', home_rank: homeRank || null, away_rank: awayRank || null, point_gap: pointGap, goal_difference_gap: goalDiffGap, edge: score >= 62 ? 'home' : score <= 54 ? 'away' : 'none', reason: `อันดับลีกจริง เจ้าบ้านอันดับ ${homeRank || '-'} ทีมเยือนอันดับ ${awayRank || '-'} แต้มต่าง ${pointGap} และประตูได้เสียต่าง ${goalDiffGap}` }
}

function calculateRecentFormData(homeForm: any, awayForm: any) {
  const played = Number(homeForm?.played ?? 0) + Number(awayForm?.played ?? 0)
  if (!played) return { score: 58, confidence: 'low', home: emptyDataForm(), away: emptyDataForm(), trend: 'unknown', reason: 'ข้อมูลฟอร์มล่าสุดยังจำกัด' }

  const score = Math.round(clamp(56 + (formPoints(homeForm) - formPoints(awayForm)) * 1.4 + (formGoalDiff(homeForm) - formGoalDiff(awayForm)) * 1.2, 35, 82))
  return { score, confidence: played >= 8 ? 'high' : played >= 4 ? 'medium' : 'low', home: summarizeDataForm(homeForm), away: summarizeDataForm(awayForm), trend: score >= 63 ? 'positive' : score <= 49 ? 'negative' : 'neutral', reason: `ฟอร์มล่าสุดมีข้อมูลจริง ${played} นัด เจ้าบ้าน ${formatDataForm(homeForm)} ทีมเยือน ${formatDataForm(awayForm)}` }
}

function calculateHomeAwayFormData(match: any) {
  const venueData = match.homeAwayForm ?? match.venueForm ?? {}
  const homeForm = venueData.home ?? match.homeHomeForm
  const awayForm = venueData.away ?? match.awayAwayForm
  const played = Number(homeForm?.played ?? 0) + Number(awayForm?.played ?? 0)
  if (!played) return { score: 58, confidence: 'low', home_win_rate: null, away_win_rate: null, home: emptyDataForm(), away: emptyDataForm(), advantage: 'unknown', reason: 'ฟอร์มเหย้า/เยือนยังไม่ชัด' }

  const homeRate = Number(homeForm?.played ?? 0) ? Number(homeForm?.wins ?? 0) / Number(homeForm?.played ?? 1) : null
  const awayRate = Number(awayForm?.played ?? 0) ? Number(awayForm?.wins ?? 0) / Number(awayForm?.played ?? 1) : null
  const score = Math.round(clamp(57 + ((homeRate ?? 0.4) - (awayRate ?? 0.35)) * 28 + (formGoalDiff(homeForm) - formGoalDiff(awayForm)) * 0.9, 35, 82))
  return { score, confidence: played >= 8 ? 'high' : 'medium', home_win_rate: homeRate === null ? null : Math.round(homeRate * 100), away_win_rate: awayRate === null ? null : Math.round(awayRate * 100), home: summarizeDataForm(homeForm), away: summarizeDataForm(awayForm), advantage: score >= 63 ? 'home' : score <= 51 ? 'away' : 'none', reason: `ใช้ข้อมูลเหย้า/เยือนจริง advantage ${score >= 63 ? 'home' : score <= 51 ? 'away' : 'none'}` }
}

function calculateHeadToHeadData(match: any, context: any) {
  const matches = getH2HMatches(match, context)
  if (!matches.length) return { score: 58, confidence: 'low', matches_count: 0, home_wins: 0, away_wins: 0, draws: 0, goals_average: null, reason: 'ไม่มี H2H เพียงพอ' }

  const summary = summarizeH2H(matches.slice(0, 10), getTeamId(match.homeTeam), getTeamId(match.awayTeam))
  return { score: Math.round(clamp(56 + (summary.homeWins - summary.awayWins) * 3 + Math.min(summary.played, 5), 42, 78)), confidence: summary.played >= 8 ? 'high' : summary.played >= 4 ? 'medium' : 'low', matches_count: summary.played, home_wins: summary.homeWins, away_wins: summary.awayWins, draws: summary.draws, goals_average: summary.played ? Math.round((summary.goals / summary.played) * 100) / 100 : null, reason: `H2H มีข้อมูลจริง ${summary.played} นัด เจ้าบ้านชนะ ${summary.homeWins} เสมอ ${summary.draws} ทีมเยือนชนะ ${summary.awayWins}` }
}

function calculateStrengthOfScheduleData(recentOpponents: any) {
  const ranks = flattenRecentOpponents(recentOpponents).map((item: any) => Number(item.opponent?.position ?? item.position ?? item.rank ?? 0)).filter((rank: number) => rank > 0)
  if (!ranks.length) return { score: 58, confidence: 'low', average_opponent_rank: null, difficulty: 'unknown', reason: 'ยังไม่มีข้อมูลคุณภาพคู่แข่ง 3-5 นัดล่าสุดเพียงพอ' }

  const average = ranks.reduce((total: number, rank: number) => total + rank, 0) / ranks.length
  const difficulty = average <= 6 ? 'hard' : average >= 14 ? 'easy' : 'medium'
  return { score: difficulty === 'hard' ? 55 : difficulty === 'easy' ? 62 : 58, confidence: ranks.length >= 6 ? 'high' : ranks.length >= 3 ? 'medium' : 'low', average_opponent_rank: Math.round(average * 100) / 100, difficulty, reason: `คู่แข่งล่าสุดมีอันดับเฉลี่ย ${Math.round(average * 100) / 100} ระดับความยาก ${difficulty}` }
}

function calculateGoalStatisticsData(homeForm: any, awayForm: any) {
  const played = Number(homeForm?.played ?? 0) + Number(awayForm?.played ?? 0)
  if (!played) return { score: 58, confidence: 'low', average_goals_scored: null, average_goals_conceded: null, clean_sheet_rate: null, btts_rate: null, over_2_5_rate: null, reason: 'สถิติประตูยังจำกัด และไม่สร้างค่า xG เอง' }

  const goalsFor = Number(homeForm?.goals_for ?? 0) + Number(awayForm?.goals_for ?? 0)
  const goalsAgainst = Number(homeForm?.goals_against ?? 0) + Number(awayForm?.goals_against ?? 0)
  const cleanSheets = Number(homeForm?.clean_sheets ?? 0) + Number(awayForm?.clean_sheets ?? 0)
  const averageFor = goalsFor / played
  const averageAgainst = goalsAgainst / played
  return { score: Math.round(clamp(52 + averageFor * 10 - averageAgainst * 5 + (cleanSheets / played) * 8, 35, 84)), confidence: played >= 8 ? 'high' : played >= 4 ? 'medium' : 'low', average_goals_scored: Math.round(averageFor * 100) / 100, average_goals_conceded: Math.round(averageAgainst * 100) / 100, clean_sheet_rate: Math.round((cleanSheets / played) * 100), btts_rate: null, over_2_5_rate: null, reason: `สถิติประตูจากข้อมูลจริง ${played} นัด ยิงเฉลี่ย ${Math.round(averageFor * 100) / 100} เสียเฉลี่ย ${Math.round(averageAgainst * 100) / 100}` }
}

function calculateDataConfidenceScore(sections: any) {
  const keys = ['league_position', 'recent_form', 'home_away_form', 'head_to_head', 'strength_of_schedule', 'goal_statistics']
  const available = keys.filter((key) => {
    const item = sections[key]
    if (key === 'league_position') return item.confidence !== 'low' && item.home_rank !== null && item.away_rank !== null
    if (key === 'recent_form') return item.confidence !== 'low' && Number(item.home?.played ?? 0) + Number(item.away?.played ?? 0) > 0
    if (key === 'home_away_form') return item.confidence !== 'low' && item.advantage !== 'unknown'
    if (key === 'head_to_head') return item.confidence !== 'low' && Number(item.matches_count ?? 0) > 0
    if (key === 'strength_of_schedule') return item.confidence !== 'low' && item.difficulty !== 'unknown'
    return item.confidence !== 'low' && item.average_goals_scored !== null
  })
  const missing = keys.filter((key) => !available.includes(key))
  const score = Math.round((available.length / keys.length) * 100)
  const level = score >= 75 ? 'high' : score >= 45 ? 'medium' : 'low'
  return { score, level, available, missing, reason: `ข้อมูลจริงพร้อมใช้ ${available.length}/${keys.length} หมวด ระดับ ${level}` }
}

function calculateDataIntelligenceModifier(data: any, baseConfidence = 0, footballModifier = 0) {
  const keys = ['league_position', 'recent_form', 'home_away_form', 'head_to_head', 'strength_of_schedule', 'goal_statistics']
  const scores = keys.map((key) => Number(data[key]?.score ?? 58))
  const average = scores.reduce((total, score) => total + score, 0) / scores.length
  const lowConfidenceCount = keys.filter((key) => data[key]?.confidence === 'low' || data[key]?.level === 'low').length
  let modifier = (average - 58) * 0.12
  if (data.recent_form?.trend === 'positive') modifier += 1.5
  if (data.recent_form?.trend === 'negative') modifier -= 1.5
  if (Number(data.goal_statistics?.score ?? 0) >= 64 && data.goal_statistics?.confidence !== 'low') modifier += 1
  if (data.head_to_head?.confidence !== 'low' && Number(data.head_to_head?.score ?? 0) >= 61) modifier += 1
  if (Number(data.data_confidence?.score ?? 0) < 35) modifier -= 2.5
  else if (Number(data.data_confidence?.score ?? 0) < 60) modifier -= 1
  modifier -= Math.min(3, lowConfidenceCount * 0.35)
  const positiveCap = baseConfidence && baseConfidence < 75 ? Math.max(0, 74 - baseConfidence - Number(footballModifier ?? 0)) : 10
  const total = Number(footballModifier ?? 0) + modifier
  return Math.round(clamp(clamp(total, -10, positiveCap) - Number(footballModifier ?? 0), -10, 10))
}

function getCombinedIntelligenceModifier(baseConfidence: number, footballModifier: number, dataIntelligenceModifier: number) {
  const positiveCap = baseConfidence && baseConfidence < 75 ? Math.max(0, 74 - baseConfidence) : 10
  return Math.round(clamp(Number(footballModifier ?? 0) + Number(dataIntelligenceModifier ?? 0), -10, positiveCap))
}

function calculateDataConsistency(sections: any) {
  const scores = ['league_position', 'recent_form', 'home_away_form', 'head_to_head', 'strength_of_schedule', 'goal_statistics'].map((key) => Number(sections[key]?.score ?? 0)).filter(Boolean)
  if (scores.length < 2) return 58
  const average = scores.reduce((total, score) => total + score, 0) / scores.length
  return Math.round(clamp(100 - (Math.max(...scores) - Math.min(...scores)) * 1.1 - Math.abs(average - 58) * 0.15, 30, 100))
}

function summarizeDataForm(form: any) {
  return { played: Number(form?.played ?? 0), wins: Number(form?.wins ?? 0), draws: Number(form?.draws ?? 0), losses: Number(form?.losses ?? 0), goals_for: Number(form?.goals_for ?? 0), goals_against: Number(form?.goals_against ?? 0), clean_sheets: Number(form?.clean_sheets ?? 0) }
}

function emptyDataForm() {
  return summarizeDataForm({})
}

function formatDataForm(form: any) {
  return `${Number(form?.wins ?? 0)}-${Number(form?.draws ?? 0)}-${Number(form?.losses ?? 0)}`
}

function calculateFootballIntelligence(match: any, context: any = {}) {
  const h2h = calculateH2HIntelligence(match, context)
  const leagueContext = calculateLeagueContext(match)
  const restDays = calculateRestDays(match, context.recentMatches)
  const scheduleDifficulty = calculateScheduleDifficulty(context.recentOpponents)
  const squadContext = calculateSquadContext(match, context.squadData)
  const momentum = calculateMomentum({ home: context.homeForm, away: context.awayForm })
  const matchImportance = calculateMatchImportance(match)
  const intelligence = {
    h2h,
    league_context: leagueContext,
    rest_days: restDays,
    schedule_difficulty: scheduleDifficulty,
    squad_context: squadContext,
    momentum,
    match_importance: matchImportance,
  }
  const modifier = calculateIntelligenceModifier(intelligence, context.baseConfidence)
  const signals = collectIntelligenceSignals(intelligence)

  return {
    ...intelligence,
    ai_explanation: {
      summary: buildFootballIntelligenceExplanation(intelligence, modifier),
      signals,
      data_confidence: getIntelligenceDataConfidence(intelligence),
    },
    modifier,
    signals,
  }
}

function calculateH2HIntelligence(match: any, context: any = {}) {
  const h2hMatches = getH2HMatches(match, context)
  if (!h2hMatches.length) {
    return { score: 58, confidence: 'low', reason: 'ยังไม่มีข้อมูล H2H เพียงพอ', signals: ['missing_h2h'] }
  }

  const latest10 = h2hMatches.slice(0, 10)
  const latest5 = latest10.slice(0, 5)
  const homeId = getTeamId(match.homeTeam)
  const awayId = getTeamId(match.awayTeam)
  const samples = summarizeH2H(latest10, homeId, awayId)
  const homeAwaySamples = latest10.filter((item: any) => getTeamId(item.homeTeam) === homeId && getTeamId(item.awayTeam) === awayId)
  const goalsAverage = samples.played ? (samples.goals / samples.played).toFixed(2) : null
  const confidence = latest10.length >= 8 ? 'high' : latest10.length >= 4 ? 'medium' : 'low'
  const signals = [
    `h2h_${latest5.length}_of_5_available`,
    `h2h_${latest10.length}_of_10_available`,
    homeAwaySamples.length ? `home_away_history_${homeAwaySamples.length}` : 'home_away_history_limited',
  ]
  if (goalsAverage) signals.push(`h2h_goals_avg_${goalsAverage}`)

  return {
    score: Math.round(clamp(56 + (samples.homeWins - samples.awayWins) * 3 + Math.min(latest5.length, 5), 45, 76)),
    confidence,
    reason: `H2H มีข้อมูลจริง ${latest10.length} นัดล่าสุด เจ้าบ้านชนะ ${samples.homeWins} เสมอ ${samples.draws} ทีมเยือนชนะ ${samples.awayWins}${goalsAverage ? ` ค่าเฉลี่ยประตู ${goalsAverage}` : ''}`,
    signals,
  }
}

function calculateLeagueContext(match: any) {
  const type = classifyCompetition(getCompetitionText(match))
  const byType: Record<string, any> = {
    league: { score: 62, risk_modifier: -1, reason: 'รายการลีกมีบริบทต่อเนื่องและประเมินเสถียรกว่า' },
    cup: { score: 58, risk_modifier: 2, reason: 'รายการถ้วยมีแรงจูงใจสูง แต่ความผันผวนมากขึ้น' },
    friendly: { score: 52, risk_modifier: 3, reason: 'เกมกระชับมิตรมีความเสี่ยงจากการทดลองทีมและแรงจูงใจต่ำกว่า' },
    international: { score: 57, risk_modifier: 1, reason: 'เกมทีมชาติมีบริบทเฉพาะและข้อมูลสโมสรใช้ได้จำกัด' },
    youth: { score: 53, risk_modifier: 2, reason: 'รายการเยาวชนมีความนิ่งของข้อมูลต่ำกว่ารายการหลัก' },
    women: { score: 54, risk_modifier: 2, reason: 'รายการหญิงอาจมี coverage ข้อมูลน้อยกว่ารายการหลัก' },
    unknown: { score: 58, risk_modifier: 0, reason: 'ยังจำแนกประเภทการแข่งขันไม่ได้ชัด จึงให้ค่ากลาง' },
  }

  return { type, ...byType[type] }
}

function calculateRestDays(match: any, recentMatches: any) {
  const homeRestDays = getRestDays(match, getTeamRecentMatches(recentMatches, 'home'))
  const awayRestDays = getRestDays(match, getTeamRecentMatches(recentMatches, 'away'))

  if (homeRestDays === null && awayRestDays === null) {
    return { home_rest_days: null, away_rest_days: null, score: 58, advantage: 'none', reason: 'ยังไม่มีข้อมูลวันพักทีมล่าสุด' }
  }

  const diff = (homeRestDays ?? 0) - (awayRestDays ?? 0)
  const advantage = Math.abs(diff) >= 2 ? (diff > 0 ? 'home' : 'away') : 'none'

  return {
    home_rest_days: homeRestDays,
    away_rest_days: awayRestDays,
    score: Math.round(clamp(58 + scoreRestDays(homeRestDays) - scoreRestDays(awayRestDays), 45, 72)),
    advantage,
    reason: `วันพักล่าสุด เจ้าบ้าน ${formatRestDays(homeRestDays)} ทีมเยือน ${formatRestDays(awayRestDays)} ภาพรวมได้เปรียบ: ${advantage}`,
  }
}

function calculateScheduleDifficulty(recentOpponents: any) {
  const opponents = flattenRecentOpponents(recentOpponents)
  const rated = opponents.map(getOpponentDifficulty).filter((value: number | null) => value !== null)

  if (!rated.length) {
    return { score: 58, difficulty: 'unknown', reason: 'ยังไม่มีข้อมูลคุณภาพคู่แข่ง 3-5 นัดล่าสุดเพียงพอ', confidence: 'low' }
  }

  const average = rated.reduce((total: number, value: number | null) => total + Number(value ?? 0), 0) / rated.length
  const difficulty = average >= 68 ? 'hard' : average <= 42 ? 'easy' : 'medium'

  return {
    score: difficulty === 'hard' ? 54 : difficulty === 'easy' ? 62 : 58,
    difficulty,
    reason: `ประเมินความยากคู่แข่งล่าสุดจากข้อมูลจริง ${rated.length} รายการ ระดับ ${difficulty}`,
    confidence: rated.length >= 6 ? 'high' : rated.length >= 3 ? 'medium' : 'low',
  }
}

function calculateSquadContext(match: any, squadData: any) {
  const data = squadData ?? match.squadData
  if (!data || (Array.isArray(data) && !data.length)) {
    return { score: 58, confidence: 'low', reason: 'ยังไม่มีข้อมูลตัวผู้เล่น/อาการบาดเจ็บเพียงพอ', signals: ['missing_squad_data'] }
  }

  const injuries = countItems(data.injuries ?? data.injury)
  const suspensions = countItems(data.suspensions ?? data.suspension)
  const missingKeyPlayers = countItems(data.missing_key_players ?? data.missingKeyPlayers)
  const rotationRisk = Boolean(data.rotation || data.rotation_risk)
  const penalty = injuries * 1.5 + suspensions * 2 + missingKeyPlayers * 3 + (rotationRisk ? 3 : 0)
  const signals = []
  if (injuries) signals.push(`injuries_${injuries}`)
  if (suspensions) signals.push(`suspensions_${suspensions}`)
  if (missingKeyPlayers) signals.push(`missing_key_players_${missingKeyPlayers}`)
  if (rotationRisk) signals.push('rotation_risk')

  return {
    score: Math.round(clamp(62 - penalty, 35, 68)),
    confidence: signals.length ? 'medium' : 'low',
    reason: signals.length ? 'มีข้อมูล squad จริงบางส่วนและนำมาหักความเสี่ยงตามผลกระทบ' : 'มีข้อมูล squad แต่ยังไม่พบสัญญาณผู้เล่นสำคัญชัดเจน',
    signals,
  }
}

function calculateMomentum(formData: any) {
  const homeForm = formData?.home
  const awayForm = formData?.away
  const played = Number(homeForm?.played ?? 0) + Number(awayForm?.played ?? 0)

  if (!played) {
    return { score: 56, momentum: 'unknown', signals: ['missing_detailed_form'], reason: 'ยังไม่มีข้อมูลโมเมนตัมละเอียด จึงไม่เดาเพิ่มจากข้อมูลที่ไม่มี' }
  }

  const pointsRate = ((formPoints(homeForm) + formPoints(awayForm)) / Math.max(played * 3, 1)) * 100
  const goalsPerMatch = (Number(homeForm?.goals_for ?? 0) + Number(awayForm?.goals_for ?? 0)) / Math.max(played, 1)
  const concededPerMatch = (Number(homeForm?.goals_against ?? 0) + Number(awayForm?.goals_against ?? 0)) / Math.max(played, 1)
  const cleanSheets = Number(homeForm?.clean_sheets ?? 0) + Number(awayForm?.clean_sheets ?? 0)
  const signals = []
  if (goalsPerMatch >= 1.5) signals.push('scoring_trend_positive')
  if (concededPerMatch >= 1.7) signals.push('conceding_trend_risky')
  if (cleanSheets >= 3) signals.push('clean_sheet_support')
  const score = Math.round(clamp(44 + pointsRate * 0.35 + goalsPerMatch * 6 - concededPerMatch * 4 + cleanSheets * 1.5, 35, 78))

  return {
    score,
    momentum: score >= 63 ? 'positive' : score <= 49 ? 'negative' : 'neutral',
    signals: signals.length ? signals : ['form_proxy_used'],
    reason: 'ใช้ข้อมูล goals/form จาก v2 เป็น proxy โดยไม่เดาสถิติที่ยังไม่มี',
  }
}

function calculateMatchImportance(match: any) {
  const text = `${getCompetitionText(match)} ${match.round ?? ''} ${match.stage ?? ''} ${match.group ?? ''}`.toLowerCase()
  const leagueContext = calculateLeagueContext(match)
  const knockout = ['final', 'semi', 'quarter', 'last 16', 'last_16', 'playoff', 'knockout'].some((item) => text.includes(item))

  if (leagueContext.type === 'friendly') return { score: 50, importance: 'low', risk_modifier: 2, reason: 'Friendly มีความสำคัญเชิงผลการแข่งขันต่ำกว่า' }
  if (knockout) return { score: 64, importance: 'high', risk_modifier: 2, reason: 'รอบน็อกเอาต์/รอบลึกมีความสำคัญสูง แต่ variance สูงขึ้น' }
  if (leagueContext.type === 'league') return { score: 59, importance: 'medium', risk_modifier: -1, reason: 'เกมลีกปกติมีแรงจูงใจและรูปแบบค่อนข้างเสถียร' }
  return { score: 58, importance: leagueContext.type === 'unknown' ? 'unknown' : 'medium', risk_modifier: leagueContext.risk_modifier > 0 ? 1 : 0, reason: 'ยังไม่มี league table context เพียงพอ จึงไม่สรุป must-win เอง' }
}

function calculateIntelligenceModifier(intelligence: any, baseConfidence = 0) {
  const scores = [
    intelligence.h2h.score,
    intelligence.league_context.score,
    intelligence.rest_days.score,
    intelligence.schedule_difficulty.score,
    intelligence.squad_context.score,
    intelligence.momentum.score,
    intelligence.match_importance.score,
  ]
  const averageScore = scores.reduce((total, score) => total + Number(score ?? 0), 0) / scores.length
  const riskModifier = Number(intelligence.league_context.risk_modifier ?? 0) + Number(intelligence.match_importance.risk_modifier ?? 0)
  const lowConfidencePenalty = [intelligence.h2h, intelligence.schedule_difficulty, intelligence.squad_context].filter((item) => item.confidence === 'low').length * 0.4
  const rawModifier = (averageScore - 58) * 0.22 - riskModifier * 0.8 - lowConfidencePenalty
  const highConfidenceSupport = [intelligence.h2h, intelligence.schedule_difficulty, intelligence.squad_context].filter((item) => ['medium', 'high'].includes(item.confidence)).length
  const positiveCap = baseConfidence && baseConfidence < 73 ? 2 : highConfidenceSupport >= 2 ? 6 : 4

  return Math.round(clamp(rawModifier, -6, positiveCap))
}

function calculateOverallRisk(breakdown: any, confidence: number, dataCompleteness: number, intelligence: any) {
  const scores = [
    breakdown.team_strength.score,
    breakdown.recent_form.score,
    breakdown.attack_quality.score,
    breakdown.defensive_stability.score,
    breakdown.home_away_advantage.score,
    breakdown.away_weakness.score,
    breakdown.motivation_context.score,
    breakdown.market_odds_risk.score,
  ]
  const spread = Math.max(...scores) - Math.min(...scores)
  const weakCore = ['team_strength', 'recent_form', 'attack_quality', 'defensive_stability'].filter((key) => breakdown[key].score < 45).length
  const marketRiskWeak = breakdown.market_odds_risk.score < 45
  const marketDataMissing = breakdown.market_odds_risk.has_market_data === false
  const leagueType = intelligence?.league_context?.type
  const dataConfidence = intelligence?.ai_explanation?.data_confidence ?? getIntelligenceDataConfidence(intelligence)
  const totalRiskModifier = Number(intelligence?.league_context?.risk_modifier ?? 0) + Number(intelligence?.match_importance?.risk_modifier ?? 0)
  const lowConfidenceSignals = [intelligence?.h2h, intelligence?.schedule_difficulty, intelligence?.squad_context].filter((item) => item?.confidence === 'low').length

  if (confidence < 48 || weakCore >= 2 || spread >= 42 || marketRiskWeak || (leagueType === 'friendly' && dataConfidence === 'low') || (totalRiskModifier >= 4 && confidence < 68) || (marketDataMissing && confidence < 50)) {
    return { level: 'HIGH', reason: 'คะแนนสำคัญอ่อน/ขัดแย้ง หรือบริบทการแข่งขันมี variance สูง จึงจัดเป็นความเสี่ยงสูง' }
  }
  if (!marketDataMissing && confidence >= 72 && dataCompleteness >= 70 && spread <= 28 && totalRiskModifier <= 1 && lowConfidenceSignals <= 1) {
    return { level: 'LOW', reason: 'หลายโมดูลให้ภาพสอดคล้องกัน ข้อมูลรองรับค่อนข้างครบ และ risk modifier ต่ำ' }
  }
  return {
    level: 'MEDIUM',
    reason: marketDataMissing
      ? 'ข้อมูลตลาดยังจำกัด จึงคุมความเสี่ยงไว้ระดับกลางและหลีกเลี่ยง BET เว้นแต่คะแนนฝั่งฟุตบอลแข็งมาก'
      : 'ข้อมูลยังไม่ครบทุกมิติ แต่ไม่มีสัญญาณอันตรายชัด จึงคงความเสี่ยงระดับกลาง',
  }
}

function buildAnalysisSummary(match: any, confidence: number, riskLevel: string, recommendation: string, breakdown: any) {
  const summaryModules = [
    { label: 'Team Strength', score: breakdown.team_strength.score },
    { label: 'Recent Form', score: breakdown.recent_form.score },
    { label: 'Home Advantage', score: breakdown.home_away_advantage.score },
    { label: 'Away Weakness', score: breakdown.away_weakness.score },
    { label: 'Goal Scoring', score: breakdown.attack_quality.score },
    { label: 'Defensive Stability', score: breakdown.defensive_stability.score },
    { label: 'Motivation & Context', score: breakdown.motivation_context.score },
    { label: 'Market Risk', score: breakdown.market_odds_risk.score },
  ]
  const bestModule = [...summaryModules].sort((a, b) => b.score - a.score)[0]
  const weakestModule = [...summaryModules].sort((a, b) => a.score - b.score)[0]
  const marketMissing = breakdown.market_odds_risk?.has_market_data === false
  const riskText = riskLevel === 'LOW' ? 'ต่ำ' : riskLevel === 'HIGH' ? 'สูง' : 'กลาง'
  const marketText = marketMissing ? ' ข้อมูลตลาดยังจำกัด จึงไม่ควรไล่ราคาแรง' : ''
  const caution = recommendation === 'BET'
    ? 'ยังควรเช็กไลน์อัปและราคาใกล้แข่งก่อนเข้า'
    : recommendation === 'LEAN'
      ? 'เหมาะติดตามหรือรอราคานิ่งมากกว่า BET เต็มตัว'
      : 'ควรข้ามหรือรอข้อมูลใหม่ก่อน'

  return `แนะนำ ${recommendation} เพราะความมั่นใจ ${confidence}/100 และความเสี่ยงระดับ${riskText}. จุดหนุนคือ ${bestModule.label} ${bestModule.score}/100 แต่ความเสี่ยงหลักอยู่ที่ ${weakestModule.label} ${weakestModule.score}/100.${marketText} ${caution}`
}

function logFootballIntelligenceV3({ match, baseConfidence, footballModifier, dataIntelligenceModifier, intelligenceModifier, confidence, riskLevel, recommendation, modules, intelligenceSignals }: any) {
  console.info('football-intelligence-v3', {
    providerMatchId: match.id,
    homeTeam: match.homeTeam?.name ?? null,
    awayTeam: match.awayTeam?.name ?? null,
    baseConfidence,
    footballModifier,
    dataIntelligenceModifier,
    intelligenceModifier,
    finalConfidence: confidence,
    riskLevel,
    recommendation,
    moduleScores: modules,
    intelligenceSignals,
  })
}

function buildFootballIntelligenceExplanation(intelligence: any, modifier: number) {
  return `v3 ประเมินบริบทเป็น ${intelligence.league_context.type}, momentum ${intelligence.momentum.momentum}, H2H confidence ${intelligence.h2h.confidence}, squad confidence ${intelligence.squad_context.confidence}; modifier ${formatSigned(modifier)}`
}

function buildContextSummary(intelligence: any) {
  const parts = [
    `บริบทการแข่งขันเป็น ${intelligence?.league_context?.type ?? 'unknown'}`,
    `โมเมนตัม ${intelligence?.momentum?.momentum ?? 'unknown'}`,
  ]
  if (intelligence?.h2h?.confidence === 'low') parts.push('ข้อมูล H2H ยังจำกัด')
  if (intelligence?.squad_context?.confidence === 'low') parts.push('ข้อมูลตัวผู้เล่นยังจำกัด')
  if (Number(intelligence?.match_importance?.risk_modifier ?? 0) > 0) parts.push('รายการมีความผันผวนเพิ่มขึ้น')
  return parts.join(', ')
}

function collectIntelligenceSignals(intelligence: any) {
  return [
    ...(intelligence?.h2h?.signals ?? []),
    ...(intelligence?.squad_context?.signals ?? []),
    ...(intelligence?.momentum?.signals ?? []),
    `league_${intelligence?.league_context?.type ?? 'unknown'}`,
    `importance_${intelligence?.match_importance?.importance ?? 'unknown'}`,
    `schedule_${intelligence?.schedule_difficulty?.difficulty ?? 'unknown'}`,
    `rest_advantage_${intelligence?.rest_days?.advantage ?? 'none'}`,
  ]
}

function getIntelligenceDataConfidence(intelligence: any) {
  const confidenceValues = [intelligence?.h2h, intelligence?.schedule_difficulty, intelligence?.squad_context]
    .map((item) => item?.confidence)
    .filter(Boolean)
  const highOrMedium = confidenceValues.filter((value) => ['medium', 'high'].includes(value)).length
  if (highOrMedium >= 3) return 'high'
  if (highOrMedium >= 2) return 'medium'
  return 'low'
}

function getH2HMatches(match: any, context: any) {
  const candidates = [
    context.h2hMatches,
    context.h2h?.matches,
    context.h2h,
    match.h2h?.matches,
    match.head_to_head,
  ]
  return candidates.find((candidate) => Array.isArray(candidate) && candidate.length) ?? []
}

function summarizeH2H(matches: Array<any>, homeId: number, awayId: number) {
  return matches.reduce(
    (total, item) => {
      const homeGoals = item.score?.fullTime?.home ?? item.home_goals ?? item.homeGoals
      const awayGoals = item.score?.fullTime?.away ?? item.away_goals ?? item.awayGoals
      if (homeGoals === null || homeGoals === undefined || awayGoals === null || awayGoals === undefined) return total
      const itemHomeId = getTeamId(item.homeTeam)
      const itemAwayId = getTeamId(item.awayTeam)
      const homeSideGoals = itemHomeId === homeId ? homeGoals : itemAwayId === homeId ? awayGoals : null
      const awaySideGoals = itemAwayId === awayId ? awayGoals : itemHomeId === awayId ? homeGoals : null
      if (homeSideGoals === null || awaySideGoals === null) return total
      total.played += 1
      total.goals += Number(homeGoals ?? 0) + Number(awayGoals ?? 0)
      if (homeSideGoals > awaySideGoals) total.homeWins += 1
      else if (homeSideGoals < awaySideGoals) total.awayWins += 1
      else total.draws += 1
      return total
    },
    { played: 0, goals: 0, homeWins: 0, awayWins: 0, draws: 0 },
  )
}

function classifyCompetition(name: string) {
  const text = String(name ?? '').toLowerCase()
  if (!text) return 'unknown'
  if (['women', 'womens', 'feminine'].some((item) => text.includes(item))) return 'women'
  if (['u17', 'u18', 'u19', 'u20', 'u21', 'u23', 'youth'].some((item) => text.includes(item))) return 'youth'
  if (['friendly', 'friendlies'].some((item) => text.includes(item))) return 'friendly'
  if (['world cup', 'euro', 'nations league', 'afcon', 'copa america', 'international'].some((item) => text.includes(item))) return 'international'
  if (['cup', 'trophy', 'knockout', 'playoff', 'play-off'].some((item) => text.includes(item))) return 'cup'
  if (['league', 'division', 'serie', 'liga', 'bundesliga', 'premier', 'championship'].some((item) => text.includes(item))) return 'league'
  return 'unknown'
}

function getCompetitionText(match: any) {
  return [match.competition?.name, match.league?.name, match.name].filter(Boolean).join(' ')
}

function getTeamRecentMatches(recentMatches: any, side: string) {
  if (!recentMatches) return []
  if (Array.isArray(recentMatches)) return recentMatches
  return recentMatches[side] ?? recentMatches[`${side}Matches`] ?? []
}

function getRestDays(match: any, recentMatches: Array<any>) {
  if (!Array.isArray(recentMatches) || !recentMatches.length) return null
  const matchTime = new Date(match.utcDate ?? match.kickoff_at ?? match.kickoffAt ?? Date.now()).getTime()
  const previous = recentMatches
    .map((item) => new Date(item.utcDate ?? item.kickoff_at ?? item.kickoffAt ?? item.date ?? 0).getTime())
    .filter((time) => Number.isFinite(time) && time > 0 && time < matchTime)
    .sort((a, b) => b - a)[0]
  if (!previous) return null
  return Math.max(0, Math.floor((matchTime - previous) / 86400000))
}

function scoreRestDays(days: number | null) {
  if (days === null) return 0
  if (days <= 2) return -5
  if (days <= 5) return 0
  if (days <= 9) return 4
  if (days > 14) return -2
  return 1
}

function formatRestDays(days: number | null) {
  return days === null ? 'ไม่ทราบ' : `${days} วัน`
}

function flattenRecentOpponents(recentOpponents: any) {
  if (!recentOpponents) return []
  if (Array.isArray(recentOpponents)) return recentOpponents
  return [...(recentOpponents.home ?? []), ...(recentOpponents.away ?? [])]
}

function getOpponentDifficulty(item: any) {
  const opponent = item.opponent ?? item.awayTeam ?? item.homeTeam ?? item.team
  const position = Number(opponent?.position ?? item.position ?? 0)
  const points = Number(opponent?.points ?? item.points ?? 0)
  const rating = Number(opponent?.rating ?? item.rating ?? item.strength ?? 0)
  if (rating) return clamp(rating, 0, 100)
  if (position) return clamp(82 - position * 3, 20, 85)
  if (points) return clamp(points, 20, 85)
  return null
}

function countItems(value: any) {
  if (Array.isArray(value)) return value.length
  if (typeof value === 'number') return value
  if (value && typeof value === 'object') return Object.keys(value).length
  return value ? 1 : 0
}

function getTeamId(team: any) {
  return Number(team?.api_team_id ?? team?.id ?? team?.apiTeamId ?? 0)
}

function formatSigned(value: number) {
  return `${value >= 0 ? '+' : ''}${value}`
}

function summarizeRecentForm(matches: Array<any>, teamId: number) {
  return matches.reduce(
    (total, match) => {
      const isHome = match.homeTeam?.id === teamId
      const homeGoals = match.score?.fullTime?.home
      const awayGoals = match.score?.fullTime?.away
      const goalsFor = Number(isHome ? homeGoals : awayGoals ?? 0)
      const goalsAgainst = Number(isHome ? awayGoals : homeGoals ?? 0)

      if (homeGoals === null || homeGoals === undefined || awayGoals === null || awayGoals === undefined) {
        return total
      }

      total.played += 1
      total.goals_for += goalsFor
      total.goals_against += goalsAgainst

      if (goalsFor > goalsAgainst) total.wins += 1
      else if (goalsFor === goalsAgainst) total.draws += 1
      else total.losses += 1

      if (goalsAgainst === 0) total.clean_sheets += 1
      if (goalsFor === 0) total.failed_to_score += 1

      return total
    },
    { played: 0, wins: 0, draws: 0, losses: 0, goals_for: 0, goals_against: 0, clean_sheets: 0, failed_to_score: 0 },
  )
}

function findStanding(standings: Array<any>, teamId: number) {
  const totalTable = standings.find((standing) => standing.type === 'TOTAL')?.table ?? standings[0]?.table ?? []
  return totalTable.find((row: any) => row.team?.id === teamId)
}

async function resetMatchesForRange(dateFrom: string, dateTo: string) {
  const range = dateRangeBangkok(dateFrom, dateTo)
  const resetResult = await supabase.from('football_matches').delete().gte('kickoff_at', range.start).lt('kickoff_at', range.end)
  if (resetResult.error) throw resetResult.error
}

function formatRound(match: any) {
  return [match.stage, match.group, match.matchday ? `Matchday ${match.matchday}` : ''].filter(Boolean).join(' · ') || null
}

function buildThaiReason(homeForm: Record<string, number>, awayForm: Record<string, number>, confidence: number, riskLevel: string) {
  const riskText = riskLevel === 'low' ? 'ความเสี่ยงโดยรวมต่ำ' : riskLevel === 'medium' ? 'ยังมีจุดที่ต้องติดตามก่อนแข่ง' : 'ความเสี่ยงสูงกว่าปกติ'
  return `ทีมเหย้ามีผลงาน 5 นัดหลัง ชนะ ${homeForm.wins} เสมอ ${homeForm.draws} แพ้ ${homeForm.losses} ยิงได้ ${homeForm.goals_for} ประตู ส่วนทีมเยือนชนะ ${awayForm.wins} เสมอ ${awayForm.draws} แพ้ ${awayForm.losses} ระบบประเมินความมั่นใจที่ ${confidence}% และ${riskText}`
}

async function finishLog(logId: string | null, status: string, message: string, raw: unknown) {
  if (!logId) {
    await supabase.from('sync_logs').insert({ sync_type: 'football-data.org', status, message, finished_at: new Date().toISOString(), raw })
    return
  }

  await supabase.from('sync_logs').update({ status, message, finished_at: new Date().toISOString(), raw }).eq('id', logId)
}

function assertRuntimeConfig() {
  if (!TOKEN) throw new Error('Missing FOOTBALL_API_KEY Supabase secret')
  if (!BASE_URL) throw new Error('Missing FOOTBALL_API_BASE_URL Supabase secret')
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing Supabase service credentials')
  if (!secretKeys.length) throw new Error('Missing Supabase secret API keys')
}

function getServiceAuthError(request: Request) {
  const apiKey = sanitizeHeaderValue(request.headers.get('apikey') ?? '')

  if (apiKey && secretKeys.includes(apiKey)) return null

  return new Response(JSON.stringify({ ok: false, message: 'Unauthorized sync request' }), {
    status: 401,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function parseSupabaseSecretKeys(value: string | undefined | null) {
  if (!value) return []

  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object') return []
    return Object.values(parsed).map((key) => sanitizeHeaderValue(String(key))).filter(Boolean)
  } catch {
    return []
  }
}

function sanitizeUrl(value: string) {
  return value.trim().replace(/^["'<]+|[>"']+$/g, '').replace(/\/$/, '')
}

function sanitizeHeaderValue(value: string) {
  return value.trim().replace(/^["'<]+|[>"']+$/g, '').replace(/[^\x20-\x7E]/g, '')
}

function todayBangkok() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function tomorrowBangkok(date = todayBangkok()) {
  const tomorrow = new Date(`${date}T00:00:00+07:00`)
  tomorrow.setDate(tomorrow.getDate() + 1)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(tomorrow)
}

function getSyncDateRange(body: Record<string, unknown>) {
  const today = todayBangkok()
  const dateFrom = typeof body.dateFrom === 'string' && body.dateFrom ? body.dateFrom : today
  const dateTo = typeof body.dateTo === 'string' && body.dateTo ? body.dateTo : tomorrowBangkok(today)

  return { dateFrom, dateTo }
}

function dateRangeBangkok(dateFrom: string, dateTo: string) {
  const start = new Date(`${dateFrom}T00:00:00+07:00`)
  const end = new Date(`${dateTo}T00:00:00+07:00`)
  end.setDate(end.getDate() + 1)

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
}

function serializeError(error: unknown) {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack }
  return error
}

async function safeJson(request: Request) {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
