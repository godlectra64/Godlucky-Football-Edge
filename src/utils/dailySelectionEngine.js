import { getLeagueQualityScore } from './leagueQualityScoring.js'

export const DAILY_SELECTION_ALGORITHM_VERSION = 'two-stage-selection-v1'

export const dailySelectionConfig = Object.freeze({
  algorithmVersion: DAILY_SELECTION_ALGORITHM_VERSION,
  topN: 10,
  primaryScoreThreshold: 72,
  secondaryScoreThreshold: 64,
  weights: Object.freeze({
    leagueQuality: 0.12,
    dataQuality: 0.18,
    marketQuality: 0.15,
    valueScore: 0.15,
    tacticalScore: 0.10,
    motivationScore: 0.08,
    confidenceScore: 0.14,
    riskSafetyScore: 0.08,
  }),
})

const terminalStatusCodes = new Set(['CANC', 'PST', 'ABD', 'SUSP', 'INT', 'AWD', 'WO', 'FT', 'AET', 'PEN'])
const terminalStatusText = /(cancelled|postponed|abandoned|suspended|interrupted|walkover|awarded|finished|after extra time|after penalties)/i

export function buildDailySelectionContext(matches = [], options = {}) {
  const firstKickoff = (matches ?? []).map(getKickoff).find(isValidDate)
  const selectionDate = options.selectionDate ?? (firstKickoff ? getBangkokDateKey(firstKickoff) : getBangkokDateKey(options.now ?? new Date()))
  const fixtureIdCounts = new Map()
  for (const match of matches ?? []) {
    const fixtureId = getFixtureId(match)
    if (!fixtureId) continue
    fixtureIdCounts.set(fixtureId, (fixtureIdCounts.get(fixtureId) ?? 0) + 1)
  }
  return {
    ...options,
    selectionDate,
    fixtureIdCounts,
    config: {
      ...dailySelectionConfig,
      topN: options.limit ?? options.topN ?? dailySelectionConfig.topN,
      ...(options.config ?? {}),
    },
  }
}

export function evaluateHardFilter(match = {}, context = {}) {
  const reasons = []
  const warnings = []
  const selectionDate = context.selectionDate ?? getBangkokDateKey(context.now ?? new Date())
  const fixtureId = getFixtureId(match)
  const kickoff = getKickoff(match)
  const homeTeam = getHomeTeamName(match)
  const awayTeam = getAwayTeamName(match)
  const league = getLeagueName(match)

  if (!fixtureId) reasons.push(reason('INVALID_FIXTURE_ID', 'Missing valid fixture id'))
  if (fixtureId && context.fixtureIdCounts?.get(fixtureId) > 1) reasons.push(reason('DUPLICATE_FIXTURE_ID', 'Fixture id is duplicated in candidate pool'))
  if (!isValidDate(kickoff)) reasons.push(reason('INVALID_KICKOFF_TIME', 'Missing or invalid kickoff time'))
  else if (getBangkokDateKey(kickoff) !== selectionDate) reasons.push(reason('OUTSIDE_SELECTION_DATE', 'Kickoff is outside selection date'))
  if (!homeTeam || !awayTeam) reasons.push(reason('MISSING_TEAM_IDENTITY', 'Missing home or away team identity'))
  if (homeTeam && awayTeam && normalizeText(homeTeam) === normalizeText(awayTeam)) reasons.push(reason('SAME_HOME_AWAY_TEAM', 'Home and away teams are the same'))
  if (!league) reasons.push(reason('MISSING_LEAGUE_IDENTITY', 'Missing league identity'))

  const status = normalizeFixtureStatus(match)
  if (terminalStatusCodes.has(status.code) || terminalStatusText.test(status.text)) {
    reasons.push(reason('INVALID_FIXTURE_STATUS', `Fixture status is ${status.code || status.text}`))
  }

  const support = getLeagueSupport(match)
  if (support.supported === false) reasons.push(reason('UNSUPPORTED_LEAGUE', support.reason || 'League explicitly unsupported'))

  if (!hasAnalyticalEvidence(match)) {
    reasons.push(reason('NO_ANALYTICAL_EVIDENCE', 'No usable analysis, team statistics, form, standings, or model features'))
  }

  if (!hasMarketData(match)) warnings.push(reason('WAITING_MARKET_DATA', 'No usable market data; apply soft penalty and waiting-market status'))
  if (getDataQualityScore(match) < 55) warnings.push(reason('LOW_DATA_QUALITY', 'Limited data quality; apply soft penalty'))

  return {
    passed: reasons.length === 0,
    reasons,
    warnings,
  }
}

