import {
  DECISION_STATUS,
  DEFAULT_DECISION_THRESHOLDS,
  MATCH_STATUS_CATEGORY,
  REASON_CODE,
  RISK_LEVEL,
} from './contracts.js'
import { canMarketProduceReady, getMarketCapability, normalizeMarketType } from './markets.js'
import { isEligibleForNewDecision } from './matchStatus.js'
import { validateAnalysis, validateFinalPick, validateFixture } from './validation.js'

const REASON_MESSAGES_TH = Object.freeze({
  [REASON_CODE.READY_ALL_GATES_PASSED]: 'พร้อมตัดสินใจ: ข้อมูลการแข่งขัน การวิเคราะห์ ตลาด และความเสี่ยงผ่านทุกเกณฑ์',
  [REASON_CODE.WAIT_MARKET_MISSING]: 'รอข้อมูลตลาด: ยังไม่พบตลาดที่ใช้ตัดสินใจได้',
  [REASON_CODE.WAIT_MARKET_STALE]: 'รอข้อมูลตลาด: ราคาล่าสุดเก่าเกินเกณฑ์ที่กำหนด',
  [REASON_CODE.WAIT_MARKET_REFRESH]: 'รอข้อมูลตลาด: การรีเฟรชข้อมูลยังไม่เสร็จ',
  [REASON_CODE.WAIT_ANALYSIS_INCOMPLETE]: 'รอการวิเคราะห์: ข้อมูลยังไม่ครบและอาจสมบูรณ์ได้ภายหลัง',
  [REASON_CODE.WAIT_MATCH_RESCHEDULE]: 'การแข่งขันถูกเลื่อน รอกำหนดเวลาใหม่',
  [REASON_CODE.WATCH_CONFIDENCE_BELOW_READY]: 'เฝ้าดู: ความมั่นใจยังต่ำกว่าเกณฑ์ READY',
  [REASON_CODE.WATCH_MARKET_EDGE_WEAK]: 'เฝ้าดู: ตลาดหรือความได้เปรียบยังไม่พอสำหรับ Final Pick',
  [REASON_CODE.WATCH_DATA_QUALITY_BORDERLINE]: 'เฝ้าดู: คุณภาพข้อมูลผ่านขั้นต่ำแต่อยู่ใกล้ขอบเกณฑ์',
  [REASON_CODE.REJECT_FIXTURE_INVALID]: 'ไม่ผ่านเกณฑ์: ข้อมูลการแข่งขันไม่ถูกต้องหรือไม่ครบ',
  [REASON_CODE.REJECT_UNSUPPORTED_LEAGUE]: 'ไม่ผ่านเกณฑ์: ลีกนี้ยังไม่อยู่ในขอบเขตที่รองรับ',
  [REASON_CODE.REJECT_DATA_QUALITY_FAILED]: 'ไม่ผ่านเกณฑ์: คุณภาพข้อมูลต่ำกว่าเกณฑ์ขั้นต่ำ',
  [REASON_CODE.REJECT_ANALYSIS_INVALID]: 'ไม่ผ่านเกณฑ์: ผลการวิเคราะห์ไม่ถูกต้อง',
  [REASON_CODE.REJECT_RISK_CRITICAL]: 'ไม่ผ่านเกณฑ์: ความเสี่ยงอยู่ในระดับวิกฤต',
  [REASON_CODE.REJECT_MATCH_ALREADY_STARTED]: 'การแข่งขันเริ่มแล้ว จึงไม่สร้างคำแนะนำใหม่',
  [REASON_CODE.REJECT_MATCH_NOT_PLAYABLE]: 'ไม่ผ่านเกณฑ์: สถานะการแข่งขันไม่สามารถนำมาประเมินได้',
  [REASON_CODE.REJECT_FINAL_PICK_INVALID]: 'ไม่ผ่านเกณฑ์: Final Pick มีรูปแบบไม่ถูกต้อง',
  [REASON_CODE.REJECT_THRESHOLD_INVALID]: 'ไม่ผ่านเกณฑ์: ค่า threshold ของการตัดสินใจไม่ถูกต้อง',
})

