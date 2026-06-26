const LIMITED_REASON = 'ข้อมูลจำกัด'
const NEUTRAL_SCORE = 58

export const dataIntelligenceSections = [
  'league_position',
  'recent_form',
  'home_away_form',
  'head_to_head',
  'strength_of_schedule',
  'goal_statistics',
]

export function calculateDataIntelligence(match = {}, context = {}) {
  const leaguePosition = calculateLeaguePosition(match)
  const recentForm = calculateRecentForm(match, context)
  const homeAwayForm = calculateHomeAwayForm(match, context)
  const headToHead = calculateHeadToHead(match, context)
  const strengthOfSchedule = calculateStrengthOfSchedule(match, context)
  const goalStatistics = calculateGoalStatistics(match, context)
  const sections = {
    league_position: leaguePosition,
    recent_form: recentForm,
    home_away_form: homeAwayForm,
    head_to_head: headToHead,
    strength_of_schedule: strengthOfSchedule,
    goal_statistics: goalStatistics,
  }
  const dataConfidence = calculateDataConfidence(sections)
  const modifier = calculateDataIntelligenceModifier({ ...sections, data_confidence: dataConfidence }, context.baseConfidence, context.footballModifier)

  return {
    ...sections,
    data_confidence: dataConfidence,
    consistency: calculateDataIntelligenceConsistency(sections),
    modifier,
  }
}

export function normalizeDataIntelligence(value, match = {}, context = {}) {
  const fallback = calculateDataIntelligence(match, context)
  const normalized = value && typeof value === 'object' ? value : {}
  const sections = {
    league_position: normalizeSection(normalized.league_position, fallback.league_position),
    recent_form: normalizeSection(normalized.recent_form, fallback.recent_form),
    home_away_form: normalizeSection(normalized.home_away_form, fallback.home_away_form),
    head_to_head: normalizeSection(normalized.head_to_head, fallback.head_to_head),
    strength_of_schedule: normalizeSection(normalized.strength_of_schedule, fallback.strength_of_schedule),
    goal_statistics: normalizeSection(normalized.goal_statistics, fallback.goal_statistics),
  }
  const dataConfidence = normalizeDataConfidence(normalized.data_confidence, calculateDataConfidence(sections))

  return {
    ...sections,
    data_confidence: dataConfidence,
    consistency: Math.round(clamp(numberValue(normalized.consistency ?? calculateDataIntelligenceConsistency(sections)), 0, 100)),
    modifier: Math.round(clamp(numberValue(normalized.modifier ?? fallback.modifier), -10, 10)),
  }
}

export function calculateDataIntelligenceModifier(dataIntelligence = {}, baseConfidence = 0, footballModifier = 0) {
  const data = dataIntelligence.data_confidence ? dataIntelligence : normalizeDataIntelligence(dataIntelligence)
  const scores = dataIntelligenceSections.map((key) => numberValue(data[key]?.score)).filter((score) => score > 0)
  const average = scores.length ? scores.reduce((total, score) => total + score, 0) / scores.length : NEUTRAL_SCORE
  const confidenceScore = numberValue(data.data_confidence?.score)
  const lowConfidenceCount = dataIntelligenceSections.filter((key) => data[key]?.confidence === 'low' || data[key]?.level === 'low').length
  const conflicts = countConflictingSignals(data)
  let modifier = (average - NEUTRAL_SCORE) * 0.12

  if (data.recent_form?.trend === 'positive') modifier += 1.5
  if (data.recent_form?.trend === 'negative') modifier -= 1.5
  if (data.league_position?.edge && data.league_position.edge !== 'none' && data.league_position.confidence !== 'low') modifier += 1
  if (data.goal_statistics?.confidence !== 'low' && numberValue(data.goal_statistics?.score) >= 64) modifier += 1
  if (data.head_to_head?.confidence && data.head_to_head.confidence !== 'low' && numberValue(data.head_to_head?.score) >= 61) modifier += 1
  if (confidenceScore < 35) modifier -= 2.5
  else if (confidenceScore < 60) modifier -= 1
  else if (confidenceScore >= 80) modifier += 1
  modifier -= Math.min(3, lowConfidenceCount * 0.35)
  modifier -= conflicts * 1.25

  const total = numberValue(footballModifier) + modifier
  const positiveCap = baseConfidence && baseConfidence < 75 ? Math.max(0, 74 - baseConfidence - numberValue(footballModifier)) : 10
  const bounded = clamp(total, -10, positiveCap)

  return Math.round(clamp(bounded - numberValue(footballModifier), -10, 10))
}

