import assert from 'node:assert/strict'

import {
  validateAnalysis,
  validateFinalPick,
  validateFixture,
  validateMarket,
} from '../supabase/functions/_shared/cleanCore/validation.js'

const baseFixture = fixture()
for (const value of [
  baseFixture,
  fixture({ id: 0 }),
  fixture({ id: 'fixture-101' }),
  fixture({ status: 'ns' }),
  fixture({ status: 'TBD' }),
  fixture({ status: 'LIVE' }),
  fixture({ status: 'INT' }),
  fixture({ kickoffAt: new Date('2030-07-20T12:00:00.000Z') }),
]) {
  const result = validateFixture(value)
  assert.equal(result.valid, true, result.errors.join(', '))
  assert.equal(result.retryable, false)
  assert.equal(result.terminal, false)
}

for (const status of ['FT', 'AET', 'PEN', 'CANC', 'ABD', 'PST', 'AWD', 'WO']) {
  const result = validateFixture(fixture({ status }))
  assert.ok(result.errors.includes('MATCH_NOT_PLAYABLE'), `${status} must not be playable`)
  assert.equal(result.terminal, true)
  assert.equal(result.retryable, false)
}

for (const id of ['', '   ', null, undefined]) assert.ok(validateFixture(fixture({ id })).errors.includes('FIXTURE_ID_MISSING'))
assert.ok(validateFixture(fixture({ homeTeam: { id: 2, name: 'Alpha' } })).errors.includes('FIXTURE_TEAM_IDS_IDENTICAL'))
assert.equal(validateFixture(fixture({ awayTeam: { id: 2, name: 'Alpha' } })).valid, true, 'same names with distinct IDs must remain valid')
assert.ok(validateFixture(fixture({ kickoffAt: 'not-a-date' })).errors.includes('KICKOFF_INVALID'))
assert.ok(validateFixture(fixture({ league: { name: 'Test League' } })).errors.includes('LEAGUE_ID_MISSING'))
assert.ok(validateFixture({}).errors.includes('HOME_TEAM_MISSING'))
const retryableFixture = validateFixture(fixture({ id: '' }))
assert.equal(retryableFixture.retryable, true)
assert.equal(retryableFixture.terminal, false)

const frozenFixture = deepFreeze(fixture())
const frozenFixtureBefore = JSON.stringify(frozenFixture)
assert.equal(validateFixture(frozenFixture).valid, true)
assert.equal(JSON.stringify(frozenFixture), frozenFixtureBefore)

for (const confidence of [0, 100]) {
  const result = validateAnalysis({ score: 0, confidence, riskLevel: 'LOW', output: { value: 0 } })
  assert.equal(result.valid, true, result.errors.join(', '))
}
for (const confidence of [-0.01, 100.01, '80', NaN, Infinity]) {
  assert.ok(validateAnalysis({ score: 1, confidence, riskLevel: 'LOW', output: 'HOME' }).errors.includes('ANALYSIS_CONFIDENCE_INVALID'))
}
for (const riskLevel of ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) {
  assert.equal(validateAnalysis({ score: 1, confidence: 50, riskLevel, output: 'HOME' }).valid, true)
}
assert.ok(validateAnalysis({ confidence: 50, riskLevel: 'LOW', output: 'HOME' }).errors.includes('ANALYSIS_SCORE_INVALID'))
assert.ok(validateAnalysis({ score: 0, confidence: 50, riskLevel: 'UNKNOWN', output: 'HOME' }).errors.includes('ANALYSIS_RISK_INVALID'))
assert.ok(validateAnalysis({ score: 0, confidence: 50, riskLevel: 'LOW', output: '' }).errors.includes('ANALYSIS_OUTPUT_MISSING'))
assert.ok(validateAnalysis({ score: 0, confidence: 50, riskLevel: 'LOW', output: {} }).errors.includes('ANALYSIS_OUTPUT_MISSING'))
assert.ok(validateAnalysis(null).errors.includes('ANALYSIS_MISSING'))

