import { DECISION_STATUS, REASON_CODE, RISK_LEVEL } from './contracts.js'
import { canMarketProduceReady, getMarketCapability, normalizeMarketType } from './markets.js'
import { validateAnalysis, validateFinalPick, validateFixture } from './validation.js'

const REASON_MESSAGES_TH = Object.freeze({
  [REASON_CODE.READY_ALL_GATES_PASSED]: 'พร้อมตัดสินใจ: ข้อมูลการแข่งขัน การวิเคราะห์ ตลาด และความเสี่ยงผ่านทุกเกณฑ์',
  [REASON_CODE.WAIT_MARKET_MISSING]: 'รอข้อมูลตลาด: ยังไม่พบตลาดที่ใช้ตัดสินใจได้',
  [REASON_CODE.WAIT_MARKET_STALE]: 'รอข้อมูลตลาด: ราคาล่าสุดเก่าเกินเกณฑ์ที่กำหนด',
  [REASON_CODE.WAIT_MARKET_REFRESH]: 'รอข้อมูลตลาด: การรีเฟรชข้อมูลยังไม่เสร็จ',
  [REASON_CODE.WAIT_ANALYSIS_INCOMPLETE]: 'รอการวิเคราะห์: ข้อมูลยังไม่ครบและอาจสมบูรณ์ได้ภายหลัง',
  [REASON_CODE.WATCH_CONFIDENCE_BELOW_READY]: 'เฝ้าดู: ความมั่นใจยังต่ำกว่าเกณฑ์ READY',
  [REASON_CODE.WATCH_MARKET_EDGE_WEAK]: 'เฝ้าดู: ตลาดมีข้อมูลแต่ความได้เปรียบหรือความสามารถของตลาดยังไม่พอสำหรับ Final Pick',
  [REASON_CODE.WATCH_DATA_QUALITY_BORDERLINE]: 'เฝ้าดู: คุณภาพข้อมูลผ่านขั้นต่ำแต่ยังอยู่ใกล้ขอบเกณฑ์',
  [REASON_CODE.REJECT_FIXTURE_INVALID]: 'ไม่ผ่านเกณฑ์: ข้อมูลการแข่งขันไม่ถูกต้องหรือไม่ครบ',
  [REASON_CODE.REJECT_UNSUPPORTED_LEAGUE]: 'ไม่ผ่านเกณฑ์: ลีกนี้ยังไม่อยู่ในขอบเขตที่รองรับ',
  [REASON_CODE.REJECT_DATA_QUALITY_FAILED]: 'ไม่ผ่านเกณฑ์: คุณภาพข้อมูลต่ำกว่าเกณฑ์ขั้นต่ำ',
  [REASON_CODE.REJECT_ANALYSIS_INVALID]: 'ไม่ผ่านเกณฑ์: ผลการวิเคราะห์ไม่ถูกต้อง',
  [REASON_CODE.REJECT_RISK_CRITICAL]: 'ไม่ผ่านเกณฑ์: ความเสี่ยงอยู่ในระดับวิกฤต',
  [REASON_CODE.REJECT_MATCH_NOT_PLAYABLE]: 'ไม่ผ่านเกณฑ์: สถานะการแข่งขันไม่สามารถนำมาเล่นได้',
  [REASON_CODE.REJECT_FINAL_PICK_INVALID]: 'ไม่ผ่านเกณฑ์: Final Pick มีรูปแบบไม่ถูกต้องและไม่ควรลองซ้ำ',
})

