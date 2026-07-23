import assert from 'node:assert/strict'

import {
  CONFIDENCE_COMPONENT_WEIGHTS,
  DECISION_STATUS,
  DEFAULT_DECISION_THRESHOLDS,
  FIXTURE_ONLY_CONFIDENCE_CAP,
  FUTURE_PIPELINE_STAGE,
  MARKET_TYPE,
  MATCH_STATUS_CATEGORY,
  PIPELINE_STAGE,
  REASON_CODE,
  REQUIRED_PIPELINE_SEQUENCE,
  RISK_LEVEL,
} from '../supabase/functions/_shared/cleanCore/contracts.js'

assert.deepEqual(Object.values(DECISION_STATUS), ['READY', 'WATCH', 'WAIT', 'REJECTED'])
assert.deepEqual(Object.values(RISK_LEVEL), ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
assert.deepEqual(Object.values(MATCH_STATUS_CATEGORY), [
  'PREMATCH_DECISION_ELIGIBLE',
  'STARTED_OR_LIVE',
  'TERMINAL_OR_VOID',
  'RETRYABLE_NOT_READY',
  'UNKNOWN',
])
assert.equal(FIXTURE_ONLY_CONFIDENCE_CAP, 60)
assert.equal(REQUIRED_PIPELINE_SEQUENCE.at(-1), PIPELINE_STAGE.COMPLETE)
assert.equal(REQUIRED_PIPELINE_SEQUENCE.includes(FUTURE_PIPELINE_STAGE.NEAR_KICKOFF_REFRESH), false)
assert.equal(REQUIRED_PIPELINE_SEQUENCE.includes(FUTURE_PIPELINE_STAGE.FINAL_LOCK), false)
assert.equal(Object.values(CONFIDENCE_COMPONENT_WEIGHTS).reduce((sum, value) => sum + value, 0), 1)
assert.deepEqual(DEFAULT_DECISION_THRESHOLDS, {
  readyConfidenceThreshold: 80,
  watchConfidenceThreshold: 70,
  minimumDataQuality: 60,
  marketFreshnessHours: 12,
})

for (const [name, contract] of Object.entries({
  DECISION_STATUS,
  PIPELINE_STAGE,
  REQUIRED_PIPELINE_SEQUENCE,
  FUTURE_PIPELINE_STAGE,
  MARKET_TYPE,
  MATCH_STATUS_CATEGORY,
  RISK_LEVEL,
  REASON_CODE,
  DEFAULT_DECISION_THRESHOLDS,
  CONFIDENCE_COMPONENT_WEIGHTS,
})) assert.equal(Object.isFrozen(contract), true, `${name} must be frozen`)

for (const [name, values] of Object.entries({
  PIPELINE_STAGE: Object.values(PIPELINE_STAGE),
  MARKET_TYPE: Object.values(MARKET_TYPE),
  REASON_CODE: Object.values(REASON_CODE),
})) assert.equal(new Set(values).size, values.length, `${name} values must be unique`)

assert.throws(() => REQUIRED_PIPELINE_SEQUENCE.push('MUTATED'), TypeError)
assert.throws(() => REQUIRED_PIPELINE_SEQUENCE.splice(0, 1), TypeError)
assert.throws(() => { REQUIRED_PIPELINE_SEQUENCE[0] = 'MUTATED' }, TypeError)
assert.throws(() => { DECISION_STATUS.READY = 'MUTATED' }, TypeError)
assert.throws(() => { DEFAULT_DECISION_THRESHOLDS.readyConfidenceThreshold = 1 }, TypeError)
assert.equal(DECISION_STATUS.READY, 'READY', 'failed mutation must not affect later callers')
assert.equal(REQUIRED_PIPELINE_SEQUENCE[0], PIPELINE_STAGE.OPEN_DAY, 'failed mutation must not affect later tests')

console.log('clean core contracts unit tests passed')