export function getDataIntelligenceRankingAdjustment(dataIntelligence = {}) {
  const data = normalizeDataIntelligence(dataIntelligence)
  const confidenceScore = numberValue(data.data_confidence?.score)
  const consistency = numberValue(data.consistency)
  const recentScore = numberValue(data.recent_form?.score)
  const goalScore = numberValue(data.goal_statistics?.score)
  const scheduleScore = numberValue(data.strength_of_schedule?.score)
  let adjustment = 0

  adjustment += clamp((confidenceScore - 55) * 0.05, -3, 3)
  adjustment += clamp((consistency - 65) * 0.04, -2, 2)
  adjustment += clamp((recentScore - 58) * 0.04, -2, 2)
  adjustment += clamp((goalScore - 58) * 0.035, -2, 2)
  adjustment += clamp((scheduleScore - 58) * 0.03, -1.5, 1.5)
  if (data.data_confidence?.level === 'low') adjustment -= 1

  return clamp(adjustment, -6, 6)
}

export function calculateDataIntelligenceConsistency(sections = {}) {
  const scores = dataIntelligenceSections.map((key) => numberValue(sections[key]?.score)).filter((score) => score > 0)
  if (scores.length < 2) return NEUTRAL_SCORE

  const average = scores.reduce((total, score) => total + score, 0) / scores.length
  const spread = Math.max(...scores) - Math.min(...scores)
  return Math.round(clamp(100 - spread * 1.1 - Math.abs(average - NEUTRAL_SCORE) * 0.15, 30, 100))
}

function calculateLeaguePosition(match) {
  const standings = getStandings(match)
  const homeStanding = findStanding(standings, getTeamId(match.homeTeam))
  const awayStanding = findStanding(standings, getTeamId(match.awayTeam))

  if (!homeStanding || !awayStanding) {
    return {
      score: NEUTRAL_SCORE,
      confidence: 'low',
      home_rank: null,
      away_rank: null,
      point_gap: null,
      goal_difference_gap: null,
      home_win_percentage: null,
      away_win_percentage: null,
      edge: 'unknown',
      reason: 'ยังไม่มีข้อมูลอันดับลีกเพียงพอ',
    }
  }

  const homeRank = numberValue(homeStanding.position)
  const awayRank = numberValue(awayStanding.position)
  const pointGap = numberValue(homeStanding.points) - numberValue(awayStanding.points)
  const goalDiffGap = getGoalDifference(homeStanding) - getGoalDifference(awayStanding)
  const homeWinPercentage = getWinPercentage(homeStanding)
  const awayWinPercentage = getWinPercentage(awayStanding)
  const rankGap = awayRank - homeRank
  const score = Math.round(clamp(58 + rankGap * 1.8 + pointGap * 0.45 + goalDiffGap * 0.35, 35, 85))
  const edge = score >= 62 ? 'home' : score <= 54 ? 'away' : 'none'

  return {
    score,
    confidence: 'high',
    home_rank: homeRank || null,
    away_rank: awayRank || null,
    point_gap: pointGap,
    goal_difference_gap: goalDiffGap,
    home_win_percentage: homeWinPercentage,
    away_win_percentage: awayWinPercentage,
    edge,
    reason: `อันดับลีกจริง เจ้าบ้านอันดับ ${homeRank || '-'} ทีมเยือนอันดับ ${awayRank || '-'} แต้มต่าง ${pointGap} และประตูได้เสียต่าง ${goalDiffGap}`,
  }
}

