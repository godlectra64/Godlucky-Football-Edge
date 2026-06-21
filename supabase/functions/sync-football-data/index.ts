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

const BASE_URL = (Deno.env.get('FOOTBALL_API_BASE_URL') ?? 'https://api.football-data.org/v4').replace(/\/$/, '')
const TOKEN = Deno.env.get('FOOTBALL_API_KEY')
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
    const date = body.date ?? todayBangkok()
    const syncType = body.mode ?? 'manual-football-data'

    const log = await supabase
      .from('sync_logs')
      .insert({
        sync_type: syncType,
        status: 'running',
        message: `football-data.org sync ${date}`,
        started_at: startedAt,
        raw: { provider: 'football-data.org', date },
      })
      .select('id')
      .single()

    if (log.error) throw log.error
    logId = log.data.id

    if (body.resetToday) {
      await resetMatchesForDate(date)
    }

    const competitions = await fetchCompetitions()
    await upsertCompetitions(competitions)

    const matches = await fetchFixturesByDate(date)
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

    const status = failures.length ? 'partial_success' : 'success'
    const message = failures.length
      ? `บันทึกข้อมูล ${processed} คู่ และมีข้อผิดพลาด ${failures.length} คู่`
      : `บันทึกข้อมูล ${processed} คู่`

    await finishLog(logId, status, message, {
      provider: 'football-data.org',
      date,
      competitions: competitions.length,
      total: matches.length,
      processed,
      failures,
    })

    return json({ ok: true, provider: 'football-data.org', date, processed, total: matches.length, failures })
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

  const analysisResult = await supabase.from('match_analysis').upsert(
    {
      match_id: matchResult.data.id,
      team_strength_score: analysis.team_strength_score,
      form_score: analysis.form_score,
      goal_quality_score: analysis.goal_quality_score,
      tactical_score: analysis.tactical_score,
      home_away_score: analysis.home_away_score,
      motivation_score: analysis.motivation_score,
      market_context_score: analysis.market_context_score,
      risk_score: analysis.risk_score,
      confidence_score: analysis.confidence_score,
      recommendation: analysis.recommendation,
      risk_level: analysis.risk_level,
      thai_reason: analysis.thai_reason,
      raw: analysis,
    },
    { onConflict: 'match_id' },
  )

  if (analysisResult.error) throw analysisResult.error
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

async function fetchFixturesByDate(date: string) {
  const data = await apiGet('/matches', { dateFrom: date, dateTo: date })
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

function analyzeMatch({ match, homeForm, awayForm, standings, leaguePriority }: any) {
  const homeStanding = findStanding(standings, match.homeTeam?.id)
  const awayStanding = findStanding(standings, match.awayTeam?.id)
  const homePoints = homeForm.wins * 3 + homeForm.draws
  const awayPoints = awayForm.wins * 3 + awayForm.draws
  const formGap = homePoints - awayPoints
  const totalRecentGoals = homeForm.goals_for + awayForm.goals_for + homeForm.goals_against + awayForm.goals_against
  const standingGap = Number(awayStanding?.position ?? 12) - Number(homeStanding?.position ?? 12)
  const dataReady = clamp((homeForm.played + awayForm.played) * 10, 0, 100)

  const teamStrength = clamp(55 + standingGap * 3 + (Number(homeStanding?.points ?? 0) - Number(awayStanding?.points ?? 0)) * 0.5, 0, 100)
  const formScore = clamp(55 + formGap * 5, 0, 100)
  const goalQuality = clamp(42 + totalRecentGoals * 3.2, 0, 100)
  const tactical = clamp((teamStrength + formScore + goalQuality) / 3, 0, 100)
  const homeAway = clamp(58 + homeForm.wins * 4 - awayForm.wins * 2, 0, 100)
  const motivation = clamp(leaguePriority <= 30 ? 76 : 60, 0, 100)
  const marketContext = clamp(dataReady * 0.65 + (100 - leaguePriority) * 0.35, 0, 100)
  const riskScore = clamp(92 - Math.abs(formGap) * 5 - (dataReady < 60 ? 16 : 0), 0, 100)
  const confidence = Math.round(
    teamStrength * 0.2 +
      formScore * 0.2 +
      goalQuality * 0.15 +
      homeAway * 0.15 +
      motivation * 0.1 +
      marketContext * 0.1 +
      riskScore * 0.1,
  )
  const riskLevel = riskScore >= 72 ? 'low' : riskScore >= 48 ? 'medium' : 'high'
  const recommendation = confidence >= 78 && riskLevel !== 'high' ? 'น่าสนใจมาก' : confidence >= 62 ? 'น่าติดตาม' : 'ข้าม'

  return {
    provider: 'football-data.org',
    team_strength_score: Math.round(teamStrength),
    form_score: Math.round(formScore),
    goal_quality_score: Math.round(goalQuality),
    tactical_score: Math.round(tactical),
    home_away_score: Math.round(homeAway),
    motivation_score: Math.round(motivation),
    market_context_score: Math.round(marketContext),
    risk_score: Math.round(riskScore),
    confidence_score: confidence,
    recommendation,
    risk_level: riskLevel,
    thai_reason: buildThaiReason(homeForm, awayForm, confidence, riskLevel),
    homeForm,
    awayForm,
    standings,
    raw_match: match,
  }
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

async function resetMatchesForDate(date: string) {
  const range = dayRangeBangkok(date)
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

function todayBangkok() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function dayRangeBangkok(date: string) {
  const start = new Date(`${date}T00:00:00+07:00`)
  const end = new Date(start)
  end.setDate(start.getDate() + 1)

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
