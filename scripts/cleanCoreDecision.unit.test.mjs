import assert from 'node:assert/strict'

import { DECISION_STATUS, REASON_CODE } from '../supabase/functions/_shared/cleanCore/contracts.js'
import { classifyDecision } from '../supabase/functions/_shared/cleanCore/decision.js'

const ready = classifyDecision(validInput())
assert.equal(ready.status, DECISION_STATUS.READY, ready.reasonMessageTh)
assert.equal(ready.marketReady, true, 'READY must have marketReady=true')
assert.ok(ready.finalPick, 'READY must have a canonical Final Pick')
assert.equal(ready.finalPick.actionable, true)

const missingMarket = classifyDecision(validInput({ marketPresent: false, marketReady: false, marketType: 'UNKNOWN', finalPick: null }))
assert.equal(missingMarket.status, DECISION_STATUS.WAIT, 'missing market must WAIT')
assert.equal(missingMarket.reasonCode, REASON_CODE.WAIT_MARKET_MISSING)
assert.equal(missingMarket.finalPick, null, 'WAIT must not expose a Final Pick')

const staleMarket = classifyDecision(validInput({ marketFresh: false }))
assert.equal(staleMarket.status, DECISION_STATUS.WAIT, 'stale market must WAIT')
assert.equal(staleMarket.reasonCode, REASON_CODE.WAIT_MARKET_STALE)
assert.equal(staleMarket.finalPick, null)

const missingFinalPick = classifyDecision(validInput({ finalPick: null }))
assert.notEqual(missingFinalPick.status, DECISION_STATUS.READY, 'missing Final Pick must not become READY')
assert.equal(missingFinalPick.finalPick, null)

const criticalRisk = classifyDecision(validInput({ riskLevel: 'CRITICAL' }))
assert.equal(criticalRisk.status, DECISION_STATUS.REJECTED, 'CRITICAL risk must be rejected')
assert.equal(criticalRisk.reasonCode, REASON_CODE.REJECT_RISK_CRITICAL)

const invalidFixture = classifyDecision(validInput({ fixtureValid: false }))
assert.equal(invalidFixture.status, DECISION_STATUS.REJECTED, 'invalid fixture must be rejected')
assert.equal(invalidFixture.reasonCode, REASON_CODE.REJECT_FIXTURE_INVALID)

const lowConfidence = classifyDecision(validInput({ readinessScore: 74, confidence: { score: 74 } }))
assert.equal(lowConfidence.status, DECISION_STATUS.WATCH, 'confidence below READY threshold must WATCH')
assert.equal(lowConfidence.finalPick, null, 'WATCH must not expose an actionable Final Pick')
assert.ok(lowConfidence.reasonCodes.includes(REASON_CODE.WATCH_CONFIDENCE_BELOW_READY))

const correctScore = classifyDecision(validInput({
  marketType: 'CORRECT_SCORE',
  finalPick: { marketType: 'CORRECT_SCORE', selection: '2-1', confidence: 86, riskLevel: 'LOW' },
}))
assert.notEqual(correctScore.status, DECISION_STATUS.READY, 'Correct Score must not produce READY')
assert.equal(correctScore.finalPick, null)

const doubleChance = classifyDecision(validInput({
  marketType: 'DOUBLE_CHANCE',
  finalPick: { marketType: 'DOUBLE_CHANCE', selection: '1X', confidence: 86, riskLevel: 'LOW' },
}))
assert.notEqual(doubleChance.status, DECISION_STATUS.READY, 'Double Chance must not produce READY')
assert.equal(doubleChance.finalPick, null)

const analysisPending = classifyDecision(validInput({ analysisComplete: false }))
assert.equal(analysisPending.status, DECISION_STATUS.WAIT)
assert.equal(analysisPending.reasonCode, REASON_CODE.WAIT_ANALYSIS_INCOMPLETE)

const blockedForRefresh = classifyDecision(validInput({ blockingReasonCodes: [REASON_CODE.WAIT_MARKET_REFRESH] }))
assert.equal(blockedForRefresh.status, DECISION_STATUS.WAIT)
assert.equal(blockedForRefresh.finalPick, null)

const malformedNonRetryable = classifyDecision(validInput({ finalPickMalformed: true, finalPickRetryable: false }))
assert.equal(malformedNonRetryable.status, DECISION_STATUS.REJECTED)
assert.equal(malformedNonRetryable.reasonCode, REASON_CODE.REJECT_FINAL_PICK_INVALID)
assert.ok(malformedNonRetryable.reasonMessageTh.length > 0, 'decision reason must include understandable Thai copy')

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
    riskLevel: 'LOW',
    blockingReasonCodes: [],
    ...overrides,
  }
}
