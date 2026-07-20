import assert from 'node:assert/strict'

import { MARKET_TYPE } from '../supabase/functions/_shared/cleanCore/contracts.js'
import {
  canMarketProduceReady,
  getMarketCapability,
  isActionableMarket,
  normalizeMarketType,
} from '../supabase/functions/_shared/cleanCore/markets.js'

assert.equal(canMarketProduceReady('AH'), true, 'AH must be able to produce READY')
assert.equal(canMarketProduceReady('OU'), true, 'OU must be able to produce READY')
assert.equal(canMarketProduceReady('1X2'), false, '1X2 must not produce READY in V1')
assert.equal(canMarketProduceReady('Double Chance'), false, 'Double Chance must not produce READY in V1')
assert.equal(getMarketCapability('Correct Score').insightOnly, true, 'Correct Score must be insight only')
assert.equal(getMarketCapability('BTTS').insightOnly, true, 'BTTS must be insight only')
assert.equal(isActionableMarket('something new'), false, 'unknown markets must not be actionable')
assert.equal(normalizeMarketType('Asian Handicap'), MARKET_TYPE.ASIAN_HANDICAP)
assert.equal(normalizeMarketType('Over/Under'), MARKET_TYPE.OVER_UNDER)
assert.equal(Object.isFrozen(getMarketCapability('AH')), true, 'market capabilities must be immutable')

console.log('clean core markets unit tests passed')