function calculateRecentForm(match, context) {
  const homeForm = getHomeForm(match, context)
  const awayForm = getAwayForm(match, context)
  const homePlayed = numberValue(homeForm?.played)
  const awayPlayed = numberValue(awayForm?.played)
  const played = homePlayed + awayPlayed

  if (!played) {
    return {
      score: NEUTRAL_SCORE,
      confidence: 'low',
      last_5_results: [],
      home: emptyForm(),
      away: emptyForm(),
      trend: 'unknown',
      reason: 'ข้อมูลฟอร์มล่าสุดยังจำกัด',
    }
  }

  const homePoints = formPoints(homeForm)
  const awayPoints = formPoints(awayForm)
  const goalGap = formGoalDiff(homeForm) - formGoalDiff(awayForm)
  const score = Math.round(clamp(56 + (homePoints - awayPoints) * 1.4 + goalGap * 1.2, 35, 82))
  const trend = score >= 63 ? 'positive' : score <= 49 ? 'negative' : 'neutral'

  return {
    score,
    confidence: played >= 8 ? 'high' : played >= 4 ? 'medium' : 'low',
    last_5_results: getLastResults(match, context).slice(0, 5),
    home: summarizeForm(homeForm),
    away: summarizeForm(awayForm),
    trend,
    reason: `ฟอร์มล่าสุดมีข้อมูลจริง ${played} นัด เจ้าบ้าน ${formatForm(homeForm)} ทีมเยือน ${formatForm(awayForm)} แนวโน้ม ${trend}`,
  }
}

function calculateHomeAwayForm(match, context) {
  const homeVenueForm = getVenueForm(match, context, 'home')
  const awayVenueForm = getVenueForm(match, context, 'away')
  const homePlayed = numberValue(homeVenueForm?.played)
  const awayPlayed = numberValue(awayVenueForm?.played)

  if (!homePlayed && !awayPlayed) {
    return {
      score: NEUTRAL_SCORE,
      confidence: 'low',
      home_win_rate: null,
      away_win_rate: null,
      home: emptyForm(),
      away: emptyForm(),
      advantage: 'unknown',
      reason: 'ฟอร์มเหย้า/เยือนยังไม่ชัด',
    }
  }

  const homeWinRate = homePlayed ? numberValue(homeVenueForm?.wins) / homePlayed : null
  const awayWinRate = awayPlayed ? numberValue(awayVenueForm?.wins) / awayPlayed : null
  const homeGoalDiff = formGoalDiff(homeVenueForm)
  const awayGoalDiff = formGoalDiff(awayVenueForm)
  const rateGap = (homeWinRate ?? 0.4) - (awayWinRate ?? 0.35)
  const score = Math.round(clamp(57 + rateGap * 28 + (homeGoalDiff - awayGoalDiff) * 0.9, 35, 82))
  const advantage = score >= 63 ? 'home' : score <= 51 ? 'away' : 'none'

  return {
    score,
    confidence: homePlayed + awayPlayed >= 8 ? 'high' : 'medium',
    home_win_rate: homeWinRate === null ? null : roundRate(homeWinRate),
    away_win_rate: awayWinRate === null ? null : roundRate(awayWinRate),
    home: summarizeForm(homeVenueForm),
    away: summarizeForm(awayVenueForm),
    advantage,
    reason: `ใช้ข้อมูลเหย้า/เยือนจริง เจ้าบ้านชนะในบ้าน ${formatRate(homeWinRate)} ทีมเยือนชนะเกมเยือน ${formatRate(awayWinRate)} advantage ${advantage}`,
  }
}

