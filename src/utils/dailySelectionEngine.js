import { getLeagueQualityScore } from './leagueQualityScoring.js'

export const DAILY_SELECTION_ALGORITHM_VERSION = 'market-ready-dynamic-selection-v1'

export const dailySelectionConfig = Object.freeze({
  algorithmVersion: DAILY_SELECTION_ALGORITHM_VERSION,
  coreTarget: 30,
  expansionStep: 10,
  maxCandidates: 60,
  minMarketReadyTarget: 12,
  targetMarketCoverageRatio: 0.4,
  primaryScoreThreshold: 72,
  secondaryScoreThreshold: 64,
  ready: Object.freeze({
    dataReadinessScore: 80,
    confidence: 72,
    edgeScore: 65,
    riskScore: 45,
    moduleConsistency: 70,
    criticalMissingFields: 0,
  }),
  watch: Object.freeze({
    dataReadinessScore: 65,
    confidence: 62,
    edgeScore: 55,
    riskScore: 60,
  }),
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
      coreTarget: positiveInteger(options.coreTarget, dailySelectionConfig.coreTarget),
      expansionStep: positiveInteger(options.expansionStep, dailySelectionConfig.expansionStep),
      maxCandidates: positiveInteger(options.maxCandidates ?? options.limit, dailySelectionConfig.maxCandidates),
      minMarketReadyTarget: positiveInteger(options.minMarketReadyTarget, dailySelectionConfig.minMarketReadyTarget),
      targetMarketCoverageRatio: numericValue(options.targetMarketCoverageRatio, dailySelectionConfig.targetMarketCoverageRatio),
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
    const decision = classifyDecision({ match, hardFilter, softRanking, context })
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
      marketReady: softRanking.hasMarketData,
      selectionStatus: decision.status,
      decisionStatus: decision.status,
      decisionRankEligible: decision.rankEligible,
      decision,
    }
  })

  const eligible = rows.filter((row) => row.passedHardFilter)
  const rejected = rows.filter((row) => !row.passedHardFilter)
  const rankedCandidates = buildDynamicCandidatePool(eligible, context.config)
  const selectedRows = rankedCandidates.filter((row) => row.decisionStatus !== 'REJECTED').map((row, index) => ({
    ...row,
    rank: row.decisionRankEligible ? index + 1 : null,
    decisionRank: row.decisionRankEligible ? index + 1 : null,
    tier: getSelectionTier(row, context.config),
  }))

  const selectedIds = new Set(selectedRows.map((row) => row.fixtureId || row.match?.id).filter(Boolean))
  const marketReadyCount = selectedRows.filter((row) => row.decisionStatus === 'READY').length
  const probedCandidateCount = Math.min(rankedCandidates.length, context.config.maxCandidates)
  const coverageRatio = probedCandidateCount ? marketReadyCount / probedCandidateCount : 0
  const expansionStopReason = getExpansionStopReason({
    marketReadyCount,
    probedCandidateCount,
    candidateCount: rankedCandidates.length,
    totalEligible: eligible.length,
    config: context.config,
  })
  const healthStatus = selectedRows.length ? 'DYNAMIC_BOARD_READY' : eligible.length ? 'NO_DECISION_READY' : 'NO_ELIGIBLE_CANDIDATES'

  return {
    algorithmVersion: DAILY_SELECTION_ALGORITHM_VERSION,
    pipelineVersion: 'market-ready-dynamic-pipeline-v1',
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
      readyCount: selectedRows.filter((row) => row.decisionStatus === 'READY').length,
      watchCount: selectedRows.filter((row) => row.decisionStatus === 'WATCH').length,
      waitingMarketCount: selectedRows.filter((row) => row.decisionStatus === 'WAITING_MARKET').length,
      rejectedCount: rejected.length + rankedCandidates.filter((row) => row.decisionStatus === 'REJECTED').length,
      primarySelected: selectedRows.filter((row) => row.tier === 'CORE').length,
      secondarySelected: selectedRows.filter((row) => row.tier === 'EXPANDED').length,
      fallbackSelected: selectedRows.filter((row) => row.tier === 'RESERVE').length,
      marketReadySelected: selectedRows.filter((row) => row.decisionStatus === 'READY').length,
      waitingMarketSelected: selectedRows.filter((row) => row.decisionStatus === 'WAITING_MARKET').length,
      coreCandidates: rankedCandidates.filter((row) => row.candidateTier === 'CORE').length,
      expandedCandidates: rankedCandidates.filter((row) => row.candidateTier === 'EXPANDED').length,
      reserveCandidates: rankedCandidates.filter((row) => row.candidateTier === 'RESERVE').length,
      marketProbedCandidates: probedCandidateCount,
      marketReadyCandidates: marketReadyCount,
      targetMarketCoverageRatio: context.config.targetMarketCoverageRatio,
      marketCoverageRatio: roundScore(coverageRatio * 100),
      expansionSteps: Math.max(0, Math.ceil(Math.max(0, rankedCandidates.length - context.config.coreTarget) / context.config.expansionStep)),
      expansionStopReason,
      healthStatus,
    },
  }
}