const REASON_PRIORITY = Object.freeze([
  REASON_CODE.REJECT_FIXTURE_INVALID,
  REASON_CODE.REJECT_MATCH_NOT_PLAYABLE,
  REASON_CODE.REJECT_MATCH_ALREADY_STARTED,
  REASON_CODE.WAIT_MATCH_RESCHEDULE,
  REASON_CODE.REJECT_UNSUPPORTED_LEAGUE,
  REASON_CODE.REJECT_RISK_CRITICAL,
  REASON_CODE.REJECT_DATA_QUALITY_FAILED,
  REASON_CODE.REJECT_ANALYSIS_INVALID,
  REASON_CODE.REJECT_THRESHOLD_INVALID,
  REASON_CODE.WAIT_ANALYSIS_INCOMPLETE,
  REASON_CODE.WAIT_MARKET_MISSING,
  REASON_CODE.WAIT_MARKET_STALE,
  REASON_CODE.WAIT_MARKET_REFRESH,
  REASON_CODE.REJECT_FINAL_PICK_INVALID,
  REASON_CODE.WATCH_CONFIDENCE_BELOW_READY,
  REASON_CODE.WATCH_MARKET_EDGE_WEAK,
  REASON_CODE.WATCH_DATA_QUALITY_BORDERLINE,
])

export function classifyDecision(input = {}) {
  const context = buildDecisionContext(isRecord(input) ? input : {})
  const reasonCodes = collectReasonCodes(context)
  const ready = reasonCodes.length === 0
    && context.decisionEligible
    && context.marketReady
    && context.marketCapability.canProduceReady
    && context.finalPickValid
    && context.canonicalFinalPick !== null
    && context.readinessScore >= context.thresholds.readyConfidenceThreshold

  if (ready) return decision(DECISION_STATUS.READY, [REASON_CODE.READY_ALL_GATES_PASSED], context)

  const codes = reasonCodes.length > 0 ? reasonCodes : [REASON_CODE.WATCH_MARKET_EDGE_WEAK]
  return decision(statusForReason(codes[0]), codes, context)
}

export function buildCanonicalFinalPick(input = {}) {
  const inputValue = isRecord(input) ? input : {}
  if (!allowsNewDecision(inputValue)) return null
  const source = inputValue.finalPick ?? inputValue
  if (!isRecord(source)) return null
  const marketType = normalizeMarketType(source.marketType ?? source.market_type ?? source.type ?? inputValue.marketType)
  const confidence = strictFiniteNumber(
    source.confidence ?? source.confidenceScore ?? source.confidence_score ?? confidenceScore(inputValue.confidence),
  )
  const riskLevel = String(source.riskLevel ?? source.risk_level ?? inputValue.riskLevel ?? '').toUpperCase()
  const context = {
    marketType,
    confidence,
    riskLevel,
    marketReady: inputValue.marketReady ?? source.marketReady ?? source.market_ready,
    marketFresh: inputValue.marketFresh ?? source.marketFresh ?? source.market_fresh,
  }
  const validation = validateFinalPick(source, context)
  if (!validation.valid) return null

  return {
    marketType,
    selection: String(source.selection ?? source.side ?? source.direction ?? source.value).trim(),
    line: marketNeedsLine(marketType) ? parseLine(source.line ?? source.marketLine ?? source.market_line) : null,
    confidence,
    riskLevel,
    actionable: true,
  }
}

