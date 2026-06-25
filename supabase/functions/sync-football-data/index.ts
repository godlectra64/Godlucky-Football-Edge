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
    const failures: Array<{ matchId?: number; message: string }> = []

    for (const footballDataMatch of matches) {
      try {
        await syncMatch(footballDataMatch)
        processed += 1
      } catch (error) {
        failures.push({
          matchId: footballDataMatch?.id,
          message: error instanceof Error ? error.message : 'match sync failed',
        })
      }
    }

    const recomputedStoredRows = body.recomputeStoredAnalysisRows ? await recomputeStoredAnalysisRows(Number(body.recomputeStoredLimit ?? 50)) : 0
    const normalizedAnalysisRows = await normalizeLegacyAnalysisRows()
    const total = matches.length
    const status = failures.length ? 'partial_success' : 'success'
    const message = total === 0
      ? 'ไม่พบคู่แข่งขันวันนี้และพรุ่งนี้'
      : failures.length
      ? `บันทึกข้อมูล ${processed} คู่ และมีข้อผิดพลาด ${failures.length} คู่`
      : `บันทึกข้อมูล ${processed} คู่`

    await finishLog(logId, status, message, {
      provider: 'football-data.org',
      dateFrom,
      dateTo,
      competitions: competitions.length,
      total,
      processed,
      recomputedStoredRows,
      normalizedAnalysisRows,
      failures,
    })

    return json({ ok: true, provider: 'football-data.org', dateFrom, dateTo, processed, total, recomputedStoredRows, normalizedAnalysisRows, failures })
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
  })

  await upsertMatchAnalysis(matchResult.data.id, analysis)
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
  const nextPayload = {
    match_id: matchId,
    team_strength_score: analysis.team_strength_score,
    form_score: analysis.form_score,
    home_advantage_score: analysis.home_advantage_score,
    away_weakness_score: analysis.away_weakness_score,
    goal_scoring_score: analysis.goal_scoring_score,
    defensive_stability_score: analysis.defensive_stability_score,
    motivation_score: analysis.motivation_score,
    market_risk_score: analysis.market_risk_score,
    confidence_score: analysis.confidence_score,
    recommendation: analysis.recommendation,
    risk_level: analysis.risk_level,
    analysis_summary: analysis.analysis_summary,
    thai_reason: analysis.thai_reason,
    raw: analysis,
  }

  const nextResult = await supabase.from('match_analysis').upsert(nextPayload, { onConflict: 'match_id' })
  if (!nextResult.error) return

  const legacyResult = await supabase.from('match_analysis').upsert(
    {
      match_id: matchId,
      team_strength_score: analysis.team_strength_score,
      form_score: analysis.form_score,
      goal_quality_score: analysis.goal_scoring_score,
      home_away_score: analysis.home_advantage_score,
      motivation_score: analysis.motivation_score,
      market_context_score: analysis.market_risk_score,
      risk_score: analysis.market_risk_score,
      confidence_score: analysis.confidence_score,
      recommendation: analysis.recommendation,
      risk_level: analysis.risk_level,
      thai_reason: analysis.thai_reason,
      raw: analysis,
    },
    { onConflict: 'match_id' },
  )

  if (legacyResult.error) throw nextResult.error
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
    })

    await upsertMatchAnalysis(row.id, analysis)
    recomputed += 1
  }

  return recomputed
}

async function normalizeLegacyAnalysisRows() {
  const result = await supabase
    .from('match_analysis')
    .select('id, confidence_score, recommendation, risk_level, analysis_summary, thai_reason, raw')
    .limit(1000)

  if (result.error) throw result.error

  let normalized = 0

  for (const row of result.data ?? []) {
    const confidence = Math.round(clamp(Number(row.confidence_score ?? row.raw?.confidence_score ?? 0), 0, 100))
    const riskLevel = ['low', 'medium', 'high'].includes(String(row.risk_level ?? '').toLowerCase())
      ? String(row.risk_level).toLowerCase()
      : ['low', 'medium', 'high'].includes(String(row.raw?.risk_level ?? '').toLowerCase())
      ? String(row.raw.risk_level).toLowerCase()
      : 'medium'
    const recommendation = getRecommendationFromConfidence(confidence, riskLevel)
    const analysisSummary = row.analysis_summary || row.raw?.analysis_summary || row.thai_reason || `Football Master Framework ให้คะแนน ${confidence}/100 คำแนะนำ ${recommendation}`

    if (row.analysis_summary && row.recommendation === recommendation && row.risk_level === riskLevel) {
      continue
    }

    const updateResult = await supabase
      .from('match_analysis')
      .update({
        analysis_summary: analysisSummary,
        recommendation,
        risk_level: riskLevel,
      })
      .eq('id', row.id)

    if (updateResult.error) throw updateResult.error
    normalized += 1
  }

  return normalized
}