export function compareDailySelectionRows(a, b) {
  return (
    decisionStatusPriority(b.decisionStatus) - decisionStatusPriority(a.decisionStatus) ||
    b.selectionScore - a.selectionScore ||
    getRecommendationPriority(b.softRanking?.recommendation) - getRecommendationPriority(a.softRanking?.recommendation) ||
    a.kickoffTime - b.kickoffTime ||
    String(a.fixtureId ?? a.match?.id ?? '').localeCompare(String(b.fixtureId ?? b.match?.id ?? '')) ||
    a.inputIndex - b.inputIndex
  )
}

function getSelectionTier(row, config) {
  if (row.candidateTier) return row.candidateTier
  if (row.candidateRank <= config.coreTarget) return 'CORE'
  if (row.candidateRank <= config.maxCandidates) return 'EXPANDED'
  return 'RESERVE'
}

function buildDynamicCandidatePool(eligible, config) {
  const sorted = [...eligible].sort(compareDailySelectionRows)
  const maxCandidates = Math.max(0, Math.min(config.maxCandidates, sorted.length))
  let target = Math.min(config.coreTarget, maxCandidates)
  let pool = sorted.slice(0, target)

  while (target < maxCandidates && shouldExpandCandidatePool(pool, config)) {
    target = Math.min(target + config.expansionStep, maxCandidates)
    pool = sorted.slice(0, target)
  }

  return pool.map((row, index) => ({
    ...row,
    candidateRank: index + 1,
    candidateTier: index < config.coreTarget ? 'CORE' : index < target ? 'EXPANDED' : 'RESERVE',
  }))
}

function shouldExpandCandidatePool(rows, config) {
  if (!rows.length) return false
  const marketReadyCount = rows.filter((row) => row.decisionStatus === 'READY').length
  return marketReadyCount < config.minMarketReadyTarget &&
    marketReadyCount / rows.length < config.targetMarketCoverageRatio
}

function getExpansionStopReason({ marketReadyCount, probedCandidateCount, candidateCount, totalEligible, config }) {
  if (marketReadyCount >= config.minMarketReadyTarget) return 'MIN_MARKET_READY_TARGET_REACHED'
  if (probedCandidateCount > 0 && marketReadyCount / probedCandidateCount >= config.targetMarketCoverageRatio) return 'TARGET_MARKET_COVERAGE_RATIO_REACHED'
  if (candidateCount >= config.maxCandidates) return 'MAX_CANDIDATES_REACHED'
  if (candidateCount >= totalEligible) return 'NO_MORE_CANDIDATES'
  return 'CANDIDATE_POOL_READY'
}