function calculateHeadToHead(match, context) {
  const matches = getH2HMatches(match, context)
  if (!matches.length) {
    return {
      score: NEUTRAL_SCORE,
      confidence: 'low',
      matches_count: 0,
      home_wins: 0,
      away_wins: 0,
      draws: 0,
      goals_average: null,
      reason: 'ไม่มี H2H เพียงพอ',
    }
  }

  const latest = matches.slice(0, 10)
  const summary = summarizeH2H(latest, getTeamId(match.homeTeam), getTeamId(match.awayTeam))
  const goalsAverage = summary.played ? roundNumber(summary.goals / summary.played) : null
  const score = Math.round(clamp(56 + (summary.homeWins - summary.awayWins) * 3 + Math.min(summary.played, 5), 42, 78))

  return {
    score,
    confidence: summary.played >= 8 ? 'high' : summary.played >= 4 ? 'medium' : 'low',
    matches_count: summary.played,
    home_wins: summary.homeWins,
    away_wins: summary.awayWins,
    draws: summary.draws,
    goals_average: goalsAverage,
    reason: `H2H มีข้อมูลจริง ${summary.played} นัด เจ้าบ้านชนะ ${summary.homeWins} เสมอ ${summary.draws} ทีมเยือนชนะ ${summary.awayWins}`,
  }
}

function calculateStrengthOfSchedule(match, context) {
  const opponents = flattenRecentOpponents(context.recentOpponents ?? match.raw?.recentOpponents ?? match.analysis?.raw?.recentOpponents)
  const ranks = opponents
    .map((item) => numberValue(item.opponent?.position ?? item.position ?? item.rank))
    .filter((rank) => rank > 0)

  if (!ranks.length) {
    return {
      score: NEUTRAL_SCORE,
      confidence: 'low',
      average_opponent_rank: null,
      difficulty: 'unknown',
      reason: 'ยังไม่มีข้อมูลคุณภาพคู่แข่ง 3-5 นัดล่าสุดเพียงพอ',
    }
  }

  const averageRank = ranks.reduce((total, rank) => total + rank, 0) / ranks.length
  const difficulty = averageRank <= 6 ? 'hard' : averageRank >= 14 ? 'easy' : 'medium'
  const score = difficulty === 'hard' ? 55 : difficulty === 'easy' ? 62 : 58

  return {
    score,
    confidence: ranks.length >= 6 ? 'high' : ranks.length >= 3 ? 'medium' : 'low',
    average_opponent_rank: roundNumber(averageRank),
    difficulty,
    reason: `คู่แข่งล่าสุดมีอันดับเฉลี่ย ${roundNumber(averageRank)} ระดับความยาก ${difficulty}`,
  }
}

function calculateGoalStatistics(match, context) {
  const homeForm = getHomeForm(match, context)
  const awayForm = getAwayForm(match, context)
  const played = numberValue(homeForm?.played) + numberValue(awayForm?.played)

  if (!played) {
    return {
      score: NEUTRAL_SCORE,
      confidence: 'low',
      average_goals_scored: null,
      average_goals_conceded: null,
      clean_sheet_rate: null,
      btts_rate: null,
      over_2_5_rate: null,
      reason: 'สถิติประตูยังจำกัด และไม่สร้างค่า xG เอง',
    }
  }

  const goalsFor = numberValue(homeForm?.goals_for) + numberValue(awayForm?.goals_for)
  const goalsAgainst = numberValue(homeForm?.goals_against) + numberValue(awayForm?.goals_against)
  const cleanSheets = numberValue(homeForm?.clean_sheets) + numberValue(awayForm?.clean_sheets)
  const failedToScore = numberValue(homeForm?.failed_to_score) + numberValue(awayForm?.failed_to_score)
  const averageGoalsScored = goalsFor / played
  const averageGoalsConceded = goalsAgainst / played
  const cleanSheetRate = cleanSheets / played
  const score = Math.round(clamp(52 + averageGoalsScored * 10 - averageGoalsConceded * 5 + cleanSheetRate * 8, 35, 84))

  return {
    score,
    confidence: played >= 8 ? 'high' : played >= 4 ? 'medium' : 'low',
    average_goals_scored: roundNumber(averageGoalsScored),
    average_goals_conceded: roundNumber(averageGoalsConceded),
    clean_sheet_rate: roundRate(cleanSheetRate),
    btts_rate: readOptionalRate(match, context, 'btts_rate'),
    over_2_5_rate: readOptionalRate(match, context, 'over_2_5_rate'),
    failed_to_score: failedToScore,
    reason: `สถิติประตูจากข้อมูลจริง ${played} นัด ยิงเฉลี่ย ${roundNumber(averageGoalsScored)} เสียเฉลี่ย ${roundNumber(averageGoalsConceded)} คลีนชีต ${roundRate(cleanSheetRate)}%`,
  }
}