export function classifyDecision(input = {}) {
  const context = buildDecisionContext(input)

  if (!context.matchPlayable) return decision(DECISION_STATUS.REJECTED, [REASON_CODE.REJECT_MATCH_NOT_PLAYABLE], context)
  if (!context.fixtureValid) return decision(DECISION_STATUS.REJECTED, [REASON_CODE.REJECT_FIXTURE_INVALID], context)
  if (!context.supportedLeague) return decision(DECISION_STATUS.REJECTED, [REASON_CODE.REJECT_UNSUPPORTED_LEAGUE], context)
  if (context.riskLevel === RISK_LEVEL.CRITICAL) return decision(DECISION_STATUS.REJECTED, [REASON_CODE.REJECT_RISK_CRITICAL], context)
  if (!context.analysisComplete) return decision(DECISION_STATUS.WAIT, [REASON_CODE.WAIT_ANALYSIS_INCOMPLETE], context)
  if (!context.analysisValid) return decision(DECISION_STATUS.REJECTED, [REASON_CODE.REJECT_ANALYSIS_INVALID], context)
  if (!context.dataQualityPassed) return decision(DECISION_STATUS.REJECTED, [REASON_CODE.REJECT_DATA_QUALITY_FAILED], context)
  if (context.hardBlockingReasons.length > 0) return decision(DECISION_STATUS.REJECTED, context.hardBlockingReasons, context)
  if (context.waitBlockingReasons.length > 0) return decision(DECISION_STATUS.WAIT, context.waitBlockingReasons, context)
  if (context.marketRefreshPending) return decision(DECISION_STATUS.WAIT, [REASON_CODE.WAIT_MARKET_REFRESH], context)
  if (!context.marketPresent) return decision(DECISION_STATUS.WAIT, [REASON_CODE.WAIT_MARKET_MISSING], context)
  if (!context.marketFresh) return decision(DECISION_STATUS.WAIT, [REASON_CODE.WAIT_MARKET_STALE], context)
  if (context.finalPickMalformed && !context.finalPickRetryable) {
    return decision(DECISION_STATUS.REJECTED, [REASON_CODE.REJECT_FINAL_PICK_INVALID], context)
  }

  const blockingReasons = context.blockingReasons.filter((reason) => !context.hardBlockingReasons.includes(reason))
  const ready = context.marketReady
    && context.marketCapability.canProduceReady
    && context.finalPickValid
    && context.canonicalFinalPick !== null
    && context.readinessScore >= context.readyThreshold
    && blockingReasons.length === 0

  if (ready) return decision(DECISION_STATUS.READY, [REASON_CODE.READY_ALL_GATES_PASSED], context)

  const watchReasons = []
  if (context.readinessScore < context.readyThreshold) watchReasons.push(REASON_CODE.WATCH_CONFIDENCE_BELOW_READY)
  if (!context.marketReady || !context.marketCapability.canProduceReady || !context.finalPickValid) watchReasons.push(REASON_CODE.WATCH_MARKET_EDGE_WEAK)
  if (context.dataQualityBorderline) watchReasons.push(REASON_CODE.WATCH_DATA_QUALITY_BORDERLINE)
  watchReasons.push(...blockingReasons)
  return decision(DECISION_STATUS.WATCH, watchReasons.length > 0 ? watchReasons : [REASON_CODE.WATCH_MARKET_EDGE_WEAK], context)
}