function classifyDecision({ match, hardFilter, softRanking, context }) {
  if (!hardFilter.passed) {
    return {
      status: 'REJECTED',
      rankEligible: false,
      failedGates: hardFilter.reasons,
      reason: 'Fixture rejected by hard filters',
    }
  }

  const dataReadinessScore = getDataQualityScore(match)
  const confidence = getConfidenceScore(match)
  const edgeScore = getValueScore(match)
  const riskScore = getRiskScore(match)
  const moduleConsistency = getModuleConsistencyScore(match)
  const criticalMissingFields = getCriticalMissingFieldCount(match)
  const marketReady = softRanking.hasMarketData
  const gates = {
    market_ready: marketReady,
    data_readiness_score: dataReadinessScore,
    confidence,
    edge_score: edgeScore,
    risk_score: riskScore,
    module_consistency: moduleConsistency,
    critical_missing_fields: criticalMissingFields,
  }

  if (!marketReady) {
    return {
      status: 'WAITING_MARKET',
      rankEligible: false,
      gates,
      failedGates: [reason('WAITING_MARKET', 'No valid AH/O-U market is available; final pick is blocked')],
      reason: 'Waiting for market availability',
      ahPickStatus: 'รอเส้น AH',
      ouPickStatus: 'รอราคา O/U',
      finalPick: null,
    }
  }

  const ready = context.config.ready ?? dailySelectionConfig.ready
  const readyFailures = []
  if (dataReadinessScore < ready.dataReadinessScore) readyFailures.push(reason('DATA_READINESS_BELOW_READY', `data_readiness_score ${dataReadinessScore} < ${ready.dataReadinessScore}`))
  if (confidence < ready.confidence) readyFailures.push(reason('CONFIDENCE_BELOW_READY', `confidence ${confidence} < ${ready.confidence}`))
  if (edgeScore < ready.edgeScore) readyFailures.push(reason('EDGE_BELOW_READY', `edge_score ${edgeScore} < ${ready.edgeScore}`))
  if (riskScore > ready.riskScore) readyFailures.push(reason('RISK_ABOVE_READY', `risk_score ${riskScore} > ${ready.riskScore}`))
  if (moduleConsistency < ready.moduleConsistency) readyFailures.push(reason('MODULE_CONSISTENCY_BELOW_READY', `module_consistency ${moduleConsistency} < ${ready.moduleConsistency}`))
  if (criticalMissingFields > ready.criticalMissingFields) readyFailures.push(reason('CRITICAL_FIELDS_MISSING', `critical_missing_fields ${criticalMissingFields} > ${ready.criticalMissingFields}`))

  if (!readyFailures.length) {
    return {
      status: 'READY',
      rankEligible: true,
      gates,
      failedGates: [],
      reason: 'Market-ready candidate passed READY gates',
    }
  }

  const watch = context.config.watch ?? dailySelectionConfig.watch
  const watchPassed = dataReadinessScore >= watch.dataReadinessScore &&
    (confidence >= watch.confidence || edgeScore >= watch.edgeScore) &&
    riskScore <= watch.riskScore &&
    criticalMissingFields === 0

  if (watchPassed) {
    return {
      status: 'WATCH',
      rankEligible: false,
      gates,
      failedGates: readyFailures,
      reason: 'Market-ready candidate did not pass READY gates',
    }
  }

  return {
    status: 'REJECTED',
    rankEligible: false,
    gates,
    failedGates: readyFailures,
    reason: 'Candidate did not pass decision quality gates',
  }
}

function decisionStatusPriority(status) {
  if (status === 'READY') return 4
  if (status === 'WATCH') return 3
  if (status === 'WAITING_MARKET') return 2
  return 1
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
    (Array.isArray(rows) && rows.some(isUsableDecisionMarket)) ||
      oddsRowsUsed > 0,
  )
}

function isUsableDecisionMarket(row = {}) {
  const focus = String(row.market_focus ?? '').toUpperCase()
  const name = String(row.market_name ?? row.name ?? '').toLowerCase()
  const hasPrice = row.price !== null && row.price !== undefined && Number(row.price) > 0
  const isAh = focus === 'AH' || name.includes('asian handicap') || name.includes('handicap')
  const isOu = focus === 'OU' || name.includes('over/under') || name.includes('goals over')
  return hasPrice && (isAh || isOu)
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

function getConfidenceScore(match = {}) {
  const analysis = getAnalysis(match)
  return scoreValue(analysis.calibrated_confidence_score ?? analysis.confidence_score ?? match.confidence, 0)
}

function getModuleConsistencyScore(match = {}) {
  const analysis = getAnalysis(match)
  const values = [
    analysis.team_strength_score,
    analysis.form_score,
    analysis.home_advantage_score ?? analysis.home_away_score,
    analysis.goal_scoring_score ?? analysis.goal_quality_score,
    analysis.defensive_stability_score,
    analysis.tactical_matchup_score ?? analysis.tactical_score,
    analysis.motivation_score,
  ].map((value) => firstNumber(value)).filter((value) => value !== null)
  if (!values.length) return 70
  const average = values.reduce((total, value) => total + value, 0) / values.length
  const spread = Math.max(...values) - Math.min(...values)
  return roundScore(clamp(average - spread * 0.2, 0, 100))
}

function getCriticalMissingFieldCount(match = {}) {
  const checks = [
    getFixtureId(match),
    getKickoff(match),
    getLeagueName(match),
    getHomeTeamName(match),
    getAwayTeamName(match),
  ]
  return checks.filter((value) => !value).length
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

function positiveInteger(value, fallback) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback
}

function numericValue(value, fallback) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
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
