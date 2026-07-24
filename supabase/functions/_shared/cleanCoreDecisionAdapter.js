import { DECISION_STATUS, MARKET_TYPE } from './cleanCore/contracts.js'
import { classifyDecision } from './cleanCore/decision.js'
import { normalizeMarketType } from './cleanCore/markets.js'
import { normalizeMatchStatus } from './cleanCore/matchStatus.js'
import { validateAnalysis, validateFixture, validateMarket } from './cleanCore/validation.js'

export const CLEAN_CORE_DECISION_ADAPTER_VERSION = 'clean-core-production-shadow-v1'
export const CLEAN_CORE_SHADOW_LOG_PREFIX = '[clean-core-shadow]'
export const CLEAN_CORE_SHADOW_MISMATCH_CODES = Object.freeze([
  'STATUS_NORMALIZATION_MISMATCH',
  'ELIGIBILITY_MISMATCH',
  'DECISION_STATUS_MISMATCH',
  'ACTIONABLE_PICK_MISMATCH',
  'MARKET_MAPPING_MISMATCH',
  'REASON_PRECEDENCE_MISMATCH',
  'CORE_INPUT_INCOMPLETE',
])

const LEGACY_REASON_MAP = Object.freeze({
  READY_SCORE_PASSED: 'READY_ALL_GATES_PASSED',
  FIXTURE_INVALID: 'REJECT_FIXTURE_INVALID',
  FIXTURE_CANCELLED: 'REJECT_MATCH_NOT_PLAYABLE',
  KICKOFF_PASSED: 'REJECT_MATCH_ALREADY_STARTED',
  FIXTURE_POSTPONED: 'WAIT_MATCH_RESCHEDULE',
  RISK_CRITICAL: 'REJECT_RISK_CRITICAL',
  DATA_INCOMPLETE: 'WAIT_ANALYSIS_INCOMPLETE',
  ANALYSIS_PENDING: 'WAIT_ANALYSIS_INCOMPLETE',
  MARKET_MISSING: 'WAIT_MARKET_MISSING',
  MARKET_STALE: 'WAIT_MARKET_STALE',
  MARKET_REFRESH_PENDING: 'WAIT_MARKET_REFRESH',
  FINAL_PICK_INVALID: 'REJECT_FINAL_PICK_INVALID',
  SCORE_BELOW_READY: 'WATCH_CONFIDENCE_BELOW_READY',
  VALUE_BORDERLINE: 'WATCH_MARKET_EDGE_WEAK',
})

/**
 * Pure production-to-Clean-Core mapping. The legacy result is deliberately
 * excluded: it is comparison evidence, never Clean Core authority.
 */
export function adaptCleanCoreDecision(input = {}) {
  const fixtureSource = asRecord(input.fixture)
  const analysisSource = asRecord(input.analysis)
  const fixture = normalizeFixture(fixtureSource)
  const analysis = normalizeAnalysis(analysisSource)
  const market = normalizeMarket(input.marketState, analysisSource)
  const fixtureValidation = validateFixture(fixture)
  const analysisValidation = validateAnalysis(analysis)
  const marketValidation = market.present
    ? validateMarket(market.value, market.validationOptions)
    : null
  const marketFresh = market.present && !hasValidationError(marketValidation, [
    'MARKET_STALE',
    'MARKET_FRESHNESS_REQUIRED',
    'MARKET_TIMESTAMP_INVALID',
    'MARKET_REFERENCE_TIME_INVALID',
    'MARKET_AGE_INVALID',
    'MARKET_FRESHNESS_THRESHOLD_INVALID',
  ])
  const marketReady = market.present && marketValidation?.valid === true && market.ready !== false
  const decision = classifyDecision({
    fixture,
    fixtureValidation,
    analysis,
    analysisValidation,
    analysisComplete: Object.keys(analysisSource).length > 0,
    analysisValid: analysisValidation.valid,
    dataQuality: analysis.dataQuality,
    market: market.present ? market.value : null,
    marketType: market.value.marketType,
    marketPresent: market.present,
    marketReady,
    marketFresh,
    marketRefreshPending: market.refreshPending,
    finalPick: market.present ? {
      marketType: market.value.marketType,
      selection: market.value.selection,
      line: market.value.line,
      confidence: analysis.confidence,
      riskLevel: analysis.riskLevel,
    } : null,
    finalPickMalformed: market.present && marketValidation?.valid !== true,
    confidence: analysis.confidence,
    readinessScore: analysis.score,
    riskLevel: analysis.riskLevel,
  })
  const mappedFinalPick = decision.finalPick ? {
    marketType: decision.finalPick.marketType,
    selection: decision.finalPick.selection,
    line: decision.finalPick.line,
    confidence: decision.finalPick.confidence,
    riskLevel: decision.finalPick.riskLevel,
  } : null

  return {
    adapterVersion: CLEAN_CORE_DECISION_ADAPTER_VERSION,
    cleanCoreVersion: null,
    normalizedFixtureStatus: normalizeMatchStatus(fixture.status),
    statusCategory: fixtureValidation.statusCategory,
    decisionEligible: fixtureValidation.decisionEligible === true,
    decisionStatus: decision.status,
    reasonCode: decision.reasonCode,
    reasonCodes: [...decision.reasonCodes],
    reasonMessageTh: decision.reasonMessageTh,
    actionableFinalPickPresent: decision.finalPick?.actionable === true,
    mappedFinalPick,
    marketType: market.value.marketType,
    selection: textOrNull(market.value.selection),
    line: parseLine(market.value.line),
    confidence: numberOrNull(analysis.confidence),
    inputCompleteness: buildInputCompleteness({
      fixture,
      analysis,
      market,
      fixtureValidation,
      analysisValidation,
      marketValidation,
    }),
  }
}