function buildDecisionContext(input) {
  const fixtureValidation = input.fixtureValidation ?? (input.fixture ? validateFixture(input.fixture) : null)
  const analysisValidation = input.analysisValidation ?? (input.analysis ? validateAnalysis(input.analysis, input.analysisValidationOptions) : null)
  const fixtureValid = fixtureValidation
    ? (fixtureValidation.reasonCode === undefined
        ? fixtureValidation.valid === true
        : fixtureValidation.reasonCode !== REASON_CODE.REJECT_FIXTURE_INVALID)
      && input.fixtureValid !== false
    : booleanOr(input.fixtureValid, false)
  const statusCategory = firstDefined(fixtureValidation?.statusCategory, input.statusCategory, null)
  const decisionEligible = fixtureValidation && typeof fixtureValidation.decisionEligible === 'boolean'
    ? fixtureValidation.decisionEligible
      && fixtureValid
      && input.decisionEligible !== false
      && input.matchPlayable !== false
      && input.fixturePlayable !== false
    : statusCategory === MATCH_STATUS_CATEGORY.PREMATCH_DECISION_ELIGIBLE
      && fixtureValid
      && input.decisionEligible !== false
      && input.matchPlayable !== false
      && input.fixturePlayable !== false
  const displayable = fixtureValidation && typeof fixtureValidation.displayable === 'boolean'
    ? fixtureValidation.displayable
    : booleanOr(input.displayable, input.matchPlayable ?? input.fixturePlayable, decisionEligible)
  const terminalMatch = fixtureValidation
    ? fixtureValidation.terminal === true
    : booleanOr(input.matchTerminal, input.terminal, statusCategory === MATCH_STATUS_CATEGORY.TERMINAL_OR_VOID)
  const retryableMatch = fixtureValidation
    ? fixtureValidation.retryable === true
    : booleanOr(input.matchRetryable, input.retryable, statusCategory === MATCH_STATUS_CATEGORY.RETRYABLE_NOT_READY)
  const startedMatch = statusCategory === MATCH_STATUS_CATEGORY.STARTED_OR_LIVE || input.matchStarted === true
  const matchPlayable = booleanOr(
    input.matchPlayable ?? input.fixturePlayable,
    displayable,
    decisionEligible,
  )
  const analysisComplete = booleanOr(input.analysisComplete, input.analysis ? true : null, false)
  const analysisValid = booleanOr(input.analysisValid, analysisValidation?.valid, false)
  const thresholds = resolveThresholds(input)
  const dataQuality = strictFiniteNumber(input.dataQuality ?? input.analysis?.dataQuality ?? input.analysis?.data_quality_score)
  const explicitDataQualityPassed = typeof input.dataQualityPassed === 'boolean' ? input.dataQualityPassed : null
  const dataQualityPassed = explicitDataQualityPassed
    ?? (dataQuality === null ? null : dataQuality >= thresholds.values.minimumDataQuality)
  const marketType = normalizeMarketType(
    input.marketType
    ?? input.market?.marketType
    ?? input.market?.market_type
    ?? input.finalPick?.marketType
    ?? input.finalPick?.market_type
    ?? input.finalPick?.type,
  )
  const marketCapability = getMarketCapability(marketType)
  const marketPresent = booleanOr(input.marketPresent, input.market ? true : null, marketType !== 'UNKNOWN')
  const marketFresh = booleanOr(input.marketFresh, input.market?.fresh ?? input.market?.isFresh, false)
  const marketReady = booleanOr(input.marketReady, input.market?.ready, input.market?.marketReady, false)
  const riskLevel = String(
    input.riskLevel
    ?? input.analysis?.riskLevel
    ?? input.analysis?.risk_level
    ?? input.finalPick?.riskLevel
    ?? input.finalPick?.risk_level
    ?? '',
  ).toUpperCase()
  const readinessScore = clamp(strictFiniteNumber(
    input.readinessScore ?? confidenceScore(input.confidence) ?? input.finalPick?.confidence,
  ) ?? 0)
  const finalPickRetryable = input.finalPickRetryable !== false
  const canonicalFinalPick = buildCanonicalFinalPick({
    ...input,
    decisionEligible,
    fixtureValidation,
    marketType,
    marketReady,
    marketFresh,
    riskLevel,
    confidence: input.confidence ?? readinessScore,
  })
  const finalPickMalformed = input.finalPickMalformed === true
    || (marketCapability.actionable && input.finalPick != null && canonicalFinalPick === null)
  const finalPickValid = booleanOr(input.finalPickValid, canonicalFinalPick !== null, false) && canonicalFinalPick !== null
  const blockingReasons = uniqueStrings(input.blockingReasonCodes ?? input.blockingReasons)

  return {
    fixtureValid,
    decisionEligible,
    displayable,
    statusCategory,
    startedMatch,
    terminalMatch,
    retryableMatch,
    matchPlayable,
    supportedLeague: input.supportedLeague !== false,
    analysisComplete,
    analysisValid,
    analysisMalformed: analysisComplete && !analysisValid,
    dataQuality,
    dataQualityPassed,
    dataQualityHardFail: input.dataQualityHardFail === true
      || explicitDataQualityPassed === false
      || (thresholds.errors.length === 0 && dataQualityPassed === false),
    dataQualityBorderline: input.dataQualityBorderline === true,
    marketType,
    marketCapability,
    marketPresent,
    marketReady,
    marketFresh,
    marketRefreshPending: input.marketRefreshPending === true,
    riskLevel,
    readinessScore,
    thresholds: thresholds.values,
    thresholdErrors: thresholds.errors,
    confidence: input.confidence ?? readinessScore,
    finalPickMalformed,
    finalPickRetryable,
    finalPickValid,
    canonicalFinalPick,
    blockingReasons,
  }
}

