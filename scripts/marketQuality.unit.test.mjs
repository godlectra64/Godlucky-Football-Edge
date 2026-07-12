import assert from 'node:assert/strict'
import { classifyDecisionFromMarkets, evaluateMarketQuality } from '../src/utils/marketQuality.js'
import { MARKET_TYPES, normalizeMarketRecord, normalizeMarketType, validateMarketRecord } from '../src/utils/marketRegistry.js'
import { settleAiPickResult } from '../src/utils/resultSettlement.js'

const now = '2026-07-12T12:00:00.000Z'
const common = { fixtureId: 'fixture-1', capturedAt: now, bookmakerId: 1, bookmakerName: 'Provider Book' }

assert.equal(normalizeMarketType('Asian Handicap'), MARKET_TYPES.ASIAN_HANDICAP)
assert.equal(normalizeMarketType('Goal Line'), MARKET_TYPES.OVER_UNDER)
assert.equal(normalizeMarketType('Home/Draw/Away'), MARKET_TYPES.MATCH_WINNER_1X2)
assert.equal(normalizeMarketType('Double Chance'), MARKET_TYPES.DOUBLE_CHANCE)
assert.equal(normalizeMarketType('Correct Score'), MARKET_TYPES.CORRECT_SCORE)
assert.equal(normalizeMarketType('Corners'), null)

const invalid = normalizeMarketRecord({ ...common, market_name: 'Match Winner', selection: 'Home', price: 1 })
assert.deepEqual(validateMarketRecord(invalid).reasonCodes, ['INVALID_PRICE'])

const oneX2Rows = [
  { ...common, market_name: 'Match Winner', selection: 'Home', price: 2.2 },
  { ...common, market_name: 'Match Winner', selection: 'Draw', price: 3.4 },
  { ...common, market_name: 'Match Winner', selection: 'Away', price: 3.1 },
]
const oneX2 = evaluateMarketQuality(oneX2Rows, { now })
assert.equal(oneX2.status, 'READY_ALTERNATIVE')
assert.equal(oneX2.decisionMarket, MARKET_TYPES.MATCH_WINNER_1X2)
assert.ok(oneX2.markets.find((item) => item.marketType === MARKET_TYPES.MATCH_WINNER_1X2).overround > 1)

const doubleChanceRows = [
  { ...common, market_name: 'Double Chance', selection: '1X', price: 1.35 },
  { ...common, market_name: 'Double Chance', selection: '12', price: 1.28 },
  { ...common, market_name: 'Double Chance', selection: 'X2', price: 1.72 },
]
assert.equal(classifyDecisionFromMarkets(doubleChanceRows, { now }).status, 'READY_ALTERNATIVE')

const correctScoreOnly = [
  { ...common, market_name: 'Correct Score', selection: '1-0', price: 7.5 },
  { ...common, market_name: 'Correct Score', selection: '1-1', price: 6.5 },
  { ...common, market_name: 'Correct Score', selection: '2-1', price: 8.5 },
]
assert.equal(classifyDecisionFromMarkets(correctScoreOnly, { now }).status, 'WAITING_MARKET')

assert.equal(settleAiPickResult({ statusShort: 'FT', homeScore: 1, awayScore: 1, marketFocus: 'DOUBLE_CHANCE', direction: '1X' }).simulation_outcome, 'HIT')
assert.equal(settleAiPickResult({ statusShort: 'FT', homeScore: 1, awayScore: 1, marketFocus: 'DOUBLE_CHANCE', direction: '12' }).simulation_outcome, 'MISS')
assert.equal(settleAiPickResult({ statusShort: 'FT', homeScore: 1, awayScore: 2, marketFocus: 'DOUBLE_CHANCE', direction: 'X2' }).simulation_outcome, 'HIT')

console.log('market quality unit tests passed')
