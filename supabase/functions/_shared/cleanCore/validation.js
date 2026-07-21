import { DEFAULT_DECISION_THRESHOLDS, MARKET_TYPE, RISK_LEVEL } from './contracts.js'
import { isPlayableMatchStatus, isTerminalMatchStatus, normalizeMatchStatus } from './matchStatus.js'
import { isActionableMarket, normalizeMarketType } from './markets.js'

export function validateFixture(fixture = {}) {
  const source = isRecord(fixture) ? fixture : {}
  const errors = []
  const warnings = []
  const fixtureId = identifier(source.id ?? source.fixtureId ?? source.fixture_id ?? source.apiFixtureId ?? source.api_fixture_id)
  const homeValue = source.homeTeam ?? source.home_team ?? source.home
  const awayValue = source.awayTeam ?? source.away_team ?? source.away
  const homeTeam = teamName(homeValue) ?? text(source.homeTeamName ?? source.home_team_name ?? source.home_name)
  const awayTeam = teamName(awayValue) ?? text(source.awayTeamName ?? source.away_team_name ?? source.away_name)
  const homeTeamId = identifier(teamId(homeValue) ?? source.homeTeamId ?? source.home_team_id ?? source.homeApiTeamId ?? source.home_api_team_id)
  const awayTeamId = identifier(teamId(awayValue) ?? source.awayTeamId ?? source.away_team_id ?? source.awayApiTeamId ?? source.away_api_team_id)
  const kickoff = source.kickoffAt ?? source.kickoff_at ?? source.kickoff ?? source.date
  const leagueValue = source.league
  const league = teamName(leagueValue) ?? text(source.leagueName ?? source.league_name ?? source.competition)
  const leagueId = identifier(teamId(leagueValue) ?? source.leagueId ?? source.league_id ?? source.apiLeagueId ?? source.api_league_id)
  const statusValue = source.statusShort ?? source.status_short ?? source.matchStatus ?? source.match_status ?? source.status
  const status = normalizeMatchStatus(isRecord(statusValue) ? statusValue.short ?? statusValue.long : statusValue)

  if (fixtureId === null) errors.push('FIXTURE_ID_MISSING')
  if (!homeTeam) errors.push('HOME_TEAM_MISSING')
  if (!awayTeam) errors.push('AWAY_TEAM_MISSING')
  if (homeTeamId === null) errors.push('HOME_TEAM_ID_MISSING')
  if (awayTeamId === null) errors.push('AWAY_TEAM_ID_MISSING')
  if (homeTeamId !== null && awayTeamId !== null && homeTeamId === awayTeamId) errors.push('FIXTURE_TEAM_IDS_IDENTICAL')
  if (!isValidDateValue(kickoff)) errors.push('KICKOFF_INVALID')
  if (!league) errors.push('LEAGUE_MISSING')
  if (leagueId === null) errors.push('LEAGUE_ID_MISSING')
  if (!isPlayableMatchStatus(status)) errors.push('MATCH_NOT_PLAYABLE')

  const terminal = isTerminalMatchStatus(status) || errors.includes('FIXTURE_TEAM_IDS_IDENTICAL')
  return validationResult(errors, warnings, { retryable: errors.length > 0 && !terminal, terminal })
}

export function validateAnalysis(analysis, options = {}) {
  const errors = []
  const warnings = []
  if (!isRecord(analysis)) return validationResult(['ANALYSIS_MISSING'], warnings, { retryable: true })

  const score = strictFiniteNumber(analysis.score ?? analysis.analysisScore ?? analysis.analysis_score)
  const confidence = strictFiniteNumber(analysis.confidence ?? analysis.confidenceScore ?? analysis.confidence_score)
  const risk = String(analysis.riskLevel ?? analysis.risk_level ?? '').toUpperCase()
  if (score === null) errors.push('ANALYSIS_SCORE_INVALID')
  if (confidence === null || confidence < 0 || confidence > 100) errors.push('ANALYSIS_CONFIDENCE_INVALID')
  if (!Object.values(RISK_LEVEL).includes(risk)) errors.push('ANALYSIS_RISK_INVALID')

  const requiredOutputs = Array.isArray(options.requiredOutputs) ? options.requiredOutputs : []
  if (requiredOutputs.length > 0) {
    for (const field of requiredOutputs) {
      if (!hasMeaningfulValue(getPath(analysis, field))) errors.push(`ANALYSIS_OUTPUT_MISSING:${field}`)
    }
  } else if (!hasAnalysisOutput(analysis)) {
    errors.push('ANALYSIS_OUTPUT_MISSING')
  }

  return validationResult(errors, warnings, { terminal: errors.length > 0 })
}

