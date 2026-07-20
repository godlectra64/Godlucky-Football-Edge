import { MARKET_TYPE, RISK_LEVEL } from './contracts.js'
import { isActionableMarket, normalizeMarketType } from './markets.js'

const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN', 'FINISHED', 'MATCH_FINISHED', 'AFTER_EXTRA_TIME', 'PENALTY_SHOOTOUT'])
const VOID_STATUSES = new Set(['PST', 'CANC', 'ABD', 'AWD', 'WO', 'POSTPONED', 'CANCELLED', 'ABANDONED', 'MATCH_ABANDONED'])
const PLAYABLE_STATUSES = new Set(['NS', 'TBD', 'SCHEDULED', 'TIMED', 'NOT_STARTED', 'LIVE', '1H', '2H', 'HT', 'ET', 'BT', 'P', 'SUSP', 'INT'])

export function validateFixture(fixture = {}) {
  const errors = []
  const warnings = []
  const fixtureId = fixture.id ?? fixture.fixtureId ?? fixture.fixture_id ?? fixture.apiFixtureId ?? fixture.api_fixture_id
  const homeTeam = teamName(fixture.homeTeam ?? fixture.home_team ?? fixture.home)
    ?? text(fixture.homeTeamName ?? fixture.home_team_name ?? fixture.home_name)
  const awayTeam = teamName(fixture.awayTeam ?? fixture.away_team ?? fixture.away)
    ?? text(fixture.awayTeamName ?? fixture.away_team_name ?? fixture.away_name)
  const kickoff = fixture.kickoffAt ?? fixture.kickoff_at ?? fixture.kickoff ?? fixture.date
  const league = teamName(fixture.league) ?? text(fixture.leagueName ?? fixture.league_name ?? fixture.competition)
  const statusValue = fixture.statusShort ?? fixture.status_short ?? fixture.matchStatus ?? fixture.match_status ?? fixture.status
  const status = normalizeStatus(typeof statusValue === 'object' ? statusValue?.short ?? statusValue?.long : statusValue)

  if (!hasValue(fixtureId)) errors.push('FIXTURE_ID_MISSING')
  if (!homeTeam) errors.push('HOME_TEAM_MISSING')
  if (!awayTeam) errors.push('AWAY_TEAM_MISSING')
  if (homeTeam && awayTeam && homeTeam.toLowerCase() === awayTeam.toLowerCase()) errors.push('FIXTURE_TEAMS_IDENTICAL')
  if (!kickoff || !Number.isFinite(Date.parse(kickoff))) errors.push('KICKOFF_INVALID')
  if (!league) errors.push('LEAGUE_MISSING')
  if (!status || FINISHED_STATUSES.has(status) || VOID_STATUSES.has(status) || !PLAYABLE_STATUSES.has(status)) errors.push('MATCH_NOT_PLAYABLE')

  return validationResult(errors, warnings)
}

export function validateAnalysis(analysis, options = {}) {
  const errors = []
  const warnings = []
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) return validationResult(['ANALYSIS_MISSING'], warnings)

  const score = finiteNumber(analysis.score ?? analysis.analysisScore ?? analysis.analysis_score)
  const confidence = finiteNumber(analysis.confidence ?? analysis.confidenceScore ?? analysis.confidence_score)
  const risk = String(analysis.riskLevel ?? analysis.risk_level ?? '').toUpperCase()
  if (score === null) errors.push('ANALYSIS_SCORE_INVALID')
  if (confidence === null || confidence < 0 || confidence > 100) errors.push('ANALYSIS_CONFIDENCE_INVALID')
  if (!Object.values(RISK_LEVEL).includes(risk)) errors.push('ANALYSIS_RISK_INVALID')

  const requiredOutputs = Array.isArray(options.requiredOutputs) ? options.requiredOutputs : []
  if (requiredOutputs.length > 0) {
    for (const field of requiredOutputs) {
      if (!hasValue(getPath(analysis, field))) errors.push(`ANALYSIS_OUTPUT_MISSING:${field}`)
    }
  } else if (!hasAnalysisOutput(analysis)) {
    errors.push('ANALYSIS_OUTPUT_MISSING')
  }

  return validationResult(errors, warnings)
}

