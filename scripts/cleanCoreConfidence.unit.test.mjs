import assert from 'node:assert/strict'

import {
  CONFIDENCE_COMPONENT_WEIGHTS,
  FIXTURE_ONLY_CONFIDENCE_CAP,
} from '../supabase/functions/_shared/cleanCore/contracts.js'
import { calculateDecisionConfidence } from '../supabase/functions/_shared/cleanCore/confidence.js'

assert.equal(Object.values(CONFIDENCE_COMPONENT_WEIGHTS).reduce((sum, value) => sum + value, 0), 1)

const baseInput = {
  dataQuality: 90,
  analysisQuality: 88,
  modelAgreement: 84,
  marketCompleteness: 86,
  marketFreshness: 92,
  riskPenalty: 0,
  missingDataPenalty: 0,
  contradictionPenalty: 0,
}
const unpenalized = calculateDecisionConfidence(baseInput)
const penalized = calculateDecisionConfidence({
  ...baseInput,
  riskPenalty: 5,
  missingDataPenalty: 7,
  contradictionPenalty: 3,
})
assert.ok(penalized.score < unpenalized.score)
assert.equal(penalized.rawScore, Number((penalized.componentTotal - penalized.penaltyTotal).toFixed(2)))
assert.equal(penalized.uncappedScore, Math.min(100, Math.max(0, penalized.rawScore)))
assert.equal(
  Number((Object.values(penalized.components).reduce((sum, value) => sum + value, 0)
    - Object.values(penalized.penalties).reduce((sum, value) => sum + value, 0)).toFixed(2)),
  penalized.rawScore,
  'breakdown must reconstruct raw score',
)

for (const componentValue of [-100, 0, 25, 100, 200, NaN, Infinity, undefined]) {
  const output = calculateDecisionConfidence({
    dataQuality: componentValue,
    analysisQuality: componentValue,
    modelAgreement: componentValue,
    marketCompleteness: componentValue,
    marketFreshness: componentValue,
  })
  assert.ok(output.score >= 0 && output.score <= 100, `score must be clamped for ${componentValue}`)
  assert.equal(Number.isFinite(output.score), true)
}

const numericStrings = calculateDecisionConfidence({
  dataQuality: '100',
  analysisQuality: '100',
  modelAgreement: '100',
  marketCompleteness: '100',
  marketFreshness: '100',
  riskPenalty: '10',
})
assert.equal(numericStrings.score, 90, 'numeric component and penalty strings are normalized consistently')
assert.equal(calculateDecisionConfidence(null).score, 0, 'missing components must not produce NaN')
assert.doesNotThrow(() => calculateDecisionConfidence({ dataQuality: Symbol('invalid') }))
assert.equal(calculateDecisionConfidence({ dataQuality: Symbol('invalid') }).score, 0)

const fixtureOnly = calculateDecisionConfidence({ ...baseInput, fixtureOnly: true })
assert.equal(fixtureOnly.score, FIXTURE_ONLY_CONFIDENCE_CAP)
assert.equal(fixtureOnly.capped, true)
assert.equal(fixtureOnly.capReason, 'FIXTURE_ONLY')
const fixtureOnlyBelowCap = calculateDecisionConfidence({ dataQuality: 20, fixtureOnly: true })
assert.equal(fixtureOnlyBelowCap.score, 5, 'fixture-only cap must not raise a lower score')
assert.equal(fixtureOnlyBelowCap.capped, false)
assert.equal(fixtureOnlyBelowCap.capReason, null)

const critical = calculateDecisionConfidence({ ...baseInput, riskLevel: 'CRITICAL' })
assert.equal(critical.score, 0)
assert.equal(critical.capped, true)
assert.equal(critical.capReason, 'RISK_CRITICAL')
const criticalAlreadyZero = calculateDecisionConfidence({ riskLevel: 'CRITICAL' })
assert.equal(criticalAlreadyZero.score, 0)
assert.equal(criticalAlreadyZero.capped, false)
assert.equal(criticalAlreadyZero.capReason, 'RISK_CRITICAL')

const frozenInput = Object.freeze({ ...baseInput })
const frozenBefore = JSON.stringify(frozenInput)
assert.deepEqual(calculateDecisionConfidence(frozenInput), calculateDecisionConfidence(frozenInput))
assert.equal(JSON.stringify(frozenInput), frozenBefore)

console.log('clean core confidence unit tests passed')
