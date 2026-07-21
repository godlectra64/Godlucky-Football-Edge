import assert from 'node:assert/strict'

import { canSettleMarket, validateSettlementInput } from '../supabase/functions/_shared/cleanCore/results.js'

for (const market of ['AH', 'OU', 'MATCH_WINNER']) assert.equal(canSettleMarket(market), true)
for (const market of ['DOUBLE_CHANCE', 'CORRECT_SCORE', 'BTTS', 'UNKNOWN']) assert.equal(canSettleMarket(market), false)

assert.equal(validateSettlementInput(settlement()).valid, true)
assert.equal(validateSettlementInput(settlement({ homeScore: 0, awayScore: 0, line: 0 })).valid, true, '0-0 and line 0 must be valid')
assert.equal(validateSettlementInput(settlement({ marketType: 'OU', selection: 'UNDER', line: 0 })).valid, true)
assert.equal(validateSettlementInput(settlement({ marketType: 'MATCH_WINNER', selection: 'DRAW', line: undefined })).valid, true)

for (const overrides of [
  { homeScore: -1 },
  { awayScore: -1 },
  { homeScore: 1.5 },
  { awayScore: 0.5 },
  { homeScore: undefined },
  { awayScore: undefined },
  { homeScore: '0' },
]) assert.ok(validateSettlementInput(settlement(overrides)).errors.includes('SETTLEMENT_SCORE_INVALID'))

assert.ok(validateSettlementInput(settlement({ statusShort: 'NS' })).errors.includes('SETTLEMENT_STATUS_NOT_TERMINAL'))
assert.ok(validateSettlementInput(settlement({ selection: '' })).errors.includes('SETTLEMENT_SELECTION_MISSING'))
assert.ok(validateSettlementInput(settlement({ line: 'line=-0.5' })).errors.includes('SETTLEMENT_LINE_INVALID'))
assert.ok(validateSettlementInput(settlement({ marketType: 'MATCH_WINNER', selection: 'BOTH' })).errors.includes('SETTLEMENT_SELECTION_INVALID'))
for (const marketType of ['DOUBLE_CHANCE', 'CORRECT_SCORE', 'BTTS', 'UNKNOWN']) {
  assert.ok(validateSettlementInput(settlement({ marketType })).errors.includes('SETTLEMENT_MARKET_UNSUPPORTED'))
}

assert.equal(validateSettlementInput({ marketType: 'AH', statusShort: 'CANC' }).valid, true, 'void results may settle without a score')
const frozen = Object.freeze(settlement())
const before = JSON.stringify(frozen)
assert.equal(validateSettlementInput(frozen).valid, true)
assert.equal(JSON.stringify(frozen), before)

console.log('clean core results unit tests passed')

function settlement(overrides = {}) {
  return {
    marketType: 'AH',
    statusShort: 'FT',
    homeScore: 2,
    awayScore: 1,
    selection: 'HOME',
    line: -0.5,
    ...overrides,
  }
}