export function validateMarket(market = {}, options = {}) {
  const sourceValue = isRecord(market) ? market : {}
  const optionValues = isRecord(options) ? options : {}
  const errors = []
  const warnings = []
  const marketType = normalizeMarketType(sourceValue.marketType ?? sourceValue.market_type ?? sourceValue.type ?? sourceValue.name)
  const selection = sourceValue.selection ?? sourceValue.value ?? sourceValue.side ?? sourceValue.direction
  const line = parseLine(sourceValue.line ?? sourceValue.marketLine ?? sourceValue.market_line)
  const source = text(sourceValue.source ?? sourceValue.provider)
  const bookmaker = text(sourceValue.bookmaker ?? sourceValue.bookmakerName ?? sourceValue.bookmaker_name)
  const timestamp = sourceValue.timestamp ?? sourceValue.sourceTimestamp ?? sourceValue.source_timestamp ?? sourceValue.updatedAt ?? sourceValue.updated_at
  const freshness = resolveFreshness(sourceValue, optionValues, timestamp)

  if (marketType === MARKET_TYPE.UNKNOWN) errors.push('MARKET_TYPE_INVALID')
  if (!validMarketSelection(marketType, selection)) errors.push('MARKET_SELECTION_INVALID')
  if ([MARKET_TYPE.ASIAN_HANDICAP, MARKET_TYPE.OVER_UNDER].includes(marketType) && line === null) errors.push('MARKET_LINE_INVALID')
  if (optionValues.requireSource !== false && !source) errors.push('MARKET_SOURCE_MISSING')
  if (optionValues.requireBookmaker !== false && !bookmaker) errors.push('MARKET_BOOKMAKER_MISSING')
  if (!isValidDateValue(timestamp)) errors.push('MARKET_TIMESTAMP_INVALID')
  errors.push(...freshness.errors)
  if (freshness.fresh === null && freshness.errors.length === 0) errors.push('MARKET_FRESHNESS_REQUIRED')
  else if (freshness.fresh === false && freshness.errors.length === 0) errors.push('MARKET_STALE')

  const retryableCodes = new Set([
    'MARKET_SOURCE_MISSING',
    'MARKET_BOOKMAKER_MISSING',
    'MARKET_TIMESTAMP_INVALID',
    'MARKET_FRESHNESS_REQUIRED',
    'MARKET_STALE',
    'MARKET_AGE_INVALID',
  ])
  const retryable = errors.length > 0 && errors.every((error) => retryableCodes.has(error))
  return validationResult(errors, warnings, { retryable, terminal: errors.length > 0 && !retryable })
}

export function validateFinalPick(finalPick = {}, context = {}) {
  const source = isRecord(finalPick) ? finalPick : {}
  const contextValues = isRecord(context) ? context : {}
  const errors = []
  const warnings = []
  const marketType = normalizeMarketType(source.marketType ?? source.market_type ?? source.type ?? contextValues.marketType)
  const selection = source.selection ?? source.side ?? source.direction ?? source.value
  const line = parseLine(source.line ?? source.marketLine ?? source.market_line)
  const confidence = strictFiniteNumber(source.confidence ?? source.confidenceScore ?? source.confidence_score ?? contextValues.confidence)
  const risk = String(source.riskLevel ?? source.risk_level ?? contextValues.riskLevel ?? '').toUpperCase()
  const marketReady = booleanValue(contextValues.marketReady ?? source.marketReady ?? source.market_ready)
  const marketFresh = booleanValue(contextValues.marketFresh ?? source.marketFresh ?? source.market_fresh)

  if (!isActionableMarket(marketType)) errors.push('FINAL_PICK_MARKET_NOT_ACTIONABLE')
  if (!validMarketSelection(marketType, selection)) errors.push('FINAL_PICK_SELECTION_INVALID')
  if ([MARKET_TYPE.ASIAN_HANDICAP, MARKET_TYPE.OVER_UNDER].includes(marketType) && line === null) errors.push('FINAL_PICK_LINE_INVALID')
  if (confidence === null || confidence < 0 || confidence > 100) errors.push('FINAL_PICK_CONFIDENCE_INVALID')
  if (marketReady !== true) errors.push('FINAL_PICK_MARKET_NOT_READY')
  if (marketFresh !== true) errors.push('FINAL_PICK_MARKET_NOT_FRESH')
  if (risk === RISK_LEVEL.CRITICAL) errors.push('FINAL_PICK_RISK_CRITICAL')
  else if (!Object.values(RISK_LEVEL).includes(risk)) errors.push('FINAL_PICK_RISK_INVALID')

  return validationResult(errors, warnings, { terminal: errors.length > 0 })
}