function collectReasonCodes(context) {
  const reasons = []
  if (!context.fixtureValid) reasons.push(REASON_CODE.REJECT_FIXTURE_INVALID)
  if (context.terminalMatch) reasons.push(REASON_CODE.REJECT_MATCH_NOT_PLAYABLE)
  if (context.startedMatch) reasons.push(REASON_CODE.REJECT_MATCH_ALREADY_STARTED)
  if (context.retryableMatch) reasons.push(REASON_CODE.WAIT_MATCH_RESCHEDULE)
  if (!context.decisionEligible && !context.terminalMatch && !context.startedMatch && !context.retryableMatch) {
    reasons.push(REASON_CODE.REJECT_MATCH_NOT_PLAYABLE)
  }
  if (!context.supportedLeague) reasons.push(REASON_CODE.REJECT_UNSUPPORTED_LEAGUE)
  if (context.riskLevel === RISK_LEVEL.CRITICAL) reasons.push(REASON_CODE.REJECT_RISK_CRITICAL)
  if (context.dataQualityHardFail) reasons.push(REASON_CODE.REJECT_DATA_QUALITY_FAILED)
  if (context.analysisMalformed) reasons.push(REASON_CODE.REJECT_ANALYSIS_INVALID)
  if (context.thresholdErrors.length > 0) reasons.push(REASON_CODE.REJECT_THRESHOLD_INVALID)
  if (!context.analysisComplete || context.dataQualityPassed === null) reasons.push(REASON_CODE.WAIT_ANALYSIS_INCOMPLETE)
  if (!context.marketPresent) reasons.push(REASON_CODE.WAIT_MARKET_MISSING)
  if (context.marketPresent && !context.marketFresh) reasons.push(REASON_CODE.WAIT_MARKET_STALE)
  if (context.marketPresent && context.marketRefreshPending) reasons.push(REASON_CODE.WAIT_MARKET_REFRESH)
  if (context.marketPresent && context.marketFresh && context.finalPickMalformed && !context.finalPickRetryable) {
    reasons.push(REASON_CODE.REJECT_FINAL_PICK_INVALID)
  }
  if (context.readinessScore < context.thresholds.readyConfidenceThreshold) {
    reasons.push(REASON_CODE.WATCH_CONFIDENCE_BELOW_READY)
  }
  if (!context.marketReady || !context.marketCapability.canProduceReady || !context.finalPickValid) {
    reasons.push(REASON_CODE.WATCH_MARKET_EDGE_WEAK)
  }
  if (context.dataQualityBorderline) reasons.push(REASON_CODE.WATCH_DATA_QUALITY_BORDERLINE)
  reasons.push(...context.blockingReasons)
  return sortReasonCodes(reasons)
}

function resolveThresholds(input) {
  const provided = isRecord(input.thresholds) ? input.thresholds : {}
  const values = {
    readyConfidenceThreshold: firstDefined(
      provided.readyConfidenceThreshold,
      input.readyConfidenceThreshold,
      input.readyThreshold,
      DEFAULT_DECISION_THRESHOLDS.readyConfidenceThreshold,
    ),
    watchConfidenceThreshold: firstDefined(
      provided.watchConfidenceThreshold,
      input.watchConfidenceThreshold,
      input.watchThreshold,
      DEFAULT_DECISION_THRESHOLDS.watchConfidenceThreshold,
    ),
    minimumDataQuality: firstDefined(
      provided.minimumDataQuality,
      input.minimumDataQuality,
      input.dataQualityThreshold,
      DEFAULT_DECISION_THRESHOLDS.minimumDataQuality,
    ),
    marketFreshnessHours: firstDefined(
      provided.marketFreshnessHours,
      input.marketFreshnessHours,
      DEFAULT_DECISION_THRESHOLDS.marketFreshnessHours,
    ),
  }
  const errors = []
  for (const [name, value] of Object.entries(values)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) errors.push(`THRESHOLD_INVALID:${name}`)
  }
  if (errors.length === 0 && values.readyConfidenceThreshold < values.watchConfidenceThreshold) {
    errors.push('THRESHOLD_ORDER_INVALID:readyConfidenceThreshold')
  }
  return { values, errors }
}