export function calculateSoftRanking(candidate = {}, context = {}) {
  const match = candidate.match ?? candidate
  const analysis = getAnalysis(match)
  const components = {
    leagueQuality: scoreValue(analysis.league_quality_score ?? getLeagueQualityScore(match), 65),
    dataQuality: getDataQualityScore(match),
    marketQuality: getMarketQualityScore(match),
    valueScore: getValueScore(match),
    tacticalScore: scoreValue(analysis.tactical_matchup_score ?? analysis.tactical_score ?? analysis.home_away_score, 56),
    motivationScore: scoreValue(analysis.motivation_score, 55),
    confidenceScore: scoreValue(analysis.calibrated_confidence_score ?? analysis.confidence_score ?? match.confidence, 55),
    riskScore: getRiskScore(match),
    riskSafetyScore: 0,
  }
  components.riskSafetyScore = scoreValue(100 - components.riskScore, 50)

  const weights = context.config?.weights ?? dailySelectionConfig.weights
  const weightedScore = roundScore(
    components.leagueQuality * weights.leagueQuality +
      components.dataQuality * weights.dataQuality +
      components.marketQuality * weights.marketQuality +
      components.valueScore * weights.valueScore +
      components.tacticalScore * weights.tacticalScore +
      components.motivationScore * weights.motivationScore +
      components.confidenceScore * weights.confidenceScore +
      components.riskSafetyScore * weights.riskSafetyScore,
  )

  const penalties = []
  const bonuses = []
  if (!hasMarketData(match)) penalties.push(adjustment('MISSING_MARKET_DATA', 12))
  if (components.marketQuality < 40) penalties.push(adjustment('LOW_MARKET_QUALITY', 6))
  if (components.confidenceScore < 58) penalties.push(adjustment('LOW_CONFIDENCE', 7))
  if (components.riskScore >= 75) penalties.push(adjustment('HIGH_RISK', 10))
  if (components.dataQuality < 45) penalties.push(adjustment('LOW_DATA_QUALITY', 8))
  if (components.leagueQuality < 55) penalties.push(adjustment('LOW_LEAGUE_QUALITY', 5))
  if (components.confidenceScore >= 78 && components.riskScore <= 45) bonuses.push(adjustment('HIGH_CONFIDENCE_LOW_RISK', 4))
  if (hasMarketData(match) && components.marketQuality >= 70) bonuses.push(adjustment('MARKET_READY', 3))

  const calculatedScore = weightedScore + sumAdjustments(bonuses) - sumAdjustments(penalties)
  const finalScore = roundScore(clamp(calculatedScore, 0, 100))
  const recommendation = normalizeRecommendation(analysis.recommendation ?? match.recommendation)
  const marketState = hasMarketData(match) ? 'MARKET_READY' : 'WAITING_MARKET'

  return {
    algorithmVersion: DAILY_SELECTION_ALGORITHM_VERSION,
    components,
    weightedScore,
    penalties,
    bonuses,
    finalScore,
    recommendation,
    marketState,
    hasMarketData: marketState === 'MARKET_READY',
    finalPickAllowed: marketState === 'MARKET_READY',
  }
}

export function selectDailyTop10(matches = [], options = {}) {
  const context = buildDailySelectionContext(matches, options)
  const rows = (matches ?? []).map((match, inputIndex) => {
    const hardFilter = evaluateHardFilter(match, context)
    const softRanking = calculateSoftRanking({ match }, context)
    return {
      match,
      inputIndex,
      fixtureId: getFixtureId(match),
      leagueKey: normalizeText(getLeagueName(match)),
      kickoffTime: getTime(getKickoff(match)),
      hardFilter,
      softRanking,
      passedHardFilter: hardFilter.passed,
      selectionScore: softRanking.finalScore,
      hasMarketData: softRanking.hasMarketData,
      selectionStatus: softRanking.hasMarketData ? 'SELECTED_MARKET_READY' : 'SELECTED_WAITING_MARKET',
    }
  })

  const eligible = rows.filter((row) => row.passedHardFilter)
  const rejected = rows.filter((row) => !row.passedHardFilter)
  const selectedRows = fillTopN(eligible, context.config).map((row, index) => ({
    ...row,
    rank: index + 1,
    tier: getSelectionTier(row, context.config),
  }))

  const selectedIds = new Set(selectedRows.map((row) => row.fixtureId || row.match?.id).filter(Boolean))
  const healthStatus = eligible.length >= context.config.topN
    ? selectedRows.length === context.config.topN ? 'OK' : 'TOP10_UNDERFILLED'
    : 'INSUFFICIENT_ELIGIBLE_CANDIDATES'

  return {
    algorithmVersion: DAILY_SELECTION_ALGORITHM_VERSION,
    selectionDate: context.selectionDate,
    selected: selectedRows,
    candidates: rows.map((row) => ({
      ...row,
      selected: selectedIds.has(row.fixtureId || row.match?.id),
    })),
    eligible,
    rejected,
    summary: {
      fixturesToday: rows.length,
      eligibleCandidateCount: eligible.length,
      hardFilterPassed: eligible.length,
      hardFilterRejected: rejected.length,
      selectedCount: selectedRows.length,
      primarySelected: selectedRows.filter((row) => row.tier === 'PRIMARY').length,
      secondarySelected: selectedRows.filter((row) => row.tier === 'SECONDARY').length,
      fallbackSelected: selectedRows.filter((row) => row.tier === 'FALLBACK').length,
      marketReadySelected: selectedRows.filter((row) => row.hasMarketData).length,
      waitingMarketSelected: selectedRows.filter((row) => !row.hasMarketData).length,
      healthStatus,
    },
  }
}