const baseMarket = market()
assert.equal(validateMarket(baseMarket, freshnessOptions()).valid, true)
assert.equal(validateMarket(market({ line: 0 }), freshnessOptions()).valid, true, 'AH line 0 must be valid')
assert.equal(validateMarket(market({ line: -0.25 }), freshnessOptions()).valid, true)
assert.equal(validateMarket(market({ line: '-0.25' }), freshnessOptions()).valid, true)
assert.equal(validateMarket(market({ marketType: 'OU', selection: 'OVER', line: 2.5 }), freshnessOptions()).valid, true)
assert.equal(validateMarket(market({ marketType: 'OU', selection: 'UNDER', line: 0 }), freshnessOptions()).valid, true)
assert.ok(validateMarket(market({ line: 'line=-0.25' }), freshnessOptions()).errors.includes('MARKET_LINE_INVALID'))
assert.ok(validateMarket(market({ timestamp: 'invalid' }), { fresh: true }).errors.includes('MARKET_TIMESTAMP_INVALID'))
assert.ok(validateMarket(market({ timestamp: undefined }), { marketAgeHours: 0 }).errors.includes('MARKET_TIMESTAMP_INVALID'))
assert.ok(validateMarket(market({ source: undefined }), freshnessOptions()).errors.includes('MARKET_SOURCE_MISSING'))
assert.ok(validateMarket(market({ bookmaker: undefined }), freshnessOptions()).errors.includes('MARKET_BOOKMAKER_MISSING'))
assert.equal(validateMarket(baseMarket, { marketAgeHours: 0, marketFreshnessHours: 6 }).valid, true)
assert.equal(validateMarket(baseMarket, { marketAgeHours: 6, marketFreshnessHours: 6 }).valid, true, 'age equal to threshold must be fresh')
assert.ok(validateMarket(baseMarket, { marketAgeHours: 6.0001, marketFreshnessHours: 6 }).errors.includes('MARKET_STALE'))
assert.ok(validateMarket(baseMarket, { marketAgeHours: -0.01, marketFreshnessHours: 6 }).errors.includes('MARKET_AGE_INVALID'))
assert.ok(validateMarket(baseMarket, { marketAgeHours: 0, marketFreshnessHours: -1 }).errors.includes('MARKET_FRESHNESS_THRESHOLD_INVALID'))
assert.equal(validateMarket(market({ marketType: 'CORRECT_SCORE', selection: '2-1', line: undefined }), freshnessOptions()).valid, true)
assert.ok(validateMarket(market({ marketType: 'UNKNOWN' }), freshnessOptions()).errors.includes('MARKET_TYPE_INVALID'))

const basePick = finalPick()
assert.equal(validateFinalPick(basePick, readyContext()).valid, true)
assert.equal(validateFinalPick(finalPick({ line: 0, confidence: 0 }), readyContext()).valid, true)
assert.equal(validateFinalPick(finalPick({ marketType: 'OU', selection: 'UNDER', line: 0, confidence: 100 }), readyContext()).valid, true)
for (const marketType of ['MATCH_WINNER', 'DOUBLE_CHANCE', 'CORRECT_SCORE']) {
  assert.ok(validateFinalPick(finalPick({ marketType }), readyContext()).errors.includes('FINAL_PICK_MARKET_NOT_ACTIONABLE'))
}
assert.ok(validateFinalPick(finalPick({ selection: '   ' }), readyContext()).errors.includes('FINAL_PICK_SELECTION_INVALID'))
assert.ok(validateFinalPick(finalPick({ confidence: '80' }), readyContext()).errors.includes('FINAL_PICK_CONFIDENCE_INVALID'))
assert.ok(validateFinalPick(finalPick({ riskLevel: 'CRITICAL' }), readyContext()).errors.includes('FINAL_PICK_RISK_CRITICAL'))
assert.ok(validateFinalPick(basePick, { marketReady: false, marketFresh: true }).errors.includes('FINAL_PICK_MARKET_NOT_READY'))
assert.ok(validateFinalPick(basePick, { marketReady: true, marketFresh: false }).errors.includes('FINAL_PICK_MARKET_NOT_FRESH'))

const frozenMarket = deepFreeze(market())
const frozenMarketBefore = JSON.stringify(frozenMarket)
validateMarket(frozenMarket, freshnessOptions())
assert.equal(JSON.stringify(frozenMarket), frozenMarketBefore, 'validators must not mutate frozen input')

console.log('clean core validation unit tests passed')

function fixture(overrides = {}) {
  return {
    id: 101,
    homeTeam: { id: 1, name: 'Alpha' },
    awayTeam: { id: 2, name: 'Beta' },
    kickoffAt: '2030-07-20T12:00:00.000Z',
    league: { id: 99, name: 'Test League' },
    status: { short: 'NS' },
    ...overrides,
  }
}

function market(overrides = {}) {
  return {
    marketType: 'AH',
    selection: 'HOME',
    line: -0.5,
    source: 'API_FOOTBALL',
    bookmaker: 'Test Bookmaker',
    timestamp: '2030-07-20T09:00:00.000Z',
    ...overrides,
  }
}

function freshnessOptions() {
  return { referenceTime: '2030-07-20T12:00:00.000Z', marketFreshnessHours: 6 }
}

function finalPick(overrides = {}) {
  return { marketType: 'AH', selection: 'HOME', line: -0.5, confidence: 81, riskLevel: 'MEDIUM', ...overrides }
}

function readyContext() {
  return { marketReady: true, marketFresh: true }
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item)
    Object.freeze(value)
  }
  return value
}
