import assert from 'node:assert/strict'

import {
  validateAnalysis,
  validateFinalPick,
  validateFixture,
  validateMarket,
} from '../supabase/functions/_shared/cleanCore/validation.js'

const fixture = {
  id: 101,
  homeTeam: { name: 'Alpha' },
  awayTeam: { name: 'Beta' },
  kickoffAt: '2030-07-20T12:00:00.000Z',
  league: { name: 'Test League' },
  status: { short: 'NS' },
}
assert.equal(validateFixture(fixture).valid, true)
assert.equal(validateFixture({ ...fixture, awayTeam: { name: 'Alpha' } }).valid, false, 'same home and away team must fail')
assert.ok(validateFixture({ ...fixture, status: 'FT' }).errors.includes('MATCH_NOT_PLAYABLE'), 'finished fixture must not be playable')
assert.ok(validateFixture({ ...fixture, status: 'PST' }).errors.includes('MATCH_NOT_PLAYABLE'), 'postponed fixture must not be playable')

const validAnalysis = validateAnalysis({
  score: 78,
  confidence: 82,
  riskLevel: 'LOW',
  output: { direction: 'HOME' },
})
assert.equal(validAnalysis.valid, true, validAnalysis.errors.join(', '))
assert.equal(validateAnalysis({ score: 78, confidence: 101, riskLevel: 'LOW', output: 'HOME' }).valid, false)
assert.equal(validateAnalysis({ score: 78, confidence: 82, riskLevel: 'UNSAFE', output: 'HOME' }).valid, false)

const validMarket = validateMarket({
  marketType: 'AH',
  selection: 'HOME',
  line: -0.5,
  source: 'Test Bookmaker',
  timestamp: '2030-07-20T09:00:00.000Z',
}, {
  referenceTime: '2030-07-20T12:00:00.000Z',
  maxAgeHours: 6,
})
assert.equal(validMarket.valid, true, validMarket.errors.join(', '))

const staleMarket = validateMarket({
  marketType: 'OU',
  selection: 'OVER',
  line: 2.5,
  source: 'Test Bookmaker',
  timestamp: '2030-07-19T12:00:00.000Z',
  fresh: false,
})
assert.ok(staleMarket.errors.includes('MARKET_STALE'))

const validPick = validateFinalPick({
  marketType: 'OU',
  selection: 'UNDER',
  line: 2.5,
  confidence: 81,
  riskLevel: 'MEDIUM',
}, {
  marketReady: true,
  marketFresh: true,
})
assert.equal(validPick.valid, true, validPick.errors.join(', '))

const unsupportedPick = validateFinalPick({
  marketType: 'CORRECT_SCORE',
  selection: '2-1',
  confidence: 81,
  riskLevel: 'LOW',
}, {
  marketReady: true,
  marketFresh: true,
})
assert.ok(unsupportedPick.errors.includes('FINAL_PICK_MARKET_NOT_ACTIONABLE'))

console.log('clean core validation unit tests passed')
