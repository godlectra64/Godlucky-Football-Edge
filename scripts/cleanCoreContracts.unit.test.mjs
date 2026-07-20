import assert from 'node:assert/strict'

import {
  DECISION_STATUS,
  FUTURE_PIPELINE_STAGE,
  MARKET_TYPE,
  PIPELINE_STAGE,
  REQUIRED_PIPELINE_SEQUENCE,
} from '../supabase/functions/_shared/cleanCore/contracts.js'
import { normalizeMarketType } from '../supabase/functions/_shared/cleanCore/markets.js'

assert.deepEqual(Object.values(DECISION_STATUS), ['READY', 'WATCH', 'WAIT', 'REJECTED'], 'decision statuses must contain exactly four canonical values')
assert.equal(Object.isFrozen(DECISION_STATUS), true, 'decision status contract must be frozen')
assert.equal(Object.isFrozen(REQUIRED_PIPELINE_SEQUENCE), true, 'pipeline sequence must be frozen')
assert.throws(() => {
  DECISION_STATUS.READY = 'CHANGED'
}, TypeError, 'frozen constants must reject mutation')
assert.equal(normalizeMarketType('unrecognized market'), MARKET_TYPE.UNKNOWN, 'unknown markets must normalize to UNKNOWN')
assert.equal(REQUIRED_PIPELINE_SEQUENCE.includes(FUTURE_PIPELINE_STAGE.NEAR_KICKOFF_REFRESH), false, 'future refresh must not be required in V1')
assert.equal(REQUIRED_PIPELINE_SEQUENCE.includes(FUTURE_PIPELINE_STAGE.FINAL_LOCK), false, 'future lock must not be required in V1')
assert.equal(REQUIRED_PIPELINE_SEQUENCE.at(-1), PIPELINE_STAGE.COMPLETE, 'COMPLETE must close the canonical sequence')

console.log('clean core contracts unit tests passed')