export function validateMarket(market = {}, options = {}) {
  const errors = []
  const warnings = []
  const marketType = normalizeMarketType(market.marketType ?? market.market_type ?? market.type ?? market.name)
  const selection = market.selection ?? market.value ?? market.side ?? market.direction
  const line = parseLine(market.line ?? market.marketLine ?? market.market_line)
  const source = text(market.source ?? market.bookmaker ?? market.bookmakerName ?? market.bookmaker_name ?? market.provider)
  const timestamp = market.timestamp ?? market.sourceTimestamp ?? market.source_timestamp ?? market.updatedAt ?? market.updated_at
  const freshness = resolveFreshness(market, options, timestamp)

  if (marketType === MARKET_TYPE.UNKNOWN) errors.push('MARKET_TYPE_INVALID')
  if (!validMarketSelection(marketType, selection)) errors.push('MARKET_SELECTION_INVALID')
  if ([MARKET_TYPE.ASIAN_HANDICAP, MARKET_TYPE.OVER_UNDER].includes(marketType) && line === null) errors.push('MARKET_LINE_INVALID')
  if (options.requireSource !== false && !source) errors.push('MARKET_SOURCE_MISSING')
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) errors.push('MARKET_TIMESTAMP_INVALID')
  if (freshness === null) errors.push('MARKET_FRESHNESS_REQUIRED')
  else if (!freshness) errors.push('MARKET_STALE')

  return validationResult(errors, warnings)
}

export function validateFinalPick(finalPick = {}, context = {}) {
  const errors = []
  const warnings = []
  const marketType = normalizeMarketType(finalPick.marketType ?? finalPick.market_type ?? finalPick.type ?? context.marketType)
  const selection = finalPick.selection ?? finalPick.side ?? finalPick.direction ?? finalPick.value
  const line = parseLine(finalPick.line ?? finalPick.marketLine ?? finalPick.market_line)
  const confidence = finiteNumber(finalPick.confidence ?? finalPick.confidenceScore ?? finalPick.confidence_score ?? context.confidence)
  const risk = String(finalPick.riskLevel ?? finalPick.risk_level ?? context.riskLevel ?? '').toUpperCase()
  const marketReady = booleanValue(context.marketReady ?? finalPick.marketReady ?? finalPick.market_ready)
  const marketFresh = booleanValue(context.marketFresh ?? finalPick.marketFresh ?? finalPick.market_fresh)

  if (!isActionableMarket(marketType)) errors.push('FINAL_PICK_MARKET_NOT_ACTIONABLE')
  if (!validMarketSelection(marketType, selection)) errors.push('FINAL_PICK_SELECTION_INVALID')
  if ([MARKET_TYPE.ASIAN_HANDICAP, MARKET_TYPE.OVER_UNDER].includes(marketType) && line === null) errors.push('FINAL_PICK_LINE_INVALID')
  if (confidence === null || confidence < 0 || confidence > 100) errors.push('FINAL_PICK_CONFIDENCE_INVALID')
  if (marketReady !== true) errors.push('FINAL_PICK_MARKET_NOT_READY')
  if (marketFresh !== true) errors.push('FINAL_PICK_MARKET_NOT_FRESH')
  if (risk === RISK_LEVEL.CRITICAL) errors.push('FINAL_PICK_RISK_CRITICAL')
  else if (!Object.values(RISK_LEVEL).includes(risk)) errors.push('FINAL_PICK_RISK_INVALID')

  return validationResult(errors, warnings)
}

function resolveFreshness(market, options, timestamp) {
  const explicit = market.fresh ?? market.isFresh ?? market.marketFresh ?? market.market_fresh ?? market.freshness?.fresh ?? options.fresh
  if (typeof explicit === 'boolean') return explicit
  const ageHours = finiteNumber(options.marketAgeHours ?? market.marketAgeHours ?? market.market_age_hours)
  const maxAgeHours = finiteNumber(options.maxAgeHours ?? market.maxAgeHours ?? market.max_age_hours)
  if (ageHours !== null && maxAgeHours !== null) return ageHours >= 0 && ageHours <= maxAgeHours
  const referenceTime = options.referenceTime ?? market.referenceTime ?? market.reference_time
  if (referenceTime && timestamp && maxAgeHours !== null) {
    const referenceMs = Date.parse(referenceTime)
    const timestampMs = Date.parse(timestamp)
    const ageMs = referenceMs - timestampMs
    if (Number.isFinite(referenceMs) && Number.isFinite(timestampMs)) return ageMs >= 0 && ageMs <= maxAgeHours * 60 * 60 * 1000
  }
  return null
}

function validMarketSelection(marketType, value) {
  const normalized = String(value ?? '').trim().toUpperCase().replaceAll(' ', '')
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
    Array.isArray(analysis.outputs) && analysis.outputs.length > 0 ? analysis.outputs : null,
  ].some(hasValue)
}

function normalizeStatus(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function teamName(value) {
  if (typeof value === 'string') return text(value)
  return text(value?.name ?? value?.teamName ?? value?.team_name)
}

function getPath(value, path) {
  return String(path).split('.').reduce((current, key) => current?.[key], value)
}

function parseLine(value) {
  if (value === null || value === undefined || value === '') return null
  const match = String(value).match(/-?\d+(?:\.\d+)?/)
  const parsed = match ? Number(match[0]) : NaN
  return Number.isFinite(parsed) ? parsed : null
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function booleanValue(value) {
  return typeof value === 'boolean' ? value : null
}

function text(value) {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== ''
}

function validationResult(errors, warnings) {
  return { valid: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)] }
}
