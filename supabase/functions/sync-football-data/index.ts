import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const priorityLeagues = new Map<string, number>([
  ['Premier League', 10],
  ['La Liga', 12],
  ['Serie A', 14],
  ['Bundesliga', 16],
  ['Ligue 1', 18],
  ['UEFA Champions League', 8],
  ['Champions League', 8],
  ['UEFA Europa League', 20],
  ['Europa League', 20],
  ['Thai League', 25],
  ['J1 League', 28],
  ['J League', 28],
  ['K League 1', 30],
  ['K League', 30],
])

const apiBaseUrl = Deno.env.get('FOOTBALL_API_BASE_URL') ?? 'https://v3.football.api-sports.io'
const apiKey = Deno.env.get('FOOTBALL_API_KEY')
const apiHost = Deno.env.get('FOOTBALL_API_HOST') ?? 'v3.football.api-sports.io'
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
    if (!apiKey) throw new Error('Missing FOOTBALL_API_KEY Supabase secret')
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing Supabase service credentials')

    const body = await safeJson(request)
    const date = body.date ?? todayBangkok()
    const season = Number(body.season ?? new Date().getUTCFullYear())

    const log = await supabase
      .from('sync_logs')
      .insert({ sync_type: body.mode ?? 'manual', status: 'running', message: `sync ${date}`, started_at: startedAt })
      .select('id')
      .single()

    if (log.error) throw log.error
    logId = log.data.id

    if (body.resetToday) {
      const range = dayRangeBangkok(date)
      const resetResult = await supabase.from('football_matches').delete().gte('kickoff_at', range.start).lt('kickoff_at', range.end)
      if (resetResult.error) throw resetResult.error
    }

    const fixtures = await fetchFixturesByDate(date)
    let processed = 0

    for (const item of fixtures) {
      const fixture = item.fixture
      const league = await upsertLeague(item.league)
      const homeTeam = await upsertTeam(item.teams?.home, item.league?.country)
      const awayTeam = await upsertTeam(item.teams?.away, item.league?.country)

      const match = await supabase
        .from('football_matches')
        .upsert(
          {
            api_fixture_id: fixture.id,
            league_id: league.id,
            home_team_id: homeTeam.id,
            away_team_id: awayTeam.id,
            kickoff_at: fixture.date,
            status: item.fixture?.status?.short ?? item.fixture?.status?.long ?? 'scheduled',
            venue: fixture.venue?.name ?? null,
            round: item.league?.round ?? null,
            home_goals: item.goals?.home ?? null,
            away_goals: item.goals?.away ?? null,
            raw: item,
          },
          { onConflict: 'api_fixture_id' },
        )
        .select('id')
        .single()

      if (match.error) throw match.error

      const [homeLast, awayLast, homeStats, awayStats, standings] = await Promise.all([
        fetchTeamLastMatches(item.teams?.home?.id, 5),
        fetchTeamLastMatches(item.teams?.away?.id, 5),
        fetchTeamStatistics(item.teams?.home?.id, item.league?.id, season),
        fetchTeamStatistics(item.teams?.away?.id, item.league?.id, season),
        fetchStandings(item.league?.id, season),
      ])

      const homeForm = summarizeRecentForm(homeLast, item.teams?.home?.id)
      const awayForm = summarizeRecentForm(awayLast, item.teams?.away?.id)
      await upsertRecentForm(homeTeam.id, homeForm, homeLast)
      await upsertRecentForm(awayTeam.id, awayForm, awayLast)
      await upsertTeamStatistics(homeTeam.id, league.id, season, homeStats)
      await upsertTeamStatistics(awayTeam.id, league.id, season, awayStats)

      const analysis = analyzeMatch({
        item,
        homeForm,
        awayForm,
        homeStats,
        awayStats,
        standings,
        leaguePriority: league.priority,
      })

      const analysisResult = await supabase.from('match_analysis').upsert(
        {
          match_id: match.data.id,
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
      processed += 1
    }

    await finishLog(logId, 'success', `บันทึกข้อมูล ${processed} คู่`, { date, processed, total: fixtures.length })

    return json({ ok: true, date, processed, total: fixtures.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'sync failed'
    await finishLog(logId, 'failed', message, { error })
    return json({ ok: false, message }, 500)
  }
})

async function apiGet(path: string, params: Record<string, string | number | undefined>) {
  const url = new URL(`${apiBaseUrl}${path}`)
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  })

  const response = await fetch(url, {
    headers: {
      'x-rapidapi-key': apiKey ?? '',
      'x-rapidapi-host': apiHost,
    },
  })

  if (!response.ok) throw new Error(`football api ${response.status}: ${await response.text()}`)
  const data = await response.json()
  return data.response ?? []
}

function fetchFixturesByDate(date: string) {
  return apiGet('/fixtures', { date, timezone: 'Asia/Bangkok' })
}

function fetchStandings(leagueId: number, season: number) {
  if (!leagueId) return []
  return apiGet('/standings', { league: leagueId, season })
}

function fetchTeamStatistics(teamId: number, leagueId: number, season: number) {
  if (!teamId || !leagueId) return null
  return apiGet('/teams/statistics', { team: teamId, league: leagueId, season }).then((rows) => rows?.[0] ?? null)
}

function fetchTeamLastMatches(teamId: number, limit: number) {
  if (!teamId) return []
  return apiGet('/fixtures', { team: teamId, last: limit })
}

async function upsertLeague(league: any) {
  const name = String(league?.name ?? 'Unknown League')
  const result = await supabase
    .from('football_leagues')
    .upsert(
      {
        api_league_id: league?.id,
        name,
        country: league?.country ?? null,
        logo: league?.logo ?? null,
        enabled: true,
        priority: priorityLeagues.get(name) ?? 50,
      },
      { onConflict: 'api_league_id' },
    )
    .select('id, priority')
    .single()

  if (result.error) throw result.error
  return result.data
}