export function compareDailySelectionRows(a, b) {
  return (
    b.selectionScore - a.selectionScore ||
    Number(b.hasMarketData) - Number(a.hasMarketData) ||
    getRecommendationPriority(b.softRanking?.recommendation) - getRecommendationPriority(a.softRanking?.recommendation) ||
    a.kickoffTime - b.kickoffTime ||
    String(a.fixtureId ?? a.match?.id ?? '').localeCompare(String(b.fixtureId ?? b.match?.id ?? '')) ||
    a.inputIndex - b.inputIndex
  )
}

function fillTopN(eligible, config) {
  const selected = []
  const used = new Set()
  const passes = [
    { tier: 'PRIMARY', threshold: config.primaryScoreThreshold, cap: 3 },
    { tier: 'SECONDARY', threshold: config.secondaryScoreThreshold, cap: 5 },
    { tier: 'FALLBACK', threshold: 0, cap: Infinity },
  ]
  const sorted = [...eligible].sort(compareDailySelectionRows)

  for (const pass of passes) {
    const leagueCounts = countSelectedLeagues(selected)
    for (const row of sorted) {
      const key = row.fixtureId || row.match?.id
      if (!key || used.has(key)) continue
      if (row.selectionScore < pass.threshold) continue
      if ((leagueCounts.get(row.leagueKey) ?? 0) >= pass.cap) continue
      selected.push({ ...row, fallbackLevel: pass.tier })
      used.add(key)
      leagueCounts.set(row.leagueKey, (leagueCounts.get(row.leagueKey) ?? 0) + 1)
      if (selected.length >= config.topN) return selected
    }
  }

  return selected
}

function getSelectionTier(row, config) {
  if (row.fallbackLevel) return row.fallbackLevel
  if (row.selectionScore >= config.primaryScoreThreshold) return 'PRIMARY'
  if (row.selectionScore >= config.secondaryScoreThreshold) return 'SECONDARY'
  return 'FALLBACK'
}

function countSelectedLeagues(rows) {
  const counts = new Map()
  for (const row of rows) counts.set(row.leagueKey, (counts.get(row.leagueKey) ?? 0) + 1)
  return counts
}

function getFixtureId(match = {}) {
  const value = match.api_sports_fixture_id ?? match.api_fixture_id ?? match.fixture_id ?? match.fixtureId ?? match.id ?? match.match_id
  const text = String(value ?? '').trim()
  return text || null
}

function getKickoff(match = {}) {
  return match.kickoffAt ?? match.kickoff_at ?? match.utcDate ?? match.raw?.utcDate ?? match.raw?.apiFootball?.fixture?.date ?? null
}

function getHomeTeamName(match = {}) {
  return firstText(match.homeTeam?.name, match.home_team?.name, match.home_team, match.raw?.homeTeam?.name, match.raw?.apiFootball?.teams?.home?.name)
}

function getAwayTeamName(match = {}) {
  return firstText(match.awayTeam?.name, match.away_team?.name, match.away_team, match.raw?.awayTeam?.name, match.raw?.apiFootball?.teams?.away?.name)
}

function getLeagueName(match = {}) {
  return firstText(match.league?.name, match.competition?.name, match.raw?.league?.name, match.raw?.competition?.name, match.raw?.apiFootball?.league?.name)
}

function normalizeFixtureStatus(match = {}) {
  const code = String(firstText(match.status_short, match.statusShort, match.fixture_status_short, match.raw?.apiFootball?.fixture?.status?.short, '')).toUpperCase()
  const text = String(firstText(match.status_long, match.status, match.match_status, match.raw?.apiFootball?.fixture?.status?.long, '')).toLowerCase()
  return { code, text }
}