export function buildCanonicalFinalPick(input = {}) {
  const source = input.finalPick ?? input
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null
  const marketType = normalizeMarketType(source.marketType ?? source.market_type ?? source.type ?? input.marketType)
  const confidence = finiteNumber(source.confidence ?? source.confidenceScore ?? source.confidence_score ?? confidenceScore(input.confidence))
  const riskLevel = String(source.riskLevel ?? source.risk_level ?? input.riskLevel ?? '').toUpperCase()
  const context = {
    marketType,
    confidence,
    riskLevel,
    marketReady: input.marketReady ?? source.marketReady ?? source.market_ready,
    marketFresh: input.marketFresh ?? source.marketFresh ?? source.market_fresh,
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
  const fixtureValid = booleanOr(input.fixtureValid, fixtureValidation?.valid, false)
  const matchPlayable = booleanOr(
    input.matchPlayable ?? input.fixturePlayable,
    fixtureValidation ? !fixtureValidation.errors.includes('MATCH_NOT_PLAYABLE') : null,
    fixtureValid,
  )
  const analysisComplete = booleanOr(input.analysisComplete, input.analysis ? true : null, false)
  const analysisValid = booleanOr(input.analysisValid, analysisValidation?.valid, false)
  const dataQuality = finiteNumber(input.dataQuality ?? input.analysis?.dataQuality ?? input.analysis?.data_quality_score)
  const dataQualityThreshold = finiteNumber(input.dataQualityThreshold) ?? 0
  const dataQualityPassed = booleanOr(input.dataQualityPassed, dataQuality === null ? null : dataQuality >= dataQualityThreshold, false)
  const dataQualityBorderlineThreshold = finiteNumber(input.dataQualityBorderlineThreshold) ?? dataQualityThreshold + 5
  const marketType = normalizeMarketType(input.marketType ?? input.market?.marketType ?? input.market?.market_type ?? input.finalPick?.marketType ?? input.finalPick?.market_type ?? input.finalPick?.type)
  const marketCapability = getMarketCapability(marketType)
  const marketPresent = booleanOr(input.marketPresent, input.market ? true : null, marketType !== 'UNKNOWN')
  const marketFresh = booleanOr(input.marketFresh, input.market?.fresh ?? input.market?.isFresh, false)
  const marketReady = Boolean(input.marketReady ?? input.market?.ready ?? input.market?.marketReady)
  const riskLevel = String(input.riskLevel ?? input.analysis?.riskLevel ?? input.analysis?.risk_level ?? input.finalPick?.riskLevel ?? input.finalPick?.risk_level ?? '').toUpperCase()
  const readinessScore = clamp(finiteNumber(input.readinessScore ?? confidenceScore(input.confidence) ?? input.finalPick?.confidence) ?? 0)
  const readyThreshold = clamp(finiteNumber(input.readyThreshold) ?? 80)
  const finalPickRetryable = input.finalPickRetryable !== false
  const canonicalFinalPick = buildCanonicalFinalPick({
    ...input,
    marketType,
    marketReady,
    marketFresh,
    riskLevel,
    confidence: input.confidence ?? readinessScore,
  })
  const finalPickMalformed = Boolean(
    input.finalPickMalformed
    || (!finalPickRetryable && input.finalPick && canonicalFinalPick === null),
  )
  const finalPickValid = booleanOr(input.finalPickValid, canonicalFinalPick !== null, false) && canonicalFinalPick !== null
  const blockingReasons = uniqueStrings(input.blockingReasonCodes ?? input.blockingReasons)
  const hardBlockingReasons = blockingReasons.filter((reason) => String(reason).startsWith('REJECT_'))
  const waitBlockingReasons = blockingReasons.filter((reason) => String(reason).startsWith('WAIT_'))

  return {
    fixtureValid,
    matchPlayable,
    supportedLeague: input.supportedLeague !== false,
    analysisComplete,
    analysisValid,
    dataQuality,
    dataQualityThreshold,
    dataQualityPassed,
    dataQualityBorderline: dataQuality !== null && dataQuality >= dataQualityThreshold && dataQuality < dataQualityBorderlineThreshold,
    marketType,
    marketCapability,
    marketPresent,
    marketReady,
    marketFresh,
    marketRefreshPending: Boolean(input.marketRefreshPending),
    riskLevel,
    readinessScore,
    readyThreshold,
    confidence: input.confidence ?? readinessScore,
    finalPickMalformed,
    finalPickRetryable,
    finalPickValid,
    canonicalFinalPick,
    blockingReasons,
    hardBlockingReasons,
    waitBlockingReasons,
  }
}

function decision(status, reasonCodes, context) {
  const codes = uniqueStrings(reasonCodes)
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
      matchPlayable: context.matchPlayable,
      supportedLeague: context.supportedLeague,
      analysisComplete: context.analysisComplete,
      analysisValid: context.analysisValid,
      dataQualityPassed: context.dataQualityPassed,
      dataQualityThreshold: context.dataQualityThreshold,
      marketType: context.marketType,
      marketCanProduceReady: canMarketProduceReady(context.marketType),
      marketFresh: context.marketFresh,
      finalPickValid: context.finalPickValid,
      riskLevel: context.riskLevel,
      readyThreshold: context.readyThreshold,
      blockingReasonCodes: [...context.blockingReasons],
    },
  }
}

function confidenceScore(value) {
  if (typeof value === 'number') return value
  return finiteNumber(value?.score)
}

function marketNeedsLine(marketType) {
  return ['ASIAN_HANDICAP', 'OVER_UNDER'].includes(marketType)
}

function parseLine(value) {
  const match = String(value ?? '').match(/-?\d+(?:\.\d+)?/)
  const parsed = match ? Number(match[0]) : NaN
  return Number.isFinite(parsed) ? parsed : null
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function booleanOr(...values) {
  return values.find((value) => typeof value === 'boolean') ?? false
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? '').trim()).filter(Boolean))]
}

function clamp(value) {
  return Math.min(100, Math.max(0, value))
}