async function upsertTeam(team: any, country: string | null) {
  const result = await supabase
    .from('football_teams')
    .upsert(
      {
        api_team_id: team?.id,
        name: team?.name ?? 'Unknown Team',
        logo: team?.logo ?? null,
        country,
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

async function upsertTeamStatistics(teamId: string, leagueId: string, season: number, stats: any) {
  const played = Number(stats?.fixtures?.played?.total ?? 0)
  const goalsFor = Number(stats?.goals?.for?.total?.total ?? 0)
  const goalsAgainst = Number(stats?.goals?.against?.total?.total ?? 0)

  const result = await supabase.from('team_statistics').upsert(
    {
      team_id: teamId,
      league_id: leagueId,
      season,
      played,
      wins: Number(stats?.fixtures?.wins?.total ?? 0),
      draws: Number(stats?.fixtures?.draws?.total ?? 0),
      losses: Number(stats?.fixtures?.loses?.total ?? 0),
      goals_for: goalsFor,
      goals_against: goalsAgainst,
      home_strength: ratio(Number(stats?.fixtures?.wins?.home ?? 0), Number(stats?.fixtures?.played?.home ?? 0)) * 100,
      away_strength: ratio(Number(stats?.fixtures?.wins?.away ?? 0), Number(stats?.fixtures?.played?.away ?? 0)) * 100,
      raw: stats,
    },
    { onConflict: 'team_id,league_id,season' },
  )

  if (result.error) throw result.error
}

function analyzeMatch({ item, homeForm, awayForm, homeStats, awayStats, leaguePriority }: any) {
  const homePlayed = Number(homeStats?.fixtures?.played?.total ?? 0)
  const awayPlayed = Number(awayStats?.fixtures?.played?.total ?? 0)
  const dataReady = Math.min(100, ((homePlayed + awayPlayed) / 20) * 100)
  const homePoints = homeForm.wins * 3 + homeForm.draws
  const awayPoints = awayForm.wins * 3 + awayForm.draws
  const formGap = homePoints - awayPoints
  const goalTotal = homeForm.goals_for + awayForm.goals_for
  const goalAgainstTotal = homeForm.goals_against + awayForm.goals_against

  const teamStrength = clamp(50 + Number(homeStats?.fixtures?.wins?.total ?? 0) * 3 - Number(awayStats?.fixtures?.wins?.total ?? 0) * 2, 0, 100)
  const formScore = clamp(55 + formGap * 5, 0, 100)
  const goalQuality = clamp(45 + goalTotal * 4 + goalAgainstTotal * 2, 0, 100)
  const tactical = clamp((teamStrength + goalQuality) / 2, 0, 100)
  const homeAway = clamp(50 + ratio(Number(homeStats?.fixtures?.wins?.home ?? 0), Number(homeStats?.fixtures?.played?.home ?? 0)) * 35, 0, 100)
  const motivation = clamp(leaguePriority <= 30 ? 75 : 58, 0, 100)
  const marketContext = clamp(dataReady * 0.7 + (100 - leaguePriority) * 0.3, 0, 100)
  const riskScore = clamp(100 - Math.abs(formGap) * 6 - (dataReady < 55 ? 20 : 0), 0, 100)
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
    raw_fixture: item,
  }
}

function summarizeRecentForm(matches: Array<any>, teamId: number) {
  return matches.reduce(
    (total, match) => {
      const isHome = match.teams?.home?.id === teamId
      const goalsFor = Number(isHome ? match.goals?.home : match.goals?.away ?? 0)
      const goalsAgainst = Number(isHome ? match.goals?.away : match.goals?.home ?? 0)
      total.goals_for += goalsFor
      total.goals_against += goalsAgainst
      if (goalsFor > goalsAgainst) total.wins += 1
      else if (goalsFor === goalsAgainst) total.draws += 1
      else total.losses += 1
      if (goalsAgainst === 0) total.clean_sheets += 1
      if (goalsFor === 0) total.failed_to_score += 1
      return total
    },
    { wins: 0, draws: 0, losses: 0, goals_for: 0, goals_against: 0, clean_sheets: 0, failed_to_score: 0 },
  )
}

function buildThaiReason(homeForm: Record<string, number>, awayForm: Record<string, number>, confidence: number, riskLevel: string) {
  const riskText = riskLevel === 'low' ? 'ความเสี่ยงโดยรวมต่ำ' : riskLevel === 'medium' ? 'ยังมีจุดที่ต้องติดตามก่อนแข่ง' : 'ความเสี่ยงสูงกว่าปกติ'
  return `ทีมเหย้ามีผลงาน 5 นัดหลัง ชนะ ${homeForm.wins} เสมอ ${homeForm.draws} แพ้ ${homeForm.losses} ยิงได้ ${homeForm.goals_for} ประตู ส่วนทีมเยือนชนะ ${awayForm.wins} เสมอ ${awayForm.draws} แพ้ ${awayForm.losses} ระบบประเมินความมั่นใจที่ ${confidence}% และ${riskText}`
}

async function finishLog(logId: string | null, status: string, message: string, raw: unknown) {
  if (!logId) {
    await supabase.from('sync_logs').insert({ sync_type: 'manual', status, message, finished_at: new Date().toISOString(), raw })
    return
  }

  await supabase.from('sync_logs').update({ status, message, finished_at: new Date().toISOString(), raw }).eq('id', logId)
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

function ratio(value: number, total: number) {
  return total > 0 ? value / total : 0
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
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