function getLeagueSupport(match = {}) {
  const analysis = getAnalysis(match)
  const rawSupport = analysis.raw?.league_support ?? match.league_support ?? match.league?.support
  if (rawSupport?.supported === false) return { supported: false, reason: rawSupport.reason }
  if (match.league?.enabled === false) return { supported: false, reason: 'League disabled' }
  return { supported: true }
}

function hasAnalyticalEvidence(match = {}) {
  const analysis = getAnalysis(match)
  const raw = analysis.raw ?? {}
  return Boolean(
    analysis.analysis_summary ||
      analysis.confidence_score ||
      analysis.ranking_score ||
      analysis.professional_score ||
      analysis.team_strength_score ||
      raw.modules ||
      raw.homeForm ||
      raw.awayForm ||
      match.homeForm ||
      match.awayForm ||
      match.standings?.length ||
      raw.standings?.length,
  )
}

function hasMarketData(match = {}) {
  const analysis = getAnalysis(match)
  const rows = match.odds ?? match.matchOdds ?? match.match_odds ?? analysis.raw?.odds ?? []
  const oddsRowsUsed = Number(analysis.odds_rows_used ?? analysis.raw?.odds_rows_used ?? 0)
  return Boolean(
    (Array.isArray(rows) && rows.length > 0) ||
      oddsRowsUsed > 0 ||
      match.hasMarketData ||
      match.has_market_data ||
      analysis.market_data_used,
  )
}

function getDataQualityScore(match = {}) {
  const analysis = getAnalysis(match)
  const stored = firstNumber(analysis.data_quality_score, match.dataQualityScore, match.data_quality_score, match.data_readiness_score)
  if (stored !== null) return scoreValue(stored)
  const checks = [
    Boolean(getFixtureId(match)),
    Boolean(getKickoff(match)),
    Boolean(getLeagueName(match)),
    Boolean(getHomeTeamName(match)),
    Boolean(getAwayTeamName(match)),
    hasAnalyticalEvidence(match),
    Boolean(match.hasFixtureDetail ?? match.has_fixture_detail),
    hasMarketData(match),
  ]
  return roundScore(35 + checks.filter(Boolean).length * 8)
}

function getMarketQualityScore(match = {}) {
  const analysis = getAnalysis(match)
  if (!hasMarketData(match)) return 25
  return scoreValue(analysis.market_quality_score ?? analysis.market_edge_score ?? analysis.odds_confidence_score ?? analysis.market_reading_score, 58)
}

function getValueScore(match = {}) {
  const analysis = getAnalysis(match)
  if (!hasMarketData(match)) return Math.min(scoreValue(analysis.value_edge_score ?? analysis.market_edge_score, 45), 55)
  return scoreValue(analysis.value_edge_score ?? analysis.market_edge_score ?? analysis.edge_score, 58)
}

function getRiskScore(match = {}) {
  const analysis = getAnalysis(match)
  const direct = firstNumber(analysis.risk_score, match.riskScore, match.risk_score)
  if (direct !== null) return scoreValue(direct)
  const riskLevel = String(match.riskLevel ?? match.risk_level ?? analysis.risk_level ?? '').toUpperCase()
  if (riskLevel === 'LOW') return 30
  if (riskLevel === 'HIGH') return 78
  return 55
}

function getAnalysis(match = {}) {
  const analysis = Array.isArray(match.analysis) ? match.analysis[0] : match.analysis ?? match.match_analysis ?? {}
  return analysis ?? {}
}

function getRecommendationPriority(value) {
  const normalized = normalizeRecommendation(value)
  if (normalized === 'BET') return 4
  if (normalized === 'LEAN') return 3
  if (normalized === 'WATCH') return 2
  return 1
}

function normalizeRecommendation(value) {
  const normalized = String(value ?? '').toUpperCase().replace('_', ' ')
  return ['BET', 'LEAN', 'WATCH', 'NO BET'].includes(normalized) ? normalized : 'NO BET'
}

function reason(code, detail) {
  return { code, detail }
}

function adjustment(code, value) {
  return { code, value }
}

function sumAdjustments(items) {
  return items.reduce((total, item) => total + scoreValue(item.value), 0)
}

function getBangkokDateKey(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function isValidDate(value) {
  return Number.isFinite(new Date(value ?? '').getTime())
}

function getTime(value) {
  const time = new Date(value ?? 0).getTime()
  return Number.isFinite(time) ? time : 0
}

function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase()
}

function firstText(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue
    const text = String(value).trim()
    if (text) return text
  }
  return ''
}

function firstNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return numeric
  }
  return null
}

function scoreValue(value, fallback = 0) {
  const numeric = Number(value)
  return roundScore(Number.isFinite(numeric) ? numeric : fallback)
}

function roundScore(value) {
  return Math.round(clamp(value, 0, 100) * 10) / 10
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
}