function analyzeMatch({ match, homeForm, awayForm, standings, leaguePriority }: any) {
  const homeStanding = findStanding(standings, match.homeTeam?.id)
  const awayStanding = findStanding(standings, match.awayTeam?.id)
  const dataCompleteness = getDataCompletenessFromSource(match, homeForm, awayForm, standings)
  const analysisBreakdown = buildModuleBreakdown(match, homeForm, awayForm, homeStanding, awayStanding, leaguePriority)
  const confidence = Math.round(
    analysisBreakdown.team_strength.score * 0.18 +
      analysisBreakdown.recent_form.score * 0.17 +
      analysisBreakdown.attack_quality.score * 0.15 +
      analysisBreakdown.defensive_stability.score * 0.15 +
      analysisBreakdown.home_away_advantage.score * 0.12 +
      analysisBreakdown.motivation_context.score * 0.1 +
      analysisBreakdown.market_odds_risk.score * 0.13,
  )
  const overallRisk = calculateOverallRisk(analysisBreakdown, confidence, dataCompleteness)
  analysisBreakdown.overall_risk = overallRisk
  const riskLevel = overallRisk.level
  const roundedModules = {
    teamStrength: analysisBreakdown.team_strength.score,
    recentForm: analysisBreakdown.recent_form.score,
    attackQuality: analysisBreakdown.attack_quality.score,
    defensiveStability: analysisBreakdown.defensive_stability.score,
    homeAwayAdvantage: analysisBreakdown.home_away_advantage.score,
    motivationContext: analysisBreakdown.motivation_context.score,
    marketOddsRisk: analysisBreakdown.market_odds_risk.score,
  }
  const recommendation = getRecommendationFromConfidence(confidence, riskLevel)
  logAnalysisV2Breakdown({
    match,
    confidence,
    riskLevel,
    recommendation,
    modules: roundedModules,
  })
  const analysisSummary = buildAnalysisSummary(match, confidence, riskLevel, recommendation, analysisBreakdown)

  return {
    provider: 'football-data.org',
    framework: 'football-master-v2',
    team_strength_score: analysisBreakdown.team_strength.score,
    form_score: analysisBreakdown.recent_form.score,
    home_advantage_score: analysisBreakdown.home_away_advantage.score,
    away_weakness_score: 0,
    goal_scoring_score: analysisBreakdown.attack_quality.score,
    defensive_stability_score: analysisBreakdown.defensive_stability.score,
    motivation_score: analysisBreakdown.motivation_context.score,
    market_risk_score: analysisBreakdown.market_odds_risk.score,
    confidence_score: confidence,
    recommendation,
    risk_level: riskLevel,
    analysis_summary: analysisSummary,
    thai_reason: analysisSummary,
    modules: roundedModules,
    analysis_breakdown: analysisBreakdown,
    data_completeness: dataCompleteness,
    homeForm,
    awayForm,
    standings,
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

function scoreMotivationContext(match: any, leaguePriority: number) {
  const stage = String(match.stage ?? match.group ?? match.round ?? '').toLowerCase()
  const knockoutBoost = ['final', 'semi', 'quarter', 'last_16', 'playoff'].some((item) => stage.includes(item)) ? 8 : 0
  const priorityScore = leaguePriority <= 15 ? 65 : leaguePriority <= 30 ? 61 : leaguePriority <= 50 ? 58 : 55
  const score = clamp(priorityScore + knockoutBoost, 52, 78)
  return moduleResult(score, knockoutBoost ? 'รายการหรือรอบการแข่งขันเพิ่มแรงจูงใจเชิงบริบท' : 'ข้อมูลแรงจูงใจยังจำกัด จึงใช้คะแนนกลางตามความสำคัญรายการ')
}

function scoreMarketOddsRisk(match: any, homeForm: any, awayForm: any) {
  const hasOdds = Boolean(match.odds || match.market || match.bookmakers)
  if (!hasOdds) return moduleResult(60, 'ยังไม่มีข้อมูลราคาเพียงพอ จึงประเมินแบบกลางและไม่ยกระดับเป็น high risk อัตโนมัติ')

  const formGap = Math.abs(formPoints(homeForm) - formPoints(awayForm))
  const score = clamp(58 + Math.min(formGap, 8) * 2.2, 42, 82)
  return moduleResult(score, 'มีข้อมูลตลาดบางส่วนและใช้ร่วมกับความต่างของฟอร์มเพื่อประเมินความเสี่ยง')
}

function calculateOverallRisk(breakdown: any, confidence: number, dataCompleteness: number) {
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
    return { level: 'high', reason: 'คะแนนสำคัญหลายด้านอ่อนหรือขัดแย้งกันมาก จึงจัดเป็นความเสี่ยงสูง' }
  }
  if (confidence >= 72 && dataCompleteness >= 70 && spread <= 28) {
    return { level: 'low', reason: 'หลายโมดูลให้ภาพสอดคล้องกันและข้อมูลรองรับค่อนข้างครบ' }
  }
  return { level: 'medium', reason: 'มีข้อมูลสนับสนุนบางส่วน แต่ยังไม่ครบทุกมิติหรือคะแนนยังไม่สอดคล้องเต็มที่' }
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
  if (String(riskLevel).toLowerCase() === 'high') return 'NO BET'
  if (confidence >= 75) return 'BET'
  if (confidence >= 62) return 'LEAN'
  return 'NO BET'
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

function buildAnalysisSummary(match: any, confidence: number, riskLevel: string, recommendation: string, breakdown: any) {
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