function calculateDataConfidence(sections) {
  const available = dataIntelligenceSections.filter((key) => sectionHasRealData(key, sections[key]))
  const missing = dataIntelligenceSections.filter((key) => !available.includes(key))
  const score = Math.round((available.length / dataIntelligenceSections.length) * 100)
  const level = score >= 75 ? 'high' : score >= 45 ? 'medium' : 'low'

  return {
    score,
    level,
    available,
    missing,
    reason: `ข้อมูลจริงพร้อมใช้ ${available.length}/${dataIntelligenceSections.length} หมวด ระดับ ${level}`,
  }
}

function normalizeDataConfidence(value, fallback) {
  const score = Math.round(clamp(numberValue(value?.score ?? fallback.score), 0, 100))
  return {
    score,
    level: ['low', 'medium', 'high'].includes(value?.level) ? value.level : score >= 75 ? 'high' : score >= 45 ? 'medium' : 'low',
    available: Array.isArray(value?.available) ? value.available : fallback.available,
    missing: Array.isArray(value?.missing) ? value.missing : fallback.missing,
    reason: value?.reason || fallback.reason,
  }
}

function normalizeSection(value, fallback) {
  const section = value && typeof value === 'object' ? value : {}
  return {
    ...fallback,
    ...section,
    score: Math.round(clamp(numberValue(section.score ?? fallback.score), 0, 100)),
    confidence: section.confidence ?? fallback.confidence ?? section.level ?? fallback.level ?? 'low',
    reason: section.reason || fallback.reason || LIMITED_REASON,
  }
}

function sectionHasRealData(key, section = {}) {
  if (key === 'league_position') return section.confidence !== 'low' && section.home_rank !== null && section.away_rank !== null
  if (key === 'recent_form') return section.confidence !== 'low' && (numberValue(section.home?.played) + numberValue(section.away?.played)) > 0
  if (key === 'home_away_form') return section.confidence !== 'low' && section.advantage !== 'unknown'
  if (key === 'head_to_head') return section.confidence !== 'low' && numberValue(section.matches_count) > 0
  if (key === 'strength_of_schedule') return section.confidence !== 'low' && section.difficulty !== 'unknown'
  if (key === 'goal_statistics') return section.confidence !== 'low' && section.average_goals_scored !== null
  return false
}

function countConflictingSignals(data) {
  const high = dataIntelligenceSections.filter((key) => numberValue(data[key]?.score) >= 66).length
  const low = dataIntelligenceSections.filter((key) => {
    const score = numberValue(data[key]?.score)
    return score > 0 && score <= 50
  }).length
  return high && low ? Math.min(high, low) : 0
}

function getHomeForm(match, context) {
  return context.homeForm ?? context.formData?.home ?? match.homeForm ?? match.analysis?.raw?.homeForm ?? match.raw?.homeForm
}

function getAwayForm(match, context) {
  return context.awayForm ?? context.formData?.away ?? match.awayForm ?? match.analysis?.raw?.awayForm ?? match.raw?.awayForm
}