function resolveFreshness(market, options, timestamp) {
  const errors = []
  const explicit = market.fresh ?? market.isFresh ?? market.marketFresh ?? market.market_fresh ?? market.freshness?.fresh ?? options.fresh
  const ageValue = options.marketAgeHours ?? market.marketAgeHours ?? market.market_age_hours
  const thresholdValue = options.marketFreshnessHours
    ?? options.maxAgeHours
    ?? market.marketFreshnessHours
    ?? market.market_freshness_hours
    ?? market.maxAgeHours
    ?? market.max_age_hours
    ?? DEFAULT_DECISION_THRESHOLDS.marketFreshnessHours
  const threshold = strictFiniteNumber(thresholdValue)
  if (threshold === null || threshold < 0) errors.push('MARKET_FRESHNESS_THRESHOLD_INVALID')

  if (ageValue !== null && ageValue !== undefined && ageValue !== '') {
    const ageHours = strictFiniteNumber(ageValue)
    if (ageHours === null || ageHours < 0) errors.push('MARKET_AGE_INVALID')
    if (errors.length > 0) return { fresh: null, errors }
    return { fresh: ageHours <= threshold, errors }
  }

  if (typeof explicit === 'boolean') return { fresh: explicit, errors }

  const referenceTime = options.referenceTime ?? market.referenceTime ?? market.reference_time
  if (referenceTime !== null && referenceTime !== undefined && referenceTime !== '') {
    if (!isValidDateValue(referenceTime)) errors.push('MARKET_REFERENCE_TIME_INVALID')
    if (!isValidDateValue(timestamp)) return { fresh: null, errors }
    const ageMs = dateValueMs(referenceTime) - dateValueMs(timestamp)
    if (ageMs < 0) errors.push('MARKET_AGE_INVALID')
    if (errors.length > 0) return { fresh: null, errors }
    return { fresh: ageMs <= threshold * 60 * 60 * 1000, errors }
  }

  return { fresh: null, errors }
}

function validMarketSelection(marketType, value) {
  if (!['string', 'number'].includes(typeof value)) return false
  const normalized = String(value).trim().toUpperCase().replaceAll(' ', '')
  if (!normalized) return false
  if (marketType === MARKET_TYPE.MATCH_WINNER) return ['1', 'X', '2', 'HOME', 'DRAW', 'AWAY'].includes(normalized)
  if (marketType === MARKET_TYPE.DOUBLE_CHANCE) return ['1X', 'X1', 'X2', '2X', '12', '1/2'].includes(normalized)
  if (marketType === MARKET_TYPE.CORRECT_SCORE) return /^\d{1,2}[:-]\d{1,2}$/.test(normalized)
  if (marketType === MARKET_TYPE.BTTS) return ['YES', 'NO', 'Y', 'N'].includes(normalized)
  return marketType !== MARKET_TYPE.UNKNOWN
}

function hasAnalysisOutput(analysis) {
  return [
    analysis.output,
    analysis.recommendation,
    analysis.direction,
    analysis.selection,
    analysis.summary,
    analysis.analysisOutput,
    analysis.outputs,
  ].some(hasMeaningfulValue)
}

function teamName(value) {
  if (typeof value === 'string') return text(value)
  return text(value?.name ?? value?.teamName ?? value?.team_name)
}

function teamId(value) {
  return value?.id ?? value?.teamId ?? value?.team_id ?? value?.apiTeamId ?? value?.api_team_id ?? value?.apiLeagueId ?? value?.api_league_id
}

function getPath(value, path) {
  return String(path).split('.').reduce((current, key) => current?.[key], value)
}

function parseLine(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function strictFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function booleanValue(value) {
  return typeof value === 'boolean' ? value : null
}

function text(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const normalized = String(value).trim()
  return normalized || null
}

function identifier(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
  if (typeof value !== 'string') return null
  return value.trim() || null
}

function hasMeaningfulValue(value) {
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'boolean') return true
  if (Array.isArray(value)) return value.some(hasMeaningfulValue)
  if (isRecord(value)) return Object.values(value).some(hasMeaningfulValue)
  return false
}

function isValidDateValue(value) {
  return Number.isFinite(dateValueMs(value))
}

function dateValueMs(value) {
  if (value instanceof Date) return value.getTime()
  if (typeof value !== 'string' || !value.trim()) return NaN
  return Date.parse(value)
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validationResult(errors, warnings, classification = {}) {
  const reasonCodes = [...new Set(errors)]
  return {
    valid: reasonCodes.length === 0,
    errors: reasonCodes,
    warnings: [...new Set(warnings)],
    reasonCodes,
    retryable: reasonCodes.length > 0 && classification.retryable === true,
    terminal: reasonCodes.length > 0 && classification.terminal === true,
  }
}