function decision(status, reasonCodes, context) {
  const codes = sortReasonCodes(reasonCodes)
  const reasonCode = codes[0] ?? REASON_CODE.REJECT_FINAL_PICK_INVALID
  const ready = status === DECISION_STATUS.READY
  return {
    status,
    readinessScore: context.readinessScore,
    reasonCode,
    reasonCodes: codes,
    reasonMessageTh: REASON_MESSAGES_TH[reasonCode] ?? 'สถานะนี้ต้องได้รับการตรวจสอบเพิ่มเติม',
    marketReady: ready ? true : context.marketReady,
    finalPick: ready ? context.canonicalFinalPick : null,
    confidence: context.confidence,
    audit: {
      fixtureValid: context.fixtureValid,
      decisionEligible: context.decisionEligible,
      displayable: context.displayable,
      retryable: context.retryableMatch,
      terminal: context.terminalMatch,
      statusCategory: context.statusCategory,
      matchPlayable: context.matchPlayable,
      supportedLeague: context.supportedLeague,
      analysisComplete: context.analysisComplete,
      analysisValid: context.analysisValid,
      dataQualityPassed: context.dataQualityPassed,
      minimumDataQuality: context.thresholds.minimumDataQuality,
      marketType: context.marketType,
      marketCanProduceReady: canMarketProduceReady(context.marketType),
      marketFresh: context.marketFresh,
      marketFreshnessHours: context.thresholds.marketFreshnessHours,
      finalPickValid: context.finalPickValid,
      riskLevel: context.riskLevel,
      readyConfidenceThreshold: context.thresholds.readyConfidenceThreshold,
      watchConfidenceThreshold: context.thresholds.watchConfidenceThreshold,
      thresholdErrors: [...context.thresholdErrors],
      blockingReasonCodes: [...context.blockingReasons],
    },
  }
}

function statusForReason(reason) {
  if (String(reason).startsWith('REJECT_')) return DECISION_STATUS.REJECTED
  if (String(reason).startsWith('WAIT_')) return DECISION_STATUS.WAIT
  return DECISION_STATUS.WATCH
}

function sortReasonCodes(values) {
  return uniqueStrings(values).sort((left, right) => {
    const priorityDifference = reasonPriority(left) - reasonPriority(right)
    if (priorityDifference !== 0 || left === right) return priorityDifference
    return left < right ? -1 : 1
  })
}

function reasonPriority(reason) {
  const index = REASON_PRIORITY.indexOf(reason)
  if (index >= 0) return index
  if (String(reason).startsWith('REJECT_')) return 6.5
  if (String(reason).startsWith('WAIT_')) return 10.5
  return REASON_PRIORITY.length + 1
}

function confidenceScore(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return strictFiniteNumber(value?.score)
}

function allowsNewDecision(input) {
  if (typeof input.fixtureValidation?.statusCategory === 'string') {
    return input.fixtureValidation.statusCategory === MATCH_STATUS_CATEGORY.PREMATCH_DECISION_ELIGIBLE
      && input.fixtureValidation.decisionEligible === true
      && input.decisionEligible !== false
  }
  const status = decisionMatchStatus(input)
  if (status !== undefined) return isEligibleForNewDecision(status) && input.decisionEligible !== false
  return input.statusCategory === MATCH_STATUS_CATEGORY.PREMATCH_DECISION_ELIGIBLE
    && input.decisionEligible !== false
}

function decisionMatchStatus(input) {
  const fixture = isRecord(input.fixture) ? input.fixture : {}
  const value = firstDefined(
    fixture.statusShort,
    fixture.status_short,
    fixture.matchStatus,
    fixture.match_status,
    fixture.status,
    input.statusShort,
    input.status_short,
    input.matchStatus,
    input.match_status,
    input.status,
  )
  return isRecord(value) ? firstDefined(value.short, value.long) : value
}

function marketNeedsLine(marketType) {
  return ['ASIAN_HANDICAP', 'OVER_UNDER'].includes(marketType)
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

function booleanOr(...values) {
  return values.find((value) => typeof value === 'boolean') ?? false
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined)
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? '').trim()).filter(Boolean))]
}

function clamp(value) {
  return Math.min(100, Math.max(0, value))
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