export function buildCleanCoreShadowComparison(input = {}) {
  const fixture = asRecord(input.fixture)
  const coreSource = asRecord(input.cleanCoreDecision)
  const legacy = legacyView(asRecord(input.legacyResult))
  const core = coreView(coreSource)
  const mismatchSet = new Set()

  if (legacy.normalizedStatus !== null && legacy.normalizedStatus !== core.normalizedStatus) {
    mismatchSet.add('STATUS_NORMALIZATION_MISMATCH')
  }
  if (legacy.eligible !== null && legacy.eligible !== core.eligible) {
    mismatchSet.add('ELIGIBILITY_MISMATCH')
  }
  if (legacy.status !== null && core.status !== null && legacy.status !== core.status) {
    mismatchSet.add('DECISION_STATUS_MISMATCH')
  }
  if (legacy.actionable !== core.actionable) mismatchSet.add('ACTIONABLE_PICK_MISMATCH')
  if (legacy.actionable && core.actionable && (
    legacy.marketType !== core.marketType
    || legacy.selection !== core.selection
    || legacy.line !== core.line
    || legacy.confidence !== core.confidence
  )) {
    mismatchSet.add('MARKET_MAPPING_MISMATCH')
  }
  if (legacy.reasonCode !== null && core.reasonCode !== null && legacy.reasonCode !== core.reasonCode) {
    mismatchSet.add('REASON_PRECEDENCE_MISMATCH')
  }
  if (coreSource.inputCompleteness?.complete !== true) mismatchSet.add('CORE_INPUT_INCOMPLETE')

  const existingDecisionLocked = resolveLockState(input.lockMetadata, fixture, input.legacyResult)
  return {
    matchId: identifierOrNull(fixture.matchId ?? fixture.match_id ?? fixture.id ?? input.legacyResult?.matchId ?? input.legacyResult?.match_id),
    invocationMode: textOrNull(input.invocationMode),
    rawFixtureStatus: {
      status: safeStatus(fixture.status),
      statusShort: safeStatus(fixture.statusShort ?? fixture.status_short),
      statusLong: safeStatus(fixture.statusLong ?? fixture.status_long),
      matchStatus: safeStatus(fixture.matchStatus ?? fixture.match_status),
    },
    normalizedFixtureStatus: core.normalizedStatus,
    cleanCoreStatusCategory: textOrNull(coreSource.statusCategory),
    legacyDecisionStatus: legacy.status,
    cleanCoreDecisionStatus: core.status,
    legacyDecisionEligible: legacy.eligible,
    cleanCoreDecisionEligible: core.eligible,
    legacyActionablePickPresent: legacy.actionable,
    cleanCoreActionablePickPresent: core.actionable,
    legacyMarketType: legacy.marketType,
    cleanCoreMarketType: core.marketType,
    legacySelection: legacy.selection,
    cleanCoreSelection: core.selection,
    legacyLine: legacy.line,
    cleanCoreLine: core.line,
    legacyConfidence: legacy.confidence,
    cleanCoreConfidence: core.confidence,
    primaryCleanCoreReasonCode: core.reasonCode,
    mismatchCodes: CLEAN_CORE_SHADOW_MISMATCH_CODES.filter((code) => mismatchSet.has(code)),
    existingDecisionLocked,
    lockMetadataAvailable: existingDecisionLocked !== 'UNKNOWN',
    adapterVersion: coreSource.adapterVersion ?? CLEAN_CORE_DECISION_ADAPTER_VERSION,
    cleanCoreVersion: coreSource.cleanCoreVersion ?? null,
  }
}

