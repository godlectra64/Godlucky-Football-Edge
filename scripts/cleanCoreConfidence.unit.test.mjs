import assert from 'node:assert/strict'

import { FIXTURE_ONLY_CONFIDENCE_CAP } from '../supabase/functions/_shared/cleanCore/contracts.js'
import { calculateDecisionConfidence } from '../supabase/functions/_shared/cleanCore/confidence.js'

const aboveRange = calculateDecisionConfidence({
  dataQuality: 200,
  analysisQuality: 200,
  modelAgreement: 200,
  marketCompleteness: 200,
  marketFreshness: 200,
})
assert.equal(aboveRange.score, 100, 'confidence must clamp at 100')

const belowRange = calculateDecisionConfidence({
  riskPenalty: 100,
  missingDataPenalty: 100,
  contradictionPenalty: 100,
})
assert.equal(belowRange.score, 0, 'confidence must clamp at 0')

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
assert.ok(penalized.score < unpenalized.score, 'penalties must reduce confidence')

const fixtureOnly = calculateDecisionConfidence({ ...baseInput, fixtureOnly: true })
assert.equal(fixtureOnly.score, FIXTURE_ONLY_CONFIDENCE_CAP, 'fixture-only confidence must use the existing cap')
assert.equal(fixtureOnly.capped, true)
assert.equal(fixtureOnly.capReason, 'FIXTURE_ONLY')

const reconstructedRaw = Number((
  Object.values(penalized.components).reduce((sum, value) => sum + value, 0)
  - Object.values(penalized.penalties).reduce((sum, value) => sum + value, 0)
).toFixed(2))
assert.equal(reconstructedRaw, penalized.rawScore, 'breakdown must reconstruct the raw score')

assert.deepEqual(calculateDecisionConfidence(baseInput), calculateDecisionConfidence(baseInput), 'same input must produce the same output')

const critical = calculateDecisionConfidence({ ...baseInput, riskLevel: 'CRITICAL' })
assert.equal(critical.score, 0, 'CRITICAL risk must not receive ready confidence')

console.log('clean core confidence unit tests passed')
