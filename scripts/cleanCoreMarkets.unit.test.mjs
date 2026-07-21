import assert from 'node:assert/strict'

import { MARKET_TYPE } from '../supabase/functions/_shared/cleanCore/contracts.js'
import {
  MARKET_CAPABILITIES,
  canMarketProduceReady,
  getMarketCapability,
  isActionableMarket,
  isSettlementSupported,
  normalizeMarketType,
} from '../supabase/functions/_shared/cleanCore/markets.js'

const aliases = new Map([
  [MARKET_TYPE.ASIAN_HANDICAP, ['AH', 'ASIAN_HANDICAP', 'asian handicap', 'asian_handicap', 'HANDICAP']],
  [MARKET_TYPE.OVER_UNDER, ['OU', 'O/U', 'OVER_UNDER', 'over under', 'TOTALS']],
  [MARKET_TYPE.MATCH_WINNER, ['1X2', 'MATCH_WINNER', 'match winner', 'HOME_DRAW_AWAY']],
  [MARKET_TYPE.DOUBLE_CHANCE, ['DOUBLE_CHANCE', 'double chance']],
])
for (const [expected, values] of aliases) {
  for (const value of values) assert.equal(normalizeMarketType(value), expected, `${value} must normalize to ${expected}`)
}

for (const selection of ['1X', 'X2', '12']) {
  assert.equal(normalizeMarketType(selection), MARKET_TYPE.UNKNOWN, `${selection} is a selection, not a market type`)
}
for (const unknown of [null, undefined, '', '   ', 12, 999, {}, [], Symbol('market')]) {
  assert.doesNotThrow(() => normalizeMarketType(unknown))
  assert.equal(normalizeMarketType(unknown), MARKET_TYPE.UNKNOWN)
}
const hostile = { toString() { throw new Error('must not coerce objects') } }
assert.equal(normalizeMarketType(hostile), MARKET_TYPE.UNKNOWN)

assert.equal(canMarketProduceReady('AH'), true)
assert.equal(canMarketProduceReady('OU'), true)
for (const market of ['MATCH_WINNER', 'DOUBLE_CHANCE', 'CORRECT_SCORE', 'BTTS', 'UNKNOWN']) {
  assert.equal(canMarketProduceReady(market), false, `${market} must not produce READY in V1`)
}
assert.equal(isActionableMarket('AH'), true)
assert.equal(isActionableMarket('OU'), true)
assert.equal(isActionableMarket('UNKNOWN'), false)
assert.equal(isSettlementSupported('AH'), true)
assert.equal(isSettlementSupported('OU'), true)
assert.equal(isSettlementSupported('MATCH_WINNER'), true)
for (const market of ['DOUBLE_CHANCE', 'CORRECT_SCORE', 'BTTS', 'UNKNOWN']) assert.equal(isSettlementSupported(market), false)
assert.equal(getMarketCapability('CORRECT_SCORE').insightOnly, true)
assert.equal(getMarketCapability('BTTS').insightOnly, true)
assert.equal(Object.isFrozen(MARKET_CAPABILITIES), true)
assert.equal(Object.isFrozen(getMarketCapability('AH')), true)
assert.throws(() => { getMarketCapability('AH').actionable = false }, TypeError)
assert.equal(getMarketCapability('AH').actionable, true)

console.log('clean core markets unit tests passed')