export function runCleanCoreDecisionShadow(input = {}) {
  const cleanCoreDecision = adaptCleanCoreDecision(input)
  return {
    cleanCoreDecision,
    comparison: buildCleanCoreShadowComparison({
      fixture: input.fixture,
      legacyResult: input.legacyResult,
      cleanCoreDecision,
      invocationMode: input.invocationMode,
      lockMetadata: input.lockMetadata,
    }),
    legacyWritePayload: input.legacyWritePayload,
  }
}

function normalizeFixture(source) {
  const home = asRecord(source.homeTeam ?? source.home_team)
  const away = asRecord(source.awayTeam ?? source.away_team)
  const league = asRecord(source.league ?? source.competition)
  const rawStatus = source.statusShort ?? source.status_short ?? source.matchStatus ?? source.match_status ?? source.status
  return {
    id: source.apiSportsFixtureId ?? source.api_sports_fixture_id ?? source.apiFixtureId ?? source.api_fixture_id ?? source.id,
    matchId: source.matchId ?? source.match_id ?? source.id,
    kickoffAt: source.kickoffAt ?? source.kickoff_at ?? source.utcDate ?? source.utc_date,
    status: isRecord(rawStatus) ? rawStatus.short ?? rawStatus.long : rawStatus,
    homeTeam: {
      id: source.apiSportsHomeTeamId ?? source.api_sports_home_team_id ?? home.apiTeamId ?? home.api_team_id ?? home.id,
      name: source.homeTeamName ?? source.home_team_name ?? home.name,
    },
    awayTeam: {
      id: source.apiSportsAwayTeamId ?? source.api_sports_away_team_id ?? away.apiTeamId ?? away.api_team_id ?? away.id,
      name: source.awayTeamName ?? source.away_team_name ?? away.name,
    },
    league: {
      id: source.apiSportsLeagueId ?? source.api_sports_league_id ?? league.apiLeagueId ?? league.api_league_id ?? league.id,
      name: source.leagueName ?? source.league_name ?? league.name,
    },
  }
}

function normalizeAnalysis(source) {
  const raw = asRecord(source.raw)
  return {
    score: source.rankingScore ?? source.ranking_score ?? source.aiScore ?? source.ai_score ?? source.score ?? raw.ranking_score ?? raw.ai_score,
    confidence: source.calibratedConfidenceScore ?? source.calibrated_confidence_score ?? source.confidenceScore ?? source.confidence_score ?? source.confidence ?? raw.calibrated_confidence_score ?? raw.confidence_score,
    riskLevel: upper(source.riskLevel ?? source.risk_level ?? raw.risk_level),
    output: source.output ?? source.recommendation ?? source.direction ?? source.selection ?? source.valueSide ?? source.value_side ?? raw.recommendation,
    dataQuality: source.dataQuality ?? source.data_quality_score ?? source.match_quality_score ?? source.data_depth_score ?? raw.data_quality_score ?? raw.match_quality_score ?? raw.data_depth_score,
  }
}

