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

const supabase = createClient(supabaseUrl, serviceRoleKey)

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const startedAt = new Date().toISOString()
  let logId: string | null = null

  try {
    assertRuntimeConfig()

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
      normalizedAnalysisRows,
      failures,
    })

    return json({ ok: true, provider: 'football-data.org', dateFrom, dateTo, processed, total, normalizedAnalysisRows, failures })
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

async function normalizeLegacyAnalysisRows() {
  const result = await supabase
    .from('match_analysis')
    .select('id, confidence_score, recommendation, risk_level, analysis_summary, thai_reason, raw')
    .limit(1000)

  if (result.error) throw result.error

  let normalized = 0

  for (const row of result.data ?? []) {
    const confidence = Math.round(clamp(Number(row.confidence_score ?? row.raw?.confidence_score ?? 0), 0, 100))
    const recommendation = getRecommendationFromConfidence(confidence)
    const riskLevel = ['low', 'medium', 'high'].includes(String(row.risk_level ?? '').toLowerCase())
      ? String(row.risk_level).toLowerCase()
      : ['low', 'medium', 'high'].includes(String(row.raw?.risk_level ?? '').toLowerCase())
      ? String(row.raw.risk_level).toLowerCase()
      : 'medium'
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
  const homePoints = homeForm.wins * 3 + homeForm.draws
  const awayPoints = awayForm.wins * 3 + awayForm.draws
  const formGap = homePoints - awayPoints
  const standingGap = Number(awayStanding?.position ?? 12) - Number(homeStanding?.position ?? 12)
  const dataCompleteness = clamp((homeForm.played + awayForm.played) * 10, 0, 100)
  const goalDiffGap = (homeForm.goals_for - homeForm.goals_against) - (awayForm.goals_for - awayForm.goals_against)

  const teamStrength = clamp(8 + standingGap * 0.5 + (Number(homeStanding?.points ?? 0) - Number(awayStanding?.points ?? 0)) * 0.08 + goalDiffGap * 0.25, 0, 15)
  const recentForm = clamp(7 + formGap * 0.45, 0, 15)
  const homeAdvantage = clamp(4 + homeForm.wins * 0.9 + Math.max(homeForm.goals_for - homeForm.goals_against, 0) * 0.25, 0, 10)
  const awayWeakness = clamp(2 + awayForm.losses * 1.1 + awayForm.goals_against * 0.35, 0, 10)
  const goalScoring = clamp(3 + (homeForm.goals_for + awayForm.goals_for) * 0.75, 0, 15)
  const defensiveStability = clamp(15 - (homeForm.goals_against + awayForm.goals_against) * 0.7 + (homeForm.clean_sheets + awayForm.clean_sheets) * 0.9, 0, 15)
  const motivation = clamp(leaguePriority <= 15 ? 10 : leaguePriority <= 30 ? 8 : leaguePriority <= 50 ? 6 : 5, 0, 10)
  const marketRisk = clamp(4 + dataCompleteness * 0.04 + Math.min(Math.abs(formGap), 8) * 0.25, 0, 10)
  const confidence = Math.round(
    teamStrength +
      recentForm +
      homeAdvantage +
      awayWeakness +
      goalScoring +
      defensiveStability +
      motivation +
      marketRisk,
  )
  const riskLevel = marketRisk >= 8 && dataCompleteness >= 70 ? 'low' : marketRisk >= 5 && dataCompleteness >= 50 ? 'medium' : 'high'
  const recommendation = getRecommendationFromConfidence(confidence)
  const analysisSummary = buildAnalysisSummary(match, confidence, riskLevel, {
    teamStrength,
    recentForm,
    homeAdvantage,
    awayWeakness,
    goalScoring,
    defensiveStability,
    motivation,
    marketRisk,
  })

  return {
    provider: 'football-data.org',
    framework: 'football-master',
    team_strength_score: Math.round(teamStrength),
    form_score: Math.round(recentForm),
    home_advantage_score: Math.round(homeAdvantage),
    away_weakness_score: Math.round(awayWeakness),
    goal_scoring_score: Math.round(goalScoring),
    defensive_stability_score: Math.round(defensiveStability),
    motivation_score: Math.round(motivation),
    market_risk_score: Math.round(marketRisk),
    confidence_score: confidence,
    recommendation,
    risk_level: riskLevel,
    analysis_summary: analysisSummary,
    thai_reason: analysisSummary,
    modules: {
      teamStrength: Math.round(teamStrength),
      recentForm: Math.round(recentForm),
      homeAdvantage: Math.round(homeAdvantage),
      awayWeakness: Math.round(awayWeakness),
      goalScoring: Math.round(goalScoring),
      defensiveStability: Math.round(defensiveStability),
      motivation: Math.round(motivation),
      marketRisk: Math.round(marketRisk),
    },
    data_completeness: dataCompleteness,
    homeForm,
    awayForm,
    standings,
    raw_match: match,
  }
}

function getRecommendationFromConfidence(confidence: number) {
  if (confidence >= 80) return 'BET'
  if (confidence >= 65) return 'LEAN'
  return 'NO BET'
}

function buildAnalysisSummary(match: any, confidence: number, riskLevel: string, modules: Record<string, number>) {
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

  return `${home} พบ ${away}: Football Master Framework ให้คะแนน ${confidence}/100 คำแนะนำ ${getRecommendationFromConfidence(confidence)} จุดเด่นคือ${moduleText[topModule]} และ risk_level เป็น ${riskLevel}`
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
