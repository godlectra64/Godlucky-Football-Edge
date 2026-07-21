import assert from 'node:assert/strict'

import {
  DECISION_STATUS,
  DEFAULT_DECISION_THRESHOLDS,
  REASON_CODE,
} from '../supabase/functions/_shared/cleanCore/contracts.js'
import { buildCanonicalFinalPick, classifyDecision } from '../supabase/functions/_shared/cleanCore/decision.js'

const ready = classifyDecision(validInput())
assert.equal(ready.status, DECISION_STATUS.READY, ready.reasonMessageTh)
assert.equal(ready.marketReady, true)
assert.ok(ready.finalPick)
assert.equal(ready.finalPick.actionable, true)
assert.equal(ready.reasonCode, REASON_CODE.READY_ALL_GATES_PASSED)

const zeroLinePick = buildCanonicalFinalPick(validInput({
  marketType: 'OU',
  finalPick: { marketType: 'OU', selection: 'UNDER', line: 0, confidence: 100, riskLevel: 'LOW' },
  confidence: { score: 100 },
  readinessScore: 100,
}))
assert.equal(zeroLinePick.line, 0)
assert.equal(zeroLinePick.confidence, 100)

for (const [name, overrides, status, reasonCode] of [
  ['match not playable', { matchPlayable: false }, DECISION_STATUS.REJECTED, REASON_CODE.REJECT_MATCH_NOT_PLAYABLE],
  ['fixture invalid', { fixtureValid: false }, DECISION_STATUS.REJECTED, REASON_CODE.REJECT_FIXTURE_INVALID],
  ['unsupported league', { supportedLeague: false }, DECISION_STATUS.REJECTED, REASON_CODE.REJECT_UNSUPPORTED_LEAGUE],
  ['critical risk', { riskLevel: 'CRITICAL' }, DECISION_STATUS.REJECTED, REASON_CODE.REJECT_RISK_CRITICAL],
  ['data hard fail', { dataQuality: 69 }, DECISION_STATUS.REJECTED, REASON_CODE.REJECT_DATA_QUALITY_FAILED],
  ['analysis malformed', { analysisValid: false }, DECISION_STATUS.REJECTED, REASON_CODE.REJECT_ANALYSIS_INVALID],
  ['analysis pending', { analysisComplete: false }, DECISION_STATUS.WAIT, REASON_CODE.WAIT_ANALYSIS_INCOMPLETE],
  ['market missing', { marketPresent: false, marketReady: false, marketType: 'UNKNOWN', finalPick: null }, DECISION_STATUS.WAIT, REASON_CODE.WAIT_MARKET_MISSING],
  ['market stale', { marketFresh: false }, DECISION_STATUS.WAIT, REASON_CODE.WAIT_MARKET_STALE],
  ['market refresh', { marketRefreshPending: true }, DECISION_STATUS.WAIT, REASON_CODE.WAIT_MARKET_REFRESH],
]) {
  const output = classifyDecision(validInput(overrides))
  assert.equal(output.status, status, name)
  assert.equal(output.reasonCode, reasonCode, name)
  if (status !== DECISION_STATUS.READY) assert.equal(output.finalPick, null)
}

for (const [name, overrides, primary] of [
  ['invalid fixture + missing market', { fixtureValid: false, marketPresent: false, marketReady: false, marketType: 'UNKNOWN', finalPick: null }, REASON_CODE.REJECT_FIXTURE_INVALID],
  ['critical risk + stale market', { riskLevel: 'CRITICAL', marketFresh: false }, REASON_CODE.REJECT_RISK_CRITICAL],
  ['invalid analysis + low confidence', { analysisValid: false, readinessScore: 10, confidence: { score: 10 } }, REASON_CODE.REJECT_ANALYSIS_INVALID],
  ['unsupported league + valid market', { supportedLeague: false }, REASON_CODE.REJECT_UNSUPPORTED_LEAGUE],
  ['malformed final pick + stale market', { finalPickMalformed: true, finalPickRetryable: false, marketFresh: false }, REASON_CODE.WAIT_MARKET_STALE],
]) {
  const output = classifyDecision(validInput(overrides))
  assert.equal(output.reasonCode, primary, name)
  assert.equal(output.reasonCodes[0], primary, `${name} primary reason must be deterministic`)
}

const dataBeforeAnalysis = classifyDecision(validInput({ dataQuality: 10, analysisValid: false }))
assert.equal(dataBeforeAnalysis.reasonCode, REASON_CODE.REJECT_DATA_QUALITY_FAILED)
assert.ok(dataBeforeAnalysis.reasonCodes.includes(REASON_CODE.REJECT_ANALYSIS_INVALID))
const statusBeforeFixture = classifyDecision(validInput({ matchPlayable: false, fixtureValid: false }))
assert.equal(statusBeforeFixture.reasonCode, REASON_CODE.REJECT_MATCH_NOT_PLAYABLE)
const staleBeforeRefresh = classifyDecision(validInput({ marketFresh: false, marketRefreshPending: true }))
assert.equal(staleBeforeRefresh.reasonCode, REASON_CODE.WAIT_MARKET_STALE)