function normalizeMarket(value, analysis) {
  const state = Array.isArray(value) ? { rows: value } : asRecord(value)
  const raw = asRecord(analysis.raw)
  const rows = Array.isArray(state.rows) ? state.rows.filter(isRecord) : []
  const requestedType = state.marketType ?? state.market_type ?? analysis.valueMarket ?? analysis.value_market ?? analysis.market_type ?? raw.value_market
  const requestedSelection = state.selection ?? state.value ?? state.side ?? analysis.valueSide ?? analysis.value_side ?? analysis.pick_side ?? raw.value_side
  const requestedLine = state.line ?? state.market_line ?? analysis.valueLine ?? analysis.value_line ?? analysis.latest_line ?? analysis.market_line ?? raw.value_line
  const targetType = normalizeMarketType(requestedType)
  const matching = rows.find((row) => rowMarketType(row) === targetType
    && sameText(requestedSelection, row.normalized_selection ?? row.selection))
    ?? rows.find((row) => rowMarketType(row) === targetType)
    ?? null
  const present = typeof state.present === 'boolean'
    ? state.present
    : rows.length > 0 || targetType !== MARKET_TYPE.UNKNOWN
  const marketType = targetType !== MARKET_TYPE.UNKNOWN ? targetType : rowMarketType(matching)
  const fresh = state.fresh ?? state.marketFresh ?? matching?.fresh
  return {
    present,
    ready: state.ready ?? state.marketReady,
    refreshPending: (state.refreshPending ?? state.marketRefreshPending) === true,
    stateProvided: Array.isArray(value) || isRecord(value),
    value: {
      marketType,
      selection: requestedSelection ?? matching?.normalized_selection ?? matching?.selection,
      line: requestedLine ?? matching?.line,
      source: state.source ?? state.provider ?? matching?.source ?? matching?.provider,
      bookmaker: state.bookmaker ?? state.bookmaker_name ?? matching?.bookmaker ?? matching?.bookmaker_name,
      timestamp: state.timestamp ?? state.source_timestamp ?? matching?.provider_source_at ?? matching?.fetched_at ?? matching?.snapshot_at,
      fresh,
    },
    validationOptions: {
      fresh,
      referenceTime: state.referenceTime ?? state.reference_time,
      marketAgeHours: state.marketAgeHours ?? state.market_age_hours,
      marketFreshnessHours: state.marketFreshnessHours ?? state.market_freshness_hours,
    },
  }
}

function buildInputCompleteness({ fixture, analysis, market, fixtureValidation, analysisValidation, marketValidation }) {
  const required = [
    ['fixture.id', fixture.id],
    ['fixture.matchId', fixture.matchId],
    ['fixture.kickoffAt', fixture.kickoffAt],
    ['fixture.status', fixture.status],
    ['fixture.homeTeam.id', fixture.homeTeam.id],
    ['fixture.homeTeam.name', fixture.homeTeam.name],
    ['fixture.awayTeam.id', fixture.awayTeam.id],
    ['fixture.awayTeam.name', fixture.awayTeam.name],
    ['fixture.league.id', fixture.league.id],
    ['fixture.league.name', fixture.league.name],
    ['analysis.score', analysis.score],
    ['analysis.confidence', analysis.confidence],
    ['analysis.riskLevel', analysis.riskLevel],
    ['analysis.output', analysis.output],
    ['analysis.dataQuality', analysis.dataQuality],
    ['marketState', market.stateProvided || null],
  ]
  if (market.present) {
    required.push(
      ['market.marketType', market.value.marketType === MARKET_TYPE.UNKNOWN ? null : market.value.marketType],
      ['market.selection', market.value.selection],
      ['market.source', market.value.source],
      ['market.bookmaker', market.value.bookmaker],
      ['market.timestamp', market.value.timestamp],
    )
    if ([MARKET_TYPE.ASIAN_HANDICAP, MARKET_TYPE.OVER_UNDER].includes(market.value.marketType) && parseLine(market.value.line) === null) {
      required.push(['market.line', null])
    }
  }
  const missingFields = required.filter(([, item]) => !hasValue(item)).map(([name]) => name)
  const fixtureErrors = fixtureValidation.errors.filter((code) => code !== 'MATCH_NOT_PLAYABLE')
  const marketErrors = marketValidation?.errors.filter((code) => code !== 'MARKET_STALE') ?? []
  const invalidFields = [
    ...fixtureErrors.map((code) => `fixture:${code}`),
    ...analysisValidation.errors.map((code) => `analysis:${code}`),
    ...marketErrors.map((code) => `market:${code}`),
  ]
  return {
    complete: missingFields.length === 0 && invalidFields.length === 0,
    missingFields: unique(missingFields),
    invalidFields: unique(invalidFields),
    validationErrors: {
      fixture: [...fixtureValidation.errors],
      analysis: [...analysisValidation.errors],
      market: marketValidation ? [...marketValidation.errors] : [],
    },
  }
}