function getVenueForm(match, context, side) {
  const raw = match.raw ?? match.analysis?.raw ?? {}
  const venueData = context.homeAwayForm ?? raw.homeAwayForm ?? raw.venueForm ?? {}
  if (side === 'home') return venueData.home ?? context.homeHomeForm ?? raw.homeHomeForm ?? match.homeHomeForm
  return venueData.away ?? context.awayAwayForm ?? raw.awayAwayForm ?? match.awayAwayForm
}

function getLastResults(match, context) {
  const data = context.lastResults ?? match.raw?.lastResults ?? match.analysis?.raw?.lastResults
  return Array.isArray(data) ? data : []
}

function getStandings(match) {
  return match.standings ?? match.analysis?.raw?.standings ?? match.raw?.standings ?? []
}

function findStanding(standings, teamId) {
  const totalTable = standings.find((standing) => standing.type === 'TOTAL')?.table ?? standings[0]?.table ?? []
  return totalTable.find((row) => Number(row.team?.id) === Number(teamId) || Number(row.team?.api_team_id) === Number(teamId))
}

function getH2HMatches(match, context) {
  const candidates = [
    context.h2hMatches,
    context.h2h?.matches,
    context.h2h,
    match.raw?.h2h?.matches,
    match.raw?.head_to_head,
    match.analysis?.raw?.h2h?.matches,
    match.analysis?.raw?.head_to_head,
  ]
  return candidates.find((candidate) => Array.isArray(candidate) && candidate.length) ?? []
}

function summarizeH2H(matches, homeId, awayId) {
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
      total.goals += numberValue(homeGoals) + numberValue(awayGoals)
      if (homeSideGoals > awaySideGoals) total.homeWins += 1
      else if (homeSideGoals < awaySideGoals) total.awayWins += 1
      else total.draws += 1
      return total
    },
    { played: 0, goals: 0, homeWins: 0, awayWins: 0, draws: 0 },
  )
}

function flattenRecentOpponents(recentOpponents) {
  if (!recentOpponents) return []
  if (Array.isArray(recentOpponents)) return recentOpponents
  return [...(recentOpponents.home ?? []), ...(recentOpponents.away ?? [])]
}

function readOptionalRate(match, context, key) {
  const value = context[key] ?? match.raw?.[key] ?? match.analysis?.raw?.[key]
  if (value === null || value === undefined) return null
  return roundRate(Number(value) > 1 ? Number(value) / 100 : Number(value))
}

function summarizeForm(form) {
  return {
    played: numberValue(form?.played),
    wins: numberValue(form?.wins),
    draws: numberValue(form?.draws),
    losses: numberValue(form?.losses),
    goals_for: numberValue(form?.goals_for),
    goals_against: numberValue(form?.goals_against),
    clean_sheets: numberValue(form?.clean_sheets),
  }
}

function emptyForm() {
  return summarizeForm({})
}

function formatForm(form) {
  return `${numberValue(form?.wins)}-${numberValue(form?.draws)}-${numberValue(form?.losses)}`
}

function getGoalDifference(standing) {
  return numberValue(standing.goalDifference ?? standing.goal_difference ?? standing.goalsFor - standing.goalsAgainst)
}

function getWinPercentage(standing) {
  const played = numberValue(standing.playedGames ?? standing.played)
  if (!played) return null
  return roundRate(numberValue(standing.won ?? standing.wins) / played)
}

function formPoints(form) {
  return numberValue(form?.wins) * 3 + numberValue(form?.draws)
}

function formGoalDiff(form) {
  return numberValue(form?.goals_for) - numberValue(form?.goals_against)
}

function getTeamId(team) {
  return Number(team?.api_team_id ?? team?.id ?? team?.apiTeamId ?? 0)
}

function formatRate(value) {
  return value === null || value === undefined ? '-' : `${roundRate(value)}%`
}

function roundRate(value) {
  return Math.round(clamp(Number(value) * 100, 0, 100))
}

function roundNumber(value) {
  return Math.round(Number(value) * 100) / 100
}

function numberValue(value) {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
}