const lowConfidence = classifyDecision(validInput({ readinessScore: 74, confidence: { score: 74 } }))
assert.equal(lowConfidence.status, DECISION_STATUS.WATCH)
assert.equal(lowConfidence.finalPick, null)
assert.ok(lowConfidence.reasonCodes.includes(REASON_CODE.WATCH_CONFIDENCE_BELOW_READY))

for (const marketType of ['MATCH_WINNER', 'DOUBLE_CHANCE', 'CORRECT_SCORE', 'BTTS']) {
  const insight = classifyDecision(validInput({
    marketType,
    finalPick: { marketType, selection: marketType === 'CORRECT_SCORE' ? '2-1' : 'HOME', confidence: 86, riskLevel: 'LOW' },
  }))
  assert.equal(insight.status, DECISION_STATUS.WATCH, `${marketType} must remain insight-only in V1`)
  assert.equal(insight.finalPick, null)
}

const missingFinalPick = classifyDecision(validInput({ finalPick: null }))
assert.equal(missingFinalPick.status, DECISION_STATUS.WATCH)
assert.equal(missingFinalPick.finalPick, null)
const missingDataQuality = classifyDecision(validInput({ dataQuality: undefined, dataQualityPassed: undefined }))
assert.equal(missingDataQuality.status, DECISION_STATUS.WAIT, 'missing quality data must not produce READY')
assert.equal(missingDataQuality.reasonCode, REASON_CODE.WAIT_ANALYSIS_INCOMPLETE)
const malformedNonRetryable = classifyDecision(validInput({ finalPickMalformed: true, finalPickRetryable: false }))
assert.equal(malformedNonRetryable.status, DECISION_STATUS.REJECTED)
assert.equal(malformedNonRetryable.reasonCode, REASON_CODE.REJECT_FINAL_PICK_INVALID)
assert.ok(malformedNonRetryable.reasonMessageTh.length > 0)

for (const overrides of [
  { readyThreshold: 60, watchThreshold: 70 },
  { readyThreshold: 101 },
  { watchThreshold: -1 },
  { dataQualityThreshold: 101 },
  { marketFreshnessHours: -1 },
  { readyThreshold: '80' },
]) {
  const output = classifyDecision(validInput(overrides))
  assert.equal(output.status, DECISION_STATUS.REJECTED)
  assert.equal(output.reasonCode, REASON_CODE.REJECT_THRESHOLD_INVALID)
  assert.ok(output.audit.thresholdErrors.length > 0)
}

const defaults = classifyDecision(validInput({
  readyThreshold: undefined,
  watchThreshold: undefined,
  dataQualityThreshold: undefined,
  dataQuality: 82,
}))
assert.equal(defaults.audit.readyConfidenceThreshold, DEFAULT_DECISION_THRESHOLDS.readyConfidenceThreshold)
assert.equal(defaults.audit.watchConfidenceThreshold, DEFAULT_DECISION_THRESHOLDS.watchConfidenceThreshold)
assert.equal(defaults.audit.minimumDataQuality, DEFAULT_DECISION_THRESHOLDS.minimumDataQuality)
assert.equal(defaults.audit.marketFreshnessHours, DEFAULT_DECISION_THRESHOLDS.marketFreshnessHours)

const blockingA = classifyDecision(validInput({
  blockingReasonCodes: [REASON_CODE.WATCH_DATA_QUALITY_BORDERLINE, REASON_CODE.WAIT_MARKET_REFRESH],
}))
const blockingB = classifyDecision(validInput({
  blockingReasonCodes: [REASON_CODE.WAIT_MARKET_REFRESH, REASON_CODE.WATCH_DATA_QUALITY_BORDERLINE],
}))
assert.deepEqual(blockingA.reasonCodes, blockingB.reasonCodes, 'reason order must not depend on caller order')
assert.equal(blockingA.reasonCode, REASON_CODE.WAIT_MARKET_REFRESH)

console.log('clean core decision unit tests passed')

function validInput(overrides = {}) {
  return {
    fixtureValid: true,
    matchPlayable: true,
    supportedLeague: true,
    analysisComplete: true,
    analysisValid: true,
    dataQuality: 82,
    dataQualityThreshold: 70,
    marketType: 'AH',
    marketPresent: true,
    marketReady: true,
    marketFresh: true,
    finalPick: {
      marketType: 'AH',
      selection: 'HOME',
      line: -0.5,
      confidence: 86,
      riskLevel: 'LOW',
    },
    confidence: { score: 86 },
    readinessScore: 86,
    readyThreshold: 80,
    watchThreshold: 70,
    riskLevel: 'LOW',
    blockingReasonCodes: [],
    ...overrides,
  }
}