function legacyView(source) {
  const status = decisionStatus(source.selectionStatus ?? source.selection_status ?? source.decisionStatus ?? source.signal)
  const marketType = normalizeMarketType(source.pickMarket ?? source.pick_market ?? source.marketFocus ?? source.market_type)
  const selection = textOrNull(source.pickSelection ?? source.pick_selection ?? source.selection ?? source.pickSide)
  const explicitActionable = source.actionableFinalPickPresent ?? source.finalPickActionable
  const actionable = typeof explicitActionable === 'boolean'
    ? explicitActionable
    : status === DECISION_STATUS.READY && marketType !== MARKET_TYPE.UNKNOWN && selection !== null
  const explicitEligible = source.decisionEligible ?? source.eligible
  const normalizedStatusValue = source.normalizedFixtureStatus ?? source.fixtureStatus
  return {
    status,
    marketType,
    selection,
    line: parseLine(source.pickLine ?? source.line ?? source.marketLine),
    confidence: numberOrNull(source.pickConfidence ?? source.confidenceScore ?? source.confidence_score),
    actionable,
    eligible: typeof explicitEligible === 'boolean'
      ? explicitEligible
      : actionable || [DECISION_STATUS.READY, DECISION_STATUS.WATCH].includes(status)
        ? true
        : null,
    normalizedStatus: normalizedStatusValue === undefined ? null : normalizeMatchStatus(normalizedStatusValue),
    reasonCode: legacyReason(source.cleanCoreReasonCode ?? source.primaryReasonCode ?? source.primary_reason_code ?? source.reasonCode),
  }
}

function coreView(source) {
  return {
    status: decisionStatus(source.decisionStatus),
    eligible: source.decisionEligible === true,
    actionable: source.actionableFinalPickPresent === true,
    normalizedStatus: textOrNull(source.normalizedFixtureStatus),
    marketType: normalizeMarketType(source.mappedFinalPick?.marketType ?? source.marketType),
    selection: textOrNull(source.mappedFinalPick?.selection ?? source.selection),
    line: parseLine(source.mappedFinalPick?.line ?? source.line),
    confidence: numberOrNull(source.mappedFinalPick?.confidence ?? source.confidence),
    reasonCode: textOrNull(source.reasonCode ?? source.reasonCodes?.[0]),
  }
}

function rowMarketType(row) {
  return normalizeMarketType(row?.normalized_market_type ?? row?.market_focus ?? row?.market_name)
}

function resolveLockState(...values) {
  for (const value of values) {
    const source = asRecord(value)
    const explicit = source.locked ?? source.isLocked ?? source.is_locked ?? source.decisionLocked
    if (typeof explicit === 'boolean') return explicit
    if (hasValue(source.lockedAt ?? source.locked_at ?? source.decisionLockedAt)) return true
  }
  return 'UNKNOWN'
}

function legacyReason(value) {
  const reason = upper(value)
  if (!reason) return null
  return LEGACY_REASON_MAP[reason] ?? (/^(READY|WATCH|WAIT|REJECT)_/.test(reason) ? reason : null)
}

function decisionStatus(value) {
  const status = upper(value)
  if (status === 'STRONG_SIGNAL') return DECISION_STATUS.READY
  if (status === 'SKIP') return DECISION_STATUS.WAIT
  return Object.values(DECISION_STATUS).includes(status) ? status : null
}

function safeStatus(value) {
  if (['string', 'number', 'boolean'].includes(typeof value)) return value
  return isRecord(value) ? textOrNull(value.short ?? value.long) : null
}

function hasValidationError(validation, codes) {
  return !validation || codes.some((code) => validation.errors.includes(code))
}

function parseLine(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())) return null
  return numberOrNull(Number(value))
}

function sameText(left, right) {
  return !hasValue(left) || upper(left) === upper(right)
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function identifierOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : textOrNull(value)
}

function textOrNull(value) {
  if (!['string', 'number'].includes(typeof value)) return null
  return String(value).trim() || null
}

function upper(value) {
  return textOrNull(value)?.toUpperCase() ?? null
}

function hasValue(value) {
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'string') return value.trim().length > 0
  return value !== null && value !== undefined
}

function unique(values) {
  return [...new Set(values)]
}

function asRecord(value) {
  return isRecord(value) ? value : {}
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
