import assert from 'node:assert/strict'

import { canSettleMarket, validateSettlementInput } from '../supabase/functions/_shared/cleanCore/results.js'

assert.equal(canSettleMarket('AH'), true, 'AH must be settlement supported')
assert.equal(canSettleMarket('OU'), true, 'OU must be settlement supported')
assert.equal(canSettleMarket('MATCH_WINNER'), true, 'MATCH_WINNER must be settlement supported')
assert.equal(canSettleMarket('DOUBLE_CHANCE'), false, 'Double Chance must remain unsupported')
assert.equal(canSettleMarket('CORRECT_SCORE'), false, 'Correct Score must remain unsupported')
assert.equal(canSettleMarket('BTTS'), false, 'BTTS must remain unsupported')

const validAhInput = validateSettlementInput({
  marketType: 'AH',
  statusShort: 'FT',
  homeScore: 2,
  awayScore: 1,
  selection: 'HOME',
  line: -0.5,
})
assert.equal(validAhInput.valid, true, validAhInput.errors.join(', '))

const unsupportedInput = validateSettlementInput({
  marketType: 'BTTS',
  statusShort: 'FT',
  homeScore: 2,
  awayScore: 1,
  selection: 'YES',
})
assert.equal(unsupportedInput.valid, false)
assert.ok(unsupportedInput.errors.includes('SETTLEMENT_MARKET_UNSUPPORTED'))

console.log('clean core results unit tests passed')
